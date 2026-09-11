import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPureTestEnv, PURE_TEST_SCRUBBED_ENV_NAMES } from './pure-test-env.mjs';

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
  ...Object.fromEntries(
    PURE_TEST_SCRUBBED_ENV_NAMES.map((key) => [key, `${key.toLowerCase()}-secret`]),
  ),
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

  for (const key of PURE_TEST_SCRUBBED_ENV_NAMES) {
    assert.equal(key in pureEnv, false, `${key} must not enter a pure test lane`);
  }

  for (const key of [
    'PG_ENABLED',
    'PG_CONNECTION_STRING',
    'REDIS_ENABLED',
    'REDIS_HOST',
    'REDIS_PORT',
  ]) {
    assert.equal(key in pureEnv, false, `${key} must not enter a pure test lane`);
  }

  assert.equal(
    poisonedEnv.OPENAI_API_KEY,
    'openai_api_key-secret',
    'source environment is not mutated',
  );
});
