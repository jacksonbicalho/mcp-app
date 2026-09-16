import { describe, expect, it, jest } from '@jest/globals';
import type { DiscoveryService } from '@nestjs/core';
import { McpToolRegistryService } from './mcp-tool-registry.service';
import type { McpToolProvider } from './mcp-tool-provider.interface';

function makeDiscoveryService(providers: unknown[]): DiscoveryService {
  return {
    getProviders: jest.fn(() => providers.map((instance) => ({ instance }))),
  } as unknown as DiscoveryService;
}

function makeRegistry(providers: Partial<McpToolProvider>[]) {
  const registry = new McpToolRegistryService(makeDiscoveryService(providers));
  registry.onModuleInit();
  return registry;
}

describe('McpToolRegistryService', () => {
  it('agrega tools de múltiplos providers', () => {
    const providerA: Partial<McpToolProvider> = {
      getToolDefinitions: () => [{ name: 'a', description: 'd', inputSchema: {} }],
      callTool: jest.fn(async () => 'resultado-a'),
    };
    const providerB: Partial<McpToolProvider> = {
      getToolDefinitions: () => [{ name: 'b', description: 'd', inputSchema: {} }],
      callTool: jest.fn(async () => 'resultado-b'),
    };

    const registry = makeRegistry([providerA, providerB]);
    expect(registry.getAllTools().map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('ignora wrappers sem instance', () => {
    const registry = new McpToolRegistryService({
      getProviders: jest.fn(() => [{ instance: undefined }]),
    } as unknown as DiscoveryService);
    registry.onModuleInit();
    expect(registry.getAllTools()).toEqual([]);
  });

  it('callTool despacha pro provider dono da tool', async () => {
    const callTool = jest.fn(async (..._args: unknown[]) => 'ok');
    const provider: Partial<McpToolProvider> = {
      getToolDefinitions: () => [{ name: 'minha_tool', description: 'd', inputSchema: {} }],
      callTool,
    };

    const registry = makeRegistry([provider]);
    await expect(registry.callTool('minha_tool', { x: 1 })).resolves.toBe('ok');
    expect(callTool).toHaveBeenCalledWith('minha_tool', { x: 1 });
  });

  it('callTool lança erro para tool desconhecida', async () => {
    const registry = makeRegistry([]);
    await expect(registry.callTool('desconhecida', {})).rejects.toThrow(/Unknown tool: desconhecida/);
  });

  it('agrega resources só de providers que implementam getResourceDefinitions', () => {
    const withResources: Partial<McpToolProvider> = {
      getToolDefinitions: () => [],
      getResourceDefinitions: () => [{ uri: 'app://x/1', name: 'x', description: 'd', mimeType: 'application/json' }],
    };
    const withoutResources: Partial<McpToolProvider> = {
      getToolDefinitions: () => [],
    };

    const registry = makeRegistry([withResources, withoutResources]);
    expect(registry.getAllResources()).toHaveLength(1);
  });

  describe('readResource', () => {
    it('escolhe o prefixo mais longo/específico quando há sobreposição', async () => {
      const genericRead = jest.fn(async () => 'generico');
      const specificRead = jest.fn(async () => 'especifico');

      const generic: Partial<McpToolProvider> = {
        getToolDefinitions: () => [],
        getResourceUriPrefixes: () => ['app://x/'],
        readResource: genericRead,
      };
      const specific: Partial<McpToolProvider> = {
        getToolDefinitions: () => [],
        getResourceUriPrefixes: () => ['app://x/specific/'],
        readResource: specificRead,
      };

      // Registra o genérico primeiro de propósito, pra provar que o sort
      // por tamanho de prefixo é quem decide, não a ordem de registro.
      const registry = makeRegistry([generic, specific]);

      await registry.readResource('app://x/specific/1');
      expect(specificRead).toHaveBeenCalled();
      expect(genericRead).not.toHaveBeenCalled();
    });

    it('lança erro quando nenhum prefixo casa com a URI', async () => {
      const registry = makeRegistry([]);
      await expect(registry.readResource('app://nao-existe/1')).rejects.toThrow(/Unknown resource/);
    });

    it('lança erro quando o provider do prefixo não implementa readResource', async () => {
      const provider: Partial<McpToolProvider> = {
        getToolDefinitions: () => [],
        getResourceUriPrefixes: () => ['app://x/'],
      };
      const registry = makeRegistry([provider]);
      await expect(registry.readResource('app://x/1')).rejects.toThrow(/Unknown resource/);
    });
  });
});
