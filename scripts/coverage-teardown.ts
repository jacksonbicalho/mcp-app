// globalTeardown do Jest (só roda quando --coverage está ativo, ver
// jest.config.ts). Depois de cada execução:
//   1. Compara a cobertura real (coverage/coverage-summary.json) com o
//      threshold salvo em coverage.config.json.
//   2. Sobe o threshold pro maior dos dois, métrica a métrica — nunca desce
//      sozinho (esse é o "ratchet": a cobertura não pode regredir em
//      silêncio, porque o Jest já falha antes disso via coverageThreshold).
//   3. Regrava COVERAGE.md com o relatório atualizado.
import * as fs from 'fs';
import * as path from 'path';
import { buildCoverageBadge, buildCoverageMarkdown } from './coverage-report';

interface Totals {
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}

const METRICS: (keyof Totals)[] = ['lines', 'statements', 'functions', 'branches'];

function ratchetUp(current: Totals, actual: Totals): Totals {
  const result = {} as Totals;
  for (const metric of METRICS) {
    result[metric] = Math.max(current[metric], actual[metric]);
  }
  return result;
}

export default async function globalTeardown(): Promise<void> {
  const rootDir = path.resolve(__dirname, '..');
  const summaryPath = path.join(rootDir, 'coverage', 'coverage-summary.json');
  const configPath = path.join(rootDir, 'coverage.config.json');

  if (!fs.existsSync(summaryPath)) {
    // Suíte rodou sem produzir cobertura (ex.: 0 testes) — nada a ratchear.
    return;
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  const actual: Totals = {
    lines: summary.total.lines.pct,
    statements: summary.total.statements.pct,
    functions: summary.total.functions.pct,
    branches: summary.total.branches.pct,
  };

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const current: Totals = config.coverageThreshold.global;

  config.coverageThreshold.global = ratchetUp(current, actual);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const markdown = buildCoverageMarkdown(summary, rootDir);
  fs.writeFileSync(path.join(rootDir, 'COVERAGE.md'), markdown);

  // Badge dinâmico do shields.io (formato "endpoint") — o README aponta pra
  // esse JSON via raw.githubusercontent.com; só o conteúdo dele muda a cada
  // rodada, a URL no README nunca precisa ser editada de novo.
  const badgesDir = path.join(rootDir, '.github', 'badges');
  fs.mkdirSync(badgesDir, { recursive: true });
  const badge = buildCoverageBadge(summary.total);
  fs.writeFileSync(path.join(badgesDir, 'coverage.json'), JSON.stringify(badge, null, 2) + '\n');
}
