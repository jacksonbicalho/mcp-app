import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Allowed characters for index pattern passed to console proxy (single segment before /_search). */
const INDEX_PATTERN_SAFE = /^[a-zA-Z0-9_*.,-]+$/;

const SAVED_OBJECT_ID_SAFE = /^[a-zA-Z0-9_-]+$/;

const DEFAULT_INDEX_PATTERN = 'app*';
const DEFAULT_INDEX_PATTERN_ID = 'c878fc70-48a2-11f1-9245-15f07e063a37';
const DEFAULT_XSRF = 'kibana';

const MAX_FIELD_NAMES = 800;

@Injectable()
export class KibanaService {
  constructor(private configService: ConfigService) {}

  private getBaseUrl(): string {
    const url = this.configService.get<string>('KIBANA_BASE_URL');
    if (!url?.trim()) {
      throw new Error('Kibana não configurado. Defina KIBANA_BASE_URL (ex.: http://kibana.example:5601).');
    }
    return url.replace(/\/$/, '');
  }

  private getXsrfValue(): string {
    return this.configService.get<string>('KIBANA_XSRF_VALUE')?.trim() || DEFAULT_XSRF;
  }

  private getDefaultIndexPattern(): string {
    return this.configService.get<string>('KIBANA_INDEX_PATTERN')?.trim() || DEFAULT_INDEX_PATTERN;
  }

  private getDefaultIndexPatternId(): string {
    return this.configService.get<string>('KIBANA_INDEX_PATTERN_ID')?.trim() || DEFAULT_INDEX_PATTERN_ID;
  }

  private buildAuthorizationHeader(): string | undefined {
    const apiId = this.configService.get<string>('KIBANA_API_KEY_ID')?.trim();
    const apiSecret = this.configService.get<string>('KIBANA_API_KEY_SECRET')?.trim();
    if (apiId && apiSecret) {
      const raw = `${apiId}:${apiSecret}`;
      return `ApiKey ${Buffer.from(raw, 'utf8').toString('base64')}`;
    }
    const user = this.configService.get<string>('KIBANA_USERNAME')?.trim();
    const passRaw = this.configService.get<string>('KIBANA_PASSWORD');
    if (user && passRaw !== undefined && passRaw !== null) {
      const pass = passRaw;
      return `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
    }
    return undefined;
  }

  private baseHeaders(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'kbn-xsrf': this.getXsrfValue(),
      ...extra,
    };
    const auth = this.buildAuthorizationHeader();
    if (auth) {
      h.Authorization = auth;
    }
    return h;
  }

  private wrapNetworkError(err: unknown): Error {
    const e = err as NodeJS.ErrnoException & { cause?: { code?: string } };
    const code = e?.code || e?.cause?.code;
    const msg = String(e?.message || err);
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo|Could not resolve|ENOTFOUND/i.test(msg)) {
      return new Error(
        `Kibana: falha de DNS/rede ao resolver o host (${msg}). Hostnames internos (ex.: *.internal.example) exigem VPN ou DNS corporativo; isso não é erro de autenticação.`,
      );
    }
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
      return new Error(`Kibana: conexão recusada ou tempo esgotado (${code}). Verifique KIBANA_BASE_URL e firewall.`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private validateIndexPattern(pattern: string): string {
    const p = pattern.trim();
    if (!p) {
      throw new Error('indexPattern não pode ser vazio.');
    }
    if (!INDEX_PATTERN_SAFE.test(p)) {
      throw new Error('indexPattern contém caracteres não permitidos. Use apenas letras, dígitos, *, _, -, vírgula e ponto.');
    }
    return p;
  }

  private validateSavedObjectId(id: string): string {
    const s = id.trim();
    if (!s) {
      throw new Error('savedObjectId não pode ser vazio.');
    }
    if (!SAVED_OBJECT_ID_SAFE.test(s)) {
      throw new Error('savedObjectId contém caracteres não permitidos. Use apenas letras, dígitos, hífen e sublinhado.');
    }
    return s;
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    try {
      const response = await fetch(url, init);
      const text = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `Kibana: ${response.status} — acesso negado. Configure KIBANA_API_KEY_ID/KIBANA_API_KEY_SECRET ou KIBANA_USERNAME/KIBANA_PASSWORD se o ambiente exigir autenticação.`,
          );
        }
        throw new Error(`Kibana: ${response.status} ${response.statusText} — ${text.slice(0, 500)}`);
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Kibana: resposta não é JSON válido (${text.slice(0, 200)})`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Kibana:')) {
        throw err;
      }
      throw this.wrapNetworkError(err);
    }
  }

  async testConnection(): Promise<{
    version: string | null;
    overallState: string | null;
    name: string | null;
    raw?: Record<string, unknown>;
  }> {
    const data = await this.fetchJson<Record<string, unknown>>('/api/status', {
      method: 'GET',
      headers: this.baseHeaders(),
    });
    const version = data.version as { number?: string } | undefined;
    const status = data.status as { overall?: { state?: string } } | undefined;
    return {
      version: version?.number ?? null,
      overallState: status?.overall?.state ?? null,
      name: (data.name as string) ?? null,
      raw: {
        name: data.name,
        version: data.version,
        status: data.status,
      },
    };
  }

  async search(dsl: Record<string, unknown>, indexPatternOverride?: string): Promise<unknown> {
    const rawDefault = this.getDefaultIndexPattern();
    const pattern = this.validateIndexPattern((indexPatternOverride ?? rawDefault).trim() || rawDefault);
    const path = `${pattern}/_search`;
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/api/console/proxy?path=${encodeURIComponent(path)}&method=POST`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.baseHeaders({
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify(dsl),
      });
      const text = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error(`Kibana: ${response.status} — acesso negado no console proxy. Verifique credenciais opcionais.`);
        }
        throw new Error(`Kibana console proxy: ${response.status} ${response.statusText} — ${text.slice(0, 800)}`);
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new Error(`Kibana: corpo da busca não é JSON (${text.slice(0, 300)})`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Kibana')) {
        throw err;
      }
      throw this.wrapNetworkError(err);
    }
  }

  async getIndexPatternFields(savedObjectId?: string): Promise<{
    id: string;
    type: string;
    title: string | null;
    timeFieldName: string | null;
    fieldNames: string[];
    fieldNamesTruncated: boolean;
    totalFieldNames: number;
  }> {
    const id = this.validateSavedObjectId((savedObjectId ?? this.getDefaultIndexPatternId()).trim());
    const data = await this.fetchJson<{
      id?: string;
      type?: string;
      attributes?: {
        title?: string;
        timeFieldName?: string;
        fields?: string;
      };
    }>(`/api/saved_objects/index-pattern/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: this.baseHeaders(),
    });
    const attrs = data.attributes ?? {};
    let names: string[] = [];
    if (typeof attrs.fields === 'string' && attrs.fields.length > 0) {
      try {
        const parsed = JSON.parse(attrs.fields) as Record<string, { name?: string }>;
        names = Object.keys(parsed);
      } catch {
        names = [];
      }
    }
    names.sort();
    const total = names.length;
    const truncated = total > MAX_FIELD_NAMES;
    if (truncated) {
      names = names.slice(0, MAX_FIELD_NAMES);
    }
    return {
      id: data.id ?? id,
      type: data.type ?? 'index-pattern',
      title: attrs.title ?? null,
      timeFieldName: attrs.timeFieldName ?? null,
      fieldNames: names,
      fieldNamesTruncated: truncated,
      totalFieldNames: total,
    };
  }
}
