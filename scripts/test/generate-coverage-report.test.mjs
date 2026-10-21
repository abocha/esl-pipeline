import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const generatorPath = fileURLToPath(new URL('./generate-coverage-report.mjs', import.meta.url));

for (const available of [0, 3, 4]) {
  test(`coverage input status is prominent and informational with ${available}/4 inputs`, (t) => {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'coverage-input-status-'));
    t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
    const keys = ['batch-frontend', 'batch-backend', 'orchestrator', 'tts-elevenlabs'];
    for (const key of keys.slice(0, available)) {
      const directory = path.join(repoRoot, 'tmp', 'coverage', key);
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, 'coverage-summary.json'),
        JSON.stringify({
          total: Object.fromEntries(
            ['lines', 'statements', 'functions', 'branches'].map((metric) => [
              metric,
              { covered: 1, total: 2, pct: 50 },
            ]),
          ),
        }),
      );
    }
    const result = spawnSync(process.execPath, [generatorPath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const markdown = readFileSync(path.join(repoRoot, 'tmp/coverage/report.md'), 'utf8');
    const json = JSON.parse(readFileSync(path.join(repoRoot, 'tmp/coverage/report.json'), 'utf8'));
    assert.equal(result.stdout.trim(), markdown.trim());
    assert.deepEqual(Object.keys(json), [
      'generatedAt',
      'aggregate',
      'packageMetrics',
      'missingPackages',
      'topUncoveredLargeFiles',
    ]);
    assert.equal(json.packageMetrics.length, available);
    assert.deepEqual(
      json.missingPackages.map((pkg) => pkg.key),
      keys.slice(available),
    );
    assert.equal(json.aggregate.linesPct, available === 0 ? null : 50);
    const status = available === 0 ? 'UNAVAILABLE' : 'PARTIAL';
    const prefix =
      available === 4
        ? '# Coverage Report (Non-Blocking)\n\nGenerated at: '
        : `# Coverage Report (Non-Blocking)\n\n**${status}: ${available}/4 package inputs available.**\n`;
    assert.ok(markdown.startsWith(prefix));
    assert.equal(/PARTIAL|UNAVAILABLE/.test(markdown), available < 4);
  });
}

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
