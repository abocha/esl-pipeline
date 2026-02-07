import { describe, expect, it } from 'vitest';

import { isRetryablePgError } from '../src/infrastructure/db.js';

describe('infrastructure/db retry policy', () => {
  it('retries transient connection-class pg codes', () => {
    expect(isRetryablePgError({ code: '08006', message: 'connection failure' })).toBe(true);
    expect(isRetryablePgError({ code: '40001', message: 'serialization failure' })).toBe(true);
    expect(isRetryablePgError({ code: '40P01', message: 'deadlock detected' })).toBe(true);
  });

  it('does not retry deterministic constraint failures', () => {
    expect(
      isRetryablePgError({
        code: '23503',
        message: 'insert or update violates foreign key constraint',
      }),
    ).toBe(false);

    expect(
      isRetryablePgError({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      }),
    ).toBe(false);
  });

  it('uses message fallback for transient errors without code', () => {
    expect(isRetryablePgError(new Error('Connection terminated due to connection timeout'))).toBe(
      true,
    );
    expect(isRetryablePgError(new Error('ECONNREFUSED postgres:5432'))).toBe(true);
  });

  it('defaults to non-retry for unknown errors', () => {
    expect(isRetryablePgError(new Error('validation failed'))).toBe(false);
    expect(isRetryablePgError({ code: '22001', message: 'string data right truncation' })).toBe(
      false,
    );
  });
});
