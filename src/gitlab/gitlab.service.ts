import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type GitLabMergeRequestState = 'opened' | 'closed' | 'locked' | 'merged' | 'all';

export interface GitLabUserSummary {
  id: number;
  username: string;
  name: string;
}

export interface GitLabMergeRequestSummary {
  iid: number;
  id: number;
  title: string;
  state: string;
  webUrl: string;
  sourceBranch: string;
  targetBranch: string;
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  mergedAt: string | null;
  description: string | null;
  diffRefs: {
    baseSha: string | null;
    headSha: string | null;
    startSha: string | null;
  };
}

export interface GitLabMergeRequestListItem {
  iid: number;
  title: string;
  state: string;
  webUrl: string;
  author: string | null;
  sourceBranch: string;
  targetBranch: string;
  createdAt: string | null;
  updatedAt: string | null;
}

@Injectable()
export class GitLabService {
  constructor(private configService: ConfigService) {}

  private getBaseUrl(): string {
    const url = this.configService.get<string>('GITLAB_BASE_URL');
    if (!url?.trim()) {
      throw new Error('GitLab não configurado. Defina GITLAB_BASE_URL (ex.: https://code.example.com).');
    }
    return url.replace(/\/$/, '');
  }

  private getToken(): string {
    const token = this.configService.get<string>('GITLAB_TOKEN')?.trim();
    if (!token) {
      throw new Error('GitLab não configurado. Defina GITLAB_TOKEN (Personal Access Token com header PRIVATE-TOKEN).');
    }
    return token;
  }

  getDefaultProjectPath(): string | undefined {
    return this.configService.get<string>('GITLAB_PROJECT_PATH')?.trim() || undefined;
  }

  encodeProjectPath(projectPath: string): string {
    return encodeURIComponent(projectPath.trim());
  }

  resolveProjectPath(override?: string): string {
    const path = override?.trim() || this.getDefaultProjectPath() || '';
    if (!path) {
      throw new Error('projectPath não pode ser vazio. Defina GITLAB_PROJECT_PATH ou passe projectPath na tool.');
    }
    return path;
  }

  private projectApiBase(projectPath: string): string {
    const encoded = this.encodeProjectPath(projectPath);
    return `/api/v4/projects/${encoded}`;
  }

  private wrapNetworkError(err: unknown): Error {
    const e = err as NodeJS.ErrnoException & { cause?: { code?: string } };
    const code = e?.code || e?.cause?.code;
    const msg = String(e?.message || err);
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo|Could not resolve|ENOTFOUND/i.test(msg)) {
      return new Error(`GitLab: falha de DNS/rede ao resolver o host (${msg}). Verifique VPN/rede corporativa.`);
    }
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
      return new Error(`GitLab: conexão recusada ou tempo esgotado (${code}). Verifique GITLAB_BASE_URL.`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const baseUrl = this.getBaseUrl();
    const token = this.getToken();
    const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'PRIVATE-TOKEN': token,
          ...init?.headers,
        },
      });

      const text = await response.text();
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('GitLab: autenticação inválida ou sem permissão. Verifique GITLAB_TOKEN.');
        }
        if (response.status === 404) {
          throw new Error(`GitLab: recurso não encontrado (404). ${text.slice(0, 300) || response.statusText}`);
        }
        throw new Error(`GitLab: ${response.status} ${response.statusText} — ${text.slice(0, 500)}`);
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`GitLab: resposta não é JSON válido (${text.slice(0, 200)})`);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('GitLab')) {
        throw err;
      }
      throw this.wrapNetworkError(err);
    }
  }

  async testConnection(): Promise<GitLabUserSummary> {
    const data = await this.request<{
      id: number;
      username: string;
      name: string;
    }>('/api/v4/user');

    return {
      id: data.id,
      username: data.username,
      name: data.name,
    };
  }

  private mapMergeRequest(raw: Record<string, unknown>): GitLabMergeRequestSummary {
    const author = raw.author as { name?: string; username?: string } | undefined;
    const diffRefs = (raw.diff_refs ?? {}) as Record<string, string | undefined>;

    return {
      iid: Number(raw.iid),
      id: Number(raw.id),
      title: String(raw.title ?? ''),
      state: String(raw.state ?? ''),
      webUrl: String(raw.web_url ?? ''),
      sourceBranch: String(raw.source_branch ?? ''),
      targetBranch: String(raw.target_branch ?? ''),
      author: author?.name ?? author?.username ?? null,
      createdAt: (raw.created_at as string) ?? null,
      updatedAt: (raw.updated_at as string) ?? null,
      mergedAt: (raw.merged_at as string) ?? null,
      description: (raw.description as string) ?? null,
      diffRefs: {
        baseSha: diffRefs.base_sha ?? null,
        headSha: diffRefs.head_sha ?? null,
        startSha: diffRefs.start_sha ?? null,
      },
    };
  }

  async getMergeRequest(iid: number, projectPathOverride?: string): Promise<GitLabMergeRequestSummary> {
    const mrIid = Math.floor(Number(iid));
    if (!Number.isFinite(mrIid) || mrIid < 1) {
      throw new Error('mergeRequestIid deve ser um número inteiro >= 1.');
    }
    const projectPath = this.resolveProjectPath(projectPathOverride);
    const data = await this.request<Record<string, unknown>>(`${this.projectApiBase(projectPath)}/merge_requests/${mrIid}`);
    return this.mapMergeRequest(data);
  }

  async getMergeRequestDiscussions(iid: number, projectPathOverride?: string, perPage?: number): Promise<unknown[]> {
    const mrIid = Math.floor(Number(iid));
    if (!Number.isFinite(mrIid) || mrIid < 1) {
      throw new Error('mergeRequestIid deve ser um número inteiro >= 1.');
    }
    const limit = Math.min(Math.max(1, Math.floor(Number(perPage) || 100)), 100);
    const projectPath = this.resolveProjectPath(projectPathOverride);
    const qs = new URLSearchParams({ per_page: String(limit) });
    return this.request<unknown[]>(`${this.projectApiBase(projectPath)}/merge_requests/${mrIid}/discussions?${qs.toString()}`);
  }

  async listMergeRequests(options?: {
    state?: GitLabMergeRequestState;
    projectPath?: string;
    perPage?: number;
  }): Promise<GitLabMergeRequestListItem[]> {
    const state = options?.state ?? 'opened';
    const allowed: GitLabMergeRequestState[] = ['opened', 'closed', 'locked', 'merged', 'all'];
    if (!allowed.includes(state)) {
      throw new Error(`state inválido: ${state}. Use opened, closed, locked, merged ou all.`);
    }
    const limit = Math.min(Math.max(1, Math.floor(Number(options?.perPage) || 20)), 50);
    const projectPath = this.resolveProjectPath(options?.projectPath);
    const qs = new URLSearchParams({
      state,
      per_page: String(limit),
    });
    const data = await this.request<Record<string, unknown>[]>(`${this.projectApiBase(projectPath)}/merge_requests?${qs.toString()}`);

    return data.map((raw) => {
      const author = raw.author as { name?: string; username?: string } | undefined;
      return {
        iid: Number(raw.iid),
        title: String(raw.title ?? ''),
        state: String(raw.state ?? ''),
        webUrl: String(raw.web_url ?? ''),
        author: author?.name ?? author?.username ?? null,
        sourceBranch: String(raw.source_branch ?? ''),
        targetBranch: String(raw.target_branch ?? ''),
        createdAt: (raw.created_at as string) ?? null,
        updatedAt: (raw.updated_at as string) ?? null,
      };
    });
  }
}
