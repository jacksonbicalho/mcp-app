import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { CodeAnalyzerService } from '../analyzer/code-analyzer.service';
import { getPinnedKeys, listEnvironmentNames, readEnvironmentBlock } from './load-environments';

const CONFIG_KEY = /^(DB_|JIRA_|KIBANA_|GITLAB_|APP_PATH|APP_ENV)/;

@Injectable()
export class EnvironmentService {
  private appliedKeys = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly codeAnalyzerService: CodeAnalyzerService,
  ) {
    for (const key of Object.keys(process.env)) {
      if (CONFIG_KEY.test(key) && !getPinnedKeys().has(key)) {
        this.appliedKeys.add(key);
      }
    }
  }

  list(): string[] {
    return listEnvironmentNames();
  }

  current() {
    const pinned = [...getPinnedKeys()].filter((key) => CONFIG_KEY.test(key));
    const configured = Object.keys(process.env)
      .filter((key) => CONFIG_KEY.test(key))
      .sort();

    return {
      environment: this.configService.get<string>('APP_ENV') || 'development',
      configuredKeys: configured,
      pinnedKeys: pinned,
      appPath: this.codeAnalyzerService.getAppPath(),
    };
  }

  async useEnvironment(environment: string, overrides?: Record<string, string>) {
    const names = listEnvironmentNames();
    if (!names.includes(environment)) {
      throw new Error(`Ambiente "${environment}" não existe. Disponíveis: ${names.join(', ')}`);
    }

    const block = readEnvironmentBlock(environment);
    const pinned = getPinnedKeys();
    const overrideEntries = this.normalizeOverrides(overrides);
    const applied: string[] = [];
    const skippedPinned: string[] = [];

    for (const key of [...this.appliedKeys]) {
      if (pinned.has(key)) {
        continue;
      }
      if (overrideEntries[key] !== undefined || block[key] !== undefined) {
        continue;
      }
      delete process.env[key];
      this.configService.set(key, undefined);
      this.appliedKeys.delete(key);
    }

    for (const [key, value] of Object.entries(block)) {
      if (overrideEntries[key] !== undefined) {
        continue;
      }
      if (pinned.has(key)) {
        skippedPinned.push(key);
        continue;
      }
      this.setConfig(key, value);
      applied.push(key);
    }

    for (const [key, value] of Object.entries(overrideEntries)) {
      this.setConfig(key, value);
      applied.push(key);
    }

    process.env.APP_ENV = environment;
    this.configService.set('APP_ENV', environment);

    await this.databaseService.resetPool();

    return {
      environment,
      appliedKeys: [...new Set(applied)].sort(),
      skippedPinnedKeys: skippedPinned.sort(),
      appPath: this.codeAnalyzerService.getAppPath(),
      message: `Ambiente ativo: ${environment}. As próximas tools usam esse bloco.`,
    };
  }

  private setConfig(key: string, value: string) {
    process.env[key] = value;
    this.configService.set(key, value);
    this.appliedKeys.add(key);
  }

  private normalizeOverrides(overrides?: Record<string, string>): Record<string, string> {
    if (!overrides || typeof overrides !== 'object') {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined || value === null) {
        continue;
      }
      result[key] = String(value);
    }
    return result;
  }
}
