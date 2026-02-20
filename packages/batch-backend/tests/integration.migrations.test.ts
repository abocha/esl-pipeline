import fs from 'node:fs/promises';
import path from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closePgPool } from '../src/infrastructure/db.js';
import { verifyMigrations } from '../src/infrastructure/migration-verify.js';
import { getMigrationStatus, runMigrations } from '../src/infrastructure/migrations.js';
import { requirePgTestEnv, resolveTestTimeout, writeTestArtifact } from './support/test-env.js';

const { connectionString } = requirePgTestEnv();
const testTimeout = resolveTestTimeout(120_000);
const legacyFixturePath = path.resolve(import.meta.dirname, 'fixtures', 'pg-legacy-schema.sql');

async function withAdminClient<T>(fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

async function resetPublicSchema(): Promise<void> {
  await closePgPool();
  await withAdminClient(async (pool) => {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
    await pool.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
    await pool.query('GRANT ALL ON SCHEMA public TO public');
  });
}

async function applyLegacySchemaFixture(): Promise<void> {
  const sql = await fs.readFile(legacyFixturePath, 'utf8');
  await withAdminClient(async (pool) => {
    await pool.query(sql);
  });
}

async function assertSchemaHealthy(scenario: string): Promise<void> {
  const status = await getMigrationStatus();
  const verification = await verifyMigrations();

  await writeTestArtifact(`migrations-${scenario}-status.json`, {
    discovered: status.discovered.map((migration) => migration.id),
    applied: status.applied.map((migration) => migration.id),
    pending: status.pending.map((migration) => migration.id),
    checksumMismatches: status.checksumMismatches,
    missingFilesForApplied: status.missingFilesForApplied,
  });
  await writeTestArtifact(`migrations-${scenario}-verify.json`, verification);

  expect(status.checksumMismatches).toHaveLength(0);
  expect(status.missingFilesForApplied).toHaveLength(0);
  expect(status.pending).toHaveLength(0);
  expect(status.applied.map((migration) => migration.id)).toEqual(
    status.discovered.map((migration) => migration.id),
  );
  expect(verification.ok).toBe(true);
  expect(verification.errors).toEqual([]);

  await withAdminClient(async (pool) => {
    const extensionResult = await pool.query<{ present: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
      ) AS present
      `,
    );

    if (!extensionResult.rows[0]?.present) {
      return;
    }

    const indexResult = await pool.query<{ indexname: string }>(
      `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])
      `,
      [['idx_recordings_source_path_trgm', 'idx_recordings_storage_uri_trgm', 'idx_recordings_id_trgm']],
    );
    const indexNames = new Set(indexResult.rows.map((row) => row.indexname));
    expect(indexNames.has('idx_recordings_source_path_trgm')).toBe(true);
    expect(indexNames.has('idx_recordings_storage_uri_trgm')).toBe(true);
    expect(indexNames.has('idx_recordings_id_trgm')).toBe(true);
  });
}

describe('integration/migrations', () => {
  beforeEach(async () => {
    await resetPublicSchema();
  }, testTimeout);

  afterAll(async () => {
    await closePgPool();
  });

  it('fresh bootstrap applies all migrations and verifies cleanly', async () => {
    await runMigrations();
    await assertSchemaHealthy('fresh-bootstrap');
  }, testTimeout);

  it('legacy schema upgrade applies migrations without drift', async () => {
    await applyLegacySchemaFixture();
    await runMigrations();
    await assertSchemaHealthy('legacy-upgrade');

    await withAdminClient(async (pool) => {
      const profileResult = await pool.query<{ profile_id: string; active_count: number }>(
        `
        SELECT profile_id, COUNT(*) FILTER (WHERE status = 'active')::int AS active_count
        FROM profile_revisions
        GROUP BY profile_id
        `,
      );
      const templateResult = await pool.query<{ template_id: string; active_count: number }>(
        `
        SELECT template_id, COUNT(*) FILTER (WHERE status = 'active')::int AS active_count
        FROM template_revisions
        GROUP BY template_id
        `,
      );

      expect(profileResult.rows.every((row) => row.active_count === 1)).toBe(true);
      expect(templateResult.rows.every((row) => row.active_count === 1)).toBe(true);
    });
  }, testTimeout);

  it('idempotency re-run leaves migration history unchanged', async () => {
    await runMigrations();
    const firstStatus = await getMigrationStatus();
    await runMigrations();
    const secondStatus = await getMigrationStatus();

    await assertSchemaHealthy('idempotency');

    expect(firstStatus.applied.map((migration) => migration.id)).toEqual(
      secondStatus.applied.map((migration) => migration.id),
    );

    await withAdminClient(async (pool) => {
      const duplicateResult = await pool.query<{ id: string }>(
        `
        SELECT id
        FROM schema_migrations
        GROUP BY id
        HAVING COUNT(*) > 1
        `,
      );
      expect(duplicateResult.rows).toHaveLength(0);
    });
  }, testTimeout);
});
