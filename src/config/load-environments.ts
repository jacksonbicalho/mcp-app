import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';
import { errorInfo } from '../common/error-info';

// Este arquivo vive em src/config (ou dist/config quando compilado) — sempre
// dois níveis abaixo da raiz do projeto, tanto em ts-node quanto em dist/.
const projectRoot = join(__dirname, '..', '..');

export const DEFAULT_APP_ENV = 'development';

const SKIP_PROFILE_KEYS = new Set(['APP_ENV', 'env']);

let pinnedKeys = new Set<string>();

export function getPinnedKeys(): ReadonlySet<string> {
  return pinnedKeys;
}

export function getEnvironmentsPath(): string {
  return join(projectRoot, 'environments.json');
}

function isEnvMap(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Aceita `{ DB_HOST: … }` ou `{ env: { DB_HOST: … } }`. A chave do ambiente já é o seletor. */
function resolveEnvBlock(block: Record<string, unknown>): Record<string, unknown> {
  return isEnvMap(block.env) ? block.env : block;
}

function readEnvironmentsFile(): Record<string, Record<string, unknown>> {
  const environmentsPath = getEnvironmentsPath();
  if (!existsSync(environmentsPath)) {
    throw new Error(
      `environments.json não encontrado em ${environmentsPath}. Copie environments.example.json e preencha as credenciais de cada ambiente.`,
    );
  }

  try {
    return JSON.parse(readFileSync(environmentsPath, 'utf-8'));
  } catch (err) {
    throw new Error(`Falha ao ler ${environmentsPath}: ${errorInfo(err).message}`, { cause: err });
  }
}

export function listEnvironmentNames(): string[] {
  return Object.keys(readEnvironmentsFile());
}

export function readEnvironmentBlock(appEnv: string): Record<string, string> {
  const environments = readEnvironmentsFile();
  const block = environments[appEnv];
  if (!block || !isEnvMap(block)) {
    const available = Object.keys(environments).join(', ') || '(nenhum)';
    throw new Error(`APP_ENV="${appEnv}" não encontrado em ${getEnvironmentsPath()}. Ambientes disponíveis: ${available}`);
  }

  const vars = resolveEnvBlock(block);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (SKIP_PROFILE_KEYS.has(key)) {
      continue;
    }
    result[key] = String(value);
  }
  return result;
}

/**
 * Prioridade final: process.env já definido no processo (ex.: bloco "env" da
 * config MCP do Cursor) > bloco do ambiente ativo em environments.json > .env.
 * Nada aqui sobrescreve o que já estava em process.env antes desta função rodar.
 *
 * A chave em environments.json (development, staging, …) escolhe o bloco.
 * APP_ENV só é necessário para sair do default "development" — não vai no .env
 * nem dentro de cada bloco. environments.json continua obrigatório.
 *
 * Chaves que já estavam em process.env ficam "pinned": use_environment não as
 * sobrescreve a menos que o cliente mande override na tool.
 */
export function loadEnvironments(): void {
  const externalEnv = { ...process.env };
  pinnedKeys = new Set(Object.keys(externalEnv));

  const envFilePath = join(projectRoot, '.env');
  const fileVars = existsSync(envFilePath) ? dotenv.parse(readFileSync(envFilePath)) : {};

  const explicitAppEnv = externalEnv.APP_ENV ?? fileVars.APP_ENV;
  const appEnv = explicitAppEnv || DEFAULT_APP_ENV;
  if (!explicitAppEnv) {
    console.error(`[ENV] APP_ENV não definido; usando default "${DEFAULT_APP_ENV}"`);
  }

  const vars = readEnvironmentBlock(appEnv);
  console.error(`[ENV] Ambiente "${appEnv}" carregado de ${getEnvironmentsPath()}`);

  // .env é a base (hoje só MCP_SERVER_*); o bloco do ambiente ativo sobrescreve.
  const merged: Record<string, string> = { ...fileVars, ...vars };

  for (const [key, value] of Object.entries(merged)) {
    if (externalEnv[key] === undefined) {
      process.env[key] = value;
    }
  }

  if (process.env.APP_ENV === undefined) {
    process.env.APP_ENV = appEnv;
  }
}

loadEnvironments();
