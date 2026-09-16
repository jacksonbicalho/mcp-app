import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GESTAO_MUDANCA_FIELDS, GESTAO_MUDANCA_FIELD_IDS, FieldMapping, GestaoMudancaFieldKey } from './jira.field-map';

export interface JiraIssueSummary {
  key: string;
  summary: string;
  description: string | null;
  status: string;
  assignee: string | null;
  link: string;
  acceptanceCriteria: string | null;
  issueType: string;
  project: string;
  created: string | null;
  updated: string | null;
  /** Gestão de mudança — first-class fields */
  desenvolvedorResponsavel: string | null;
  cenarioProposto: string | null;
  procedimentoValidacao: string | null;
  sistemasNecessarios: string | null;
  /** Other filled custom fields keyed by readable name (excludes Gestão de mudança typed fields). */
  customFields: Record<string, string>;
}

export interface JiraSearchResult {
  issues: JiraIssueSummary[];
  total: number;
  maxResults: number;
}

// Shape mínimo usado do payload de /rest/api/3/issue e /search/jql. Campos
// nomeados são os que a Jira sempre retorna com esse formato; o resto (custom
// fields) é genuinamente dinâmico por instância, daí o index signature unknown.
interface JiraFieldsPayload {
  summary?: string;
  description?: unknown;
  status?: { name?: string } | null;
  assignee?: { displayName?: string; emailAddress?: string } | null;
  issuetype?: { name?: string } | null;
  project?: { key?: string; name?: string } | null;
  created?: string;
  updated?: string;
  [customField: string]: unknown;
}

interface JiraRawIssue {
  key?: string;
  fields?: JiraFieldsPayload;
  names?: Record<string, string>;
}

@Injectable()
export class JiraService {
  constructor(private configService: ConfigService) {}

  private getBaseUrl(): string {
    const url = this.configService.get<string>('JIRA_BASE_URL');
    if (!url) {
      throw new Error('Jira não configurado. Defina JIRA_BASE_URL no ambiente (ex: https://seu-dominio.atlassian.net).');
    }
    return url.replace(/\/$/, '');
  }

