// packages/batch-backend/src/infrastructure/db.ts
// Thin Postgres adapter for the batch-backend.
// - Uses env from config/env.
// - Optional: only required if PG_ENABLED=true.
// - Exposed helpers are minimal and easy to swap if your platform provides its own client.
import { Pool, PoolClient } from 'pg';

import { loadConfig } from '../config/env.js';
import { logger } from './logger.js';

let pool: Pool | null = null;
let schemaReadyPromise: Promise<void> | null = null;

const JOBS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL,
  md TEXT NOT NULL,
  preset TEXT NULL,
  with_tts BOOLEAN NULL,
  upload TEXT NULL,
  voice_accent TEXT NULL,
  force_tts BOOLEAN NULL,
  notion_database TEXT NULL,
  mode TEXT NULL,
  notion_url TEXT NULL,
  manifest_path TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  error TEXT NULL
);
`;

const JOBS_SCHEMA_PATCHES: string[] = [
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS preset TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS with_tts BOOLEAN NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS upload TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS voice_id TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS voice_accent TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS force_tts BOOLEAN NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notion_database TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mode TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notion_url TEXT NULL',
  'ALTER TABLE jobs ADD COLUMN IF NOT EXISTS manifest_path TEXT NULL',
];

const JOBS_INDEX_PATCHES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_jobs_state_created_at ON jobs (state, created_at)',
];

async function ensureJobsSchema(client: PoolClient): Promise<void> {
  if (schemaReadyPromise) {
    await schemaReadyPromise;
    return;
  }

  schemaReadyPromise = (async () => {
    await client.query(JOBS_TABLE_SQL);
    for (const statement of JOBS_SCHEMA_PATCHES) {
      await client.query(statement);
    }
    for (const indexSql of JOBS_INDEX_PATCHES) {
      await client.query(indexSql);
    }

    logger.info('Ensured jobs table schema', {
      component: 'pg',
      event: 'jobs_schema_ready',
    });
  })().catch((error) => {
    schemaReadyPromise = null;
    throw error;
  });

  await schemaReadyPromise;
}

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
      config.pg.password,
    )}@${config.pg.host}:${config.pg.port}/${config.pg.database}`;

  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5000,
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
  attempt = 1,
): Promise<T> {
  const p = createPgPool();

  try {
    const client = await p.connect();
    try {
      await ensureJobsSchema(client);
      return await fn(client);
    } finally {
      client.release();
    }
  } catch (error) {
    if (attempt < 5) {
      const delay = 500 * attempt;
      logger.warn('Postgres connection failed; retrying', {
        component: 'pg',
        attempt,
        delay,
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withPgClient(fn, attempt + 1);
    }

    logger.error(error instanceof Error ? error : String(error), {
      component: 'pg',
      message: 'Postgres operation failed',
    });
    throw error;
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
