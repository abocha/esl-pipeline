import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PoolClient } from 'pg';

import { loadConfig } from '../config/env.js';
import { closePgPool, createPgPool } from './db.js';
import { logger } from './logger.js';

export interface MigrationFile {
  id: string;
  filename: string;
  absolutePath: string;
  checksum: string;
  sql: string;
}

export interface AppliedMigration {
  id: string;
  checksum: string;
  appliedAt: Date;
}

export interface MigrationStatus {
  migrationsDir: string;
  discovered: MigrationFile[];
  applied: AppliedMigration[];
  pending: MigrationFile[];
  checksumMismatches: {
    id: string;
    expected: string;
    actual: string;
  }[];
  missingFilesForApplied: string[];
}

const MIGRATION_FILE_PATTERN = /^\d{4}_[a-z0-9_]+\.sql$/;
const MIGRATION_TOOL_VERSION = 'batch-backend-migrator-v1';
const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
);

function resolveMigrationsDir(): string {
  const config = loadConfig();
  if (config.pg.migrationsDir) {
    return path.resolve(process.cwd(), config.pg.migrationsDir);
  }
  return DEFAULT_MIGRATIONS_DIR;
}

function getMigrationLockKey(): string {
  const config = loadConfig();
  return config.pg.migrationLockKey;
}

async function ensureMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      execution_ms INTEGER NOT NULL,
      tool_version TEXT NOT NULL
    );
  `);
}

async function readMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => MIGRATION_FILE_PATTERN.test(name))
    .sort((a, b) => a.localeCompare(b));

  const migrations: MigrationFile[] = [];
  for (const filename of files) {
    const absolutePath = path.join(migrationsDir, filename);
    const sql = await fs.readFile(absolutePath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    migrations.push({
      id: filename.replace(/\.sql$/, ''),
      filename,
      absolutePath,
      checksum,
      sql,
    });
  }

  return migrations;
}

async function loadAppliedMigrations(client: PoolClient): Promise<AppliedMigration[]> {
  const result = await client.query<{
    id: string;
    checksum: string;
    applied_at: Date;
  }>(`
    SELECT id, checksum, applied_at
    FROM schema_migrations
    ORDER BY id ASC
  `);

  return result.rows.map((row) => ({
    id: row.id,
    checksum: row.checksum,
    appliedAt: row.applied_at,
  }));
}

async function acquireMigrationLock(client: PoolClient, lockKey: string): Promise<void> {
  await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey]);
}

async function releaseMigrationLock(client: PoolClient, lockKey: string): Promise<void> {
  await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]);
}

export async function getMigrationStatus(): Promise<MigrationStatus> {
  const migrationsDir = resolveMigrationsDir();
  const discovered = await readMigrationFiles(migrationsDir);

  const pool = createPgPool();
  const client = await pool.connect();
  try {
    await ensureMigrationTable(client);
    const applied = await loadAppliedMigrations(client);
    const appliedById = new Map(applied.map((entry) => [entry.id, entry]));
    const discoveredById = new Map(discovered.map((entry) => [entry.id, entry]));

    const checksumMismatches = discovered
      .filter((migration) => {
        const appliedRow = appliedById.get(migration.id);
        return Boolean(appliedRow && appliedRow.checksum !== migration.checksum);
      })
      .map((migration) => ({
        id: migration.id,
        expected: discoveredById.get(migration.id)!.checksum,
        actual: appliedById.get(migration.id)!.checksum,
      }));

    const pending = discovered.filter((migration) => !appliedById.has(migration.id));
    const missingFilesForApplied = applied
      .map((entry) => entry.id)
      .filter((id) => !discoveredById.has(id));

    return {
      migrationsDir,
      discovered,
      applied,
      pending,
      checksumMismatches,
      missingFilesForApplied,
    };
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  const status = await getMigrationStatus();
  if (status.checksumMismatches.length > 0) {
    const details = status.checksumMismatches
      .map((entry) => `${entry.id} (db=${entry.actual.slice(0, 12)}, file=${entry.expected.slice(0, 12)})`)
      .join(', ');
    throw new Error(`Migration checksum mismatch detected: ${details}`);
  }
  if (status.missingFilesForApplied.length > 0) {
    throw new Error(
      `Applied migrations missing on disk: ${status.missingFilesForApplied.join(', ')}`,
    );
  }
  if (status.pending.length === 0) {
    logger.info('No pending database migrations', {
      component: 'pg-migrations',
      migrationsDir: status.migrationsDir,
    });
    return;
  }

  const lockKey = getMigrationLockKey();
  const pool = createPgPool();
  const client = await pool.connect();
  let lockHeld = false;
  try {
    await ensureMigrationTable(client);
    await acquireMigrationLock(client, lockKey);
    lockHeld = true;

    const appliedAfterLock = await loadAppliedMigrations(client);
    const appliedIds = new Set(appliedAfterLock.map((migration) => migration.id));
    const pendingAfterLock = status.discovered.filter((migration) => !appliedIds.has(migration.id));

    for (const migration of pendingAfterLock) {
      const startedAt = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        const executionMs = Date.now() - startedAt;
        await client.query(
          `
          INSERT INTO schema_migrations (id, checksum, execution_ms, tool_version)
          VALUES ($1, $2, $3, $4)
          `,
          [migration.id, migration.checksum, executionMs, MIGRATION_TOOL_VERSION],
        );
        await client.query('COMMIT');
        logger.info('Applied database migration', {
          component: 'pg-migrations',
          migrationId: migration.id,
          executionMs,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    if (lockHeld) {
      try {
        await releaseMigrationLock(client, lockKey);
      } catch (unlockError) {
        logger.warn('Failed to release migration advisory lock cleanly', {
          component: 'pg-migrations',
          error: unlockError instanceof Error ? unlockError.message : String(unlockError),
        });
      }
    }
    client.release();
  }
}

export async function runMigrationsIfConfigured(): Promise<void> {
  const config = loadConfig();
  if (!config.pg.enabled) {
    logger.info('Postgres disabled; skipping migration checks', {
      component: 'pg-migrations',
      event: 'pg_migration_mode_disabled',
    });
    return;
  }
  const status = await getMigrationStatus();

  if (status.checksumMismatches.length > 0 || status.missingFilesForApplied.length > 0) {
    throw new Error(
      'Migration status is invalid (checksum mismatch or missing migration files); resolve before startup.',
    );
  }

  if (!config.pg.autoMigrateOnBoot) {
    logger.info('Startup migration mode resolved to manual', {
      component: 'pg-migrations',
      event: 'pg_migration_mode_manual',
      pendingCount: status.pending.length,
    });
    if (status.pending.length > 0) {
      logger.warn('Pending migrations detected and PG_AUTO_MIGRATE_ON_BOOT=false', {
        component: 'pg-migrations',
        pendingCount: status.pending.length,
        pending: status.pending.map((migration) => migration.id),
      });
    }
    return;
  }

  logger.info('Startup migration mode resolved to auto-apply', {
    component: 'pg-migrations',
    event: 'pg_migration_mode_auto',
    pendingCount: status.pending.length,
  });
  await runMigrations();
}

export async function closeMigrationPool(): Promise<void> {
  await closePgPool();
}
