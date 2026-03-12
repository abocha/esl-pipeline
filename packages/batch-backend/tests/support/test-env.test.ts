import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { requirePgTestEnv } from './test-env.js';

const ENV_KEYS = [
  'BATCH_BACKEND_TEST_PG',
  'PG_ENABLED',
  'PG_AUTO_MIGRATE_ON_BOOT',
  'PG_CONNECTION_STRING',
] as const;

type EnvKey = (typeof ENV_KEYS)[number];

function snapshotEnv(): Record<EnvKey, string | undefined> {
  return {
    BATCH_BACKEND_TEST_PG: process.env.BATCH_BACKEND_TEST_PG,
    PG_ENABLED: process.env.PG_ENABLED,
    PG_AUTO_MIGRATE_ON_BOOT: process.env.PG_AUTO_MIGRATE_ON_BOOT,
    PG_CONNECTION_STRING: process.env.PG_CONNECTION_STRING,
  };
}

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

function restoreEnv(snapshot: Record<EnvKey, string | undefined>): void {
  clearEnv();
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

describe('tests/support/test-env requirePgTestEnv', () => {
  let envSnapshot: Record<EnvKey, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    clearEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it('rejects non-test database names', () => {
    process.env.BATCH_BACKEND_TEST_PG = 'postgresql://esl:esl@127.0.0.1:5432/esl_batch';

    expect(() => requirePgTestEnv()).toThrow(
      'must target a dedicated test database ending with "_test"',
    );
  });

  it('accepts _test database names and wires PG env', () => {
    process.env.BATCH_BACKEND_TEST_PG = 'postgresql://esl:esl@127.0.0.1:5432/esl_batch_test';

    const resolved = requirePgTestEnv();

    expect(resolved.connectionString).toBe(process.env.BATCH_BACKEND_TEST_PG);
    expect(process.env.PG_ENABLED).toBe('true');
    expect(process.env.PG_AUTO_MIGRATE_ON_BOOT).toBe('false');
    expect(process.env.PG_CONNECTION_STRING).toBe(process.env.BATCH_BACKEND_TEST_PG);
  });

  it('rejects malformed database path segments', () => {
    process.env.BATCH_BACKEND_TEST_PG = 'postgresql://esl:esl@127.0.0.1:5432/tenant/esl_batch_test';

    expect(() => requirePgTestEnv()).toThrow('must include exactly one database name in URL path');
  });
});
