import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import fetchMock from 'jest-fetch-mock';
import { JiraService } from './jira.service';

function makeConfigService(values: Record<string, string>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

const configuredService = () =>
  new JiraService(
    makeConfigService({
      JIRA_BASE_URL: 'https://example.atlassian.net',
      JIRA_EMAIL: 'user@example.com',
      JIRA_API_TOKEN: 'token123',
    }),
  );

describe('JiraService', () => {
  describe('buildJqlFromFilters', () => {
    it('combina múltiplos filtros com AND', () => {
      const service = configuredService();
      expect(service.buildJqlFromFilters({ project: 'PROJ', status: 'Aberto' })).toBe('project = PROJ AND status = "Aberto"');
    });

    it('inclui o filtro issueType', () => {
      const service = configuredService();
      expect(service.buildJqlFromFilters({ issueType: 'Bug' })).toBe('type = "Bug"');
    });

    it('trata assignee = currentUser() sem aspas', () => {
      const service = configuredService();
      expect(service.buildJqlFromFilters({ assignee: 'currentUser()' })).toBe('assignee = currentUser()');
    });

    it('escapa aspas duplas dentro dos valores', () => {
      const service = configuredService();
      expect(service.buildJqlFromFilters({ status: 'Em "progresso"' })).toBe('status = "Em \\"progresso\\""');
    });

    it('lança erro quando nenhum filtro é informado', () => {
      const service = configuredService();
      expect(() => service.buildJqlFromFilters({})).toThrow(/Informe ao menos um filtro/);
    });

    it('ignora filtros vazios/só espaços', () => {
      const service = configuredService();
      expect(service.buildJqlFromFilters({ project: '  ', assignee: 'bob' })).toBe('assignee = "bob"');
    });
  });

  describe('isConfigured', () => {
    it('retorna true quando URL, email e token estão setados', () => {
      expect(configuredService().isConfigured()).toBe(true);
    });

    it('retorna false quando falta qualquer uma das três chaves', () => {
      const service = new JiraService(makeConfigService({ JIRA_BASE_URL: 'https://example.atlassian.net' }));
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('getIssue', () => {
    beforeEach(() => {
      fetchMock.resetMocks();
    });

    it('mapeia summary, status, assignee e descrição em ADF (texto simples)', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-123',
          fields: {
            summary: 'Corrigir bug de login',
            description: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Descrição em ADF' }],
                },
              ],
            },
            status: { name: 'Em progresso' },
            assignee: { displayName: 'Fulano da Silva' },
            issuetype: { name: 'Bug' },
            project: { key: 'PROJ' },
            created: '2026-01-01T00:00:00.000Z',
            updated: '2026-01-02T00:00:00.000Z',
          },
        }),
      );

      const service = configuredService();
      const issue = await service.getIssue('proj-123');

      expect(issue.key).toBe('PROJ-123');
      expect(issue.summary).toBe('Corrigir bug de login');
      expect(issue.description).toBe('Descrição em ADF');
      expect(issue.status).toBe('Em progresso');
      expect(issue.assignee).toBe('Fulano da Silva');
      expect(issue.issueType).toBe('Bug');
      expect(issue.project).toBe('PROJ');
      expect(issue.link).toBe('https://example.atlassian.net/browse/PROJ-123');
    });

    it('lança erro claro quando a chave do issue é vazia', async () => {
      const service = configuredService();
      await expect(service.getIssue('   ')).rejects.toThrow(/Chave do issue é obrigatória/);
    });

    it('traduz 401 em mensagem de autenticação inválida', async () => {
      fetchMock.mockResponseOnce('', { status: 401 });
      const service = configuredService();
      await expect(service.getIssue('PROJ-1')).rejects.toThrow(/autenticação inválida/);
    });

    it('traduz 404 incluindo o corpo da resposta', async () => {
      fetchMock.mockResponseOnce('issue não existe', { status: 404 });
      await expect(configuredService().getIssue('PROJ-1')).rejects.toThrow(/recurso não encontrado/);
    });

    it('traduz 410 orientando a atualizar o servidor', async () => {
      fetchMock.mockResponseOnce('gone', { status: 410 });
      await expect(configuredService().getIssue('PROJ-1')).rejects.toThrow(/API removida \(410 Gone\)/);
    });

    it('traduz 5xx em erro de servidor', async () => {
      fetchMock.mockResponseOnce('', { status: 503 });
      await expect(configuredService().getIssue('PROJ-1')).rejects.toThrow(/erro no servidor \(503\)/);
    });

    it('outros códigos de erro incluem status e corpo', async () => {
      fetchMock.mockResponseOnce('bad request', { status: 400 });
      await expect(configuredService().getIssue('PROJ-1')).rejects.toThrow(/Jira: 400 - bad request/);
    });

    it('lança erro quando as credenciais não estão configuradas', async () => {
      const service = new JiraService(makeConfigService({ JIRA_BASE_URL: 'https://example.atlassian.net' }));
      await expect(service.getIssue('PROJ-1')).rejects.toThrow(/Defina JIRA_EMAIL e JIRA_API_TOKEN/);
    });

    it('lança erro quando JIRA_BASE_URL não está configurado', async () => {
      const service = new JiraService(makeConfigService({}));
      await expect(service.getIssue('PROJ-1')).rejects.toThrow(/Defina JIRA_BASE_URL/);
    });

    it('aceita description como string simples (sem ADF)', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: { description: 'Descrição em texto puro' },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.description).toBe('Descrição em texto puro');
    });

    it('retorna string vazia para um nó ADF sem text nem content', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: { description: { type: 'doc', version: 1 } },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.description).toBe('');
    });

    it('assignee cai para emailAddress quando não há displayName', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: { assignee: { emailAddress: 'fulano@example.com' } },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.assignee).toBe('fulano@example.com');
    });

    it('project cai para name quando não há key', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: { project: { name: 'Meu Projeto' } },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.project).toBe('Meu Projeto');
    });

    it("extrai acceptanceCriteria de um campo cuja chave menciona 'criteria'/'critério'", async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: {
            acceptance_criteria: { value: 'Critério de aceite aqui' },
          },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.acceptanceCriteria).toBe('Critério de aceite aqui');
    });

    it('usa customfield_10036 como fallback de acceptanceCriteria', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: { customfield_10036: 'Critério via fallback' },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.acceptanceCriteria).toBe('Critério via fallback');
    });

    it('resolve campos de Gestão de Mudança pelo id hardcoded', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: {
            customfield_10358: 'Fulano Dev',
            customfield_10359: 'Cenário X',
          },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.desenvolvedorResponsavel).toBe('Fulano Dev');
      expect(issue.cenarioProposto).toBe('Cenário X');
    });

    it('resolve campo de Gestão de Mudança por nome via expand=names quando o id não está no payload', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: {
            customfield_55555: 'Sistema A, Sistema B',
          },
          names: {
            customfield_55555: 'Sistemas necessários',
          },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.sistemasNecessarios).toBe('Sistema A, Sistema B');
    });

    it('agrupa custom fields não mapeados em customFields, usando o nome de names', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: {
            customfield_77777: 'valor customizado',
          },
          names: {
            customfield_77777: 'Campo Customizado',
          },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.customFields).toEqual({
        'Campo Customizado': 'valor customizado',
      });
    });

    it('não duplica em customFields um campo já resolvido como Gestão de Mudança', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: { customfield_10358: 'Fulano Dev' },
          names: { customfield_10358: 'Desenvolvedor Responsável' },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.customFields).toEqual({});
    });

    it('normaliza valores numéricos, booleanos e arrays em campos custom', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: {
            customfield_11111: 42,
            customfield_22222: true,
            customfield_33333: ['a', 'b', null],
          },
          names: {
            customfield_11111: 'Número',
            customfield_22222: 'Booleano',
            customfield_33333: 'Lista',
          },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.customFields).toEqual({
        Número: '42',
        Booleano: 'true',
        Lista: 'a, b',
      });
    });

    it('normaliza campos custom com formato objeto (select/user/ADF)', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: {
            customfield_44444: { displayName: 'Fulano' },
            customfield_55556: { emailAddress: 'fulano@example.com' },
            customfield_66666: { value: 'Opção A' },
            customfield_77778: { name: 'Alta' },
            customfield_88888: {
              type: 'doc',
              content: [{ type: 'text', text: 'Texto em ADF' }],
            },
            customfield_99999: {},
          },
          names: {
            customfield_44444: 'Usuário (nome)',
            customfield_55556: 'Usuário (email)',
            customfield_66666: 'Seleção',
            customfield_77778: 'Prioridade',
            customfield_88888: 'Descrição ADF',
            customfield_99999: 'Objeto vazio',
          },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.customFields).toEqual({
        'Usuário (nome)': 'Fulano',
        'Usuário (email)': 'fulano@example.com',
        Seleção: 'Opção A',
        Prioridade: 'Alta',
        'Descrição ADF': 'Texto em ADF',
      });
    });

    it('ignora custom fields vazios/nulos', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          key: 'PROJ-1',
          fields: { customfield_11111: null, customfield_22222: '   ' },
          names: { customfield_11111: 'Vazio', customfield_22222: 'Espaços' },
        }),
      );
      const issue = await configuredService().getIssue('PROJ-1');
      expect(issue.customFields).toEqual({});
    });

    it('sem expand=names (data via search), customFields fica vazio mesmo com custom fields presentes', async () => {
      fetchMock.mockResponseOnce(
        JSON.stringify({
          issues: [
            {
              key: 'PROJ-1',
              fields: { customfield_11111: 'valor' },
            },
          ],
        }),
      );
      const result = await configuredService().search('project = PROJ');
      expect(result.issues[0].customFields).toEqual({});
    });
  });

  describe('search', () => {
    beforeEach(() => {
      fetchMock.resetMocks();
    });

    it('usa maxResults default 20 e mapeia issues/total', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ issues: [{ key: 'PROJ-1', fields: {} }] }));
      const result = await configuredService().search('project = PROJ');
      expect(result.issues).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.maxResults).toBe(20);
    });

    it('usa total/maxResults vindos da resposta quando presentes', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ issues: [], total: 137, maxResults: 20 }));
      const result = await configuredService().search('project = PROJ', 20);
      expect(result.total).toBe(137);
    });

    it('limita maxResults a 50 no máximo', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ issues: [] }));
      await configuredService().search('project = PROJ', 500);
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('maxResults=50');
    });

    it('usa 20 quando maxResults não é um número válido', async () => {
      fetchMock.mockResponseOnce(JSON.stringify({ issues: [] }));
      await configuredService().search('project = PROJ', NaN);
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain('maxResults=20');
    });
  });
});
