import { describe, expect, it, jest } from '@jest/globals';
import { AnalyzerMcpProvider } from './analyzer.mcp-provider';
import type { CodeAnalyzerService } from './code-analyzer.service';
import type { DatabaseService } from '../database/database.service';
import type { PinoLogger } from 'nestjs-pino';

function makeCodeAnalyzerService() {
  return {
    getSystemOverview: jest.fn(async (..._args: unknown[]) => ({
      framework: 'PHP',
    })),
    listDirectory: jest.fn(async (..._args: unknown[]) => []),
    readFile: jest.fn(async (..._args: unknown[]) => ({ content: '' })),
    searchFiles: jest.fn(async (..._args: unknown[]) => []),
    searchInFiles: jest.fn(async (..._args: unknown[]) => []),
    getCodeStats: jest.fn(async (..._args: unknown[]) => ({ totalFiles: 0 })),
    getDirectoryStructure: jest.fn(async (..._args: unknown[]) => ({
      name: 'app',
    })),
    analyzePHPFile: jest.fn(async (..._args: unknown[]) => null),
    getDatabaseReferences: jest.fn(async (..._args: unknown[]) => []),
    searchUrlInFiles: jest.fn(async (..._args: unknown[]) => ({
      results: [] as Array<{
        file: string;
        line: number;
        context: string;
        fileType: string;
      }>,
      filesSearched: 0,
    })),
  };
}

function makeDatabaseService() {
  return {
    searchUrlInDatabase: jest.fn(async (..._args: unknown[]) => ({
      results: [] as Array<Record<string, unknown>>,
      tablesSearched: 0,
    })),
  };
}

function makeLogger() {
  return {
    setContext: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  };
}

function makeProvider() {
  const codeAnalyzerService = makeCodeAnalyzerService();
  const databaseService = makeDatabaseService();
  const logger = makeLogger();
  const provider = new AnalyzerMcpProvider(
    codeAnalyzerService as unknown as CodeAnalyzerService,
    databaseService as unknown as DatabaseService,
    logger as unknown as PinoLogger,
  );
  return { provider, codeAnalyzerService, databaseService, logger };
}

