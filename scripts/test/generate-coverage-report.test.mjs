import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const generatorPath = fileURLToPath(new URL('./generate-coverage-report.mjs', import.meta.url));

test('coverage report annotates the scope of Top Uncovered Large Files', () => {
  const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'coverage-report-test-'));
  const summaryDirectory = path.join(repoRoot, 'tmp', 'coverage', 'batch-frontend');
  mkdirSync(summaryDirectory, { recursive: true });
  writeFileSync(
    path.join(summaryDirectory, 'coverage-summary.json'),
    JSON.stringify({
      total: {
        lines: { covered: 0, total: 120, pct: 0 },
        statements: { covered: 0, total: 120, pct: 0 },
        functions: { covered: 0, total: 1, pct: 0 },
        branches: { covered: 0, total: 1, pct: 0 },
      },
      'src/example.ts': {
        lines: { covered: 0, total: 120, pct: 0 },
      },
    }),
    'utf8',
  );

  try {
    const result = spawnSync(process.execPath, [generatorPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const report = readFileSync(path.join(repoRoot, 'tmp', 'coverage', 'report.md'), 'utf8');
    assert.match(
      report,
      /## Top Uncovered Large Files\n\nScope note: This report reflects core unit evidence only; deterministic HTTP and PostgreSQL\/Redis\/service lanes are not represented\. A low\/zero file value does not establish absence of meaningful tests elsewhere\.\n\n\| Package \| File \| Uncovered Lines \| Line Coverage \|/u,
    );
    assert.match(
      report,
      /\| @esl-pipeline\/batch-frontend \| src\/example\.ts \| 120\/120 \| 0% \|/u,
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
