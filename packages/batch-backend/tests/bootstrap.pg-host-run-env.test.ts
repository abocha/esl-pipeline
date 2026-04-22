import { afterEach, describe, expect, it } from 'vitest';

import { configureHostRunPgRuntimeEnv } from '../src/bootstrap/pg-host-run-env.js';

const ORIGINAL_ENV = {
  PG_CONNECTION_STRING: process.env.PG_CONNECTION_STRING,
  PG_HOST: process.env.PG_HOST,
  TMPDIR: process.env.TMPDIR,
  TMP: process.env.TMP,
  TEMP: process.env.TEMP,
};

describe('bootstrap/pg-host-run-env', () => {
  afterEach(() => {
    process.env.PG_CONNECTION_STRING = ORIGINAL_ENV.PG_CONNECTION_STRING;
    process.env.PG_HOST = ORIGINAL_ENV.PG_HOST;
    process.env.TMPDIR = ORIGINAL_ENV.TMPDIR;
    process.env.TMP = ORIGINAL_ENV.TMP;
    process.env.TEMP = ORIGINAL_ENV.TEMP;
  });

  it('normalizes a container hostname in PG_CONNECTION_STRING for host-run tools', () => {
    const env: NodeJS.ProcessEnv = {
      PG_CONNECTION_STRING: 'postgresql://esl:esl@postgres:5432/esl_batch',
    };

    const resolved = configureHostRunPgRuntimeEnv(env);

    expect(resolved.connectionString).toBe('postgresql://esl:esl@127.0.0.1:5432/esl_batch');
    expect(env.PG_CONNECTION_STRING).toBe(resolved.connectionString);
    expect(env.TMPDIR).toBe('/tmp/codex-tmp');
    expect(env.TMP).toBe('/tmp/codex-tmp');
    expect(env.TEMP).toBe('/tmp/codex-tmp');
  });

  it('normalizes PG_HOST when the runtime uses discrete PG env vars', () => {
    const env: NodeJS.ProcessEnv = {
      PG_HOST: 'postgres',
      PG_DATABASE: 'esl_batch',
    };

    configureHostRunPgRuntimeEnv(env);

    expect(env.PG_HOST).toBe('127.0.0.1');
  });
});
