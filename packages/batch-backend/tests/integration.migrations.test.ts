import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closePgPool } from '../src/infrastructure/db.js';
import { verifyMigrations } from '../src/infrastructure/migration-verify.js';
import { getMigrationStatus, runMigrations } from '../src/infrastructure/migrations.js';
import { generateSchemaBaselineSql } from '../src/infrastructure/schema-baseline.js';
import { requirePgTestEnv, resolveTestTimeout, writeTestArtifact } from './support/test-env.js';

const { connectionString } = requirePgTestEnv();
const testTimeout = resolveTestTimeout(120_000);
const legacyFixturePath = path.resolve(import.meta.dirname, 'fixtures', 'pg-legacy-schema.sql');
const schemaBaselinePath = path.resolve(import.meta.dirname, '..', 'schema.sql');
const execFile = promisify(execFileCallback);

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

async function applySchemaBaselineFixture(): Promise<void> {
  await execFile('psql', [connectionString, '-v', 'ON_ERROR_STOP=1', '-f', schemaBaselinePath], {
    maxBuffer: 20 * 1024 * 1024,
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
      [
        [
          'idx_recordings_source_path_trgm',
          'idx_recordings_storage_uri_trgm',
          'idx_recordings_id_trgm',
        ],
      ],
    );
    const indexNames = new Set(indexResult.rows.map((row) => row.indexname));
    expect(indexNames.has('idx_recordings_source_path_trgm')).toBe(true);
    expect(indexNames.has('idx_recordings_storage_uri_trgm')).toBe(true);
    expect(indexNames.has('idx_recordings_id_trgm')).toBe(true);

    const studentMemorySnapshotColumns = await pool.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'student_memory_snapshots'
      `,
    );
    const studentMemorySnapshotColumnSet = new Set(
      studentMemorySnapshotColumns.rows.map((row) => row.column_name),
    );
    expect(studentMemorySnapshotColumnSet.has('lesson_memory_entry_ids')).toBe(true);
    expect(studentMemorySnapshotColumnSet.has('homework_memory_entry_ids')).toBe(true);
    expect(studentMemorySnapshotColumnSet.has('content_hash')).toBe(true);
    expect(studentMemorySnapshotColumnSet.has('unresolved_issues')).toBe(true);

    const jobsColumns = await pool.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'jobs'
      `,
    );
    const jobsColumnSet = new Set(jobsColumns.rows.map((row) => row.column_name));
    expect(jobsColumnSet.has('started_at')).toBe(true);
    expect(jobsColumnSet.has('finished_at')).toBe(true);
    expect(jobsColumnSet.has('error')).toBe(true);

    const profileRevisionSourceConstraint = await pool.query<{ definition: string }>(
      `
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'profile_revisions_source_check'
      `,
    );
    const definition = profileRevisionSourceConstraint.rows[0]?.definition ?? '';
    expect(definition).toContain('starter_profile_form');
    expect(definition).toContain('candidate_promotion');
    expect(definition).toContain('legacy_normalization');

    const actionTypeConstraint = await pool.query<{ definition: string }>(
      `
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'job_action_history_action_type_check'
      `,
    );
    const actionDefinition = actionTypeConstraint.rows[0]?.definition ?? '';
    expect(actionDefinition).toContain("'rerun'");
    expect(actionDefinition).not.toContain('rerun_audio');
    expect(actionDefinition).not.toContain('rerun_publish');
  });
}

