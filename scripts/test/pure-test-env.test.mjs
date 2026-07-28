import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPureTestEnv, resolveValidationLaneEnv } from './pure-test-env.mjs';

const poisonedEnv = {
  PATH: 'toolchain-path',
  CI: 'true',
  NODE_ENV: 'test',
  TZ: 'UTC',
  npm_execpath: 'pnpm.cjs',
  CHECK_FAST_COMMAND_TIMEOUT_MS: '1234',
  BATCH_BACKEND_TEST_PG: 'postgres://invalid',
  BATCH_BACKEND_TEST_REDIS: 'redis://invalid',
  PG_ENABLED: 'true',
  PG_CONNECTION_STRING: 'postgres://ambient',
  REDIS_ENABLED: 'true',
  REDIS_HOST: 'ambient-redis',
  REDIS_PORT: '6379',
  DOCKER_HOST: 'tcp://ambient-docker:2375',
  OPENAI_API_KEY: 'openai-secret',
  ELEVENLABS_API_KEY: 'elevenlabs-secret',
  INWORLD_API_KEY: 'inworld-secret',
  AWS_ACCESS_KEY_ID: 'aws-id',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  AWS_SESSION_TOKEN: 'aws-session',
  GOOGLE_APPLICATION_CREDENTIALS: 'google-secret.json',
};

test('pure test environments keep toolchain state and remove ambient prerequisites', () => {
  const pureEnv = buildPureTestEnv(poisonedEnv);

  assert.deepEqual(
    {
      PATH: pureEnv.PATH,
      CI: pureEnv.CI,
      NODE_ENV: pureEnv.NODE_ENV,
      TZ: pureEnv.TZ,
      npm_execpath: pureEnv.npm_execpath,
      CHECK_FAST_COMMAND_TIMEOUT_MS: pureEnv.CHECK_FAST_COMMAND_TIMEOUT_MS,
      VALIDATION_TEST_CLASS: pureEnv.VALIDATION_TEST_CLASS,
    },
    {
      PATH: 'toolchain-path',
      CI: 'true',
      NODE_ENV: 'test',
      TZ: 'UTC',
      npm_execpath: 'pnpm.cjs',
      CHECK_FAST_COMMAND_TIMEOUT_MS: '1234',
      VALIDATION_TEST_CLASS: 'pure',
    },
  );

  for (const key of [
    'BATCH_BACKEND_TEST_PG',
    'BATCH_BACKEND_TEST_REDIS',
    'PG_ENABLED',
    'PG_CONNECTION_STRING',
    'REDIS_ENABLED',
    'REDIS_HOST',
    'REDIS_PORT',
    'DOCKER_HOST',
    'OPENAI_API_KEY',
    'ELEVENLABS_API_KEY',
    'INWORLD_API_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'GOOGLE_APPLICATION_CREDENTIALS',
  ]) {
    assert.equal(key in pureEnv, false, `${key} must not enter a pure test lane`);
  }

  assert.equal(poisonedEnv.OPENAI_API_KEY, 'openai-secret', 'source environment is not mutated');
});

test('canonical unit lanes use the pure environment', () => {
  assert.deepEqual(
    resolveValidationLaneEnv({
      laneId: 'turbo:test:unit:prebuilt',
      sourceEnv: poisonedEnv,
      backendDbEnv: false,
    }),
    buildPureTestEnv(poisonedEnv),
  );
});

test('explicit backend service environments bypass pure scrubbing', () => {
  assert.deepEqual(
    resolveValidationLaneEnv({
      laneId: 'backend-db-worker',
      sourceEnv: poisonedEnv,
      backendDbEnv: true,
    }),
    poisonedEnv,
  );
});
