// packages/batch-backend/src/infrastructure/db.ts

// Thin Postgres adapter for the batch-backend.
// - Uses env from config/env.
// - Optional: only required if PG_ENABLED=true.
// - Exposed helpers are minimal and easy to swap if your platform provides its own client.

import { Pool, PoolClient } from 'pg';
import { loadConfig } from '../config/env';
import { logger } from './logger';

let pool: Pool | null = null;

// createPgPool.declaration()
export function createPgPool(): Pool {
  if (pool) return pool;

  const config = loadConfig();

  if (!config.pg.enabled) {
    throw new Error('Postgres requested but PG_ENABLED=false');
  }

  const connectionString =
    config.pg.connectionString ||
    `postgresql://${encodeURIComponent(config.pg.user)}:${encodeURIComponent(
      config.pg.password
    )}@${config.pg.host}:${config.pg.port}/${config.pg.database}`;

  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err: Error) => {
    logger.error(err, {
      component: 'pg',
      message: 'Unexpected Postgres pool error',
    });
  });

  return pool;
}

// withPgClient.declaration()
export async function withPgClient<T>(
  fn: (client: PoolClient) => Promise<T>,
  attempt = 1
): Promise<T> {
  const p = createPgPool();

  try {
    const client = await p.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  } catch (err) {
    if (attempt < 5) {
      const delay = 500 * attempt;
      logger.warn('Postgres connection failed; retrying', {
        component: 'pg',
        attempt,
        delay,
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise(resolve => setTimeout(resolve, delay));
      return withPgClient(fn, attempt + 1);
    }

    logger.error(err instanceof Error ? err : String(err), {
      component: 'pg',
      message: 'Postgres operation failed',
    });
    throw err;
  }
}

/*
Example schema compatible with the batch-backend domain (JobRecord):

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL,
  md TEXT NOT NULL,
  preset TEXT,
  with_tts BOOLEAN DEFAULT FALSE,
  upload TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  manifest_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_state_created_at ON jobs (state, created_at);
*/
