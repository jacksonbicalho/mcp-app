import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Logger as PinoInstance } from 'pino';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { McpToolRegistryService } from './mcp-tool-registry.service';
import { errorInfo } from '../common/error-info';

// pino.Logger não declara flushSync — só existe em runtime quando o
// destination por trás do logger é o retorno de multistream() (ver
// pino.config.ts). Guardado com `?.` porque nos demais destinations (arquivo
// simples, stderr/stdout) o método não existe.
type LoggerWithFlushSync = PinoInstance & { flushSync?: () => void };

@Injectable()
export class McpService {
  private mcpServer: McpServer;

  constructor(
    private configService: ConfigService,
    private mcpToolRegistry: McpToolRegistryService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(McpService.name);

    this.mcpServer = new McpServer(
      {
        name: configService.get<string>('MCP_SERVER_NAME', 'mcp-app'),
        version: configService.get<string>('MCP_SERVER_VERSION', '1.0.0'),
        description: configService.get<string>('MCP_SERVER_DESCRIPTION', 'MCP App'),
        title: configService.get<string>('MCP_SERVER_TITLE', 'MCP App'),
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      },
    );

    this.setupHandlers();
    this.logger.info('MCP handlers setup completed');
  }

  private setupHandlers() {
    this.logger.info('Setting up MCP handlers...');
    this.setupToolHandlers();
    this.setupResourceHandlers();
    this.logger.info('All MCP handlers registered successfully');
  }

  private setupToolHandlers() {
    this.logger.info('Setting up tool handlers...');

    // List available tools
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
      console.error('[MCP DEBUG] ListTools request received');
      this.logger.info('ListTools request received');
      return {
        tools: this.mcpToolRegistry.getAllTools(),
      };
    });

    // Handle tool calls
    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const params = (args || {}) as Record<string, unknown>;
      const sanitizedParams = this.sanitizeParams(params);

      console.error(`[MCP DEBUG] Tool called: ${name}`, JSON.stringify(sanitizedParams));

      // Forçar flush do logger para garantir que o log seja escrito imediatamente
      this.logger.info(
        {
          tool: name,
          params: sanitizedParams,
        },
        `Tool called: ${name}`,
      );

      (this.logger.logger as LoggerWithFlushSync).flushSync?.();

      const startTime = Date.now();

      try {
        const result = await this.mcpToolRegistry.callTool(name, params);

        const duration = Date.now() - startTime;
        const resultSize = JSON.stringify(result).length;

        this.logger.info(
          {
            tool: name,
            duration: `${duration}ms`,
            resultSize,
          },
          `Tool ${name} completed successfully`,
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const { message, stack } = errorInfo(error);

        this.logger.error(
          {
            tool: name,
            duration: `${duration}ms`,
            error: message,
            stack,
          },
          `Tool ${name} failed`,
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: true,
                message,
              }),
            },
          ],
          isError: true,
        };
      }
    });

    this.logger.info('Tool handlers registered successfully');
  }

  private setupResourceHandlers() {
    this.logger.info('Setting up resource handlers...');
    // List available resources
    this.mcpServer.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      this.logger.info('ListResources request received');
      return {
        resources: this.mcpToolRegistry.getAllResources(),
      };
    });

    // Read resources
    this.mcpServer.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      this.logger.info({ uri }, `Resource read requested: ${uri}`);
      const startTime = Date.now();

      try {
        const content = await this.mcpToolRegistry.readResource(uri);

        const duration = Date.now() - startTime;
        const contentSize = JSON.stringify(content).length;

        this.logger.info(
          {
            uri,
            duration: `${duration}ms`,
            contentSize,
          },
          `Resource ${uri} read successfully`,
        );

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(content, null, 2),
            },
          ],
        };
      } catch (error) {
        const duration = Date.now() - startTime;
        const { message, stack } = errorInfo(error);

        this.logger.error(
          {
            uri,
            duration: `${duration}ms`,
            error: message,
            stack,
          },
          `Resource ${uri} read failed`,
        );
        throw new Error(`Failed to read resource ${uri}: ${message}`, { cause: error });
      }
    });

    this.logger.info('Resource handlers registered successfully');
  }

  async start() {
    try {
      this.logger.info('Initializing MCP server transport...');
      const transport = new StdioServerTransport();

      this.mcpServer.server.onerror = (error) => {
        console.error('[MCP ERROR]', error);
        this.logger.error({ error: error.message, stack: error.stack }, 'MCP server error');
      };

      this.logger.info('Connecting MCP server to transport...');
      await this.mcpServer.connect(transport);

      this.logger.info(
        {
          serverName: this.configService.get<string>('MCP_SERVER_NAME', 'mcp-app'),
          version: this.configService.get<string>('MCP_SERVER_VERSION', '1.0.0'),
          stdinIsTTY: process.stdin.isTTY,
          stdoutIsTTY: process.stdout.isTTY,
        },
        'MCP App server started successfully and ready to receive requests',
      );
    } catch (error) {
      const { message, stack } = errorInfo(error);
      this.logger.error({ error: message, stack }, 'Failed to start MCP server');
      throw error;
    }
  }

  private sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      // Não logar senhas ou dados sensíveis
      if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret')) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof value === 'string' && value.length > 200) {
        sanitized[key] = value.substring(0, 200) + '... (truncated)';
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
