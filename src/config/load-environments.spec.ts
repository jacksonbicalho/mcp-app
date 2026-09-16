import { afterEach, describe, expect, it, jest } from '@jest/globals';

// `fs.existsSync`/`readFileSync` não são configuráveis em todas as versões do
// Node (jest.spyOn falha com "Cannot redefine property"), então substituímos
// o módulo inteiro — mantendo o restante da implementação real via
// requireActual — só para poder controlar essas duas funções por teste.
// Começam delegando pro fs real: load-environments.ts roda loadEnvironments()
// como efeito colateral do próprio import, antes de qualquer teste configurar
// um mock específico.
const actualFs = jest.requireActual<typeof import('fs')>('fs');
const mockExistsSync = jest.fn<(p: unknown) => boolean>((p) => actualFs.existsSync(p as never));
const mockReadFileSync = jest.fn<(p: unknown, opts?: unknown) => string>(
  (p, opts) => actualFs.readFileSync(p as never, opts as never) as unknown as string,
);

jest.mock('fs', () => ({
  ...(jest.requireActual('fs') as object),
  existsSync: (p: unknown) => mockExistsSync(p),
  readFileSync: (p: unknown, opts?: unknown) => mockReadFileSync(p, opts),
}));

import * as path from 'path';
import { getEnvironmentsPath, listEnvironmentNames, loadEnvironments, readEnvironmentBlock } from './load-environments';

const environmentsPath = getEnvironmentsPath();
const dotEnvPath = path.join(path.dirname(environmentsPath), '.env');

function mockEnvironmentsFile(content: string | null, dotEnvContent?: string | null) {
  mockExistsSync.mockImplementation((p: unknown) => {
    if (p === environmentsPath) return content !== null;
    if (dotEnvContent !== undefined && p === dotEnvPath) return dotEnvContent !== null;
    return actualFs.existsSync(p as never);
  });
  mockReadFileSync.mockImplementation((p: unknown, opts?: unknown) => {
    if (p === environmentsPath) return content as string;
    if (dotEnvContent !== undefined && p === dotEnvPath) return dotEnvContent as string;
    return actualFs.readFileSync(p as never, opts as never) as unknown as string;
  });
}

describe('load-environments', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('lança erro claro quando environments.json não existe', () => {
    mockEnvironmentsFile(null);
    expect(() => listEnvironmentNames()).toThrow(/environments\.json não encontrado/);
  });

  it('lança erro claro quando environments.json tem JSON inválido', () => {
    mockEnvironmentsFile('{ isso não é json');
    expect(() => listEnvironmentNames()).toThrow(/Falha ao ler/);
  });

  it('lista os nomes dos blocos de um environments.json válido', () => {
    mockEnvironmentsFile(JSON.stringify({ development: {}, staging: {} }));
    expect(listEnvironmentNames()).toEqual(['development', 'staging']);
  });

  it('readEnvironmentBlock lança erro listando os ambientes disponíveis quando o bloco não existe', () => {
    mockEnvironmentsFile(JSON.stringify({ development: { DB_HOST: 'x' } }));
    expect(() => readEnvironmentBlock('staging')).toThrow(/APP_ENV="staging" não encontrado.*Ambientes disponíveis: development/);
  });

  it('readEnvironmentBlock lista "(nenhum)" quando environments.json está vazio', () => {
    mockEnvironmentsFile(JSON.stringify({}));
    expect(() => readEnvironmentBlock('development')).toThrow(/Ambientes disponíveis: \(nenhum\)/);
  });

  it('readEnvironmentBlock filtra APP_ENV/env do bloco e converte valores em string', () => {
    mockEnvironmentsFile(
      JSON.stringify({
        development: { DB_HOST: 'localhost', DB_PORT: 5432, APP_ENV: 'nao-deveria-aparecer' },
      }),
    );
    expect(readEnvironmentBlock('development')).toEqual({
      DB_HOST: 'localhost',
      DB_PORT: '5432',
    });
  });

  it('readEnvironmentBlock aceita o formato { env: { ... } }', () => {
    mockEnvironmentsFile(JSON.stringify({ development: { env: { DB_HOST: 'localhost' } } }));
    expect(readEnvironmentBlock('development')).toEqual({
      DB_HOST: 'localhost',
    });
  });

  describe('loadEnvironments', () => {
    it('usa DEFAULT_APP_ENV e loga aviso quando APP_ENV não está definido em nenhum lugar', () => {
      mockEnvironmentsFile(
        JSON.stringify({ development: { DB_HOST: 'x' } }),
        null, // sem .env (ou sem APP_ENV nele) — simula não haver nenhuma fonte
      );
      delete process.env.APP_ENV;
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      loadEnvironments();

      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('usando default "development"'))).toBe(true);
      expect(process.env.APP_ENV).toBe('development');
      errorSpy.mockRestore();
    });

    it('não sobrescreve APP_ENV quando já está definido externamente', () => {
      mockEnvironmentsFile(JSON.stringify({ development: {}, staging: { DB_HOST: 'y' } }));
      process.env.APP_ENV = 'staging';
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      loadEnvironments();

      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('usando default'))).toBe(false);
      expect(process.env.APP_ENV).toBe('staging');
      errorSpy.mockRestore();
    });

    it('não sobrescreve uma chave que já existia em process.env antes de carregar', () => {
      mockEnvironmentsFile(JSON.stringify({ development: { DB_HOST: 'do-bloco' } }));
      process.env.APP_ENV = 'development';
      process.env.DB_HOST = 'ja-existia';
      jest.spyOn(console, 'error').mockImplementation(() => undefined);

      loadEnvironments();

      expect(process.env.DB_HOST).toBe('ja-existia');
    });
  });
});
