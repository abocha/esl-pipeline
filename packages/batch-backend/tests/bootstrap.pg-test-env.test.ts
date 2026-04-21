import { describe, expect, it } from 'vitest';

import {
  requirePgTestRuntimeEnv,
  tryConfigurePgTestRuntimeEnv,
} from '../src/bootstrap/pg-test-env.js';

describe('bootstrap/pg-test-env', () => {
  it('normalizes an explicit BATCH_BACKEND_TEST_PG for host-run suites', () => {
    const env: NodeJS.ProcessEnv = {
      BATCH_BACKEND_TEST_PG: 'postgresql://esl:esl@postgres:5432/esl_batch_test',
    };

    const resolved = requirePgTestRuntimeEnv(env);

    expect(resolved.connectionString).toBe('postgresql://esl:esl@127.0.0.1:5432/esl_batch_test');
    expect(env.BATCH_BACKEND_TEST_PG).toBe(resolved.connectionString);
    expect(env.PG_ENABLED).toBe('true');
    expect(env.PG_AUTO_MIGRATE_ON_BOOT).toBe('false');
    expect(env.PG_CONNECTION_STRING).toBe(resolved.connectionString);
    expect(env.TMPDIR).toBe('/tmp/codex-tmp');
    expect(env.TMP).toBe('/tmp/codex-tmp');
    expect(env.TEMP).toBe('/tmp/codex-tmp');
  });

  it('derives a dedicated _test database from the runtime PG connection string', () => {
    const env: NodeJS.ProcessEnv = {
      PG_CONNECTION_STRING: 'postgresql://esl:esl@postgres:5432/esl_batch',
    };

    const resolved = requirePgTestRuntimeEnv(env);

    expect(resolved.connectionString).toBe('postgresql://esl:esl@127.0.0.1:5432/esl_batch_test');
    expect(env.BATCH_BACKEND_TEST_PG).toBe(resolved.connectionString);
    expect(env.PG_CONNECTION_STRING).toBe(resolved.connectionString);
  });

  it('returns null when no test PG source can be discovered', () => {
    const env: NodeJS.ProcessEnv = {};

    expect(tryConfigurePgTestRuntimeEnv(env)).toBeNull();
    expect(env.BATCH_BACKEND_TEST_PG).toBeUndefined();
    expect(env.PG_CONNECTION_STRING).toBeUndefined();
  });

  it('rejects an explicit non-test database URL', () => {
    const env: NodeJS.ProcessEnv = {
      BATCH_BACKEND_TEST_PG: 'postgresql://esl:esl@127.0.0.1:5432/esl_batch',
    };

    expect(() => requirePgTestRuntimeEnv(env)).toThrow(
      'must target a dedicated test database ending with "_test"',
    );
  });
});
