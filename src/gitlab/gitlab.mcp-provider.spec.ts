import { describe, expect, it, jest } from '@jest/globals';
import { GitLabMcpProvider } from './gitlab.mcp-provider';
import type { GitLabService } from './gitlab.service';

function makeGitLabService() {
  return {
    testConnection: jest.fn(async (..._args: unknown[]) => ({ id: 1 })),
    getMergeRequest: jest.fn(async (..._args: unknown[]) => ({ iid: 429 })),
    getMergeRequestDiscussions: jest.fn(async (..._args: unknown[]) => []),
    listMergeRequests: jest.fn(async (..._args: unknown[]) => []),
  };
}

function makeProvider() {
  const gitLabService = makeGitLabService();
  const provider = new GitLabMcpProvider(gitLabService as unknown as GitLabService);
  return { provider, gitLabService };
}

describe('GitLabMcpProvider', () => {
  it('expõe as 4 tools esperadas', () => {
    const { provider } = makeProvider();
    expect(provider.getToolDefinitions().map((t) => t.name)).toEqual([
      'gitlab_test_connection',
      'gitlab_get_merge_request',
      'gitlab_get_mr_discussions',
      'gitlab_list_merge_requests',
    ]);
  });

  describe('callTool', () => {
    it('gitlab_test_connection delega direto', async () => {
      const { provider, gitLabService } = makeProvider();
      await provider.callTool('gitlab_test_connection', {});
      expect(gitLabService.testConnection).toHaveBeenCalled();
    });

    it('gitlab_get_merge_request converte iid e repassa projectPath', async () => {
      const { provider, gitLabService } = makeProvider();
      await provider.callTool('gitlab_get_merge_request', {
        mergeRequestIid: '429',
        projectPath: 'group/project',
      });
      expect(gitLabService.getMergeRequest).toHaveBeenCalledWith(429, 'group/project');
    });

    it('gitlab_get_merge_request usa undefined quando projectPath não é informado', async () => {
      const { provider, gitLabService } = makeProvider();
      await provider.callTool('gitlab_get_merge_request', {
        mergeRequestIid: 429,
      });
      expect(gitLabService.getMergeRequest).toHaveBeenCalledWith(429, undefined);
    });

    it('gitlab_get_mr_discussions repassa iid, projectPath e perPage', async () => {
      const { provider, gitLabService } = makeProvider();
      await provider.callTool('gitlab_get_mr_discussions', {
        mergeRequestIid: 429,
        projectPath: 'group/project',
        perPage: 50,
      });
      expect(gitLabService.getMergeRequestDiscussions).toHaveBeenCalledWith(429, 'group/project', 50);
    });

    it('gitlab_get_mr_discussions usa undefined quando projectPath/perPage não são informados', async () => {
      const { provider, gitLabService } = makeProvider();
      await provider.callTool('gitlab_get_mr_discussions', {
        mergeRequestIid: 429,
      });
      expect(gitLabService.getMergeRequestDiscussions).toHaveBeenCalledWith(429, undefined, undefined);
    });

    it('gitlab_list_merge_requests monta options com state/projectPath/perPage', async () => {
      const { provider, gitLabService } = makeProvider();
      await provider.callTool('gitlab_list_merge_requests', {
        state: 'closed',
        projectPath: 'group/project',
        perPage: 10,
      });
      expect(gitLabService.listMergeRequests).toHaveBeenCalledWith({
        state: 'closed',
        projectPath: 'group/project',
        perPage: 10,
      });
    });

    it('gitlab_list_merge_requests sem params gera options com tudo undefined', async () => {
      const { provider, gitLabService } = makeProvider();
      await provider.callTool('gitlab_list_merge_requests', {});
      expect(gitLabService.listMergeRequests).toHaveBeenCalledWith({
        state: undefined,
        projectPath: undefined,
        perPage: undefined,
      });
    });

    it('lança erro para tool desconhecida', async () => {
      const { provider } = makeProvider();
      await expect(provider.callTool('unknown', {})).rejects.toThrow(/Unknown tool: unknown/);
    });
  });

  describe('resources', () => {
    it('expõe 2 resources e o prefixo app://gitlab/', () => {
      const { provider } = makeProvider();
      expect(provider.getResourceDefinitions()).toHaveLength(2);
      expect(provider.getResourceUriPrefixes()).toEqual(['app://gitlab/']);
    });

    it('lança erro pra URI fora do prefixo esperado', async () => {
      const { provider } = makeProvider();
      await expect(provider.readResource('app://outro/coisa')).rejects.toThrow(/Unknown resource/);
    });

    it('readResource de MR simples chama getMergeRequest', async () => {
      const { provider, gitLabService } = makeProvider();
      await provider.readResource('app://gitlab/mr/429');
      expect(gitLabService.getMergeRequest).toHaveBeenCalledWith(429, undefined);
    });

    it('readResource com projectPath na query decodifica corretamente', async () => {
      const { provider, gitLabService } = makeProvider();
      await provider.readResource('app://gitlab/mr/429?projectPath=group%2Fproject');
      expect(gitLabService.getMergeRequest).toHaveBeenCalledWith(429, 'group/project');
    });

    it('readResource de discussions chama getMergeRequestDiscussions', async () => {
      const { provider, gitLabService } = makeProvider();
      await provider.readResource('app://gitlab/mr/429/discussions');
      expect(gitLabService.getMergeRequestDiscussions).toHaveBeenCalledWith(429, undefined);
    });

    it('lança erro para IID inválido', async () => {
      const { provider } = makeProvider();
      await expect(provider.readResource('app://gitlab/mr/abc')).rejects.toThrow(/IID inválido/);
    });

    it('lança erro para IID zero ou negativo', async () => {
      const { provider } = makeProvider();
      await expect(provider.readResource('app://gitlab/mr/0')).rejects.toThrow(/IID inválido/);
    });
  });
});
