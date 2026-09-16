import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { McpToolProvider } from '../mcp/mcp-tool-provider.decorator';
import { McpToolDefinition, McpResourceDefinition, McpToolProvider as McpToolProviderContract } from '../mcp/mcp-tool-provider.interface';

@Injectable()
@McpToolProvider()
export class DatabaseMcpProvider implements McpToolProviderContract {
  constructor(private readonly databaseService: DatabaseService) {}

  getToolDefinitions(): McpToolDefinition[] {
    return [
      {
        name: 'db_test_connection',
        description: 'Test the PostgreSQL database connection',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'db_get_stats',
        description: 'Get database statistics including size, number of tables, indexes, and sequences',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'db_list_tables',
        description: 'List all tables in the database with optional row counts',
        inputSchema: {
          type: 'object',
          properties: {
            schema: {
              type: 'string',
              description: 'Database schema (default: public)',
              default: 'public',
            },
            includeRowCounts: {
              type: 'boolean',
              description: 'Include approximate row counts for each table',
              default: false,
            },
          },
          required: [],
        },
      },
      {
        name: 'db_get_table_details',
        description: 'Get detailed information about a specific table including columns, foreign keys, indexes, and row count',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Name of the table to analyze',
            },
            schema: {
              type: 'string',
              description: 'Database schema (default: public)',
              default: 'public',
            },
          },
          required: ['tableName'],
        },
      },
      {
        name: 'db_get_table_columns',
        description: 'Get column information for a specific table',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Name of the table',
            },
            schema: {
              type: 'string',
              description: 'Database schema (default: public)',
              default: 'public',
            },
          },
          required: ['tableName'],
        },
      },
      {
        name: 'db_get_foreign_keys',
        description: 'Get foreign key relationships for a table or all tables',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Name of the table (optional, omit for all tables)',
            },
            schema: {
              type: 'string',
              description: 'Database schema (default: public)',
              default: 'public',
            },
          },
          required: [],
        },
      },
      {
        name: 'db_get_indexes',
        description: 'Get index information for a table or all tables',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Name of the table (optional, omit for all tables)',
            },
            schema: {
              type: 'string',
              description: 'Database schema (default: public)',
              default: 'public',
            },
          },
          required: [],
        },
      },
      {
        name: 'db_get_sample_data',
        description: 'Get sample data rows from a table',
        inputSchema: {
          type: 'object',
          properties: {
            tableName: {
              type: 'string',
              description: 'Name of the table',
            },
            limit: {
              type: 'number',
              description: 'Number of rows to fetch (default: 10, max: 100)',
              default: 10,
            },
            schema: {
              type: 'string',
              description: 'Database schema (default: public)',
              default: 'public',
            },
          },
          required: ['tableName'],
        },
      },
      {
        name: 'db_search_tables',
        description: 'Search for tables by name pattern',
        inputSchema: {
          type: 'object',
          properties: {
            searchTerm: {
              type: 'string',
              description: 'Search term to match against table names',
            },
            schema: {
              type: 'string',
              description: 'Database schema (default: public)',
              default: 'public',
            },
          },
          required: ['searchTerm'],
        },
      },
      {
        name: 'db_search_columns',
        description: 'Search for columns by name pattern across all tables',
        inputSchema: {
          type: 'object',
          properties: {
            searchTerm: {
              type: 'string',
              description: 'Search term to match against column or table names',
            },
            schema: {
              type: 'string',
              description: 'Database schema (default: public)',
              default: 'public',
            },
          },
          required: ['searchTerm'],
        },
      },
      {
        name: 'db_execute_query',
        description:
          'Execute SQL queries on the PostgreSQL database to retrieve real data. Use this tool to get actual data from tables, run aggregations, joins, and complex queries. This is the primary tool for executing SQL and obtaining query results.\n\n' +
          'ALLOWED: only SELECT, WITH, and EXPLAIN statements. ' +
          'NOT ALLOWED (rejected before running, no partial execution): any DDL/DML — CREATE (including CREATE EXTENSION), ALTER, DROP, INSERT, UPDATE, DELETE, GRANT, etc.\n\n' +
          'Known limitation: the pgcrypto extension is NOT installed on this database and cannot be installed via this tool (CREATE EXTENSION is blocked). ' +
          "Functions like digest(), crypt(), gen_random_uuid() will fail with 'function ... does not exist' — do not use them. " +
          'For simple hashing, use the built-in md5() function instead (no extension required).',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description:
                'SQL query to execute. Must be a SELECT, WITH, or EXPLAIN query. This allows you to retrieve real data from the database tables.',
            },
          },
          required: ['sql'],
        },
      },
      {
        name: 'db_get_relationships',
        description: 'Get all table relationships in the database as a graph',
        inputSchema: {
          type: 'object',
          properties: {
            schema: {
              type: 'string',
              description: 'Database schema (default: public)',
              default: 'public',
            },
          },
          required: [],
        },
      },
    ];
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'db_test_connection':
        return this.databaseService.testConnection();

      case 'db_get_stats':
        return this.databaseService.getDatabaseStats();

      case 'db_list_tables':
        if (params.includeRowCounts) {
          return this.databaseService.getTableWithRowCounts(String(params.schema || 'public'));
        }
        return this.databaseService.getAllTables(String(params.schema || 'public'));

      case 'db_get_table_details':
        return this.databaseService.getTableDetails(String(params.tableName), String(params.schema || 'public'));

      case 'db_get_table_columns':
        return this.databaseService.getTableColumns(String(params.tableName), String(params.schema || 'public'));

      case 'db_get_foreign_keys':
        return this.databaseService.getTableForeignKeys(params.tableName ? String(params.tableName) : undefined, String(params.schema || 'public'));

      case 'db_get_indexes':
        return this.databaseService.getTableIndexes(params.tableName ? String(params.tableName) : undefined, String(params.schema || 'public'));

      case 'db_get_sample_data': {
        const limit = Math.min(Number(params.limit) || 10, 100);
        return this.databaseService.getSampleData(String(params.tableName), limit, String(params.schema || 'public'));
      }

      case 'db_search_tables':
        return this.databaseService.searchTables(String(params.searchTerm), String(params.schema || 'public'));

      case 'db_search_columns':
        return this.databaseService.searchColumns(String(params.searchTerm), String(params.schema || 'public'));

      case 'db_execute_query':
        return this.databaseService.executeQuery(String(params.sql));

      case 'db_get_relationships':
        return this.databaseService.getAllRelationships(String(params.schema || 'public'));

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  getResourceDefinitions(): McpResourceDefinition[] {
    return [
      {
        uri: 'app://database/overview',
        name: 'Database Overview',
        description: 'Overview of the App PostgreSQL database',
        mimeType: 'application/json',
      },
      {
        uri: 'app://database/tables',
        name: 'Database Tables',
        description: 'List of all tables in the database',
        mimeType: 'application/json',
      },
      {
        uri: 'app://database/relationships',
        name: 'Database Relationships',
        description: 'All foreign key relationships in the database',
        mimeType: 'application/json',
      },
    ];
  }

  getResourceUriPrefixes(): string[] {
    return ['app://database/'];
  }

  async readResource(uri: string): Promise<unknown> {
    switch (uri) {
      case 'app://database/overview':
        return this.databaseService.getDatabaseStats();

      case 'app://database/tables':
        return this.databaseService.getTableWithRowCounts('public');

      case 'app://database/relationships':
        return this.databaseService.getAllRelationships('public');

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  }
}
