import { Injectable } from '@nestjs/common';
import { GitLabService, GitLabMergeRequestState } from './gitlab.service';
import { McpToolProvider } from '../mcp/mcp-tool-provider.decorator';
import { McpToolDefinition, McpResourceDefinition, McpToolProvider as McpToolProviderContract } from '../mcp/mcp-tool-provider.interface';

@Injectable()
@McpToolProvider()
export class GitLabMcpProvider implements McpToolProviderContract {
  constructor(private readonly gitLabService: GitLabService) {}

  getToolDefinitions(): McpToolDefinition[] {
    return [
      {
        name: 'gitlab_test_connection',
        description: 'Testa conexão com o GitLab (GET /api/v4/user). Requer GITLAB_BASE_URL e GITLAB_TOKEN (header PRIVATE-TOKEN).',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'gitlab_get_merge_request',
        description:
          'Obtém detalhes de um merge request por IID. projectPath opcional (barras, ex.: apps/example/services/app); default GITLAB_PROJECT_PATH.',
        inputSchema: {
          type: 'object',
          properties: {
            mergeRequestIid: {
              type: 'number',
              description: 'IID do merge request (ex.: 429)',
            },
            projectPath: {
              type: 'string',
              description: 'Opcional: caminho do projeto no GitLab com barras.',
            },
          },
          required: ['mergeRequestIid'],
        },
      },
      {
        name: 'gitlab_get_mr_discussions',
        description:
          'Lista discussions (comentários/reviews) de um merge request. Equivalente a GET .../merge_requests/{iid}/discussions. projectPath default GITLAB_PROJECT_PATH.',
        inputSchema: {
          type: 'object',
          properties: {
            mergeRequestIid: {
              type: 'number',
              description: 'IID do merge request (ex.: 429)',
            },
            projectPath: {
              type: 'string',
              description: 'Opcional: caminho do projeto com barras.',
            },
            perPage: {
              type: 'number',
              description: 'Itens por página (default 100, máx. 100)',
              default: 100,
            },
          },
          required: ['mergeRequestIid'],
        },
      },
      {
        name: 'gitlab_list_merge_requests',
        description: 'Lista merge requests do projeto. state default opened. projectPath default GITLAB_PROJECT_PATH.',
        inputSchema: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              description: 'opened, closed, locked, merged ou all (default opened)',
              default: 'opened',
            },
            projectPath: {
              type: 'string',
              description: 'Opcional: caminho do projeto com barras.',
            },
            perPage: {
              type: 'number',
              description: 'Itens por página (default 20, máx. 50)',
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
      case 'gitlab_test_connection':
        return this.gitLabService.testConnection();

      case 'gitlab_get_merge_request':
        return this.gitLabService.getMergeRequest(
          Number(params.mergeRequestIid),
          params.projectPath != null ? String(params.projectPath) : undefined,
        );

      case 'gitlab_get_mr_discussions':
        return this.gitLabService.getMergeRequestDiscussions(
          Number(params.mergeRequestIid),
          params.projectPath != null ? String(params.projectPath) : undefined,
          params.perPage != null ? Number(params.perPage) : undefined,
        );

      case 'gitlab_list_merge_requests':
        return this.gitLabService.listMergeRequests({
          state: params.state != null ? (String(params.state) as GitLabMergeRequestState) : undefined,
          projectPath: params.projectPath != null ? String(params.projectPath) : undefined,
          perPage: params.perPage != null ? Number(params.perPage) : undefined,
        });

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  getResourceDefinitions(): McpResourceDefinition[] {
    return [
      {
        uri: 'app://gitlab/mr/{iid}',
        name: 'GitLab Merge Request',
        description: 'Detalhes do MR por IID. URI app://gitlab/mr/429 ou app://gitlab/mr/429?projectPath=apps%2Fexample%2Fservices%2Fapp.',
        mimeType: 'application/json',
      },
      {
        uri: 'app://gitlab/mr/{iid}/discussions',
        name: 'GitLab MR Discussions',
        description: 'Discussions do MR. URI app://gitlab/mr/429/discussions (projectPath opcional na query).',
        mimeType: 'application/json',
      },
    ];
  }

  getResourceUriPrefixes(): string[] {
    return ['app://gitlab/'];
  }

  async readResource(uri: string): Promise<unknown> {
    if (!uri.startsWith('app://gitlab/mr/')) {
      throw new Error(`Unknown resource: ${uri}`);
    }

    const parsed = new URL(uri);
    const pathAfter = uri.slice('app://gitlab/mr/'.length);
    const pathPart = pathAfter.split('?')[0];
    const isDiscussions = pathPart.endsWith('/discussions');
    const iidStr = isDiscussions ? pathPart.slice(0, -'/discussions'.length) : pathPart;
    const iid = Math.floor(Number(iidStr));
    if (!Number.isFinite(iid) || iid < 1) {
      throw new Error('IID inválido na URI GitLab (ex.: app://gitlab/mr/429)');
    }
    const projectPath = parsed.searchParams.get('projectPath');
    const projectOverride = projectPath != null && projectPath.trim() !== '' ? decodeURIComponent(projectPath) : undefined;

    if (isDiscussions) {
      return this.gitLabService.getMergeRequestDiscussions(iid, projectOverride);
    }
    return this.gitLabService.getMergeRequest(iid, projectOverride);
  }
}
