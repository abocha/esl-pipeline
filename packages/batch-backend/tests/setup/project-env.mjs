import { buildPureTestEnv } from '../../../../scripts/test/pure-test-env.mjs';
import { loadBatchBackendEnv } from '../../src/bootstrap/env.js';
import { requirePgTestRuntimeEnv } from '../../src/bootstrap/pg-test-env.js';
import { requireRedisTestEnv } from '../support/test-env.js';

export function configurePureTestEnvironment(env = process.env, { preserveKeys } = {}) {
  const sourceKeys = preserveKeys ?? new Set(Object.keys(env));
  const sourceEnv = Object.fromEntries(
    [...sourceKeys].flatMap((key) => (env[key] === undefined ? [] : [[key, env[key]]])),
  );
  const pureEnv = buildPureTestEnv(sourceEnv);
  for (const key of Object.keys(env)) {
    delete env[key];
  }
  Object.assign(env, pureEnv);
  env.BATCH_BACKEND_TEST_ENV_LOCKED = 'true';
  env.VALIDATION_TEST_CLASS = 'pure';
  return env;
}

export function configureDeterministicHttpTestEnvironment(env = process.env, options = {}) {
  configurePureTestEnvironment(env, options);
  env.PG_ENABLED = 'false';
  // HTTP route tests construct BullMQ queues but do not exercise Redis delivery. Keep the
  // adapter constructible while disabling the independent rate-limit service below.
  env.REDIS_ENABLED = 'true';
  env.REDIS_HOST = '127.0.0.1';
  env.REDIS_PORT = '6379';
  env.ENABLE_RATE_LIMITING = 'false';
  env.VALIDATION_TEST_CLASS = 'deterministic-http';
  return env;
}

export function configureMediaTestEnvironment(env = process.env, options = {}) {
  configurePureTestEnvironment(env, options);
  env.VALIDATION_TEST_CLASS = 'media';
  return env;
}

export function configurePostgresTestEnvironment() {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-vitest-postgres-project');
  const resolved = requirePgTestRuntimeEnv();
  process.env.VALIDATION_TEST_CLASS = 'postgres';
  return resolved;
}

export function configureWorkerTestEnvironment() {
  const resolved = configurePostgresTestEnvironment();
  const redis = requireRedisTestEnv();
  process.env.VALIDATION_TEST_CLASS = 'postgres-redis-worker';
  return { ...resolved, redis };
}
