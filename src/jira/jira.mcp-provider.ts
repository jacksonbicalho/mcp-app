import { Injectable } from '@nestjs/common';
import { JiraService } from './jira.service';
import { errorInfo } from '../common/error-info';
import { McpToolProvider } from '../mcp/mcp-tool-provider.decorator';
import { McpToolDefinition, McpResourceDefinition, McpToolProvider as McpToolProviderContract } from '../mcp/mcp-tool-provider.interface';

@Injectable()
@McpToolProvider()
export class JiraMcpProvider implements McpToolProviderContract {
  constructor(private readonly jiraService: JiraService) {}

  getToolDefinitions(): McpToolDefinition[] {
    return [
      {
        name: 'jira_get_issue',
        description:
          'Obtém os dados de um ticket Jira pela chave (ex: PROJ-123), para code review e cenários de teste. Inclui campos tipados da aba Gestão de mudança (desenvolvedorResponsavel, cenarioProposto, procedimentoValidacao, sistemasNecessarios) e demais custom fields preenchidos em customFields.',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'Chave do issue (ex: PROJ-123)',
            },
          },
          required: ['issueKey'],
        },
      },
      {
        name: 'jira_search',
        description: 'Busca issues no Jira por JQL (ex: project = PROJ AND status = Open).',
        inputSchema: {
          type: 'object',
          properties: {
            jql: {
              type: 'string',
              description: 'Consulta JQL',
            },
            maxResults: {
              type: 'number',
              description: 'Número máximo de resultados (default: 20, máx: 50)',
              default: 20,
            },
          },
          required: ['jql'],
        },
      },
      {
        name: 'jira_search_by_filter',
        description:
          'Busca issues no Jira por filtros (projeto, assignee, status, tipo). Gera a JQL internamente; use quando não quiser escrever JQL.',
        inputSchema: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Chave do projeto (ex: SQOT)',
            },
            assignee: {
              type: 'string',
              description: 'Nome do responsável ou currentUser() para o usuário logado',
            },
            status: {
              type: 'string',
              description: 'Nome do status (ex: Não iniciado, Em progresso)',
            },
            issueType: {
              type: 'string',
              description: 'Tipo do issue (ex: Tarefa, Bug)',
            },
            maxResults: {
              type: 'number',
              description: 'Número máximo de resultados (default: 20, máx: 50)',
              default: 20,
            },
          },
          required: [],
        },
      },
    ];
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'jira_get_issue':
        return this.jiraService.getIssue(String(params.issueKey));

      case 'jira_search':
        return this.jiraService.search(String(params.jql), params.maxResults != null ? Number(params.maxResults) : undefined);

      case 'jira_search_by_filter':
        return this.jiraService.search(
          this.jiraService.buildJqlFromFilters({
            project: params.project as string | undefined,
            assignee: params.assignee as string | undefined,
            status: params.status as string | undefined,
            issueType: params.issueType as string | undefined,
          }),
          params.maxResults != null ? Number(params.maxResults) : undefined,
        );

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  getResourceDefinitions(): McpResourceDefinition[] {
    return [
      {
        uri: 'app://jira/issue/{issueKey}',
        name: 'Jira Issue',
        description: 'Conteúdo do ticket Jira por chave (ex: PROJ-123). Use a URI app://jira/issue/KEY.',
        mimeType: 'application/json',
      },
      {
        uri: 'app://jira/search',
        name: 'Jira Search',
        description:
          'Busca de tickets no Jira com qualquer filtro JQL. Use a URI app://jira/search?jql=JQL_ENCODADO&maxResults=20 (jql obrigatório, URL-encoded; maxResults opcional, default 20, máx. 50).',
        mimeType: 'application/json',
      },
    ];
  }

  getResourceUriPrefixes(): string[] {
    return ['app://jira/'];
  }

  async readResource(uri: string): Promise<unknown> {
    if (uri.startsWith('app://jira/search')) {
      try {
        const parsed = new URL(uri);
        const jql = parsed.searchParams.get('jql');
        if (!jql || !jql.trim()) {
          throw new Error('Parâmetro jql é obrigatório na URI app://jira/search (ex: app://jira/search?jql=project%3DSQOT&maxResults=20)');
        }
        const maxResultsParam = parsed.searchParams.get('maxResults');
        const maxResults =
          maxResultsParam != null && maxResultsParam !== '' ? Math.min(Math.max(1, Math.floor(Number(maxResultsParam)) || 20), 50) : 20;
        return await this.jiraService.search(jql, maxResults);
      } catch (err) {
        const { message } = errorInfo(err);
        if (message.includes('jql é obrigatório')) throw err;
        throw new Error(`URI de busca Jira inválida: ${message || uri}`, { cause: err });
      }
    }

    if (uri.startsWith('app://jira/issue/')) {
      const issueKey = uri.slice('app://jira/issue/'.length);
      if (issueKey) {
        return this.jiraService.getIssue(issueKey);
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  }
}
