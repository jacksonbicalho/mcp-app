import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import { EnvironmentService } from './environment.service';
import * as loadEnvironmentsModule from './load-environments';
import type { DatabaseService } from '../database/database.service';
import type { CodeAnalyzerService } from '../analyzer/code-analyzer.service';

function makeConfigService(initial: Record<string, string> = {}): ConfigService {
  const store = new Map(Object.entries(initial));
  return {
    get: jest.fn((key: string) => store.get(key)),
    set: jest.fn((key: string, value: unknown) => {
      store.set(key, value as string);
    }),
  } as unknown as ConfigService;
}

function makeDatabaseService() {
  return { resetPool: jest.fn(async () => undefined) };
}

function makeCodeAnalyzerService(appPath = '/projetos/app') {
  return { getAppPath: jest.fn(() => appPath) };
}

function makeService(configValues: Record<string, string> = {}) {
  const configService = makeConfigService(configValues);
  const databaseService = makeDatabaseService();
  const codeAnalyzerService = makeCodeAnalyzerService();
  const service = new EnvironmentService(
    configService as ConfigService,
    databaseService as unknown as DatabaseService,
    codeAnalyzerService as unknown as CodeAnalyzerService,
  );
  return { service, configService, databaseService, codeAnalyzerService };
}

describe('EnvironmentService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  describe('list', () => {
    it('retorna os nomes dos ambientes de environments.json, incluindo development', () => {
      const { service } = makeService();
      expect(service.list()).toContain('development');
    });
  });

  describe('current', () => {
    it("usa 'development' como default quando APP_ENV não está configurado", () => {
      const { service } = makeService();
      const current = service.current();
      expect(current.environment).toBe('development');
    });

    it('usa o APP_ENV configurado quando presente', () => {
      const { service } = makeService({ APP_ENV: 'staging' });
      expect(service.current().environment).toBe('staging');
    });

    it('inclui o appPath vindo do CodeAnalyzerService', () => {
      const { service, codeAnalyzerService } = makeService();
      const current = service.current();
      expect(current.appPath).toBe('/projetos/app');
      expect(codeAnalyzerService.getAppPath).toHaveBeenCalled();
    });
  });

  describe('useEnvironment', () => {
    it('lança erro para ambiente inexistente', async () => {
      const { service } = makeService();
      await expect(service.useEnvironment('nao-existe')).rejects.toThrow(/não existe. Disponíveis:/);
    });

    it('aplica as chaves do bloco, atualiza APP_ENV e reseta o pool do banco', async () => {
      const { service, databaseService } = makeService();
      const result = await service.useEnvironment('development');

      expect(result.environment).toBe('development');
      expect(result.appliedKeys).toEqual(expect.arrayContaining(['DB_HOST']));
      expect(process.env.APP_ENV).toBe('development');
      expect(databaseService.resetPool).toHaveBeenCalled();
      expect(result.message).toMatch(/Ambiente ativo: development/);
    });

    it('overrides vencem o valor do bloco do ambiente', async () => {
      const { service, configService } = makeService();
      await service.useEnvironment('development', {
        DB_HOST: 'host-customizado',
      });
      expect(configService.set).toHaveBeenCalledWith('DB_HOST', 'host-customizado');
    });

    it('ignora overrides com valor undefined/null', async () => {
      const { service } = makeService();
      const result = await service.useEnvironment('development', {
        DB_HOST: undefined as unknown as string,
      });
      // Sem override válido, DB_HOST vem do bloco normalmente
      expect(result.appliedKeys).toEqual(expect.arrayContaining(['DB_HOST']));
    });

    it('troca de ambiente remove chaves aplicadas que não existem no novo bloco', async () => {
      const { service } = makeService();
      await service.useEnvironment('development', {
        CHAVE_EXTRA_QUE_SO_EXISTE_NO_OVERRIDE: 'valor',
      });
      expect(process.env.CHAVE_EXTRA_QUE_SO_EXISTE_NO_OVERRIDE).toBe('valor');

      // O bloco "staging" não repete a chave extra do passo anterior — ela
      // deve ser removida do process.env ao trocar de ambiente.
      await service.useEnvironment('staging');
      expect(process.env.CHAVE_EXTRA_QUE_SO_EXISTE_NO_OVERRIDE).toBeUndefined();
    });

    it('não aplica uma chave pinada e reporta em skippedPinnedKeys', async () => {
      const { service } = makeService();
      const pinnedSpy = jest.spyOn(loadEnvironmentsModule, 'getPinnedKeys').mockReturnValue(new Set(['DB_HOST']));

      const result = await service.useEnvironment('development');

      expect(result.skippedPinnedKeys).toContain('DB_HOST');
      pinnedSpy.mockRestore();
    });

    it('ao limpar chaves antigas, pula as que estão pinadas em vez de removê-las', async () => {
      const { service } = makeService();
      await service.useEnvironment('development', { DB_HOST: 'override' });

      const pinnedSpy = jest.spyOn(loadEnvironmentsModule, 'getPinnedKeys').mockReturnValue(new Set(['DB_HOST']));
      process.env.DB_HOST = 'valor-pinado';

      await service.useEnvironment('staging');

      expect(process.env.DB_HOST).toBe('valor-pinado');
      pinnedSpy.mockRestore();
    });
  });
});
