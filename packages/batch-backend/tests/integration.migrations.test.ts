import './support/bootstrap-pg-test-env.js';

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { resolveHomeworkMemorySourceFromSucceededJob } from '../src/application/homework-memory-source.js';
import { closePgPool } from '../src/infrastructure/db.js';
import { verifyMigrations } from '../src/infrastructure/migration-verify.js';
import { getMigrationStatus, runMigrations } from '../src/infrastructure/migrations.js';
import { applySqlFile, generateSchemaBaselineSql } from '../src/infrastructure/schema-baseline.js';
import { requirePgTestEnv, resolveTestTimeout, writeTestArtifact } from './support/test-env.js';

const { connectionString } = requirePgTestEnv();
const testTimeout = resolveTestTimeout(120_000);
const legacyFixturePath = path.resolve(import.meta.dirname, 'fixtures', 'pg-legacy-schema.sql');
const schemaBaselinePath = path.resolve(import.meta.dirname, '..', 'schema.sql');
const migrationsPath = path.resolve(import.meta.dirname, '..', 'migrations');

async function applyMigrationsThrough(pool: Pool, lastMigrationId: string): Promise<void> {
  const filenames = (await fs.readdir(migrationsPath))
    .filter((filename) => /^\d{4}_.+\.sql$/.test(filename))
    .sort((left, right) => left.localeCompare(right))
    .filter((filename) => filename.replace(/\.sql$/, '') <= lastMigrationId);

  const client = await pool.connect();
  try {
    for (const filename of filenames) {
      const sql = await fs.readFile(path.join(migrationsPath, filename), 'utf8');
      const id = filename.replace(/\.sql$/, '');
      await client.query(sql);
      await client.query(
        `
        INSERT INTO schema_migrations (id, checksum, execution_ms, tool_version)
        VALUES ($1, $2, 0, 'integration-cutover-fixture')
        ON CONFLICT (id) DO NOTHING
        `,
        [id, createHash('sha256').update(sql).digest('hex')],
      );
    }
  } finally {
    client.release();
  }
}

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
  await applySqlFile(connectionString, schemaBaselinePath);
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
    expect(definition).toContain('lesson_population');

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

    const sourceConstraints = await pool.query<{ conname: string; definition: string }>(
      `
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = ANY($1::text[])
      `,
      [['recordings_source_check', 'transcripts_stt_provider_check']],
    );
    const constraintDefinitions = new Map(
      sourceConstraints.rows.map((row) => [row.conname, row.definition]),
    );
    expect(constraintDefinitions.get('recordings_source_check')).toContain('manual_transcript');
    expect(constraintDefinitions.get('transcripts_stt_provider_check')).toContain('manual');
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
    '0049 backfills recording ownership and creates constrained ingest foundations',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0048_recording_audio_topology');
        const workspaceId = '10000000-0000-4000-8000-000000000001';
        const studentId = '20000000-0000-4000-8000-000000000001';
        const recordingId = '30000000-0000-4000-8000-000000000001';
        await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Tutor A')`, [workspaceId]);
        await pool.query(
          `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Alex', $2)`,
          [studentId, workspaceId],
        );
        await pool.query(
          `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
           VALUES ($1, 'upload', $2, 's3://audio/a.mp3', 10, 'queued')`,
          [recordingId, studentId],
        );

        await pool.query(
          await fs.readFile(
            path.join(migrationsPath, '0049_recording_ingest_readiness.sql'),
            'utf8',
          ),
        );

        const row = await pool.query(
          `SELECT workspace_id, storage_uri, audio_lifecycle FROM recordings WHERE id = $1`,
          [recordingId],
        );
        expect(row.rows[0]).toMatchObject({
          workspace_id: workspaceId,
          storage_uri: 's3://audio/a.mp3',
          audio_lifecycle: 'retained',
        });
        await expect(
          pool.query(
            `INSERT INTO transcription_runs
             (id, recording_id, workspace_id, provider, request_profile, submission_slots_reserved)
             VALUES (gen_random_uuid(), $1, $2, 'elevenlabs', 'mixed-v1', 4)`,
            [recordingId, workspaceId],
          ),
        ).rejects.toThrow();
        const otherWorkspaceId = '10000000-0000-4000-8000-000000000099';
        await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Tutor Other')`, [
          otherWorkspaceId,
        ]);
        const otherStudentId = '20000000-0000-4000-8000-000000000099';
        await pool.query(
          `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Alex', $2)`,
          [otherStudentId, otherWorkspaceId],
        );
        const constraints = await pool.query(
          `SELECT conname FROM pg_constraint
           WHERE conname IN ('students_id_workspace_unique', 'recordings_student_workspace_fkey')`,
        );
        expect(constraints.rows.map((candidate) => candidate.conname).sort()).toEqual([
          'recordings_student_workspace_fkey',
          'students_id_workspace_unique',
        ]);
        await expect(
          pool.query(
            `INSERT INTO recordings
             (id, workspace_id, source, student_id, storage_uri, audio_lifecycle, bytes, status)
             VALUES (gen_random_uuid(), $1, 'upload', $2, 's3://audio/b.mp3', 'retained', 10, 'queued')`,
            [otherWorkspaceId, studentId],
          ),
        ).rejects.toThrow();
        await expect(
          pool.query(`UPDATE students SET workspace_id = $2 WHERE id = $1`, [
            studentId,
            otherWorkspaceId,
          ]),
        ).rejects.toThrow();
        await expect(pool.query(`DELETE FROM students WHERE id = $1`, [studentId])).rejects.toThrow();
        await expect(
          pool.query(
            `INSERT INTO transcription_runs
             (id, recording_id, workspace_id, provider, request_profile)
             VALUES (gen_random_uuid(), $1, $2, 'elevenlabs', 'mixed-v1')`,
            [recordingId, otherWorkspaceId],
          ),
        ).rejects.toThrow();
      });
    },
    testTimeout,
  );

  it(
    '0049 aborts when recording ownership cannot be resolved',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0048_recording_audio_topology');
        await pool.query(
          `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
           VALUES (gen_random_uuid(), 'upload', NULL, 's3://audio/orphan.mp3', 10, 'queued')`,
        );
        await expect(
          pool.query(
            await fs.readFile(
              path.join(migrationsPath, '0049_recording_ingest_readiness.sql'),
              'utf8',
            ),
          ),
        ).rejects.toThrow('unresolved recording workspace ownership: 1 row(s)');
      });
    },
    testTimeout,
  );

  it(
    '0049 aborts rather than choosing among historical duplicate transcript winners',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0048_recording_audio_topology');
        const workspaceId = '10000000-0000-4000-8000-000000000002';
        const studentId = '20000000-0000-4000-8000-000000000002';
        const recordingId = '30000000-0000-4000-8000-000000000002';
        await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Tutor B')`, [workspaceId]);
        await pool.query(
          `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Alex', $2)`,
          [studentId, workspaceId],
        );
        await pool.query(
          `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
           VALUES ($1, 'upload', $2, 's3://audio/b.mp3', 10, 'transcribed')`,
          [recordingId, studentId],
        );
        await pool.query(
          `INSERT INTO transcripts (id, recording_id, storage_uri)
           VALUES (gen_random_uuid(), $1, 's3://transcripts/one.json'),
                  (gen_random_uuid(), $1, 's3://transcripts/two.json')`,
          [recordingId],
        );
        await expect(
          pool.query(
            await fs.readFile(
              path.join(migrationsPath, '0049_recording_ingest_readiness.sql'),
              'utf8',
            ),
          ),
        ).rejects.toThrow('duplicate transcript winners require manual resolution: 1 recording(s)');
      });
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
      expect(actual).not.toContain(
        'CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;',
      );
      expect(actual).not.toContain('COMMENT ON EXTENSION pg_stat_statements');
      expect(actual).toContain(
        'Skipping pg_stat_statements extension creation because privileges or server support are insufficient.',
      );
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
    'hard cutover removes unfinished editor state and preserves completed output lineage',
    async () => {
      const ids = {
        user: randomUUID(),
        student: randomUUID(),
        recording: randomUUID(),
        transcript: randomUUID(),
        promptPackage: randomUUID(),
        draft: randomUUID(),
        unfinishedPromptPackage: randomUUID(),
        unfinishedDraft: randomUUID(),
        activeSession: randomUUID(),
        archivedSession: randomUUID(),
        rootJob: randomUUID(),
        rerunJob: randomUUID(),
        homeworkMemory: randomUUID(),
        otherStudent: randomUUID(),
        legacyLessonMemory: randomUUID(),
        sameStudentReadyLessonMemory: randomUUID(),
        otherStudentReadyLessonMemory: randomUUID(),
        invalidReadySnapshot: randomUUID(),
        invalidPendingSnapshot: randomUUID(),
        crossStudentSnapshot: randomUUID(),
        validReadySnapshot: randomUUID(),
        emptyReadySnapshot: randomUUID(),
        failedSnapshot: randomUUID(),
      };
      const publishedUrl = 'https://example.test/handouts/completed';
      const markdownUri = 'local://historical-handouts/completed.md';
      const historicalMarkdown =
        '---\ntitle: Homework\n---\n### A. Notice the Grammar\nReview articles.\n\n### F. Your Mission\nGive travel advice.\n';
      const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assignment-cutover-storage-'));
      const previousStorageDir = process.env.FILESYSTEM_UPLOAD_DIR;
      process.env.FILESYSTEM_UPLOAD_DIR = storageDir;
      await fs.mkdir(path.join(storageDir, 'historical-handouts'), { recursive: true });
      await fs.writeFile(
        path.join(storageDir, 'historical-handouts', 'completed.md'),
        historicalMarkdown,
        'utf8',
      );

      try {
        await withAdminClient(async (pool) => {
          await applyMigrationsThrough(pool, '0043_manual_transcript_source');
          await pool.query(
            `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'hash', 'user')`,
            [ids.user, `${ids.user}@example.test`],
          );
          await pool.query(`INSERT INTO students (id, student) VALUES ($1, 'Alpha Tester')`, [
            ids.student,
          ]);
          await pool.query(`INSERT INTO students (id, student) VALUES ($1, 'Other Tester')`, [
            ids.otherStudent,
          ]);
          await pool.query(
            `
          INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
          VALUES ($1, 'upload', $2, 's3://recordings/lesson.mp3', 12, 'ingested')
          `,
            [ids.recording, ids.student],
          );
          await pool.query(
            `
          INSERT INTO transcripts (id, recording_id, storage_uri, stt_provider)
          VALUES ($1, $2, 's3://transcripts/historical.json', 'deepgram')
          `,
            [ids.transcript, ids.recording],
          );
          await pool.query(
            `
          INSERT INTO prompt_packages (
            id, recording_id, transcript_id, student_id, template_version, storage_uri
          )
          VALUES ($1, $2, $3, $4, 'v4.4', 's3://prompts/unfinished.txt')
          `,
            [ids.promptPackage, ids.recording, ids.transcript, ids.student],
          );
          await pool.query(
            `
          INSERT INTO drafts (id, prompt_package_id, student_id, storage_uri, created_by)
          VALUES ($1, $2, $3, 's3://drafts/unfinished.md', $4)
          `,
            [ids.draft, ids.promptPackage, ids.student, ids.user],
          );
          await pool.query(
            `
          INSERT INTO prompt_packages (
            id, recording_id, transcript_id, student_id, template_version, storage_uri
          )
          VALUES ($1, $2, $3, $4, 'v4.4', 's3://prompts/unreferenced.txt')
          `,
            [ids.unfinishedPromptPackage, ids.recording, ids.transcript, ids.student],
          );
          await pool.query(
            `
          INSERT INTO drafts (id, prompt_package_id, student_id, storage_uri, created_by)
          VALUES ($1, $2, $3, 's3://drafts/unreferenced.md', $4)
          `,
            [ids.unfinishedDraft, ids.unfinishedPromptPackage, ids.student, ids.user],
          );
          await pool.query(
            `
          INSERT INTO jobs (
            id, state, md_storage_uri, recording_id, transcript_id, prompt_package_id, draft_id,
            student_id, user_id, publish_target, html_url, finished_at
          )
          VALUES ($1, 'succeeded', $2, $3, $4, $5, $6, $7, $8, 'html', $9, NOW())
          `,
            [
              ids.rootJob,
              markdownUri,
              ids.recording,
              ids.transcript,
              ids.promptPackage,
              ids.draft,
              ids.student,
              ids.user,
              publishedUrl,
            ],
          );
          await pool.query(
            `
          INSERT INTO jobs (
            id, state, md_storage_uri, recording_id, transcript_id, prompt_package_id, draft_id,
            student_id, user_id, source_job_id, publish_target, html_url, finished_at
          )
          VALUES ($1, 'succeeded', $2, $3, $4, $5, $6, $7, $8, $9, 'html', $10, NOW())
          `,
            [
              ids.rerunJob,
              markdownUri,
              ids.recording,
              ids.transcript,
              ids.promptPackage,
              ids.draft,
              ids.student,
              ids.user,
              ids.rootJob,
              publishedUrl,
            ],
          );
          await pool.query(
            `
          INSERT INTO homework_memory_entries (
            id, student_id, job_id, assignment_lineage_key, schema_version, generated_at,
            provider, model, status, published_at, prompt_package_id, draft_id, recording_id,
            transcript_id
          )
          VALUES ($1, $2, $3, $4, '1', NOW(), 'openai', 'gpt-5.6', 'ready', NOW(), $5, $6, $7, $8)
          `,
            [
              ids.homeworkMemory,
              ids.student,
              ids.rerunJob,
              ids.rootJob,
              ids.promptPackage,
              ids.draft,
              ids.recording,
              ids.transcript,
            ],
          );
          await pool.query(
            `
          INSERT INTO assignment_sessions (
            id, user_id, student_id, recording_id, transcript_id, prompt_package_id, draft_id,
            current_stage, archived_at
          )
          VALUES
            ($1, $3, $4, $5, $6, $7, $8, 'review', NULL),
            ($2, $3, $4, NULL, NULL, NULL, NULL, 'source', NOW())
          `,
            [
              ids.activeSession,
              ids.archivedSession,
              ids.user,
              ids.student,
              ids.recording,
              ids.transcript,
              ids.promptPackage,
              ids.draft,
            ],
          );
          await pool.query(
            `
            INSERT INTO lesson_memory_entries (
              id, student_id, transcript_id, recording_id, schema_version, generated_at,
              provider, model, status
            )
            VALUES ($1, $2, $3, $4, 'lesson-memory.v1', NOW(), 'openai', 'gpt-5.6', 'ready')
            `,
            [ids.legacyLessonMemory, ids.student, ids.transcript, ids.recording],
          );
          await pool.query(
            `
            INSERT INTO student_memory_snapshots (
              id, student_id, schema_version, generated_at, provider, model, status,
              lesson_memory_entry_ids, homework_memory_entry_ids, superseded_by_id
            )
            VALUES
              ($1, $2, 'student-memory.v1', NOW(), 'openai', 'gpt-5.6', 'failed', $3::uuid[], ARRAY[]::uuid[], NULL),
              ($4, $2, 'student-memory.v1', NOW(), 'openai', 'gpt-5.6', 'ready', $5::uuid[], ARRAY[]::uuid[], $1),
              ($6, $2, 'student-memory.v1', NOW(), 'openai', 'gpt-5.6', 'pending', $7::uuid[], ARRAY[]::uuid[], $1),
              ($8, $2, 'student-memory.v1', NOW(), 'openai', 'gpt-5.6', 'ready', ARRAY[]::uuid[], $9::uuid[], NULL)
            `,
            [
              ids.failedSnapshot,
              ids.student,
              [randomUUID()],
              ids.invalidReadySnapshot,
              [ids.legacyLessonMemory],
              ids.invalidPendingSnapshot,
              [randomUUID()],
              ids.emptyReadySnapshot,
              [ids.homeworkMemory],
            ],
          );

          const cutoverSql = await fs.readFile(
            path.join(migrationsPath, '0044_assignment_step_confirmation_contract.sql'),
            'utf8',
          );
          await pool.query(cutoverSql);
          await pool.query(
            `
            INSERT INTO schema_migrations (id, checksum, execution_ms, tool_version)
            VALUES ('0044_assignment_step_confirmation_contract', $1, 0, 'integration-cutover-fixture')
            `,
            [createHash('sha256').update(cutoverSql).digest('hex')],
          );

          const publicationSequenceSql = await fs.readFile(
            path.join(migrationsPath, '0046_jobs_publication_sequence.sql'),
            'utf8',
          );
          await pool.query(publicationSequenceSql);
          const publishedContentHashSql = await fs.readFile(
            path.join(migrationsPath, '0047_jobs_published_content_hash.sql'),
            'utf8',
          );
          await pool.query(publishedContentHashSql);

          await pool.query(
            `
            INSERT INTO lesson_memory_entries (
              id, student_id, transcript_id, recording_id, schema_version, generated_at,
              provider, model, status, source_storage_uri, source_content_hash
            )
            VALUES
              ($1, $2, $3, $4, 'lesson-memory.v1', NOW(), 'openai', 'gpt-5.6', 'ready',
               'local://confirmed/same-student.txt', $5),
              ($6, $7, $3, $4, 'lesson-memory.v1', NOW(), 'openai', 'gpt-5.6', 'ready',
               'local://confirmed/other-student.txt', $8)
            `,
            [
              ids.sameStudentReadyLessonMemory,
              ids.student,
              ids.transcript,
              ids.recording,
              'a'.repeat(64),
              ids.otherStudentReadyLessonMemory,
              ids.otherStudent,
              'b'.repeat(64),
            ],
          );
          await pool.query(
            `
            INSERT INTO student_memory_snapshots (
              id, student_id, schema_version, generated_at, provider, model, status,
              lesson_memory_entry_ids, superseded_by_id
            )
            VALUES
              ($1, $2, 'student-memory.v1', NOW(), 'openai', 'gpt-5.6', 'ready', $3::uuid[], $4),
              ($5, $2, 'student-memory.v1', NOW(), 'openai', 'gpt-5.6', 'ready', $6::uuid[], NULL)
            `,
            [
              ids.crossStudentSnapshot,
              ids.student,
              [ids.otherStudentReadyLessonMemory],
              ids.failedSnapshot,
              ids.validReadySnapshot,
              [ids.sameStudentReadyLessonMemory],
            ],
          );

          const eligibilityRepairSql = await fs.readFile(
            path.join(migrationsPath, '0045_student_memory_snapshot_eligibility_repair.sql'),
            'utf8',
          );
          await pool.query(eligibilityRepairSql);
          const repairedSnapshots = await pool.query<{
            id: string;
            status: string;
            superseded_at: Date | null;
            superseded_by_id: string | null;
          }>(
            `
            SELECT id, status, superseded_at, superseded_by_id
            FROM student_memory_snapshots
            WHERE id = ANY($1::uuid[])
            ORDER BY id
            `,
            [
              [
                ids.invalidReadySnapshot,
                ids.invalidPendingSnapshot,
                ids.crossStudentSnapshot,
                ids.validReadySnapshot,
                ids.emptyReadySnapshot,
                ids.failedSnapshot,
              ],
            ],
          );
          const repairedById = new Map(
            repairedSnapshots.rows.map((snapshot) => [snapshot.id, snapshot]),
          );
          for (const id of [
            ids.invalidReadySnapshot,
            ids.invalidPendingSnapshot,
            ids.crossStudentSnapshot,
          ]) {
            expect(repairedById.get(id)).toMatchObject({
              status: 'superseded',
              superseded_by_id: null,
            });
            expect(repairedById.get(id)?.superseded_at).toBeInstanceOf(Date);
          }
          expect(repairedById.get(ids.validReadySnapshot)).toMatchObject({ status: 'ready' });
          expect(repairedById.get(ids.emptyReadySnapshot)).toMatchObject({ status: 'ready' });
          expect(repairedById.get(ids.failedSnapshot)).toMatchObject({ status: 'failed' });

          const repairedTimestamps = new Map(
            repairedSnapshots.rows.map((snapshot) => [
              snapshot.id,
              snapshot.superseded_at?.toISOString(),
            ]),
          );
          await pool.query(eligibilityRepairSql);
          const rerunSnapshots = await pool.query<{
            id: string;
            status: string;
            superseded_at: Date | null;
          }>(
            `SELECT id, status, superseded_at FROM student_memory_snapshots WHERE id = ANY($1::uuid[]) ORDER BY id`,
            [Array.from(repairedById.keys())],
          );
          expect(
            rerunSnapshots.rows.map((snapshot) => ({
              id: snapshot.id,
              status: snapshot.status,
              superseded_at: snapshot.superseded_at?.toISOString(),
            })),
          ).toEqual(
            repairedSnapshots.rows.map((snapshot) => ({
              id: snapshot.id,
              status: snapshot.status,
              superseded_at: repairedTimestamps.get(snapshot.id),
            })),
          );

          for (const table of ['assignment_sessions', 'drafts', 'prompt_packages']) {
            const count = await pool.query<{ count: string }>(
              `SELECT COUNT(*)::text AS count FROM ${table}`,
            );
            expect(count.rows[0]?.count).toBe('0');
          }

          const completed = await pool.query<{
            html_url: string;
            md_storage_uri: string;
            source_job_id: string;
          }>(`SELECT html_url, md_storage_uri, source_job_id FROM jobs WHERE id = $1`, [
            ids.rerunJob,
          ]);
          expect(completed.rows[0]).toEqual({
            html_url: publishedUrl,
            md_storage_uri: markdownUri,
            source_job_id: ids.rootJob,
          });

          const memory = await pool.query<{
            prompt_package_id: string | null;
            draft_id: string | null;
            md_storage_uri: string;
          }>(
            `
          SELECT h.prompt_package_id, h.draft_id, j.md_storage_uri
          FROM homework_memory_entries h
          JOIN jobs j ON j.id = h.job_id
          WHERE h.id = $1
          `,
            [ids.homeworkMemory],
          );
          expect(memory.rows[0]).toEqual({
            prompt_package_id: null,
            draft_id: null,
            md_storage_uri: markdownUri,
          });

          const transcript = await pool.query<{
            working_version: number | null;
            content_hash: string | null;
          }>(`SELECT working_version, content_hash FROM transcripts WHERE id = $1`, [
            ids.transcript,
          ]);
          expect(transcript.rows[0]).toEqual({ working_version: null, content_hash: null });
        });

        const source = await resolveHomeworkMemorySourceFromSucceededJob(ids.rerunJob);
        expect(source.publishedMarkdown).toBe(historicalMarkdown);
        expect(source.assignmentLineageKey).toBe(ids.rootJob);
      } finally {
        if (previousStorageDir === undefined) {
          delete process.env.FILESYSTEM_UPLOAD_DIR;
        } else {
          process.env.FILESYSTEM_UPLOAD_DIR = previousStorageDir;
        }
        await fs.rm(storageDir, { recursive: true, force: true });
      }
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
