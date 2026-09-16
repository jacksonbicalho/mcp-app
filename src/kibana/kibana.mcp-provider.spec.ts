import { describe, expect, it, jest } from '@jest/globals';
import { KibanaMcpProvider } from './kibana.mcp-provider';
import type { KibanaService } from './kibana.service';

function makeKibanaService() {
  return {
    testConnection: jest.fn(async (..._args: unknown[]) => ({
      version: '7.6.0',
    })),
    search: jest.fn(async (..._args: unknown[]) => ({ hits: [] })),
    getIndexPatternFields: jest.fn(async (..._args: unknown[]) => []),
  };
}

function makeProvider() {
  const kibanaService = makeKibanaService();
  const provider = new KibanaMcpProvider(kibanaService as unknown as KibanaService);
  return { provider, kibanaService };
}

describe('KibanaMcpProvider', () => {
  it('expõe as 3 tools esperadas', () => {
    const { provider } = makeProvider();
    expect(provider.getToolDefinitions().map((t) => t.name)).toEqual(['kibana_test_connection', 'kibana_search', 'kibana_index_pattern_fields']);
  });

  describe('callTool', () => {
    it('kibana_test_connection delega direto', async () => {
      const { provider, kibanaService } = makeProvider();
      await provider.callTool('kibana_test_connection', {});
      expect(kibanaService.testConnection).toHaveBeenCalled();
    });

    it('kibana_search aceita dsl como objeto', async () => {
      const { provider, kibanaService } = makeProvider();
      await provider.callTool('kibana_search', {
        dsl: { size: 10 },
        indexPattern: 'custom*',
      });
      expect(kibanaService.search).toHaveBeenCalledWith({ size: 10 }, 'custom*');
    });

    it('kibana_search aceita dsl como string JSON válida', async () => {
      const { provider, kibanaService } = makeProvider();
      await provider.callTool('kibana_search', {
        dsl: JSON.stringify({ size: 5 }),
      });
      expect(kibanaService.search).toHaveBeenCalledWith({ size: 5 }, undefined);
    });

    it('kibana_search lança erro quando dsl é string JSON inválida', async () => {
      const { provider } = makeProvider();
      await expect(provider.callTool('kibana_search', { dsl: '{invalido' })).rejects.toThrow(/string JSON válida/);
    });

    it('kibana_search lança erro quando dsl não é informado', async () => {
      const { provider } = makeProvider();
      await expect(provider.callTool('kibana_search', {})).rejects.toThrow(/dsl é obrigatório/);
    });

    it('kibana_search lança erro quando dsl é um array', async () => {
      const { provider } = makeProvider();
      await expect(provider.callTool('kibana_search', { dsl: [1, 2, 3] })).rejects.toThrow(/objeto de query Elasticsearch/);
    });

    it('kibana_search lança erro quando dsl é um número', async () => {
      const { provider } = makeProvider();
      await expect(provider.callTool('kibana_search', { dsl: 42 })).rejects.toThrow(/objeto de query Elasticsearch/);
    });

    it('kibana_index_pattern_fields repassa savedObjectId quando informado', async () => {
      const { provider, kibanaService } = makeProvider();
      await provider.callTool('kibana_index_pattern_fields', {
        savedObjectId: 'abc-123',
      });
      expect(kibanaService.getIndexPatternFields).toHaveBeenCalledWith('abc-123');
    });

    it('kibana_index_pattern_fields usa undefined quando não informado', async () => {
      const { provider, kibanaService } = makeProvider();
      await provider.callTool('kibana_index_pattern_fields', {});
      expect(kibanaService.getIndexPatternFields).toHaveBeenCalledWith(undefined);
    });

    it('lança erro para tool desconhecida', async () => {
      const { provider } = makeProvider();
      await expect(provider.callTool('unknown', {})).rejects.toThrow(/Unknown tool: unknown/);
    });
  });
});