describe('AnalyzerMcpProvider', () => {
  it('chama logger.setContext no construtor', () => {
    const { logger } = makeProvider();
    expect(logger.setContext).toHaveBeenCalledWith('AnalyzerMcpProvider');
  });

  it('expõe as 10 tools esperadas', () => {
    const { provider } = makeProvider();
    expect(provider.getToolDefinitions()).toHaveLength(10);
  });

  describe('callTool', () => {
    it('code_get_overview delega direto', async () => {
      const { provider, codeAnalyzerService } = makeProvider();
      await provider.callTool('code_get_overview', {});
      expect(codeAnalyzerService.getSystemOverview).toHaveBeenCalled();
    });

    it('code_list_directory usa string vazia como default', async () => {
      const { provider, codeAnalyzerService } = makeProvider();
      await provider.callTool('code_list_directory', {});
      expect(codeAnalyzerService.listDirectory).toHaveBeenCalledWith('');
    });

    it('code_read_file repassa o path', async () => {
      const { provider, codeAnalyzerService } = makeProvider();
      await provider.callTool('code_read_file', { path: 'a.php' });
      expect(codeAnalyzerService.readFile).toHaveBeenCalledWith('a.php');
    });

    it('code_search_files repassa pattern e extensions', async () => {
      const { provider, codeAnalyzerService } = makeProvider();
      await provider.callTool('code_search_files', {
        pattern: 'controller',
        extensions: ['.php'],
      });
      expect(codeAnalyzerService.searchFiles).toHaveBeenCalledWith('controller', ['.php']);
    });

    it('code_search_in_files usa default de extensões quando não informado', async () => {
      const { provider, codeAnalyzerService } = makeProvider();
      await provider.callTool('code_search_in_files', { searchTerm: 'x' });
      expect(codeAnalyzerService.searchInFiles).toHaveBeenCalledWith('x', ['.php', '.js']);
    });

    it('code_get_stats delega direto', async () => {
      const { provider, codeAnalyzerService } = makeProvider();
      await provider.callTool('code_get_stats', {});
      expect(codeAnalyzerService.getCodeStats).toHaveBeenCalled();
    });

    it('code_get_structure usa maxDepth default 2 quando inválido', async () => {
      const { provider, codeAnalyzerService } = makeProvider();
      await provider.callTool('code_get_structure', {});
      expect(codeAnalyzerService.getDirectoryStructure).toHaveBeenCalledWith('', 2);
    });

    it('code_analyze_php_file repassa o path', async () => {
      const { provider, codeAnalyzerService } = makeProvider();
      await provider.callTool('code_analyze_php_file', { path: 'a.php' });
      expect(codeAnalyzerService.analyzePHPFile).toHaveBeenCalledWith('a.php');
    });

    it('code_get_db_references delega direto', async () => {
      const { provider, codeAnalyzerService } = makeProvider();
      await provider.callTool('code_get_db_references', {});
      expect(codeAnalyzerService.getDatabaseReferences).toHaveBeenCalled();
    });

    it('lança erro para tool desconhecida', async () => {
      const { provider } = makeProvider();
      await expect(provider.callTool('unknown', {})).rejects.toThrow(/Unknown tool: unknown/);
    });
  });

  describe('code_search_url', () => {
    it('retorna resultado de arquivos quando encontra lá', async () => {
      const { provider, codeAnalyzerService, databaseService } = makeProvider();
      codeAnalyzerService.searchUrlInFiles.mockResolvedValueOnce({
        results: [{ file: 'a.php', line: 1, context: 'x', fileType: '.php' }],
        filesSearched: 5,
      });

      const result = (await provider.callTool('code_search_url', {
        url: 'exemplo.dev',
      })) as { found: boolean; searchType: string };

      expect(result.found).toBe(true);
      expect(result.searchType).toBe('files');
      expect(databaseService.searchUrlInDatabase).not.toHaveBeenCalled();
    });

    it('cai pro banco quando não encontra em arquivos', async () => {
      const { provider, databaseService } = makeProvider();
      databaseService.searchUrlInDatabase.mockResolvedValueOnce({
        results: [{ table: 't', column: 'c', value: 'exemplo.dev' }],
        tablesSearched: 3,
      });

      const result = (await provider.callTool('code_search_url', {
        url: 'exemplo.dev',
      })) as { found: boolean; searchType: string };

      expect(result.found).toBe(true);
      expect(result.searchType).toBe('database');
    });

    it('retorna none quando não encontra nem em arquivos nem no banco', async () => {
      const { provider } = makeProvider();
      const result = (await provider.callTool('code_search_url', {
        url: 'nao-existe',
      })) as { found: boolean; searchType: string };

      expect(result.found).toBe(false);
      expect(result.searchType).toBe('none');
    });

    it('se a busca no banco falhar após não achar em arquivos, retorna resultado de arquivos vazio com erro', async () => {
      const { provider, databaseService, logger } = makeProvider();
      databaseService.searchUrlInDatabase.mockRejectedValueOnce(new Error('db off'));

      const result = (await provider.callTool('code_search_url', {
        url: 'exemplo.dev',
      })) as { found: boolean; error: string };

      expect(result.found).toBe(false);
      expect(result.error).toMatch(/Database search failed/);
      expect(logger.error).toHaveBeenCalled();
    });

    it('se a busca em arquivos falhar, tenta o banco e retorna sucesso', async () => {
      const { provider, codeAnalyzerService, databaseService } = makeProvider();
      codeAnalyzerService.searchUrlInFiles.mockRejectedValueOnce(new Error('fs off'));
      databaseService.searchUrlInDatabase.mockResolvedValueOnce({
        results: [{ table: 't' }],
        tablesSearched: 1,
      });

      const result = (await provider.callTool('code_search_url', {
        url: 'exemplo.dev',
      })) as { found: boolean; error: string };

      expect(result.found).toBe(true);
      expect(result.error).toMatch(/File search failed/);
    });

    it('se a busca em arquivos falhar e o banco não achar nada, searchType é none', async () => {
      const { provider, codeAnalyzerService, databaseService } = makeProvider();
      codeAnalyzerService.searchUrlInFiles.mockRejectedValueOnce(new Error('fs off'));
      databaseService.searchUrlInDatabase.mockResolvedValueOnce({
        results: [],
        tablesSearched: 3,
      });

      const result = (await provider.callTool('code_search_url', {
        url: 'exemplo.dev',
      })) as { found: boolean; searchType: string };

      expect(result.found).toBe(false);
      expect(result.searchType).toBe('none');
    });

    it('se ambas as buscas falharem, lança erro combinando as duas mensagens', async () => {
      const { provider, codeAnalyzerService, databaseService } = makeProvider();
      codeAnalyzerService.searchUrlInFiles.mockRejectedValueOnce(new Error('fs off'));
      databaseService.searchUrlInDatabase.mockRejectedValueOnce(new Error('db off'));

      await expect(provider.callTool('code_search_url', { url: 'exemplo.dev' })).rejects.toThrow(
        /Search failed: fs off.*Database search also failed: db off/,
      );
    });
  });

  describe('resources', () => {
    it('expõe 2 resources e o prefixo app://code/', () => {
      const { provider } = makeProvider();
      expect(provider.getResourceDefinitions()).toHaveLength(2);
      expect(provider.getResourceUriPrefixes()).toEqual(['app://code/']);
    });

    it('readResource resolve overview e stats', async () => {
      const { provider, codeAnalyzerService } = makeProvider();
      await provider.readResource('app://code/overview');
      expect(codeAnalyzerService.getSystemOverview).toHaveBeenCalled();

      await provider.readResource('app://code/stats');
      expect(codeAnalyzerService.getCodeStats).toHaveBeenCalled();
    });

    it('lança erro para resource desconhecido', async () => {
      const { provider } = makeProvider();
      await expect(provider.readResource('app://code/nao-existe')).rejects.toThrow(/Unknown resource/);
    });
  });
});
