import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => {
  class MockPool {
    options: Record<string, unknown>;
    on = vi.fn();
    end = vi.fn(async () => {});
    connect = vi.fn(async () => ({ release: vi.fn() }));

    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
  }
  return { Pool: MockPool };
});

async function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const oldEnv = { ...process.env };
  process.env = { ...process.env, ...env };
  try {
    await fn();
  } finally {
    process.env = oldEnv;
  }
}

describe('infrastructure/db pool configuration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('wires postgres pool env values into createPgPool()', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        PG_ENABLED: 'true',
        PG_HOST: 'postgres',
        PG_PORT: '5432',
        PG_USER: 'esl',
        PG_PASSWORD: 'esl',
        PG_DATABASE: 'esl_batch',
        PG_POOL_MAX: '25',
        PG_IDLE_TIMEOUT_MS: '45000',
        PG_CONNECTION_TIMEOUT_MS: '8000',
      },
      async () => {
        const db = await import('../src/infrastructure/db.js');
        const pool = db.createPgPool() as unknown as {
          options: Record<string, unknown>;
        };

        expect(pool.options.max).toBe(25);
        expect(pool.options.idleTimeoutMillis).toBe(45_000);
        expect(pool.options.connectionTimeoutMillis).toBe(8_000);

        await db.closePgPool();
      },
    );
  });
});
