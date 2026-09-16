import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpService } from './mcp.service';
import type { McpToolRegistryService } from './mcp-tool-registry.service';

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({
    start: jest.fn(async () => undefined),
  })),
}));

type RequestHandler = (request: unknown) => Promise<unknown>;

// Captura os handlers registrados via setRequestHandler, contornando a
// validação/transporte reais do SDK — queremos testar a lógica do
// McpService, não reimplementar o SDK.
let capturedHandlers: Map<unknown, RequestHandler>;
let setRequestHandlerSpy: ReturnType<typeof jest.spyOn>;

function getHandler(schema: unknown): RequestHandler {
  const handler = capturedHandlers.get(schema);
  if (!handler) throw new Error('handler não registrado para esse schema');
  return handler;
}

function makeConfigService(values: Record<string, string> = {}): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: unknown) => (key in values ? values[key] : defaultValue)),
  } as unknown as ConfigService;
}

function makeRegistry() {
  return {
    getAllTools: jest.fn(() => [{ name: 't', description: 'd', inputSchema: {} }]),
    getAllResources: jest.fn(() => [{ uri: 'app://x', name: 'x', description: 'd', mimeType: 'application/json' }]),
    callTool: jest.fn(async (..._args: unknown[]): Promise<unknown> => ({ ok: true })),
    readResource: jest.fn(async (..._args: unknown[]): Promise<unknown> => ({ ok: true })),
  };
}

function makeLogger() {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    logger: {},
  };
}

function makeService() {
  const configService = makeConfigService();
  const registry = makeRegistry();
  const logger = makeLogger();
  const service = new McpService(configService, registry as unknown as McpToolRegistryService, logger as unknown as PinoLogger);
  return { service, configService, registry, logger };
}

