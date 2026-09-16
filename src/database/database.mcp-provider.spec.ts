import { describe, expect, it, jest } from '@jest/globals';
import { DatabaseMcpProvider } from './database.mcp-provider';
import type { DatabaseService } from './database.service';

function makeDatabaseService() {
  return {
    testConnection: jest.fn(async (..._args: unknown[]) => ({
      success: true,
      message: 'ok',
    })),
    getDatabaseStats: jest.fn(async (..._args: unknown[]) => ({
      database_name: 'app',
    })),
    getTableWithRowCounts: jest.fn(async (..._args: unknown[]) => [{ table_name: 't' }]),
    getAllTables: jest.fn(async (..._args: unknown[]) => [{ table_name: 't' }]),
    getTableDetails: jest.fn(async (..._args: unknown[]) => ({ columns: [] })),
    getTableColumns: jest.fn(async (..._args: unknown[]) => [{ column_name: 'c' }]),
    getTableForeignKeys: jest.fn(async (..._args: unknown[]) => []),
    getTableIndexes: jest.fn(async (..._args: unknown[]) => []),
    getSampleData: jest.fn(async (..._args: unknown[]) => []),
    searchTables: jest.fn(async (..._args: unknown[]) => []),
    searchColumns: jest.fn(async (..._args: unknown[]) => []),
    executeQuery: jest.fn(async (..._args: unknown[]) => ({
      rows: [],
      rowCount: 0,
      fields: [],
    })),
    getAllRelationships: jest.fn(async (..._args: unknown[]) => ({
      relationships: [],
      graph: {},
    })),
  };
}

function makeProvider() {
  const databaseService = makeDatabaseService();
  const provider = new DatabaseMcpProvider(databaseService as unknown as DatabaseService);
  return { provider, databaseService };
}

describe('DatabaseMcpProvider', () => {
  it('expõe todas as tools de banco', () => {
    const { provider } = makeProvider();
    const names = provider.getToolDefinitions().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'db_test_connection',
        'db_get_stats',
        'db_list_tables',
        'db_get_table_details',
        'db_get_table_columns',
        'db_get_foreign_keys',
        'db_get_indexes',
        'db_get_sample_data',
        'db_search_tables',
        'db_search_columns',
        'db_execute_query',
        'db_get_relationships',
      ]),
    );
  });

  describe('callTool', () => {
    it('db_test_connection delega direto', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_test_connection', {});
      expect(databaseService.testConnection).toHaveBeenCalled();
    });

    it('db_get_stats delega direto', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_stats', {});
      expect(databaseService.getDatabaseStats).toHaveBeenCalled();
    });

    it('db_list_tables usa getTableWithRowCounts quando includeRowCounts é truthy', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_list_tables', {
        includeRowCounts: true,
        schema: 'custom',
      });
      expect(databaseService.getTableWithRowCounts).toHaveBeenCalledWith('custom');
      expect(databaseService.getAllTables).not.toHaveBeenCalled();
    });

    it('db_list_tables com includeRowCounts usa default schema public quando não informado', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_list_tables', { includeRowCounts: true });
      expect(databaseService.getTableWithRowCounts).toHaveBeenCalledWith('public');
    });

    it('db_list_tables usa getAllTables e default schema public quando não informado', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_list_tables', {});
      expect(databaseService.getAllTables).toHaveBeenCalledWith('public');
    });

    it('db_get_table_details repassa tableName e schema', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_table_details', {
        tableName: 'pedidos',
        schema: 'vendas',
      });
      expect(databaseService.getTableDetails).toHaveBeenCalledWith('pedidos', 'vendas');
    });

    it('db_get_table_details usa default schema public quando não informado', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_table_details', { tableName: 'pedidos' });
      expect(databaseService.getTableDetails).toHaveBeenCalledWith('pedidos', 'public');
    });

    it('db_get_table_columns repassa tableName e default schema', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_table_columns', { tableName: 't' });
      expect(databaseService.getTableColumns).toHaveBeenCalledWith('t', 'public');
    });

    it('db_get_foreign_keys passa undefined quando tableName não é informado', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_foreign_keys', {});
      expect(databaseService.getTableForeignKeys).toHaveBeenCalledWith(undefined, 'public');
    });

    it('db_get_foreign_keys repassa tableName quando informado', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_foreign_keys', { tableName: 'pedidos' });
      expect(databaseService.getTableForeignKeys).toHaveBeenCalledWith('pedidos', 'public');
    });

    it('db_get_indexes repassa tableName quando informado', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_indexes', { tableName: 't' });
      expect(databaseService.getTableIndexes).toHaveBeenCalledWith('t', 'public');
    });

    it('db_get_indexes passa undefined quando tableName não é informado', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_indexes', {});
      expect(databaseService.getTableIndexes).toHaveBeenCalledWith(undefined, 'public');
    });

    it('db_get_sample_data limita o limit a no máximo 100', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_sample_data', {
        tableName: 't',
        limit: 500,
      });
      expect(databaseService.getSampleData).toHaveBeenCalledWith('t', 100, 'public');
    });

    it('db_get_sample_data usa 10 como default quando limit não é número', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_sample_data', { tableName: 't' });
      expect(databaseService.getSampleData).toHaveBeenCalledWith('t', 10, 'public');
    });

    it('db_search_tables repassa searchTerm e schema', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_search_tables', { searchTerm: 'cli' });
      expect(databaseService.searchTables).toHaveBeenCalledWith('cli', 'public');
    });

    it('db_search_columns repassa searchTerm e schema', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_search_columns', { searchTerm: 'id' });
      expect(databaseService.searchColumns).toHaveBeenCalledWith('id', 'public');
    });

    it('db_execute_query repassa o sql', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_execute_query', { sql: 'SELECT 1' });
      expect(databaseService.executeQuery).toHaveBeenCalledWith('SELECT 1');
    });

    it('db_get_relationships repassa schema', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_relationships', { schema: 'vendas' });
      expect(databaseService.getAllRelationships).toHaveBeenCalledWith('vendas');
    });

    it('db_get_relationships usa default schema public quando não informado', async () => {
      const { provider, databaseService } = makeProvider();
      await provider.callTool('db_get_relationships', {});
      expect(databaseService.getAllRelationships).toHaveBeenCalledWith('public');
    });

    it('lança erro para tool desconhecida', async () => {
      const { provider } = makeProvider();
      await expect(provider.callTool('unknown', {})).rejects.toThrow(/Unknown tool: unknown/);
    });
  });

  describe('resources', () => {
    it('expõe 3 resources e o prefixo app://database/', () => {
      const { provider } = makeProvider();
      expect(provider.getResourceDefinitions()).toHaveLength(3);
      expect(provider.getResourceUriPrefixes()).toEqual(['app://database/']);
    });

    it('readResource resolve overview/tables/relationships', async () => {
      const { provider, databaseService } = makeProvider();

      await provider.readResource('app://database/overview');
      expect(databaseService.getDatabaseStats).toHaveBeenCalled();

      await provider.readResource('app://database/tables');
      expect(databaseService.getTableWithRowCounts).toHaveBeenCalledWith('public');

      await provider.readResource('app://database/relationships');
      expect(databaseService.getAllRelationships).toHaveBeenCalledWith('public');
    });

    it('lança erro para resource desconhecido', async () => {
      const { provider } = makeProvider();
      await expect(provider.readResource('app://database/nao-existe')).rejects.toThrow(/Unknown resource/);
    });
  });
});