describe('integration/migrations', () => {
  beforeEach(async () => {
    await resetPublicSchema();
  }, testTimeout);

  afterAll(async () => {
    await closePgPool();
  });

  it(
    'fresh bootstrap applies all migrations and verifies cleanly',
    async () => {
      await runMigrations();
      await assertSchemaHealthy('fresh-bootstrap');
    },
    testTimeout,
  );

  it(
    'generated schema baseline matches current migration output',
    async () => {
      const expected = await generateSchemaBaselineSql(connectionString);
      const actual = await fs.readFile(schemaBaselinePath, 'utf8');

      await writeTestArtifact('schema-baseline-generated.sql', expected);

      expect(actual).toBe(expected);
      expect(actual).not.toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;');
      expect(actual).not.toContain('COMMENT ON EXTENSION pg_trgm');
      expect(actual).toContain(
        'Skipping pg_trgm extension creation because privileges are insufficient.',
      );
    },
    testTimeout,
  );

  it(
    'schema baseline bootstrap verifies cleanly without pending migrations',
    async () => {
      await applySchemaBaselineFixture();
      await assertSchemaHealthy('schema-baseline-bootstrap');
    },
    testTimeout,
  );

  it(
    'legacy schema upgrade applies migrations without drift',
    async () => {
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
        const transcriptProviderResult = await pool.query<{ stt_provider: string }>(
          `
        SELECT stt_provider
        FROM transcripts
        WHERE id = '66666666-6666-4666-8666-666666666661'
        `,
        );
        const transcriptProviderConstraint = await pool.query<{ present: boolean }>(
          `
        SELECT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'transcripts_stt_provider_check'
        ) AS present
        `,
        );

        expect(profileResult.rows.every((row) => row.active_count === 1)).toBe(true);
        expect(templateResult.rows.every((row) => row.active_count === 1)).toBe(true);
        expect(transcriptProviderResult.rows[0]?.stt_provider).toBe('deepgram');
        expect(transcriptProviderConstraint.rows[0]?.present).toBe(true);
      });
    },
    testTimeout,
  );

  it(
    'idempotency re-run leaves migration history unchanged',
    async () => {
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
    },
    testTimeout,
  );

  it(
    'legacy rerun action rows upgrade cleanly through the rerun-unification migration',
    async () => {
      await applyLegacySchemaFixture();

      await withAdminClient(async (pool) => {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS job_action_history (
            id UUID PRIMARY KEY,
            job_id UUID NOT NULL,
            action_type TEXT NOT NULL,
            payload_json JSONB NULL,
            requested_at TIMESTAMPTZ NOT NULL,
            requested_by UUID NULL,
            outcome TEXT NOT NULL,
            message TEXT NOT NULL,
            error_code TEXT NULL,
            created_job_id UUID NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);

        await pool.query(`
          ALTER TABLE job_action_history
            DROP CONSTRAINT IF EXISTS job_action_history_action_type_check;
          ALTER TABLE job_action_history
            ADD CONSTRAINT job_action_history_action_type_check
            CHECK (action_type IN ('rerun_audio', 'rerun_publish', 'cancel', 'edit_metadata'));
        `);

        await pool.query(
          `
          INSERT INTO job_action_history (
            id,
            job_id,
            action_type,
            payload_json,
            requested_at,
            requested_by,
            outcome,
            message,
            error_code,
            created_job_id,
            created_at
          )
          VALUES (
            'c3fbb9aa-0b3c-406a-94a5-4c50760625ab',
            '99999999-9999-4999-8999-999999999991',
            'rerun_publish',
            '{}'::jsonb,
            NOW() - INTERVAL '1 day',
            '11111111-1111-4111-8111-111111111111',
            'failed',
            'Publish can only be rerun for succeeded jobs',
            'invalid_state',
            NULL,
            NOW() - INTERVAL '1 day'
          )
          `,
        );
      });

      await runMigrations();
      await assertSchemaHealthy('legacy-upgrade-rerun-history');

      await withAdminClient(async (pool) => {
        const actionTypes = await pool.query<{ action_type: string }>(
          `
          SELECT action_type
          FROM job_action_history
          WHERE id = 'c3fbb9aa-0b3c-406a-94a5-4c50760625ab'
          `,
        );
        expect(actionTypes.rows[0]?.action_type).toBe('rerun');
      });
    },
    testTimeout,
  );
});
