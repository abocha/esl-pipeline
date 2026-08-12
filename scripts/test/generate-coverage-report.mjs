#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const generatedAt = new Date().toISOString();
const coverageRoot = path.resolve('tmp/coverage');
const reportJsonPath = path.join(coverageRoot, 'report.json');
const reportMdPath = path.join(coverageRoot, 'report.md');
const targets = [
  { key: 'batch-frontend', packageName: '@esl-pipeline/batch-frontend' },
  { key: 'batch-backend', packageName: '@esl-pipeline/batch-backend' },
  { key: 'orchestrator', packageName: '@esl-pipeline/orchestrator' },
  { key: 'tts-elevenlabs', packageName: '@esl-pipeline/tts-provider-elevenlabs' },
];

mkdirSync(coverageRoot, { recursive: true });

const packageMetrics = [];
const largeFileCandidates = [];
const missingPackages = [];

const totals = {
  lines: { covered: 0, total: 0 },
  statements: { covered: 0, total: 0 },
  functions: { covered: 0, total: 0 },
  branches: { covered: 0, total: 0 },
};

for (const target of targets) {
  const summaryPath = path.join(coverageRoot, target.key, 'coverage-summary.json');
  if (!existsSync(summaryPath)) {
    missingPackages.push(target);
    continue;
  }

  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const total = summary.total;
  packageMetrics.push({
    packageName: target.packageName,
    key: target.key,
    lines: total.lines,
    statements: total.statements,
    functions: total.functions,
    branches: total.branches,
  });

  totals.lines.covered += total.lines.covered;
  totals.lines.total += total.lines.total;
  totals.statements.covered += total.statements.covered;
  totals.statements.total += total.statements.total;
  totals.functions.covered += total.functions.covered;
  totals.functions.total += total.functions.total;
  totals.branches.covered += total.branches.covered;
  totals.branches.total += total.branches.total;

  for (const [filePath, fileMetrics] of Object.entries(summary)) {
    if (filePath === 'total') continue;
    if (fileMetrics.lines.total < 120) continue;
    const uncoveredLines = fileMetrics.lines.total - fileMetrics.lines.covered;
    largeFileCandidates.push({
      packageName: target.packageName,
      filePath,
      uncoveredLines,
      linesTotal: fileMetrics.lines.total,
      linesPct: fileMetrics.lines.pct,
    });
  }
}

largeFileCandidates.sort((a, b) => b.uncoveredLines - a.uncoveredLines);
const topUncoveredLargeFiles = largeFileCandidates.slice(0, 20);

const percent = (covered, total) =>
  total === 0 ? null : Number(((covered / total) * 100).toFixed(2));
const formatPercent = (pct, covered, total) =>
  pct === null ? `n/a (${covered}/${total})` : `${pct}% (${covered}/${total})`;

const aggregate = {
  linesPct: percent(totals.lines.covered, totals.lines.total),
  statementsPct: percent(totals.statements.covered, totals.statements.total),
  functionsPct: percent(totals.functions.covered, totals.functions.total),
  branchesPct: percent(totals.branches.covered, totals.branches.total),
};
const aggregateHasData =
  totals.lines.total > 0 ||
  totals.statements.total > 0 ||
  totals.functions.total > 0 ||
  totals.branches.total > 0;

const report = {
  generatedAt,
  aggregate,
  packageMetrics,
  missingPackages,
  topUncoveredLargeFiles,
};

const markdownLines = [];
markdownLines.push('# Coverage Report (Non-Blocking)');
markdownLines.push('');
markdownLines.push(`Generated at: ${generatedAt}`);
markdownLines.push('');

if (packageMetrics.length > 0) {
  markdownLines.push('## Core Unit Package Coverage');
  markdownLines.push('');
  markdownLines.push('| Package | Lines | Statements | Functions | Branches |');
  markdownLines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const pkg of packageMetrics) {
    markdownLines.push(
      `| ${pkg.packageName} | ${pkg.lines.pct}% (${pkg.lines.covered}/${pkg.lines.total}) | ${pkg.statements.pct}% (${pkg.statements.covered}/${pkg.statements.total}) | ${pkg.functions.pct}% (${pkg.functions.covered}/${pkg.functions.total}) | ${pkg.branches.pct}% (${pkg.branches.covered}/${pkg.branches.total}) |`,
    );
  }
  markdownLines.push('');
}

markdownLines.push('## Aggregate');
markdownLines.push('');
markdownLines.push(
  `- Lines: ${formatPercent(aggregate.linesPct, totals.lines.covered, totals.lines.total)}`,
);
markdownLines.push(
  `- Statements: ${formatPercent(aggregate.statementsPct, totals.statements.covered, totals.statements.total)}`,
);
markdownLines.push(
  `- Functions: ${formatPercent(aggregate.functionsPct, totals.functions.covered, totals.functions.total)}`,
);
markdownLines.push(
  `- Branches: ${formatPercent(aggregate.branchesPct, totals.branches.covered, totals.branches.total)}`,
);
if (!aggregateHasData) {
  markdownLines.push('');
  markdownLines.push(
    '_Aggregate coverage is unavailable because no coverage summary inputs were found._',
  );
}
markdownLines.push('');

if (topUncoveredLargeFiles.length > 0) {
  markdownLines.push('## Top Uncovered Large Files');
  markdownLines.push('');
  markdownLines.push(
    'Scope note: This report reflects core unit evidence only; deterministic HTTP and PostgreSQL/Redis/service lanes are not represented. A low/zero file value does not establish absence of meaningful tests elsewhere.',
  );
  markdownLines.push('');
  markdownLines.push('| Package | File | Uncovered Lines | Line Coverage |');
  markdownLines.push('| --- | --- | ---: | ---: |');
  for (const file of topUncoveredLargeFiles) {
    markdownLines.push(
      `| ${file.packageName} | ${file.filePath} | ${file.uncoveredLines}/${file.linesTotal} | ${file.linesPct}% |`,
    );
  }
  markdownLines.push('');
}

if (missingPackages.length > 0) {
  markdownLines.push('## Missing Coverage Inputs');
  markdownLines.push('');
  for (const pkg of missingPackages) {
    markdownLines.push(`- ${pkg.packageName} (${pkg.key})`);
  }
  markdownLines.push('');
}

writeFileSync(reportJsonPath, JSON.stringify(report, null, 2));
writeFileSync(reportMdPath, `${markdownLines.join('\n')}\n`);
console.log(markdownLines.join('\n'));
