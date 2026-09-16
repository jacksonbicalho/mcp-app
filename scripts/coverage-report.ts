// Converte o coverage-summary.json do Jest num COVERAGE.md legível, com um
// status visual (🔴/🟡/🟢) por arquivo e links direto pras linhas não
// cobertas. Versão consolidada e simplificada do gerador usado em ssldev
// (github.com/jacksonbicalho/ssldev), adaptada pra esse projeto.

interface FileCoverage {
  lines: { pct: number };
  statements: { pct: number };
  functions: { pct: number };
  branches: { pct: number };
}

type CoverageSummary = Record<string, FileCoverage>;

function getStatus(pct: number): string {
  if (pct < 50) return '🔴';
  if (pct < 80) return '🟡';
  return '🟢';
}

function getBadgeColor(pct: number): string {
  if (pct < 50) return 'red';
  if (pct < 80) return 'yellow';
  return 'brightgreen';
}

function relativePath(absolutePath: string, rootDir: string): string {
  return absolutePath.startsWith(rootDir + '/') ? absolutePath.slice(rootDir.length + 1) : absolutePath;
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const yyyy = date.getFullYear();
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

function formatRow(label: string, cov: FileCoverage, link?: string): string {
  const name = link ? `[${label}](${link})` : `**${label}**`;
  return `${getStatus(cov.statements.pct)}|${name}|${cov.statements.pct.toFixed(2)}|${cov.branches.pct.toFixed(2)}|${cov.functions.pct.toFixed(2)}|${cov.lines.pct.toFixed(2)}`;
}

export function buildCoverageMarkdown(summary: CoverageSummary, rootDir: string, generatedAt: Date = new Date()): string {
  const header = [
    '# Cobertura de testes',
    '',
    `Gerado automaticamente por \`yarn test:cov\` em ${formatTimestamp(generatedAt)} — não editar manualmente.`,
    '',
    'Status|Arquivo|% Stmts|% Branch|% Funcs|% Lines',
    '--|--|--|--|--|--',
  ];

  const { total, ...files } = summary;
  const rows = Object.entries(files)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([absolutePath, cov]) => formatRow(relativePath(absolutePath, rootDir), cov, relativePath(absolutePath, rootDir)));

  return [...header, formatRow('Total', total), ...rows].join('\n') + '\n';
}

interface ShieldsEndpointBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

/** Um JSON no schema de "endpoint badge" do shields.io por métrica — ver https://shields.io/endpoint. */
export function buildCoverageBadges(total: FileCoverage): Record<string, ShieldsEndpointBadge> {
  const metrics: { key: keyof FileCoverage; label: string }[] = [
    { key: 'statements', label: 'statements' },
    { key: 'branches', label: 'branches' },
    { key: 'functions', label: 'functions' },
    { key: 'lines', label: 'lines' },
  ];

  return Object.fromEntries(
    metrics.map(({ key, label }) => {
      const pct = total[key].pct;
      return [
        label,
        {
          schemaVersion: 1,
          label,
          message: `${pct.toFixed(2)}%`,
          color: getBadgeColor(pct),
        },
      ];
    }),
  );
}
