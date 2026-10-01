// packages/batch-backend/src/infrastructure/db.ts
// Thin Postgres adapter for the batch-backend.
// - Uses env from config/env.
// - Optional: only required if PG_ENABLED=true.
// - Exposed helpers are minimal and easy to swap if your platform provides its own client.
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient } from 'pg';

import { loadConfig } from '../config/env.js';
import { logger } from './logger.js';

let pool: Pool | null = null;
const sanitizedPgLogging = new AsyncLocalStorage<boolean>();

/** Keep database diagnostics free of exception details for sensitive request paths. */
export function withSanitizedPgLogging<T>(operation: () => Promise<T>): Promise<T> {
  return sanitizedPgLogging.run(true, operation);
}

function safePgErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : 'unclassified';
}

const RETRYABLE_PG_ERROR_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

const RETRYABLE_PG_CODE_PREFIXES = ['08']; // connection exceptions

const NON_RETRYABLE_MESSAGE_PATTERNS = [
  'violates foreign key constraint',
  'violates unique constraint',
  'violates check constraint',
  'invalid input syntax',
  'syntax error',
];

const RETRYABLE_MESSAGE_PATTERNS = [
  'connection terminated',
  'could not connect',
  'timeout',
  'econnrefused',
  'econnreset',
  'etimedout',
  'server closed the connection unexpectedly',
];

/** The old emergency DDL can recreate standalone profile authority. */
export async function ensureJobsSchema(_client: PoolClient): Promise<void> {
  throw new Error(
    'Legacy runtime schema patching is retired. Use db:migrate or the generated schema.sql baseline.',
  );
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
    max: config.pg.poolMax,
    idleTimeoutMillis: config.pg.idleTimeoutMs,
    connectionTimeoutMillis: config.pg.connectionTimeoutMs,
    application_name: config.pg.applicationName,
  });

  logger.info('Postgres pool initialized', {
    component: 'pg',
    event: 'pg_pool_initialized',
    poolMax: config.pg.poolMax,
    idleTimeoutMs: config.pg.idleTimeoutMs,
    connectionTimeoutMs: config.pg.connectionTimeoutMs,
    pgHost: config.pg.host,
    pgPort: config.pg.port,
    pgDatabase: config.pg.database,
    applicationName: config.pg.applicationName,
    usingConnectionString: Boolean(config.pg.connectionString),
  });

  pool.on('error', (err: Error) => {
    logger.error(err, {
      component: 'pg',
      message: 'Unexpected Postgres pool error',
    });
  });

  return pool;
}

export async function closePgPool(): Promise<void> {
  if (!pool) return;
  const toClose = pool;
  pool = null;
  await toClose.end();
}

export interface PgSessionContext {
  userId?: string | null;
  userRole?: string | null;
  rlsBypass?: boolean;
}

function normalizeSessionSetting(value: string | null | undefined): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : '';
}

/**
 * Set request-scoped session context that future RLS policies can consume.
 *
 * Values are always set with local scope (transaction-bound) and normalized to
 * empty strings when absent so policy helper functions can treat them as NULL.
 */
export async function setPgSessionContext(
  client: PoolClient,
  context: PgSessionContext,
): Promise<void> {
  const userId = normalizeSessionSetting(context.userId);
  const userRole = normalizeSessionSetting(context.userRole);
  const rlsBypass = context.rlsBypass === true ? 'on' : 'off';

  await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
  await client.query("SELECT set_config('app.user_role', $1, true)", [userRole]);
  await client.query("SELECT set_config('app.rls_bypass', $1, true)", [rlsBypass]);
}

/**
 * Transaction wrapper that applies local session context before running work.
 *
 * Intended for request/user-scoped query paths that should be RLS-ready.
 */
export async function withPgClientSessionContext<T>(
  context: PgSessionContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await setPgSessionContext(client, context);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.warn('Failed to rollback transaction after session-context error', {
          component: 'pg',
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
      throw error;
    }
  });
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
      return await fn(client);
    } finally {
      client.release();
    }
  } catch (error) {
    if (attempt < 5 && isRetryablePgError(error)) {
      const delay = 500 * attempt;
      if (sanitizedPgLogging.getStore()) {
        logger.warn('Sensitive Postgres operation retrying', {
          component: 'pg',
          event: 'sensitive_pg_retry',
          code: safePgErrorCode(error),
          attempt,
          delay,
        });
      } else {
        logger.warn('Postgres operation failed with transient error; retrying', {
          component: 'pg',
          attempt,
          delay,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      return withPgClient(fn, attempt + 1);
    }

    if (sanitizedPgLogging.getStore()) {
      logger.error('Sensitive Postgres operation failed', {
        component: 'pg',
        event: 'sensitive_pg_failed',
        code: safePgErrorCode(error),
      });
    } else {
      logger.error(error instanceof Error ? error : String(error), {
        component: 'pg',
        message: 'Postgres operation failed',
      });
    }
    throw error;
  }
}

export function isRetryablePgError(error: unknown): boolean {
  if (!error) return false;

  const maybePgError = error as { code?: unknown; message?: unknown };
  const code = typeof maybePgError.code === 'string' ? maybePgError.code : null;
  const message = (
    typeof maybePgError.message === 'string' ? maybePgError.message : String(error)
  ).toLowerCase();

  if (NON_RETRYABLE_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return false;
  }

  if (code) {
    if (RETRYABLE_PG_ERROR_CODES.has(code)) {
      return true;
    }

    if (RETRYABLE_PG_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) {
      return true;
    }
  }

  if (RETRYABLE_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return true;
  }

  return false;
}

/*
Example schema compatible with the batch-backend domain (JobRecord):

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL,
  md TEXT NULL,
  recording_id UUID,
  transcript_id UUID,
  prompt_package_id UUID,
  draft_id UUID,
  preset TEXT,
  with_tts BOOLEAN DEFAULT FALSE,
  upload TEXT,
  voice_id TEXT,
  voice_accent TEXT,
  force_tts BOOLEAN,
  notion_database TEXT,
  mode TEXT,
  notion_url TEXT,
  manifest_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  user_id UUID
);

CREATE INDEX IF NOT EXISTS idx_jobs_state_created_at ON jobs (state, created_at);
*/
