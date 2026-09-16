import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CodeAnalyzerService } from './code-analyzer.service';
import { DatabaseService } from '../database/database.service';
import { McpToolProvider } from '../mcp/mcp-tool-provider.decorator';
import { McpToolDefinition, McpResourceDefinition, McpToolProvider as McpToolProviderContract } from '../mcp/mcp-tool-provider.interface';
import { errorInfo } from '../common/error-info';

@Injectable()
@McpToolProvider()
export class AnalyzerMcpProvider implements McpToolProviderContract {
  constructor(
    private readonly codeAnalyzerService: CodeAnalyzerService,
    private readonly databaseService: DatabaseService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AnalyzerMcpProvider.name);
  }

  getToolDefinitions(): McpToolDefinition[] {
    return [
      {
        name: 'code_get_overview',
        description: 'Get an overview of the App system including framework, directories, and entry points',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'code_list_directory',
        description: 'List files and directories in a specific path within the App system',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path within App (empty for root)',
              default: '',
            },
          },
          required: [],
        },
      },
      {
        name: 'code_read_file',
        description: 'Read the contents of a file in the App system',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to the file',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'code_search_files',
        description: 'Search for files by name pattern',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Search pattern to match against file names',
            },
            extensions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by file extensions (e.g., [".php", ".js"])',
            },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'code_search_in_files',
        description: 'Search for text within files',
        inputSchema: {
          type: 'object',
          properties: {
            searchTerm: {
              type: 'string',
              description: 'Text to search for in file contents',
            },
            extensions: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by file extensions (default: [".php", ".js"])',
            },
          },
          required: ['searchTerm'],
        },
      },
      {
        name: 'code_get_stats',
        description: 'Get statistics about the codebase including file counts by extension and largest files',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'code_get_structure',
        description: 'Get the directory structure of the App system',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to start from (empty for root)',
              default: '',
            },
            maxDepth: {
              type: 'number',
              description: 'Maximum depth to traverse (default: 2)',
              default: 2,
            },
          },
          required: [],
        },
      },
      {
        name: 'code_analyze_php_file',
        description: 'Analyze a PHP file to extract class information, methods, and properties',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Relative path to the PHP file',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'code_get_db_references',
        description: 'Find database references in the PHP codebase',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'code_search_url',
        description: 'Search for a URL address in all project files. If not found in files, searches in all database tables with text columns.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to search for (can be full URL, domain, or path)',
            },
          },
          required: ['url'],
        },
      },
    ];
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'code_get_overview':
        return this.codeAnalyzerService.getSystemOverview();

      case 'code_list_directory':
        return this.codeAnalyzerService.listDirectory(String(params.path || ''));

      case 'code_read_file':
        return this.codeAnalyzerService.readFile(String(params.path));

      case 'code_search_files':
        return this.codeAnalyzerService.searchFiles(String(params.pattern), params.extensions as string[] | undefined);

      case 'code_search_in_files':
        return this.codeAnalyzerService.searchInFiles(String(params.searchTerm), (params.extensions as string[]) || ['.php', '.js']);

      case 'code_get_stats':
        return this.codeAnalyzerService.getCodeStats();

      case 'code_get_structure':
        return this.codeAnalyzerService.getDirectoryStructure(String(params.path || ''), Number(params.maxDepth) || 2);

      case 'code_analyze_php_file':
        return this.codeAnalyzerService.analyzePHPFile(String(params.path));

      case 'code_get_db_references':
        return this.codeAnalyzerService.getDatabaseReferences();

      case 'code_search_url':
        return this.searchUrl(String(params.url));

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async searchUrl(url: string): Promise<unknown> {
    try {
      // First search in files
      const fileSearchResult = await this.codeAnalyzerService.searchUrlInFiles(url);

      if (fileSearchResult.results.length > 0) {
        // Found in files, return file results only
        return {
          found: true,
          searchType: 'files',
          fileResults: fileSearchResult.results,
          summary: {
            totalFileMatches: fileSearchResult.results.length,
            totalDatabaseMatches: 0,
            filesSearched: fileSearchResult.filesSearched,
            tablesSearched: 0,
          },
        };
      }

      // Not found in files, search in database
      try {
        const dbSearchResult = await this.databaseService.searchUrlInDatabase(url);

        return {
          found: dbSearchResult.results.length > 0,
          searchType: dbSearchResult.results.length > 0 ? 'database' : 'none',
          databaseResults: dbSearchResult.results,
          summary: {
            totalFileMatches: 0,
            totalDatabaseMatches: dbSearchResult.results.length,
            filesSearched: fileSearchResult.filesSearched,
            tablesSearched: dbSearchResult.tablesSearched,
          },
        };
      } catch (dbError) {
        // If database search fails, return file search results (even if empty)
        const { message, stack } = errorInfo(dbError);
        this.logger.error({ error: message, stack }, 'Database search failed, returning file search results');

        return {
          found: false,
          searchType: 'files',
          fileResults: [],
          summary: {
            totalFileMatches: 0,
            totalDatabaseMatches: 0,
            filesSearched: fileSearchResult.filesSearched,
            tablesSearched: 0,
          },
          error: 'Database search failed, only file search was performed',
        };
      }
    } catch (fileError) {
      // If file search fails, try database search
      const fileErrorInfo = errorInfo(fileError);
      this.logger.error({ error: fileErrorInfo.message, stack: fileErrorInfo.stack }, 'File search failed, attempting database search');

      try {
        const dbSearchResult = await this.databaseService.searchUrlInDatabase(url);

        return {
          found: dbSearchResult.results.length > 0,
          searchType: dbSearchResult.results.length > 0 ? 'database' : 'none',
          databaseResults: dbSearchResult.results,
          summary: {
            totalFileMatches: 0,
            totalDatabaseMatches: dbSearchResult.results.length,
            filesSearched: 0,
            tablesSearched: dbSearchResult.tablesSearched,
          },
          error: 'File search failed, only database search was performed',
        };
      } catch (dbError) {
        // Both searches failed
        const dbErrorInfo = errorInfo(dbError);
        this.logger.error({ error: dbErrorInfo.message, stack: dbErrorInfo.stack }, 'Both file and database searches failed');

        throw new Error(`Search failed: ${fileErrorInfo.message}. Database search also failed: ${dbErrorInfo.message}`, { cause: dbError });
      }
    }
  }

  getResourceDefinitions(): McpResourceDefinition[] {
    return [
      {
        uri: 'app://code/overview',
        name: 'Code Overview',
        description: 'Overview of the App codebase',
        mimeType: 'application/json',
      },
      {
        uri: 'app://code/stats',
        name: 'Code Statistics',
        description: 'Statistics about the codebase',
        mimeType: 'application/json',
      },
    ];
  }

  getResourceUriPrefixes(): string[] {
    return ['app://code/'];
  }

  async readResource(uri: string): Promise<unknown> {
    switch (uri) {
      case 'app://code/overview':
        return this.codeAnalyzerService.getSystemOverview();

      case 'app://code/stats':
        return this.codeAnalyzerService.getCodeStats();

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  }
}
