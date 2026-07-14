import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ci = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('PR CI exposes a classifier and an always-running aggregate gate', () => {
  assert.match(ci, /^  change-scope:/mu);
  assert.match(ci, /^  ci-gate:/mu);
  assert.match(jobBlock('ci-gate'), /if: \$\{\{ always\(\) \}\}/u);
  assert.doesNotMatch(ci, /if: \$\{\{ needs\.change-scope\.outputs\.[a-z_]+ \}\}/u);

  for (const [job, scope] of [
    ['integration-tests', 'integration'],
    ['backend-db-integration', 'backend_db_worker'],
    ['telegram-compose-smoke', 'telegram'],
  ]) {
    const block = jobBlock(job);
    assert.match(block, /needs: change-scope/u, `${job} must need change-scope`);
    assert.match(
      block,
      new RegExp(
        `if: \\$\\{\\{ fromJSON\\(needs\\.change-scope\\.outputs\\.${scope}\\) \\}\\}`,
        'u',
      ),
      `${job} must use an explicit Boolean condition`,
    );
    assert.match(jobBlock('ci-gate'), new RegExp(`- ${job}(?:\\n|$)`, 'u'));
  }

  assert.match(jobBlock('ci-gate'), /- change-scope(?:\n|$)/u);
  assert.match(jobBlock('ci-gate'), /- static-checks(?:\n|$)/u);
});

test('bootstrap scope check is mechanically independent from the classifier', () => {
  const script = markedScript('ci-bootstrap');
  assert.doesNotMatch(script, /run-ci-scope/u);
  assert.doesNotMatch(script, /affected-check-lib/u);
  assert.match(script, /git diff --name-status -z/u);
});

test('aggregate gate evaluator accepts only successful selected lanes', () => {
  const evaluator = markedScript('ci-gate-evaluator');
  const baseResults = {
    'change-scope': 'success',
    'static-checks': 'success',
    'integration-tests': 'success',
    'backend-db-integration': 'success',
    'telegram-compose-smoke': 'success',
  };
  const allSelected = { integration: 'true', backend_db_worker: 'true', telegram: 'true' };

  assert.equal(runEvaluator(evaluator, baseResults, allSelected), 0);
  assert.notEqual(
    runEvaluator(evaluator, { ...baseResults, 'change-scope': 'failure' }, allSelected),
    0,
  );
  assert.notEqual(
    runEvaluator(evaluator, { ...baseResults, 'static-checks': 'failure' }, allSelected),
    0,
  );
  assert.notEqual(
    runEvaluator(evaluator, { ...baseResults, 'integration-tests': 'failure' }, allSelected),
    0,
  );
  assert.notEqual(
    runEvaluator(evaluator, { ...baseResults, 'integration-tests': 'skipped' }, allSelected),
    0,
  );
  assert.equal(
    runEvaluator(
      evaluator,
      { ...baseResults, 'integration-tests': 'skipped' },
      { ...allSelected, integration: 'false' },
    ),
    0,
  );
  assert.notEqual(
    runEvaluator(evaluator, { ...baseResults, 'telegram-compose-smoke': 'cancelled' }, allSelected),
    0,
  );
});

test('diagnostics run weekly or manually and preserve producer failures', () => {
  const diagnostics = readFileSync(
    new URL('../../.github/workflows/ci-diagnostics.yml', import.meta.url),
    'utf8',
  );
  assert.match(diagnostics, /^  schedule:/mu);
  assert.match(diagnostics, /cron: ['"]17 5 \* \* 1['"]/u);
  assert.match(diagnostics, /^  workflow_dispatch:/mu);
  assert.doesNotMatch(diagnostics, /continue-on-error:/u);

  for (const [job, producerCommand, reportCommand, artifactPath] of [
    ['coverage-report', 'pnpm test:coverage:core', 'pnpm test:coverage:report', 'tmp/coverage'],
    ['unit-timings', 'pnpm test:timings:unit', 'pnpm test:timings:report', 'tmp/test-timings'],
  ]) {
    const block = workflowJobBlock(diagnostics, job);
    assert.match(block, /id: producer/u);
    assert.ok(block.includes(producerCommand));
    assert.ok(block.includes(reportCommand));
    assert.ok(block.includes(`path: ${artifactPath}`));
    for (const step of ['Generate', 'Upload', 'Fail when producer failed']) {
      assert.match(
        block,
        new RegExp(`- name: ${step}[^\\n]*\\n\\s+if: \\$\\{\\{ always\\(\\) \\}\\}`, 'u'),
      );
    }
    assert.match(block, /PRODUCER_OUTCOME: \$\{\{ steps\.producer\.outcome \}\}/u);
  }
});

function jobBlock(job) {
  return workflowJobBlock(ci, job);
}

function workflowJobBlock(workflow, job) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${job}:`);
  assert.notEqual(start, -1, `missing ${job} job`);
  const end = lines.findIndex((line, index) => index > start && /^  [a-z0-9_-]+:$/u.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

function markedScript(marker) {
  const startToken = `${marker}:start`;
  const endToken = `${marker}:end`;
  const start = ci.indexOf(startToken);
  const end = ci.indexOf(endToken, start + startToken.length);
  assert.notEqual(start, -1, `missing ${marker} start marker`);
  assert.notEqual(end, -1, `missing ${marker} end marker`);
  return ci
    .slice(start + startToken.length, end)
    .replace(/^\r?\n/u, '')
    .replace(/\r?\n\s*$/u, '')
    .split(/\r?\n/u)
    .map((line) => line.replace(/^\s{10}/u, ''))
    .join('\n');
}

function runEvaluator(script, results, scopes) {
  return spawnSync(process.execPath, ['-e', script], {
    env: {
      ...process.env,
      CI_RESULTS: JSON.stringify(results),
      CI_SCOPES: JSON.stringify(scopes),
    },
    encoding: 'utf8',
  }).status;
}