describe('McpService', () => {
  beforeEach(() => {
    capturedHandlers = new Map();
    setRequestHandlerSpy = jest.spyOn(Server.prototype, 'setRequestHandler').mockImplementation(function (
      this: unknown,
      schema: unknown,
      handler: unknown,
    ) {
      capturedHandlers.set(schema, handler as RequestHandler);
    });
  });

  afterEach(() => {
    setRequestHandlerSpy.mockRestore();
  });

  it('configura o contexto do logger e registra os 4 handlers no construtor', () => {
    const { logger } = makeService();
    expect(logger.setContext).toHaveBeenCalledWith('McpService');
    expect(capturedHandlers.has(ListToolsRequestSchema)).toBe(true);
    expect(capturedHandlers.has(CallToolRequestSchema)).toBe(true);
    expect(capturedHandlers.has(ListResourcesRequestSchema)).toBe(true);
    expect(capturedHandlers.has(ReadResourceRequestSchema)).toBe(true);
  });

  describe('ListTools', () => {
    it('retorna as tools do registry', async () => {
      const { registry } = makeService();
      const result = (await getHandler(ListToolsRequestSchema)({})) as {
        tools: unknown[];
      };
      expect(result.tools).toEqual(registry.getAllTools());
    });
  });

  describe('CallTool', () => {
    it('retorna o resultado do registry como texto JSON', async () => {
      const { registry } = makeService();
      registry.callTool.mockResolvedValueOnce({ valor: 42 });

      const result = (await getHandler(CallToolRequestSchema)({
        params: { name: 'minha_tool', arguments: { x: 1 } },
      })) as { content: Array<{ type: string; text: string }> };

      expect(registry.callTool).toHaveBeenCalledWith('minha_tool', { x: 1 });
      expect(JSON.parse(result.content[0].text)).toEqual({ valor: 42 });
    });

    it('usa objeto vazio quando arguments não é informado', async () => {
      const { registry } = makeService();
      await getHandler(CallToolRequestSchema)({
        params: { name: 'minha_tool' },
      });
      expect(registry.callTool).toHaveBeenCalledWith('minha_tool', {});
    });

    it('redige password/secret e trunca strings longas antes de logar', async () => {
      const { registry, logger } = makeService();
      const longValue = 'x'.repeat(300);

      await getHandler(CallToolRequestSchema)({
        params: {
          name: 't',
          arguments: { DB_PASSWORD: 'segredo', API_SECRET: 's', nota: longValue, ok: 'normal' },
        },
      });

      const infoCall = logger.info.mock.calls.find((call) => (call[1] as string)?.startsWith('Tool called')) as [
        { params: Record<string, string> },
        string,
      ];
      expect(infoCall[0].params.DB_PASSWORD).toBe('***REDACTED***');
      expect(infoCall[0].params.API_SECRET).toBe('***REDACTED***');
      expect(infoCall[0].params.nota).toHaveLength(200 + '... (truncated)'.length);
      expect(infoCall[0].params.ok).toBe('normal');
      // params originais não são mutados pela sanitização usada no callTool
      expect(registry.callTool).toHaveBeenCalledWith('t', {
        DB_PASSWORD: 'segredo',
        API_SECRET: 's',
        nota: longValue,
        ok: 'normal',
      });
    });

    it('chama flushSync quando o logger interno expõe esse método', async () => {
      const { logger } = makeService();
      const flushSync = jest.fn();
      (logger.logger as { flushSync?: () => void }).flushSync = flushSync;

      await getHandler(CallToolRequestSchema)({
        params: { name: 't', arguments: {} },
      });

      expect(flushSync).toHaveBeenCalled();
    });

    it('não lança quando o logger interno não expõe flushSync', async () => {
      makeService();
      await expect(getHandler(CallToolRequestSchema)({ params: { name: 't', arguments: {} } })).resolves.toBeDefined();
    });

    it('retorna isError:true e mensagem quando a tool falha', async () => {
      const { registry } = makeService();
      registry.callTool.mockRejectedValueOnce(new Error('deu ruim'));

      const result = (await getHandler(CallToolRequestSchema)({
        params: { name: 't', arguments: {} },
      })) as { isError: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual({
        error: true,
        message: 'deu ruim',
      });
    });
  });

  describe('ListResources', () => {
    it('retorna os resources do registry', async () => {
      const { registry } = makeService();
      const result = (await getHandler(ListResourcesRequestSchema)({})) as {
        resources: unknown[];
      };
      expect(result.resources).toEqual(registry.getAllResources());
    });
  });

  describe('ReadResource', () => {
    it('retorna o conteúdo como texto JSON', async () => {
      const { registry } = makeService();
      registry.readResource.mockResolvedValueOnce({ dado: 'x' });

      const result = (await getHandler(ReadResourceRequestSchema)({
        params: { uri: 'app://x/1' },
      })) as { contents: Array<{ uri: string; text: string }> };

      expect(registry.readResource).toHaveBeenCalledWith('app://x/1');
      expect(result.contents[0].uri).toBe('app://x/1');
      expect(JSON.parse(result.contents[0].text)).toEqual({ dado: 'x' });
    });

    it('lança erro com cause quando a leitura falha', async () => {
      const { registry, logger } = makeService();
      registry.readResource.mockRejectedValueOnce(new Error('não achou'));

      await expect(getHandler(ReadResourceRequestSchema)({ params: { uri: 'app://x/1' } })).rejects.toThrow(
        /Failed to read resource app:\/\/x\/1: não achou/,
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('conecta o transporte e loga sucesso', async () => {
      const { service, logger } = makeService();
      await service.start();
      expect(logger.info.mock.calls.some((call) => call[1] === 'MCP App server started successfully and ready to receive requests')).toBe(true);
    });

    it('registra o onerror do server e loga quando disparado', async () => {
      const { service, logger } = makeService();
      await service.start();

      const internals = service as unknown as {
        mcpServer: McpServer;
      };
      const boom = new Error('boom');
      internals.mcpServer.server.onerror?.(boom);

      expect(logger.error).toHaveBeenCalledWith({ error: 'boom', stack: boom.stack }, 'MCP server error');
    });

    it('loga e relança o erro quando connect falha', async () => {
      const { service, logger } = makeService();
      const connectSpy = jest.spyOn(McpServer.prototype, 'connect').mockRejectedValueOnce(new Error('falha ao conectar'));

      await expect(service.start()).rejects.toThrow('falha ao conectar');
      expect(logger.error).toHaveBeenCalledWith({ error: 'falha ao conectar', stack: expect.any(String) }, 'Failed to start MCP server');

      connectSpy.mockRestore();
    });
  });
});
