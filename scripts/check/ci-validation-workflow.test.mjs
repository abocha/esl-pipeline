import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const workflow = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');

test('CI keeps one manifest-guarded PostgreSQL and Redis service job', () => {
  const serviceJob = workflowSection('  backend-db-integration:', '  telegram-compose-smoke:');

  assert.match(serviceJob, /postgres:\s*\n\s+image: postgres:18/u);
  assert.match(serviceJob, /redis:\s*\n\s+image: redis:8/u);
  assert.match(serviceJob, /test:db:migrations/u);
  assert.match(serviceJob, /test:db:postgres/u);
  assert.match(serviceJob, /test:integration:worker/u);
  assert.match(serviceJob, /if: always\(\)[\s\S]*backend-db-integration-artifacts/u);
});

test('CI gate fails closed over the selected service job', () => {
  const gateJob = workflowSection('  ci-gate:', null);

  assert.match(gateJob, /- backend-db-integration/u);
  assert.match(gateJob, /'backend-db-integration': 'backend_db_worker'/u);
  assert.match(gateJob, /selected \? result !== 'success'/u);
});

for (const lane of [
  {
    jobStart: '  static-checks:',
    jobEnd: '  integration-tests:',
    directory: 'tmp/ci-logs/static-checks',
    artifact: 'static-checks-logs',
  },
  {
    jobStart: '  integration-tests:',
    jobEnd: '  backend-db-integration:',
    directory: 'tmp/ci-logs/integration-tests',
    artifact: 'integration-tests-logs',
  },
]) {
  test(`${lane.artifact} retains actionable logs and a manifest`, () => {
    const job = workflowSection(lane.jobStart, lane.jobEnd);

    assert.match(job, /set -o pipefail/u);
    assert.match(job, new RegExp(escapeRegExp(lane.directory), 'u'));
    assert.match(job, /tee/u);
    assert.match(job, /manifest\.json/u);
    assert.match(job, /"command"/u);
    assert.match(job, /"conclusion"/u);
    assert.match(job, /"logPath"/u);
    assert.match(
      job,
      new RegExp(`if: always\\(\\)[\\s\\S]*name: ${escapeRegExp(lane.artifact)}`, 'u'),
    );
    assert.match(job, /retention-days: 14/u);
  });
}

function workflowSection(start, end) {
  const startIndex = workflow.indexOf(start);
  assert.notEqual(startIndex, -1, `missing workflow section ${start}`);
  const endIndex = end ? workflow.indexOf(end, startIndex + start.length) : workflow.length;
  assert.notEqual(endIndex, -1, `missing workflow section ${end}`);
  return workflow.slice(startIndex, endIndex);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
