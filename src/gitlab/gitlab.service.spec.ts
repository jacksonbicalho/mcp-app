import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import fetchMock from 'jest-fetch-mock';
import { GitLabService } from './gitlab.service';

function makeConfigService(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

const configured = () =>
  new GitLabService(
    makeConfigService({
      GITLAB_BASE_URL: 'https://gitlab.example.com',
      GITLAB_TOKEN: 'glpat-token',
      GITLAB_PROJECT_PATH: 'group/project',
    }),
  );

describe('GitLabService', () => {
  describe('resolveProjectPath', () => {
    it('usa o override quando informado, mesmo com GITLAB_PROJECT_PATH configurado', () => {
      const service = new GitLabService(makeConfigService({ GITLAB_PROJECT_PATH: 'group/default' }));
      expect(service.resolveProjectPath('group/override')).toBe('group/override');
    });

    it('cai para GITLAB_PROJECT_PATH quando nenhum override é passado', () => {
      const service = new GitLabService(makeConfigService({ GITLAB_PROJECT_PATH: 'group/default' }));
      expect(service.resolveProjectPath()).toBe('group/default');
    });

    it('ignora override vazio/espaços e usa o default', () => {
      const service = new GitLabService(makeConfigService({ GITLAB_PROJECT_PATH: 'group/default' }));
      expect(service.resolveProjectPath('   ')).toBe('group/default');
    });

    it('lança erro claro quando não há override nem GITLAB_PROJECT_PATH', () => {
      const service = new GitLabService(makeConfigService({}));
      expect(() => service.resolveProjectPath()).toThrow(/projectPath não pode ser vazio/);
    });
  });

  describe('getDefaultProjectPath', () => {
    it('retorna undefined quando GITLAB_PROJECT_PATH não está setado', () => {
      const service = new GitLabService(makeConfigService({}));
      expect(service.getDefaultProjectPath()).toBeUndefined();
    });

    it('retorna o valor configurado, sem espaços nas pontas', () => {
      const service = new GitLabService(makeConfigService({ GITLAB_PROJECT_PATH: '  group/project  ' }));
      expect(service.getDefaultProjectPath()).toBe('group/project');
    });
  });

  describe('encodeProjectPath', () => {
    it('url-encoda barras e espaços', () => {
      const service = new GitLabService(makeConfigService({}));
      expect(service.encodeProjectPath('group/sub project')).toBe('group%2Fsub%20project');
    });
  });

  describe('chamadas HTTP', () => {
    afterEach(() => {
      fetchMock.resetMocks();
    });

    it('getBaseUrl lança erro claro quando GITLAB_BASE_URL não está configurado', async () => {
      const service = new GitLabService(makeConfigService({ GITLAB_TOKEN: 't' }));
      await expect(service.testConnection()).rejects.toThrow(/Defina GITLAB_BASE_URL/);
    });

    it('getToken lança erro claro quando GITLAB_TOKEN não está configurado', async () => {
      const service = new GitLabService(makeConfigService({ GITLAB_BASE_URL: 'https://gitlab.example.com' }));
      await expect(service.testConnection()).rejects.toThrow(/Defina GITLAB_TOKEN/);
    });

    it('testConnection mapeia id/username/name', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ id: 1, username: 'jack', name: 'Jackson' }));
      const result = await configured().testConnection();
      expect(result).toEqual({ id: 1, username: 'jack', name: 'Jackson' });
    });

    it('traduz 401 em erro de autenticação', async () => {
      fetchMock.mockResponseOnce('', { status: 401 });
      await expect(configured().testConnection()).rejects.toThrow(/autenticação inválida/);
    });

    it('traduz 404 incluindo o corpo da resposta', async () => {
      fetchMock.mockResponseOnce('projeto não existe', { status: 404 });
      await expect(configured().testConnection()).rejects.toThrow(/não encontrado \(404\)/);
    });

    it('lança erro quando a resposta não é JSON válido', async () => {
      fetchMock.mockResponseOnce('<html>não é json</html>');
      await expect(configured().testConnection()).rejects.toThrow(/resposta não é JSON válido/);
    });

    it('traduz falha de DNS em mensagem amigável', async () => {
      fetchMock.mockRejectOnce(
        Object.assign(new Error('getaddrinfo ENOTFOUND gitlab.example.com'), {
          code: 'ENOTFOUND',
        }),
      );
      await expect(configured().testConnection()).rejects.toThrow(/falha de DNS\/rede/);
    });

    it('traduz conexão recusada em mensagem amigável', async () => {
      fetchMock.mockRejectOnce(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
      );
      await expect(configured().testConnection()).rejects.toThrow(/conexão recusada ou tempo esgotado/);
    });

    it('repassa o Error original quando não é DNS/timeout/conexão recusada', async () => {
      fetchMock.mockRejectOnce(new Error('algo bem específico'));
      await expect(configured().testConnection()).rejects.toThrow('algo bem específico');
    });

    it('envolve valores não-Error rejeitados em um Error', async () => {
      fetchMock.mockRejectOnce('string rejeitada' as never);
      await expect(configured().testConnection()).rejects.toThrow('string rejeitada');
    });

    it('traduz erros 5xx com status e statusText', async () => {
      fetchMock.mockResponseOnce('indisponível', {
        status: 503,
        statusText: 'Service Unavailable',
      });
      await expect(configured().testConnection()).rejects.toThrow(/GitLab: 503 Service Unavailable/);
    });

    it('404 sem corpo cai para o statusText', async () => {
      fetchMock.mockResponseOnce('', {
        status: 404,
        statusText: 'Not Found',
      });
      await expect(configured().testConnection()).rejects.toThrow(/recurso não encontrado \(404\)\. Not Found/);
    });

    it('getMergeRequest valida iid >= 1', async () => {
      await expect(configured().getMergeRequest(0)).rejects.toThrow(/mergeRequestIid deve ser um número inteiro/);
    });

    it('getMergeRequest mapeia os campos do MR', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          iid: 429,
          id: 1,
          title: 'Fix bug',
          state: 'opened',
          web_url: 'https://gitlab.example.com/mr/429',
          source_branch: 'fix',
          target_branch: 'master',
          author: { name: 'Fulano' },
          diff_refs: { base_sha: 'aaa', head_sha: 'bbb', start_sha: 'ccc' },
        }),
      );
      const mr = await configured().getMergeRequest(429);
      expect(mr.iid).toBe(429);
      expect(mr.author).toBe('Fulano');
      expect(mr.diffRefs).toEqual({
        baseSha: 'aaa',
        headSha: 'bbb',
        startSha: 'ccc',
      });
    });

    it('getMergeRequest usa fallbacks quando campos opcionais faltam', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ iid: 429, id: 1 }));
      const mr = await configured().getMergeRequest(429);
      expect(mr.title).toBe('');
      expect(mr.author).toBeNull();
      expect(mr.createdAt).toBeNull();
      expect(mr.diffRefs).toEqual({
        baseSha: null,
        headSha: null,
        startSha: null,
      });
    });

    it('getMergeRequestDiscussions valida iid e limita perPage a 100', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([{ id: '1' }]));
      const discussions = await configured().getMergeRequestDiscussions(429, undefined, 500);
      expect(discussions).toEqual([{ id: '1' }]);
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('per_page=100');
    });

    it('getMergeRequestDiscussions usa 100 como default quando perPage não é informado', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([]));
      await configured().getMergeRequestDiscussions(429);
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('per_page=100');
    });

    it('getMergeRequestDiscussions rejeita iid inválido', async () => {
      await expect(configured().getMergeRequestDiscussions(0)).rejects.toThrow(/mergeRequestIid deve ser um número inteiro/);
    });

    it('listMergeRequests usa state=opened por default e mapeia a lista', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify([
          {
            iid: 1,
            title: 'MR 1',
            state: 'opened',
            web_url: 'url',
            author: { username: 'fulano' },
            source_branch: 'a',
            target_branch: 'b',
          },
        ]),
      );
      const list = await configured().listMergeRequests();
      expect(list).toEqual([
        {
          iid: 1,
          title: 'MR 1',
          state: 'opened',
          webUrl: 'url',
          author: 'fulano',
          sourceBranch: 'a',
          targetBranch: 'b',
          createdAt: null,
          updatedAt: null,
        },
      ]);
    });

    it('listMergeRequests rejeita state inválido', async () => {
      await expect(
        configured().listMergeRequests({
          state: 'invalido' as never,
        }),
      ).rejects.toThrow(/state inválido/);
    });

    it('listMergeRequests usa fallbacks quando campos opcionais faltam', async () => {
      fetchMock.mockResponseOnce(JSON.stringify([{ iid: 2 }]));
      const [item] = await configured().listMergeRequests();
      expect(item.title).toBe('');
      expect(item.author).toBeNull();
      expect(item.createdAt).toBeNull();
      expect(item.updatedAt).toBeNull();
    });
  });
});
