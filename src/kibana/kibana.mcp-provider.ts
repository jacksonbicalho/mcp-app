import { Injectable } from '@nestjs/common';
import { KibanaService } from './kibana.service';
import { McpToolProvider } from '../mcp/mcp-tool-provider.decorator';
import { McpToolDefinition, McpToolProvider as McpToolProviderContract } from '../mcp/mcp-tool-provider.interface';

@Injectable()
@McpToolProvider()
export class KibanaMcpProvider implements McpToolProviderContract {
  constructor(private readonly kibanaService: KibanaService) {}

  getToolDefinitions(): McpToolDefinition[] {
    return [
      {
        name: 'kibana_test_connection',
        description:
          'Testa conexão com o Kibana (GET /api/status): versão e estado geral. Requer KIBANA_BASE_URL. Hosts *.internal.example só resolvem na rede corporativa/VPN.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'kibana_search',
        description:
          'Executa busca Elasticsearch via Kibana POST /api/console/proxy (Kibana 7.6.x). Body: DSL JSON. Index padrão app* (KIBANA_INDEX_PATTERN). Campos: extra.tags.industry em minúsculo; use extra.tags.industry.keyword para term exato. Exemplo QA: filtro term industry.keyword=qa e (level_name.keyword=ERROR ou range level>=400).',
        inputSchema: {
          type: 'object',
          properties: {
            dsl: {
              type: 'object',
              description: 'Objeto JSON da query Elasticsearch (ex.: size, sort, query.bool).',
            },
            indexPattern: {
              type: 'string',
              description: 'Opcional: substitui KIBANA_INDEX_PATTERN (ex.: app*).',
            },
          },
          required: ['dsl'],
        },
      },
      {
        name: 'kibana_index_pattern_fields',
        description:
          'Lista nomes de campos conhecidos pelo Kibana para o index-pattern (GET /api/saved_objects/index-pattern/:id). Útil para message, level, level_name, channel, context.*, extra.*.',
        inputSchema: {
          type: 'object',
          properties: {
            savedObjectId: {
              type: 'string',
              description: 'Opcional: ID do saved object index-pattern; default KIBANA_INDEX_PATTERN_ID.',
            },
          },
          required: [],
        },
      },
    ];
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'kibana_test_connection':
        return this.kibanaService.testConnection();

      case 'kibana_search': {
        let dslObj: Record<string, unknown>;
        const raw = params.dsl;
        if (raw == null) {
          throw new Error('Parâmetro dsl é obrigatório.');
        }
        if (typeof raw === 'string') {
          try {
            dslObj = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            throw new Error('dsl deve ser um objeto JSON ou string JSON válida.');
          }
        } else if (typeof raw === 'object' && !Array.isArray(raw)) {
          dslObj = raw as Record<string, unknown>;
        } else {
          throw new Error('dsl deve ser um objeto de query Elasticsearch.');
        }
        return this.kibanaService.search(dslObj, params.indexPattern != null ? String(params.indexPattern) : undefined);
      }

      case 'kibana_index_pattern_fields':
        return this.kibanaService.getIndexPatternFields(params.savedObjectId != null ? String(params.savedObjectId) : undefined);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
}
