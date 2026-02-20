import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
const mockRelease = vi.fn();

vi.mock('pg', () => {
  class MockPool {
    options: Record<string, unknown>;
    on = vi.fn();
    end = vi.fn(async () => {});
    connect = vi.fn(async () => ({
      query: mockQuery,
      release: mockRelease,
    }));

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

describe('infrastructure/db session context helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
    mockRelease.mockReset();
  });

  it('sets normalized session settings via setPgSessionContext()', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const db = await import('../src/infrastructure/db.js');

    await db.setPgSessionContext(
      { query: mockQuery } as unknown as import('pg').PoolClient,
      {
        userId: ' 00000000-0000-4000-8000-000000000001 ',
        userRole: ' admin ',
        rlsBypass: true,
      },
    );

    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery.mock.calls[0]).toEqual([
      "SELECT set_config('app.user_id', $1, true)",
      ['00000000-0000-4000-8000-000000000001'],
    ]);
    expect(mockQuery.mock.calls[1]).toEqual([
      "SELECT set_config('app.user_role', $1, true)",
      ['admin'],
    ]);
    expect(mockQuery.mock.calls[2]).toEqual([
      "SELECT set_config('app.rls_bypass', $1, true)",
      ['on'],
    ]);
  });

  it('wraps contextual work in a transaction and commits on success', async () => {
    mockQuery.mockResolvedValue({ rows: [] });

    await withEnv(
      {
        NODE_ENV: 'test',
        PG_ENABLED: 'true',
        PG_HOST: 'postgres',
        PG_PORT: '5432',
        PG_USER: 'esl',
        PG_PASSWORD: 'esl',
        PG_DATABASE: 'esl_batch',
      },
      async () => {
        const db = await import('../src/infrastructure/db.js');
        const result = await db.withPgClientSessionContext(
          {
            userId: '00000000-0000-4000-8000-000000000010',
            userRole: 'user',
            rlsBypass: false,
          },
          async (client) => {
            await client.query('SELECT 42');
            return 'ok';
          },
        );

        expect(result).toBe('ok');
        expect(mockQuery.mock.calls.map((call) => call[0])).toEqual([
          'BEGIN',
          "SELECT set_config('app.user_id', $1, true)",
          "SELECT set_config('app.user_role', $1, true)",
          "SELECT set_config('app.rls_bypass', $1, true)",
          'SELECT 42',
          'COMMIT',
        ]);

        await db.closePgPool();
      },
    );
  });

  it('rolls back contextual work when callback fails', async () => {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql === 'SELECT fail') {
        throw new Error('forced failure');
      }
      return { rows: [] };
    });

    await withEnv(
      {
        NODE_ENV: 'test',
        PG_ENABLED: 'true',
        PG_HOST: 'postgres',
        PG_PORT: '5432',
        PG_USER: 'esl',
        PG_PASSWORD: 'esl',
        PG_DATABASE: 'esl_batch',
      },
      async () => {
        const db = await import('../src/infrastructure/db.js');

        await expect(
          db.withPgClientSessionContext(
            {
              userId: '00000000-0000-4000-8000-000000000020',
            },
            async (client) => {
              await client.query('SELECT fail');
              return 'never';
            },
          ),
        ).rejects.toThrow('forced failure');

        const statements = mockQuery.mock.calls.map((call) => call[0]);
        expect(statements).toContain('ROLLBACK');
        expect(statements).not.toContain('COMMIT');

        await db.closePgPool();
      },
    );
  });
});
