import { describe, expect, it, jest } from '@jest/globals';
import { JiraMcpProvider } from './jira.mcp-provider';
import type { JiraService } from './jira.service';

function makeJiraService() {
  return {
    getIssue: jest.fn(async (..._args: unknown[]) => ({ key: 'PROJ-1' })),
    search: jest.fn(async (..._args: unknown[]) => ({
      issues: [],
      total: 0,
      maxResults: 20,
    })),
    buildJqlFromFilters: jest.fn((..._args: unknown[]) => 'project = PROJ'),
  };
}

function makeProvider() {
  const jiraService = makeJiraService();
  const provider = new JiraMcpProvider(jiraService as unknown as JiraService);
  return { provider, jiraService };
}

describe('JiraMcpProvider', () => {
  it('expõe as 3 tools esperadas', () => {
    const { provider } = makeProvider();
    expect(provider.getToolDefinitions().map((t) => t.name)).toEqual(['jira_get_issue', 'jira_search', 'jira_search_by_filter']);
  });

  describe('callTool', () => {
    it('jira_get_issue repassa a chave', async () => {
      const { provider, jiraService } = makeProvider();
      await provider.callTool('jira_get_issue', { issueKey: 'proj-1' });
      expect(jiraService.getIssue).toHaveBeenCalledWith('proj-1');
    });

    it('jira_search repassa jql e maxResults', async () => {
      const { provider, jiraService } = makeProvider();
      await provider.callTool('jira_search', {
        jql: 'project = PROJ',
        maxResults: 10,
      });
      expect(jiraService.search).toHaveBeenCalledWith('project = PROJ', 10);
    });

    it('jira_search usa undefined quando maxResults não é informado', async () => {
      const { provider, jiraService } = makeProvider();
      await provider.callTool('jira_search', { jql: 'project = PROJ' });
      expect(jiraService.search).toHaveBeenCalledWith('project = PROJ', undefined);
    });

    it('jira_search_by_filter monta JQL a partir dos filtros e busca', async () => {
      const { provider, jiraService } = makeProvider();
      await provider.callTool('jira_search_by_filter', {
        project: 'PROJ',
        assignee: 'bob',
        status: 'Aberto',
        issueType: 'Bug',
        maxResults: 5,
      });
      expect(jiraService.buildJqlFromFilters).toHaveBeenCalledWith({
        project: 'PROJ',
        assignee: 'bob',
        status: 'Aberto',
        issueType: 'Bug',
      });
      expect(jiraService.search).toHaveBeenCalledWith('project = PROJ', 5);
    });

    it('jira_search_by_filter usa undefined quando maxResults não é informado', async () => {
      const { provider, jiraService } = makeProvider();
      await provider.callTool('jira_search_by_filter', { project: 'PROJ' });
      expect(jiraService.search).toHaveBeenCalledWith('project = PROJ', undefined);
    });

    it('lança erro para tool desconhecida', async () => {
      const { provider } = makeProvider();
      await expect(provider.callTool('unknown', {})).rejects.toThrow(/Unknown tool: unknown/);
    });
  });

  describe('resources', () => {
    it('expõe 2 resources e o prefixo app://jira/', () => {
      const { provider } = makeProvider();
      expect(provider.getResourceDefinitions()).toHaveLength(2);
      expect(provider.getResourceUriPrefixes()).toEqual(['app://jira/']);
    });

    it('readResource de issue chama getIssue com a chave', async () => {
      const { provider, jiraService } = makeProvider();
      await provider.readResource('app://jira/issue/PROJ-123');
      expect(jiraService.getIssue).toHaveBeenCalledWith('PROJ-123');
    });

    it('readResource de search exige jql na query', async () => {
      const { provider } = makeProvider();
      await expect(provider.readResource('app://jira/search')).rejects.toThrow(/jql é obrigatório/);
    });

    it('readResource de search usa maxResults default 20 quando não informado', async () => {
      const { provider, jiraService } = makeProvider();
      await provider.readResource('app://jira/search?jql=project%3DPROJ');
      expect(jiraService.search).toHaveBeenCalledWith('project=PROJ', 20);
    });

    it('readResource de search limita maxResults a 50', async () => {
      const { provider, jiraService } = makeProvider();
      await provider.readResource('app://jira/search?jql=project%3DPROJ&maxResults=999');
      expect(jiraService.search).toHaveBeenCalledWith('project=PROJ', 50);
    });

    it('propaga (envolvido) um erro do search() que não seja sobre jql ausente', async () => {
      const { provider, jiraService } = makeProvider();
      jiraService.search.mockRejectedValueOnce(new Error('Jira não configurado. Defina JIRA_BASE_URL no ambiente.'));
      await expect(provider.readResource('app://jira/search?jql=project%3DPROJ')).rejects.toThrow(/URI de busca Jira inválida: Jira não configurado/);
    });

    it('usa a URI na mensagem de erro quando o erro capturado não tem message', async () => {
      const { provider, jiraService } = makeProvider();
      jiraService.search.mockRejectedValueOnce(new Error(''));
      const uri = 'app://jira/search?jql=project%3DPROJ';
      await expect(provider.readResource(uri)).rejects.toThrow(`URI de busca Jira inválida: ${uri}`);
    });

    it('maxResults não-numérico na query cai para o default 20', async () => {
      const { provider, jiraService } = makeProvider();
      await provider.readResource('app://jira/search?jql=project%3DPROJ&maxResults=abc');
      expect(jiraService.search).toHaveBeenCalledWith('project=PROJ', 20);
    });

    it('lança erro para app://jira/issue/ sem chave', async () => {
      const { provider } = makeProvider();
      await expect(provider.readResource('app://jira/issue/')).rejects.toThrow(/Unknown resource/);
    });

    it('lança erro para resource desconhecido', async () => {
      const { provider } = makeProvider();
      await expect(provider.readResource('app://jira/nao-existe')).rejects.toThrow(/Unknown resource/);
    });
  });
});
