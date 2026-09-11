import { describe, expect, it } from 'vitest';

import { loadBatchBackendEnv } from '../src/bootstrap/env.js';

const poisonedNames = [
  'BATCH_BACKEND_TEST_PG',
  'PG_CONNECTION_STRING',
  'REDIS_HOST',
  'REDIS_PORT',
  'OPENAI_API_KEY',
] as const;

describe('pure Vitest project environment', () => {
  it('scrubs poisoned service values and prevents dotenv rehydration', () => {
    expect(process.env.VALIDATION_TEST_CLASS).toBe('pure');
    expect(process.env.BATCH_BACKEND_TEST_ENV_LOCKED).toBe('true');

    for (const name of poisonedNames) expect(process.env[name]).toBeUndefined();

    loadBatchBackendEnv(import.meta.url, 'batch-backend-pure-environment-regression');

    for (const name of poisonedNames) expect(process.env[name]).toBeUndefined();
  });
});
