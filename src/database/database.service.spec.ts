import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockEnd = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: mockQuery,
    end: mockEnd,
  })),
}));

// Import depois do jest.mock (ts-jest içá jest.mock automaticamente, mas
// deixar explícito ajuda a ler a ordem de dependência).
import { DatabaseService } from './database.service';

function makeConfigService(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: unknown) => (key in values ? values[key] : defaultValue)),
  } as unknown as ConfigService;
}

const configuredValues = {
  DB_HOST: 'localhost',
  DB_DATABASE: 'app_db',
  DB_USERNAME: 'postgres',
};

function makeService(): DatabaseService {
  return new DatabaseService(makeConfigService(configuredValues));
}

function rows<T>(data: T[]) {
  return { rows: data, rowCount: data.length, fields: [] };
}

describe('DatabaseService', () => {
  afterEach(() => {
    mockQuery.mockReset();
    mockEnd.mockClear();
  });

  describe('configuração obrigatória', () => {
    it('testConnection retorna success:false com mensagem clara quando DB_HOST não está setado', async () => {
      const service = new DatabaseService(makeConfigService({}));
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Defina DB_HOST/);
    });

    it('testConnection retorna success:false quando falta DB_DATABASE', async () => {
      const service = new DatabaseService(makeConfigService({ DB_HOST: 'localhost', DB_USERNAME: 'postgres' }));
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Defina DB_DATABASE/);
    });

    it('não deixa pool aberto quando a configuração falha antes de conectar', async () => {
      const service = new DatabaseService(makeConfigService({}));
      await service.testConnection();
      await expect(service.resetPool()).resolves.toBeUndefined();
    });
  });

  describe('testConnection configurado', () => {
    it('retorna success:true com os dados da primeira linha', async () => {
      mockQuery.mockResolvedValueOnce(rows([{ version: 'PostgreSQL 16' }]));
      const result = await makeService().testConnection();
      expect(result).toEqual({
        success: true,
        message: 'Connection successful',
        details: { version: 'PostgreSQL 16' },
      });
    });

    it('retorna success:false quando a query falha', async () => {
      mockQuery.mockRejectedValueOnce(new Error('conexão recusada'));
      const result = await makeService().testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Connection failed: conexão recusada/);
    });
  });

  it('getDatabaseStats retorna a primeira linha do resultado', async () => {
    mockQuery.mockResolvedValueOnce(
      rows([
        {
          database_name: 'app_db',
          database_size: '10 MB',
          total_tables: 5,
          total_indexes: 3,
          total_sequences: 1,
        },
      ]),
    );
    const stats = await makeService().getDatabaseStats();
    expect(stats.database_name).toBe('app_db');
    expect(stats.total_tables).toBe(5);
  });

  it('getAllTables usa o schema informado', async () => {
    mockQuery.mockResolvedValueOnce(rows([{ table_name: 'pedidos' }]));
    const tables = await makeService().getAllTables('vendas');
    expect(tables).toEqual([{ table_name: 'pedidos' }]);
    expect(mockQuery.mock.calls[0][1]).toEqual(['vendas']);
  });

  it('getAllTables usa schema default public quando não informado', async () => {
    mockQuery.mockResolvedValueOnce(rows([]));
    await makeService().getAllTables();
    expect(mockQuery.mock.calls[0][1]).toEqual(['public']);
  });

  it('getTableWithRowCounts usa schema default public', async () => {
    mockQuery.mockResolvedValueOnce(rows([]));
    await makeService().getTableWithRowCounts();
    expect(mockQuery.mock.calls[0][1]).toEqual(['public']);
  });

  it('getTableColumns repassa schema e tableName', async () => {
    mockQuery.mockResolvedValueOnce(rows([{ column_name: 'id' }]));
    await makeService().getTableColumns('pedidos', 'vendas');
    expect(mockQuery.mock.calls[0][1]).toEqual(['vendas', 'pedidos']);
  });

  it('getTableColumns usa schema default public quando não informado', async () => {
    mockQuery.mockResolvedValueOnce(rows([]));
    await makeService().getTableColumns('pedidos');
    expect(mockQuery.mock.calls[0][1]).toEqual(['public', 'pedidos']);
  });

  describe('getTableForeignKeys', () => {
    it('sem tableName, filtra só por schema', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await makeService().getTableForeignKeys();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(params).toEqual(['public']);
      expect(sql as string).not.toContain('tc.table_name = $2');
    });

    it('com tableName, adiciona o filtro extra', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await makeService().getTableForeignKeys('pedidos', 'vendas');
      const [sql, params] = mockQuery.mock.calls[0];
      expect(params).toEqual(['vendas', 'pedidos']);
      expect(sql as string).toContain('tc.table_name = $2');
    });
  });

  describe('getTableIndexes', () => {
    it('sem tableName, filtra só por schema', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await makeService().getTableIndexes();
      expect(mockQuery.mock.calls[0][1]).toEqual(['public']);
    });

    it('com tableName, adiciona o filtro extra', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await makeService().getTableIndexes('pedidos', 'vendas');
      const [sql, params] = mockQuery.mock.calls[0];
      expect(params).toEqual(['vendas', 'pedidos']);
      expect(sql as string).toContain('t.relname = $2');
    });
  });

  describe('getPrimaryKeys', () => {
    it('sem tableName, filtra só por schema', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await makeService().getPrimaryKeys();
      expect(mockQuery.mock.calls[0][1]).toEqual(['public']);
    });

    it('com tableName, adiciona o filtro extra', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));
      await makeService().getPrimaryKeys('pedidos', 'vendas');
      const [sql, params] = mockQuery.mock.calls[0];
      expect(params).toEqual(['vendas', 'pedidos']);
      expect(sql as string).toContain('tc.table_name = $2');
    });
  });

  describe('getTableDetails', () => {
    it('combina colunas, FKs, índices, PKs e row count', async () => {
      mockQuery.mockImplementation(async (sql: unknown) => {
        const s = String(sql);
        if (s.includes('FROM information_schema.columns')) {
          return rows([{ column_name: 'id' }]);
        }
        if (s.includes('FOREIGN KEY')) {
          return rows([{ constraint_name: 'fk_1' }]);
        }
        if (s.includes('pg_index')) {
          return rows([{ index_name: 'idx_1' }]);
        }
        if (s.includes('PRIMARY KEY')) {
          return rows([{ column_name: 'id', constraint_name: 'pk_1' }]);
        }
        if (s.includes('SELECT COUNT(*)')) {
          return rows([{ count: '42' }]);
        }
        throw new Error(`query inesperada no teste: ${s}`);
      });

      const details = await makeService().getTableDetails('pedidos');
      expect(details.columns).toEqual([{ column_name: 'id' }]);
      expect(details.foreignKeys).toEqual([{ constraint_name: 'fk_1' }]);
      expect(details.indexes).toEqual([{ index_name: 'idx_1' }]);
      expect(details.primaryKeys).toEqual([{ column_name: 'id', constraint_name: 'pk_1' }]);
      expect(details.rowCount).toBe(42);
    });

    it('usa rowCount -1 quando a query de contagem falha', async () => {
      mockQuery.mockImplementation(async (sql: unknown) => {
        const s = String(sql);
        if (s.includes('SELECT COUNT(*)')) {
          throw new Error('tabela não existe');
        }
        return rows([]);
      });

      const details = await makeService().getTableDetails('pedidos');
      expect(details.rowCount).toBe(-1);
    });

    it('usa rowCount -1 quando a contagem não retorna nenhuma linha', async () => {
      mockQuery.mockImplementation(async (sql: unknown) => {
        const s = String(sql);
        if (s.includes('SELECT COUNT(*)')) {
          return rows([]);
        }
        return rows([]);
      });

      const details = await makeService().getTableDetails('pedidos');
      expect(details.rowCount).toBe(-1);
    });
  });

  it('getSampleData aplica o limit informado', async () => {
    mockQuery.mockResolvedValueOnce(rows([{ id: 1 }]));
    const data = await makeService().getSampleData('pedidos', 5, 'vendas');
    expect(data).toEqual([{ id: 1 }]);
    expect(mockQuery.mock.calls[0][1]).toEqual([5]);
  });

  it('getSampleData usa limit=10 e schema public como default', async () => {
    mockQuery.mockResolvedValueOnce(rows([]));
    await makeService().getSampleData('pedidos');
    expect(mockQuery.mock.calls[0][1]).toEqual([10]);
  });

  it('searchTables monta o padrão ILIKE com o termo buscado', async () => {
    mockQuery.mockResolvedValueOnce(rows([]));
    await makeService().searchTables('cliente');
    expect(mockQuery.mock.calls[0][1]).toEqual(['public', '%cliente%']);
  });

  it('searchColumns monta o padrão ILIKE com o termo buscado', async () => {
    mockQuery.mockResolvedValueOnce(rows([]));
    await makeService().searchColumns('id');
    expect(mockQuery.mock.calls[0][1]).toEqual(['public', '%id%']);
  });

  describe('executeQuery', () => {
    it.each(['SELECT * FROM t', 'WITH x AS (SELECT 1) SELECT * FROM x', 'EXPLAIN SELECT 1'])('permite %s', async (sql) => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ a: 1 }],
        rowCount: 1,
        fields: [{ name: 'a' }],
      });
      const result = await makeService().executeQuery(sql);
      expect(result.fields).toEqual(['a']);
    });

    it('usa rowCount=0 quando a query não retorna rowCount', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: null,
        fields: [],
      });
      const result = await makeService().executeQuery('SELECT 1');
      expect(result.rowCount).toBe(0);
    });

    it.each(['INSERT INTO t VALUES (1)', 'UPDATE t SET a=1', 'DELETE FROM t', 'DROP TABLE t'])('rejeita %s', async (sql) => {
      await expect(makeService().executeQuery(sql)).rejects.toThrow(/Only SELECT, WITH, and EXPLAIN queries are allowed/);
    });
  });

  it('getAllRelationships monta grafo de nodes/edges a partir das FKs', async () => {
    mockQuery.mockResolvedValueOnce(
      rows([
        {
          constraint_name: 'fk_1',
          table_name: 'pedidos',
          column_name: 'cliente_id',
          foreign_table_name: 'clientes',
          foreign_column_name: 'id',
        },
      ]),
    );
    const result = await makeService().getAllRelationships();
    expect(result.graph.nodes).toEqual(['clientes', 'pedidos']);
    expect(result.graph.edges).toEqual([{ from: 'pedidos', to: 'clientes', via: 'cliente_id -> id' }]);
  });

  describe('searchUrlInDatabase', () => {
    it('encontra a URL em colunas de texto e reporta a tabela/coluna', async () => {
      mockQuery.mockImplementation(async (sql: unknown) => {
        const s = String(sql);
        if (s.includes('FROM information_schema.tables')) {
          return rows([{ table_name: 'clientes' }]);
        }
        if (s.includes('FROM information_schema.columns')) {
          return rows([{ column_name: 'site', data_type: 'text' }]);
        }
        if (s.includes('PRIMARY KEY')) {
          return rows([{ column_name: 'id' }]);
        }
        if (s.includes('ILIKE')) {
          return rows([{ record_id: 1, site: 'https://exemplo.dev' }]);
        }
        throw new Error(`query inesperada: ${s}`);
      });

      const result = await makeService().searchUrlInDatabase('exemplo.dev');
      expect(result.tablesSearched).toBe(1);
      expect(result.results).toEqual([
        {
          table: 'clientes',
          column: 'site',
          recordId: 1,
          value: 'https://exemplo.dev',
        },
      ]);
    });

    it('busca normalmente quando a tabela não tem chave primária', async () => {
      mockQuery.mockImplementation(async (sql: unknown) => {
        const s = String(sql);
        if (s.includes('FROM information_schema.tables')) {
          return rows([{ table_name: 'sem_pk' }]);
        }
        if (s.includes('FROM information_schema.columns')) {
          return rows([{ column_name: 'site', data_type: 'text' }]);
        }
        if (s.includes('PRIMARY KEY')) {
          return rows([]);
        }
        if (s.includes('ILIKE')) {
          return rows([{ site: 'https://exemplo.dev' }]);
        }
        throw new Error(`query inesperada: ${s}`);
      });

      const result = await makeService().searchUrlInDatabase('exemplo.dev');
      expect(result.results).toEqual([
        {
          table: 'sem_pk',
          column: 'site',
          recordId: undefined,
          value: 'https://exemplo.dev',
        },
      ]);
    });

    it('pula tabelas sem colunas de texto', async () => {
      mockQuery.mockImplementation(async (sql: unknown) => {
        const s = String(sql);
        if (s.includes('FROM information_schema.tables')) {
          return rows([{ table_name: 'logs_binarios' }]);
        }
        if (s.includes('FROM information_schema.columns')) {
          return rows([]);
        }
        throw new Error(`query inesperada: ${s}`);
      });

      const result = await makeService().searchUrlInDatabase('exemplo.dev');
      expect(result.tablesSearched).toBe(0);
      expect(result.results).toEqual([]);
    });

    it('para de buscar em novas tabelas ao atingir 500 resultados', async () => {
      const manyTables = Array.from({ length: 60 }, (_, i) => ({
        table_name: `tabela_${i}`,
      }));
      const tenMatches = Array.from({ length: 10 }, (_, i) => ({
        record_id: i,
        site: 'https://exemplo.dev',
      }));

      mockQuery.mockImplementation(async (sql: unknown) => {
        const s = String(sql);
        if (s.includes('FROM information_schema.tables')) {
          return rows(manyTables);
        }
        if (s.includes('FROM information_schema.columns')) {
          return rows([{ column_name: 'site', data_type: 'text' }]);
        }
        if (s.includes('PRIMARY KEY')) {
          return rows([{ column_name: 'id' }]);
        }
        if (s.includes('ILIKE')) {
          return rows(tenMatches);
        }
        throw new Error(`query inesperada: ${s}`);
      });

      const result = await makeService().searchUrlInDatabase('exemplo.dev');
      // 50 tabelas x 10 matches = 500; para no limite, sem varrer as 60
      expect(result.tablesSearched).toBeLessThan(60);
      expect(result.results.length).toBeLessThanOrEqual(500);
    });

    it('continua para a próxima tabela quando uma tabela falha (ex.: sem permissão)', async () => {
      let tableCall = 0;
      mockQuery.mockImplementation(async (sql: unknown) => {
        const s = String(sql);
        if (s.includes('FROM information_schema.tables')) {
          return rows([{ table_name: 'sem_permissao' }, { table_name: 'clientes' }]);
        }
        if (s.includes('FROM information_schema.columns')) {
          tableCall++;
          if (tableCall === 1) {
            throw new Error('permission denied');
          }
          return rows([{ column_name: 'site', data_type: 'text' }]);
        }
        if (s.includes('PRIMARY KEY')) {
          return rows([{ column_name: 'id' }]);
        }
        if (s.includes('ILIKE')) {
          return rows([]);
        }
        throw new Error(`query inesperada: ${s}`);
      });

      const result = await makeService().searchUrlInDatabase('exemplo.dev');
      expect(result.tablesSearched).toBe(1);
      expect(result.results).toEqual([]);
    });
  });

  it('resetPool não lança quando não há pool aberto', async () => {
    await expect(makeService().resetPool()).resolves.toBeUndefined();
  });

  it('onModuleDestroy chama resetPool', async () => {
    mockQuery.mockResolvedValueOnce(rows([{ version: 'PostgreSQL 16' }]));
    const service = makeService();
    await service.testConnection(); // força a criação do pool
    await service.onModuleDestroy();
    expect(mockEnd).toHaveBeenCalled();
  });
});
