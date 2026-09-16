import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { errorInfo } from '../common/error-info';

export interface TableInfo {
  table_name: string;
  table_schema: string;
  table_type: string;
  row_count?: number;
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number;
}

export interface ForeignKeyInfo {
  constraint_name: string;
  table_name: string;
  column_name: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

export interface IndexInfo {
  index_name: string;
  table_name: string;
  column_names: string[];
  is_unique: boolean;
  is_primary: boolean;
}

export interface DatabaseStats {
  database_name: string;
  database_size: string;
  total_tables: number;
  total_indexes: number;
  total_sequences: number;
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool: Pool | null = null;

  constructor(private configService: ConfigService) {}

  private requireConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new Error(`Banco de dados não configurado. Defina ${key} em environments.json.`);
    }
    return value;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        host: this.requireConfig('DB_HOST'),
        port: this.configService.get<number>('DB_PORT', 5432),
        database: this.requireConfig('DB_DATABASE'),
        user: this.requireConfig('DB_USERNAME'),
        password: this.configService.get<string>('DB_PASSWORD', ''),
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });
    }
    return this.pool;
  }

  async resetPool(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async onModuleDestroy() {
    await this.resetPool();
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const pool = this.getPool();
    return pool.query<T>(sql, params);
  }

  async testConnection(): Promise<{
    success: boolean;
    message: string;
    details?: unknown;
  }> {
    try {
      const result = await this.query('SELECT version(), current_database(), current_user');
      return {
        success: true,
        message: 'Connection successful',
        details: result.rows[0],
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${errorInfo(error).message}`,
      };
    }
  }

  async getDatabaseStats(): Promise<DatabaseStats> {
    const result = await this.query<DatabaseStats>(`
      SELECT 
        current_database() as database_name,
        pg_size_pretty(pg_database_size(current_database())) as database_size,
        (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public')::int as total_tables,
        (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public')::int as total_indexes,
        (SELECT count(*) FROM information_schema.sequences WHERE sequence_schema = 'public')::int as total_sequences
    `);
    return result.rows[0];
  }

  async getAllTables(schema: string = 'public'): Promise<TableInfo[]> {
    const result = await this.query<TableInfo>(
      `
      SELECT 
        t.table_name,
        t.table_schema,
        t.table_type
      FROM information_schema.tables t
      WHERE t.table_schema = $1
      ORDER BY t.table_name
    `,
      [schema],
    );
    return result.rows;
  }

  async getTableWithRowCounts(schema: string = 'public'): Promise<TableInfo[]> {
    const result = await this.query<TableInfo>(
      `
      SELECT 
        t.table_name,
        t.table_schema,
        t.table_type,
        (SELECT reltuples::bigint FROM pg_class WHERE oid = (quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass) as row_count
      FROM information_schema.tables t
      WHERE t.table_schema = $1
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `,
      [schema],
    );
    return result.rows;
  }

  async getTableColumns(tableName: string, schema: string = 'public'): Promise<ColumnInfo[]> {
    const result = await this.query<ColumnInfo>(
      `
      SELECT 
        column_name,
        data_type,
        character_maximum_length,
        numeric_precision,
        numeric_scale,
        is_nullable,
        column_default,
        ordinal_position
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `,
      [schema, tableName],
    );
    return result.rows;
  }

  async getTableForeignKeys(tableName?: string, schema: string = 'public'): Promise<ForeignKeyInfo[]> {
    let sql = `
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
    `;

    const params: unknown[] = [schema];

    if (tableName) {
      sql += ' AND tc.table_name = $2';
      params.push(tableName);
    }

    sql += ' ORDER BY tc.table_name, kcu.column_name';

    const result = await this.query<ForeignKeyInfo>(sql, params);
    return result.rows;
  }

  async getTableIndexes(tableName?: string, schema: string = 'public'): Promise<IndexInfo[]> {
    let sql = `
      SELECT
        i.relname as index_name,
        t.relname as table_name,
        array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as column_names,
        ix.indisunique as is_unique,
        ix.indisprimary as is_primary
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
      WHERE n.nspname = $1
    `;

    const params: unknown[] = [schema];

    if (tableName) {
      sql += ' AND t.relname = $2';
      params.push(tableName);
    }

    sql += ' GROUP BY i.relname, t.relname, ix.indisunique, ix.indisprimary ORDER BY t.relname, i.relname';

    const result = await this.query<IndexInfo>(sql, params);
    return result.rows;
  }

  async getPrimaryKeys(
    tableName?: string,
    schema: string = 'public',
  ): Promise<{ table_name: string; column_name: string; constraint_name: string }[]> {
    let sql = `
      SELECT 
        tc.table_name,
        kcu.column_name,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
    `;

    const params: unknown[] = [schema];

    if (tableName) {
      sql += ' AND tc.table_name = $2';
      params.push(tableName);
    }

    sql += ' ORDER BY tc.table_name, kcu.ordinal_position';

    const result = await this.query<{
      table_name: string;
      column_name: string;
      constraint_name: string;
    }>(sql, params);
    return result.rows;
  }

  async getTableDetails(
    tableName: string,
    schema: string = 'public',
  ): Promise<{
    columns: ColumnInfo[];
    foreignKeys: ForeignKeyInfo[];
    indexes: IndexInfo[];
    primaryKeys: { column_name: string; constraint_name: string }[];
    rowCount: number;
  }> {
    const [columns, foreignKeys, indexes, primaryKeys, countResult] = await Promise.all([
      this.getTableColumns(tableName, schema),
      this.getTableForeignKeys(tableName, schema),
      this.getTableIndexes(tableName, schema),
      this.getPrimaryKeys(tableName, schema),
      this.query(`SELECT COUNT(*) as count FROM "${schema}"."${tableName}"`).catch(() => ({ rows: [{ count: -1 }] })),
    ]);

    return {
      columns,
      foreignKeys,
      indexes,
      primaryKeys: primaryKeys.map((pk) => ({
        column_name: pk.column_name,
        constraint_name: pk.constraint_name,
      })),
      rowCount: parseInt(countResult.rows[0]?.count ?? '-1', 10),
    };
  }

  async getSampleData(tableName: string, limit: number = 10, schema: string = 'public'): Promise<QueryResultRow[]> {
    const result = await this.query(`SELECT * FROM "${schema}"."${tableName}" LIMIT $1`, [limit]);
    return result.rows;
  }

  async searchTables(searchTerm: string, schema: string = 'public'): Promise<TableInfo[]> {
    const result = await this.query<TableInfo>(
      `
      SELECT 
        table_name,
        table_schema,
        table_type
      FROM information_schema.tables
      WHERE table_schema = $1
        AND table_name ILIKE $2
      ORDER BY table_name
    `,
      [schema, `%${searchTerm}%`],
    );
    return result.rows;
  }

  async searchColumns(searchTerm: string, schema: string = 'public'): Promise<{ table_name: string; column_name: string; data_type: string }[]> {
    const result = await this.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `
      SELECT 
        table_name,
        column_name,
        data_type
      FROM information_schema.columns
      WHERE table_schema = $1
        AND (column_name ILIKE $2 OR table_name ILIKE $2)
      ORDER BY table_name, column_name
    `,
      [schema, `%${searchTerm}%`],
    );
    return result.rows;
  }

  async executeQuery(sql: string): Promise<{ rows: QueryResultRow[]; rowCount: number; fields: string[] }> {
    // Only allow SELECT queries for safety
    const normalizedSql = sql.trim().toUpperCase();
    if (!normalizedSql.startsWith('SELECT') && !normalizedSql.startsWith('WITH') && !normalizedSql.startsWith('EXPLAIN')) {
      throw new Error(
        'Only SELECT, WITH, and EXPLAIN queries are allowed (DDL/DML such as CREATE, CREATE EXTENSION, ALTER, DROP, INSERT, UPDATE, DELETE are rejected)',
      );
    }

    const result = await this.query(sql);
    return {
      rows: result.rows,
      rowCount: result.rowCount ?? 0,
      fields: result.fields.map((f) => f.name),
    };
  }

  async getAllRelationships(schema: string = 'public'): Promise<{
    relationships: ForeignKeyInfo[];
    graph: {
      nodes: string[];
      edges: { from: string; to: string; via: string }[];
    };
  }> {
    const relationships = await this.getTableForeignKeys(undefined, schema);

    const nodes = new Set<string>();
    const edges: { from: string; to: string; via: string }[] = [];

    for (const rel of relationships) {
      nodes.add(rel.table_name);
      nodes.add(rel.foreign_table_name);
      edges.push({
        from: rel.table_name,
        to: rel.foreign_table_name,
        via: `${rel.column_name} -> ${rel.foreign_column_name}`,
      });
    }

    return {
      relationships,
      graph: {
        nodes: Array.from(nodes).sort(),
        edges,
      },
    };
  }

  async searchUrlInDatabase(url: string): Promise<{
    results: Array<{
      table: string;
      column: string;
      recordId?: unknown;
      value: string;
    }>;
    tablesSearched: number;
  }> {
    const results: Array<{
      table: string;
      column: string;
      recordId?: unknown;
      value: string;
    }> = [];

    let tablesSearched = 0;

    // Get all tables in the database
    const tablesResult = await this.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    const tables = tablesResult.rows.map((row) => row.table_name);

    // For each table, find text columns and search
    for (const tableName of tables) {
      try {
        // Get text columns for this table
        const columnsResult = await this.query<{
          column_name: string;
          data_type: string;
        }>(
          `
          SELECT column_name, data_type
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = $1
            AND data_type IN ('character varying', 'varchar', 'text', 'char', 'character')
          ORDER BY ordinal_position
        `,
          [tableName],
        );

        const textColumns = columnsResult.rows.map((row) => row.column_name);

        if (textColumns.length === 0) {
          continue; // Skip tables without text columns
        }

        tablesSearched++;

        // Get primary key column if exists
        const pkResult = await this.query(
          `
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = $1
            AND tc.constraint_type = 'PRIMARY KEY'
          LIMIT 1
        `,
          [tableName],
        );

        const pkColumn = pkResult.rows[0]?.column_name;

        // Build query to search in all text columns
        // Use a single parameter and apply it to all columns
        const conditions = textColumns.map((col) => `${col}::text ILIKE $1`).join(' OR ');

        const searchPattern = `%${url}%`;

        // Execute search query with LIMIT
        const selectColumns = textColumns.map((col) => `"${col}"`).join(', ');
        const selectPk = pkColumn ? `"${pkColumn}" as record_id, ` : '';
        const searchQuery = `
          SELECT ${selectPk}${selectColumns}
          FROM "${tableName}"
          WHERE ${conditions}
          LIMIT 10
        `;

        const searchResult = await this.query(searchQuery, [searchPattern]);

        // Process results
        for (const row of searchResult.rows) {
          for (const col of textColumns) {
            const value = row[col];
            if (value && typeof value === 'string' && value.toLowerCase().includes(url.toLowerCase())) {
              results.push({
                table: tableName,
                column: col,
                recordId: pkColumn ? row.record_id : undefined,
                value: value.substring(0, 500), // Limit value length
              });
            }
          }
        }

        // Limit total results
        if (results.length >= 500) {
          break;
        }
      } catch {
        // Skip tables we can't search (permissions, etc.)
        continue;
      }
    }

    return {
      results: results.slice(0, 500), // Limit total results
      tablesSearched,
    };
  }
}
