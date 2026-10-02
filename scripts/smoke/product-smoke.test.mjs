import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertAccountBootstrapReady,
  buildFingerprint,
  composeArgs,
  root,
  smokeEnv,
} from './product-smoke.mjs';

test('ordinary environment cannot redirect smoke state or enable paid generation', () => {
  const env = smokeEnv({
    PATH: 'keep-host-tools',
    PG_CONNECTION_STRING: 'postgres://remote/production',
    PG_HOST: 'remote',
    REDIS_HOST: 'remote',
    REDIS_PASSWORD: 'secret',
    OPENAI_API_KEY: 'secret',
    GEMINI_API_KEY: 'secret',
    OPENROUTER_API_KEY: 'secret',
    SMOKE_OPENAI_API_KEY: 'also-not-an-opt-in',
    ESL_PIPELINE_CONFIG_PROVIDER: 's3',
    STORAGE_PROVIDER: 's3',
    AWS_ACCESS_KEY_ID: 'secret',
    GEN_OPENAI_DAILY_REQUEST_BUDGET: '999',
  });
  assert.equal(env.PATH, 'keep-host-tools');
  assert.equal(env.PG_CONNECTION_STRING, '');
  assert.equal(env.PG_HOST, '127.0.0.1');
  assert.equal(env.PG_PORT, '55432');
  assert.equal(env.PG_DATABASE, 'esl_smoke');
  assert.equal(env.REDIS_HOST, '127.0.0.1');
  assert.equal(env.REDIS_PORT, '56379');
  assert.equal(env.REDIS_PASSWORD, '');
  for (const name of [
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'OPENROUTER_API_KEY',
    'AWS_ACCESS_KEY_ID',
  ])
    assert.equal(env[name], '');
  assert.equal(env.GEN_OPENAI_DAILY_REQUEST_BUDGET, '1');
  assert.equal(env.STORAGE_PROVIDER, 'filesystem');
  assert.equal(env.ESL_PIPELINE_CONFIG_PROVIDER, 'local');
  assert.equal(env.STUDENT_MEMORY_OPENAI_BATCH_ENABLED, 'false');
});

test('application .env keys are shadowed, including unknown credentials', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'esl-smoke-env-'));
  try {
    const file = path.join(dir, 'local.env');
    writeFileSync(
      file,
      'UNKNOWN_FUTURE_PROVIDER_KEY=secret\nPG_CONNECTION_STRING=postgres://remote/production\n',
    );
    const env = smokeEnv({}, [file]);
    assert.equal(env.UNKNOWN_FUTURE_PROVIDER_KEY, '');
    assert.equal(env.PG_CONNECTION_STRING, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit live key enables only foreground OpenAI with no retries', () => {
  const env = smokeEnv({}, [], 'deliberate-test-key');
  assert.equal(env.OPENAI_API_KEY, 'deliberate-test-key');
  assert.equal(env.GEN_OPENAI_DAILY_REQUEST_BUDGET, '1');
  assert.equal(env.GEN_OPENAI_RETRY_MAX, '0');
  assert.equal(env.GEMINI_API_KEY, '');
});

test('compose project, volumes, ports, and Redis version stay isolated from dev/prod', () => {
  assert.deepEqual(composeArgs, [
    'compose',
    '--project-name',
    'esl-pipeline-smoke',
    '--file',
    'docker-compose.smoke.yml',
  ]);
  const smoke = readFileSync(path.join(root, 'docker-compose.smoke.yml'), 'utf8');
  assert.match(smoke, /127\.0\.0\.1:55432:5432/u);
  assert.match(smoke, /127\.0\.0\.1:56379:6379/u);
  assert.doesNotMatch(smoke, /external:|container_name:|\bname:.*_data/u);
  for (const file of ['docker-compose.yml', 'docker-compose.smoke.yml'])
    assert.match(readFileSync(path.join(root, file), 'utf8'), /image: redis:8\.10\.2-alpine3\.23/u);
  assert.match(
    readFileSync(path.join(root, 'docker-compose.prod.yml'), 'utf8'),
    /image: redis:8\.10\.1-alpine3\.23/u,
  );
});

test('smoke PostgreSQL readiness requires TCP instead of the startup Unix socket', () => {
  const smoke = readFileSync(path.join(root, 'docker-compose.smoke.yml'), 'utf8');
  assert.match(smoke, /pg_isready -h 127\.0\.0\.1 -p 5432 -U esl -d esl_smoke/u);
  assert.doesNotMatch(smoke, /pg_isready -U esl -d esl_smoke/u);
});

test('fresh-account bootstrap requires a running default no-provider smoke session', () => {
  assert.throws(() => assertAccountBootstrapReady(undefined, false), /smoke:start/u);
  assert.throws(() => assertAccountBootstrapReady({ live: true }, true), /no-provider/u);
  assert.doesNotThrow(() => assertAccountBootstrapReady({ live: false }, true));
});

test('reset without deliberate fresh-state flag fails before invoking Docker', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/smoke/product-smoke.mjs'), 'reset'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--fresh-state/u);
});

test('build reuse tracks supporting source and lockfile, excluding dev runtime artifacts', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'esl-smoke-build-'));
  try {
    for (const file of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
    ])
      writeFileSync(path.join(dir, file), 'initial');
    for (const name of ['contracts', 'batch-backend', 'batch-frontend']) {
      mkdirSync(path.join(dir, 'packages', name, 'src'), { recursive: true });
      writeFileSync(path.join(dir, 'packages', name, 'src/index.ts'), 'initial');
    }
    const initial = buildFingerprint(dir);
    writeFileSync(path.join(dir, 'packages/batch-backend/src/index.ts'), 'hot reload');
    assert.equal(buildFingerprint(dir), initial);
    writeFileSync(path.join(dir, 'packages/contracts/src/index.ts'), 'contract change');
    const changed = buildFingerprint(dir);
    assert.notEqual(changed, initial);
    writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'dependency change');
    assert.notEqual(buildFingerprint(dir), changed);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