  private getAuthHeader(): string {
    const email = this.configService.get<string>('JIRA_EMAIL');
    const token = this.configService.get<string>('JIRA_API_TOKEN');
    if (!email || !token) {
      throw new Error('Jira não configurado. Defina JIRA_EMAIL e JIRA_API_TOKEN no ambiente.');
    }
    const encoded = Buffer.from(`${email}:${token}`).toString('base64');
    return `Basic ${encoded}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const auth = this.getAuthHeader();
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: auth,
        ...init?.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Jira: autenticação inválida. Verifique JIRA_EMAIL e JIRA_API_TOKEN.');
      }
      if (response.status === 404) {
        const text = await response.text();
        throw new Error(`Jira: recurso não encontrado. ${text || response.statusText}`);
      }
      if (response.status === 410) {
        const text = await response.text();
        throw new Error(
          `Jira: API removida (410 Gone). Este servidor deve usar /rest/api/3/search/jql. Verifique se o processo MCP está rodando o código mais recente (yarn build e reinicie o servidor). ${text || ''}`,
        );
      }
      if (response.status >= 500) {
        throw new Error(`Jira: erro no servidor (${response.status}). Tente mais tarde.`);
      }
      const text = await response.text();
      throw new Error(`Jira: ${response.status} - ${text || response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /** Extract plain text from Jira ADF (Atlassian Document Format) description. */
  private adfToPlainText(node: unknown): string {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (typeof node !== 'object') return '';
    const obj = node as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    const content = obj.content;
    if (Array.isArray(content)) {
      return content.map((c) => this.adfToPlainText(c)).join('');
    }
    return '';
  }

  /**
   * Normalize a Jira field value to a readable string, or null if empty.
   */
  private normalizeFieldValue(value: unknown): string | null {
    if (value == null) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      const parts = value.map((item) => this.normalizeFieldValue(item)).filter((s): s is string => s != null && s !== '');
      return parts.length > 0 ? parts.join(', ') : null;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (typeof obj.displayName === 'string') return obj.displayName;
      if (typeof obj.emailAddress === 'string') return obj.emailAddress;
      if (typeof obj.value === 'string') return obj.value;
      if (typeof obj.name === 'string' && !obj.content) return obj.name;
      // ADF document
      if (obj.type === 'doc' || Array.isArray(obj.content)) {
        const text = this.adfToPlainText(obj).trim();
        return text === '' ? null : text;
      }
      return null;
    }
    return null;
  }

  /**
   * Resolve a mapped field: try hardcoded ID first, then match by name via expand=names.
   */
  private resolveMappedField(fields: Record<string, unknown>, names: Record<string, string> | undefined, mapping: FieldMapping): string | null {
    // Happy path: hardcoded ID is present on the issue payload
    if (mapping.id && Object.prototype.hasOwnProperty.call(fields, mapping.id)) {
      return this.normalizeFieldValue(fields[mapping.id]);
    }

    // Fallback: locate field by readable name via expand=names
    if (!names) return null;

    const wanted = new Set(mapping.names.map((n) => n.trim().toLowerCase().replace(/:$/, '')));
    for (const [fieldId, fieldName] of Object.entries(names)) {
      const normalizedName = (fieldName || '').trim().toLowerCase().replace(/:$/, '');
      if (wanted.has(normalizedName)) {
        return this.normalizeFieldValue(fields[fieldId]);
      }
    }

    return null;
  }

  private collectCustomFields(fields: Record<string, unknown>, names: Record<string, string> | undefined): Record<string, string> {
    const result: Record<string, string> = {};
    if (!fields) return result;

    for (const [fieldId, rawValue] of Object.entries(fields)) {
      if (!fieldId.startsWith('customfield_')) continue;
      if (GESTAO_MUDANCA_FIELD_IDS.has(fieldId)) continue;

      const normalized = this.normalizeFieldValue(rawValue);
      if (normalized == null) continue;

      const label = names?.[fieldId] || fieldId;
      // Skip if this field was resolved as a typed Gestão de mudança field via name fallback
      const labelLower = label.trim().toLowerCase().replace(/:$/, '');
      const isTyped = Object.values(GESTAO_MUDANCA_FIELDS).some((m) => m.names.some((n) => n.trim().toLowerCase().replace(/:$/, '') === labelLower));
      if (isTyped) continue;

      result[label] = normalized;
    }

    return result;
  }

  private mapIssueFromApi(raw: JiraRawIssue): JiraIssueSummary {
    const baseUrl = this.getBaseUrl();
    const key = raw.key ?? '';
    const link = `${baseUrl}/browse/${key}`;
    const fields = raw.fields ?? {};
    const names = raw.names;
    const description = fields.description;
    const descriptionText = typeof description === 'string' ? description : description ? this.adfToPlainText(description) : null;

    let acceptanceCriteria: string | null = null;

    for (const [k, v] of Object.entries(fields)) {
      if (v && typeof v === 'object' && 'value' in v) {
        const val = v.value;
        if (typeof val === 'string' && /acceptance|criteria|critério/i.test(k)) {
          acceptanceCriteria = val;
          break;
        }
      }
    }

    if (!acceptanceCriteria && typeof fields.customfield_10036 === 'string') {
      acceptanceCriteria = fields.customfield_10036;
    }

    const typed = {} as Record<GestaoMudancaFieldKey, string | null>;
    for (const keyName of Object.keys(GESTAO_MUDANCA_FIELDS) as GestaoMudancaFieldKey[]) {
      typed[keyName] = this.resolveMappedField(fields, names, GESTAO_MUDANCA_FIELDS[keyName]);
    }

    // Only build customFields bag when names are available (getIssue with expand=names)
    const customFields = names ? this.collectCustomFields(fields, names) : {};

    return {
      key,
      summary: fields.summary ?? '',
      description: descriptionText ?? null,
      status: fields.status?.name ?? '',
      assignee: fields.assignee?.displayName ?? fields.assignee?.emailAddress ?? null,
      link,
      acceptanceCriteria,
      issueType: fields.issuetype?.name ?? '',
      project: fields.project?.key ?? fields.project?.name ?? '',
      created: fields.created ?? null,
      updated: fields.updated ?? null,
      desenvolvedorResponsavel: typed.desenvolvedorResponsavel,
      cenarioProposto: typed.cenarioProposto,
      procedimentoValidacao: typed.procedimentoValidacao,
      sistemasNecessarios: typed.sistemasNecessarios,
      customFields,
    };
  }

  async getIssue(issueKey: string): Promise<JiraIssueSummary> {
    const key = issueKey.trim().toUpperCase();
    if (!key) {
      throw new Error('Chave do issue é obrigatória (ex: PROJ-123).');
    }

    const data = await this.request<JiraRawIssue>(`/rest/api/3/issue/${encodeURIComponent(key)}?expand=names`);

    return this.mapIssueFromApi(data);
  }

  /**
   * Builds a JQL string from structured filters (project, assignee, status, issueType).
   * Use when the client does not want to write raw JQL.
   */
  buildJqlFromFilters(filters: { project?: string; assignee?: string; status?: string; issueType?: string }): string {
    const parts: string[] = [];
    if (filters.project?.trim()) {
      parts.push(`project = ${filters.project.trim()}`);
    }
    if (filters.assignee?.trim()) {
      const a = filters.assignee.trim();
      parts.push(a === 'currentUser()' ? 'assignee = currentUser()' : `assignee = "${a.replace(/"/g, '\\"')}"`);
    }
    if (filters.status?.trim()) {
      parts.push(`status = "${filters.status.trim().replace(/"/g, '\\"')}"`);
    }
    if (filters.issueType?.trim()) {
      parts.push(`type = "${filters.issueType.trim().replace(/"/g, '\\"')}"`);
    }
    if (parts.length === 0) {
      throw new Error('Informe ao menos um filtro (project, assignee, status ou issueType).');
    }
    return parts.join(' AND ');
  }

  async search(jql: string, maxResults: number = 20): Promise<JiraSearchResult> {
    const limit = Math.min(Math.max(1, Math.floor(Number(maxResults) || 20)), 50);
    const fields = 'summary,description,status,assignee,issuetype,project,created,updated';
    // API v3: usar /rest/api/3/search/jql (não o antigo /rest/api/3/search)
    const path = `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${limit}&fields=${encodeURIComponent(fields)}`;

    const data = await this.request<{
      issues: JiraRawIssue[];
      total?: number;
      maxResults?: number;
      isLast?: boolean;
    }>(path);

    const issues = (data.issues ?? []).map((i) => this.mapIssueFromApi(i));

    return {
      issues,
      total: data.total ?? issues.length,
      maxResults: data.maxResults ?? limit,
    };
  }

  /** Returns true if Jira is configured (base URL, email and token set). */
  isConfigured(): boolean {
    return !!(
      this.configService.get<string>('JIRA_BASE_URL') &&
      this.configService.get<string>('JIRA_EMAIL') &&
      this.configService.get<string>('JIRA_API_TOKEN')
    );
  }
}
