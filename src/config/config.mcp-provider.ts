import { Injectable } from '@nestjs/common';
import { EnvironmentService } from './environment.service';
import { McpToolProvider } from '../mcp/mcp-tool-provider.decorator';
import { McpToolDefinition, McpToolProvider as McpToolProviderContract } from '../mcp/mcp-tool-provider.interface';

@Injectable()
@McpToolProvider()
export class ConfigMcpProvider implements McpToolProviderContract {
  constructor(private readonly environmentService: EnvironmentService) {}

  getToolDefinitions(): McpToolDefinition[] {
    return [
      {
        name: 'use_environment',
        description:
          'Ativa um ambiente (development, staging, production, local) para as próximas tools. Use quando o usuário pedir para trabalhar/executar em um ambiente. Credenciais vêm de environments.json; o parâmetro overrides deixa o cliente passar host, senha, token etc. nesta chamada (vence o JSON e o env do mcp.json).',
        inputSchema: {
          type: 'object',
          properties: {
            environment: {
              type: 'string',
              description: 'Nome do bloco em environments.json (ex.: development, staging, production, local)',
            },
            overrides: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description:
                'Opcional. Credenciais ou endereços do cliente (DB_HOST, DB_PASSWORD, JIRA_API_TOKEN, APP_PATH, …). Vencem o bloco do ambiente.',
            },
          },
          required: ['environment'],
        },
      },
      {
        name: 'list_environments',
        description: 'Lista os ambientes disponíveis em environments.json (só os nomes, sem segredos).',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_current_environment',
        description: 'Mostra o ambiente ativo, APP_PATH e quais chaves de config estão setadas (sem valores).',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ];
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'use_environment':
        return this.environmentService.useEnvironment(String(params.environment), params.overrides as Record<string, string> | undefined);
      case 'list_environments':
        return { environments: this.environmentService.list() };
      case 'get_current_environment':
        return this.environmentService.current();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
