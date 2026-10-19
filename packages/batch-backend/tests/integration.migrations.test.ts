import './support/bootstrap-pg-test-env.js';

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { resolveHomeworkMemorySourceFromSucceededJob } from '../src/application/homework-memory-source.js';
import { getStudentActivity } from '../src/application/student-activity.js';
import { recordStudentMemoryOpenAiBatchRemoteStatus } from '../src/application/student-memory-openai-batch-operations.js';
import {
  getProfileRevisionById,
  getRecordedProfileRevision,
} from '../src/domain/profile-revision-repository.js';
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
      WHERE conname = 'student_profile_revisions_source_check'
      `,
    );
    const definition = profileRevisionSourceConstraint.rows[0]?.definition ?? '';
    expect(definition).toContain('starter_profile_form');
    expect(definition).toContain('candidate_promotion');
    expect(definition).toContain('legacy_normalization');
    expect(definition).toContain('lesson_population');

    const studentId = randomUUID();
    const provenance = await pool.query<{ profile_provenance: string }>(
      `INSERT INTO students (id, student) VALUES ($1, 'Migration fixture') RETURNING profile_provenance`,
      [studentId],
    );
    expect(provenance.rows[0]?.profile_provenance).toBe('tutor_only');
    await pool.query('DELETE FROM students WHERE id = $1', [studentId]);
    await expect(
      pool.query(
        `INSERT INTO students (id, student, profile_provenance) VALUES ($1, 'Invalid provenance', 'evidence_enriched')`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const onboardingIndexes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
         AND tablename = 'profile_initial_enrichment_operations'`,
    );
    expect(onboardingIndexes.rows.map((row) => row.indexname)).toContain(
      'profile_initial_enrichment_live_student_idx',
    );
    expect(onboardingIndexes.rows.map((row) => row.indexname)).toContain(
      'profile_initial_enrichment_success_student_idx',
    );

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
    '0071 retains retired recurrence evidence and activity while removing executable scheduling',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0070_calendar_scheduling');
        const workspace = randomUUID(),
          student = randomUUID(),
          withoutLessons = randomUUID(),
          rule = randomUUID(),
          emptyRule = randomUUID(),
          slot = randomUUID(),
          emptySlot = randomUUID(),
          lesson = randomUUID();
        await pool.query("INSERT INTO workspaces(id,name) VALUES($1,'Retirement fixture')", [
          workspace,
        ]);
        await pool.query(
          "INSERT INTO students(id,student,workspace_id) VALUES($1,'History learner',$3),($2,'No lessons learner',$3)",
          [student, withoutLessons, workspace],
        );
        await pool.query(
          "INSERT INTO student_lesson_plans(student_id,workspace_id,timezone,default_duration_minutes,cadence,preferred_times,scheduling_notes) VALUES($1,$2,'Asia/Bangkok',50,'twice weekly','morning','Retain operational note')",
          [student, workspace],
        );
        await pool.query(
          "INSERT INTO student_lesson_recurrence_rules(id,student_id,workspace_id,timezone,frequency,starts_on,status,generation_horizon_days) VALUES($1,$3,$5,'Asia/Bangkok','weekly','2026-10-01','active',56),($2,$4,$5,'UTC','weekly','2026-10-01','paused',56)",
          [rule, emptyRule, student, withoutLessons, workspace],
        );
        await pool.query(
          "INSERT INTO student_lesson_recurrence_slots(id,rule_id,iso_weekday,local_start_time,duration_minutes,sort_order) VALUES($1,$3,1,'11:00',50,0),($2,$4,5,'09:00',60,0)",
          [slot, emptySlot, rule, emptyRule],
        );
        await pool.query(
          "INSERT INTO student_lessons(id,student_id,workspace_id,starts_at,timezone,duration_minutes,status,consumes_credit,recurrence_rule_id,recurrence_slot_id,recurrence_origin,recurrence_occurrence_key) VALUES($1,$2,$3,'2026-10-05T04:00Z','Asia/Bangkok',50,'scheduled',true,$4,$5,'generated','historical-occurrence')",
          [lesson, student, workspace, rule, slot],
        );
        const before = (
          await pool.query(
            'SELECT id,payload,actor_kind,occurred_at,recorded_at FROM student_activity WHERE student_id=$1 ORDER BY id',
            [student],
          )
        ).rows;
        await pool.query(
          await fs.readFile(path.join(migrationsPath, '0071_scheduler_retirement.sql'), 'utf8'),
        );
        const plans = (
          await pool.query(
            'SELECT student_id,default_duration_minutes,scheduling_notes,retired_schedule_preferences FROM student_lesson_plans ORDER BY student_id',
          )
        ).rows;
        const original = plans.find((row) => row.student_id === student);
        expect(original).toMatchObject({
          default_duration_minutes: 50,
          scheduling_notes: 'Retain operational note',
          retired_schedule_preferences: {
            cadence: 'twice weekly',
            preferredTimes: 'morning',
            rules: [{ id: rule, slots: [{ id: slot, local_start_time: '11:00:00' }] }],
          },
        });
        expect(
          plans.find((row) => row.student_id === withoutLessons).retired_schedule_preferences.rules,
        ).toMatchObject([{ id: emptyRule, slots: [{ id: emptySlot }] }]);
        expect(
          (
            await pool.query(
              'SELECT id,schedule_origin_history,schedule_hidden_at FROM student_lessons WHERE id=$1',
              [lesson],
            )
          ).rows[0],
        ).toMatchObject({
          id: lesson,
          schedule_hidden_at: null,
          schedule_origin_history: {
            ruleId: rule,
            slotId: slot,
            occurrenceKey: 'historical-occurrence',
            origin: 'generated',
            rule: { id: rule },
            slot: { id: slot },
          },
        });
        expect(
          (
            await pool.query(
              'SELECT id,payload,actor_kind,occurred_at,recorded_at FROM student_activity WHERE student_id=$1 ORDER BY id',
              [student],
            )
          ).rows,
        ).toEqual(before);
        expect(
          (
            await pool.query(
              "SELECT to_regclass('student_lesson_recurrence_rules') AS rules,to_regclass('student_lesson_recurrence_slots') AS slots",
            )
          ).rows[0],
        ).toEqual({ rules: null, slots: null });
        await pool.query('BEGIN');
        await pool.query("SELECT set_config('app.calendar_sync','on',true)");
        await pool.query("UPDATE student_lessons SET starts_at='2026-10-05T05:00Z' WHERE id=$1", [
          lesson,
        ]);
        await pool.query('COMMIT');
        expect(
          (
            await pool.query(
              "SELECT actor_kind FROM student_activity WHERE entity_id=$1 AND type='lesson_changed'",
              [lesson],
            )
          ).rows,
        ).toEqual([{ actor_kind: 'system' }]);
      });
    },
    testTimeout,
  );

  it(
    '0068 preserves prior evidence and records compatible old-writer transitions without invented backfill',
    async () => {
      const workspaceId = randomUUID(),
        userId = randomUUID(),
        studentId = randomUUID(),
        lessonId = randomUUID(),
        creditId = randomUUID();
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0067_mcp_profile_identities');
        await pool.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'unused')", [
          userId,
          `${userId}@example.test`,
        ]);
        await pool.query("INSERT INTO workspaces(id,name) VALUES($1,'Upgrade fixture')", [
          workspaceId,
        ]);
        await pool.query(
          "INSERT INTO students(id,student,workspace_id) VALUES($1,'Legacy learner',$2)",
          [studentId, workspaceId],
        );
        await pool.query(
          `INSERT INTO student_lessons(id,student_id,workspace_id,starts_at,status,consumes_credit,title,updated_by)
        VALUES($1,$2,$3,'2026-01-01T10:00:00Z','completed',true,'Legacy lesson',$4)`,
          [lessonId, studentId, workspaceId, userId],
        );
        await pool.query(
          `INSERT INTO student_credit_events(id,student_id,workspace_id,event_type,quantity_delta,source_lesson_id)
        VALUES($1,$2,$3,'credit_consumed',-1,$4)`,
          [creditId, studentId, workspaceId, lessonId],
        );
        await pool.query('UPDATE student_lessons SET credit_event_id=$2 WHERE id=$1', [
          lessonId,
          creditId,
        ]);
      });
      await runMigrations();
      await withAdminClient(async (pool) => {
        expect((await pool.query('SELECT count(*) FROM student_activity')).rows[0].count).toBe('0');
        expect(
          (
            await pool.query(
              'SELECT status,title,credit_event_id FROM student_lessons WHERE id=$1',
              [lessonId],
            )
          ).rows[0],
        ).toEqual({ status: 'completed', title: 'Legacy lesson', credit_event_id: creditId });
        // The previous writer uses its existing transaction and no new actor helper.
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            "UPDATE student_lessons SET status='scheduled',consumes_credit=false WHERE id=$1",
            [lessonId],
          );
          await client.query('UPDATE student_credit_events SET voided_at=NOW() WHERE id=$1', [
            creditId,
          ]);
          await client.query('UPDATE student_lessons SET credit_event_id=NULL WHERE id=$1', [
            lessonId,
          ]);
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      });
      const feed = (await getStudentActivity(workspaceId, studentId, userId))!;
      expect(feed.items.filter((x) => x.evidence === 'recorded')).toHaveLength(1);
      expect(feed.items.find((x) => x.type === 'lesson_restored')).toMatchObject({
        actor: { kind: 'unknown' },
        effects: [{ label: 'Credits reversed', value: '+1' }],
      });
      expect(feed.items.find((x) => x.type === 'lesson_created')).toMatchObject({
        evidence: 'legacy',
      });
      expect(feed.items.find((x) => x.type === 'credits_consumed')).toMatchObject({
        evidence: 'retained',
        subject: 'Credits used · -1 credit',
      });
      expect(feed.items.some((x) => x.type === 'credits_reversed')).toBe(false);
      await assertSchemaHealthy('student-activity-upgrade');
    },
    testTimeout,
  );

  it(
    '0067 backfills distinct OAuth identities including revoked, expired and nonmember grants',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0066_no_homework_lesson');
        const userId = randomUUID(),
          otherUserId = randomUUID();
        const workspaceId = randomUUID(),
          otherWorkspaceId = randomUUID();
        await pool.query(
          `INSERT INTO users (id, email, password_hash) VALUES
        ($1, 'profile-one@example.test', 'unused'), ($2, 'profile-two@example.test', 'unused')`,
          [userId, otherUserId],
        );
        await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'One'), ($2, 'Two')`, [
          workspaceId,
          otherWorkspaceId,
        ]);
        // Deliberately no memberships. Multiple grants for one pair must produce
        // one UUID, while both dimensions distinguish independent profiles.
        await pool.query(
          `INSERT INTO mcp_oauth_grants
        (id, user_id, workspace_id, client_id, resource, scope, expires_at, revoked_at) VALUES
        ('old-one', $1, $3, 'client', 'resource', 'teaching_context.read', NOW() + INTERVAL '1 hour', NULL),
        ('old-two', $1, $3, 'client', 'resource', 'teaching_context.read', NOW() - INTERVAL '1 hour', NOW()),
        ('other-workspace', $1, $4, 'client', 'resource', 'teaching_context.read', NOW() - INTERVAL '1 hour', NULL),
        ('other-user', $2, $3, 'client', 'resource', 'teaching_context.read', NOW() + INTERVAL '1 hour', NOW())`,
          [userId, otherUserId, workspaceId, otherWorkspaceId],
        );
        await runMigrations();
        const profiles = await pool.query(
          'SELECT id, user_id, workspace_id FROM mcp_profile_identities ORDER BY id',
        );
        expect(profiles.rows).toHaveLength(3);
        expect(new Set(profiles.rows.map((row) => row.id)).size).toBe(3);
        for (const row of profiles.rows) {
          expect(row.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          );
          for (const column of ['id', 'user_id', 'workspace_id']) {
            await expect(
              pool.query(`UPDATE mcp_profile_identities SET ${column} = $1 WHERE id = $2`, [
                randomUUID(),
                row.id,
              ]),
            ).rejects.toMatchObject({ code: '23514' });
          }
        }
        await expect(
          pool.query('INSERT INTO mcp_profile_identities (user_id, workspace_id) VALUES ($1, $2)', [
            userId,
            workspaceId,
          ]),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          pool.query(
            'INSERT INTO mcp_profile_identities (id, user_id, workspace_id) VALUES ($1, $2, $3)',
            [profiles.rows[0].id, otherUserId, otherWorkspaceId],
          ),
        ).rejects.toMatchObject({ code: '23505' });
        await runMigrations();
        expect(
          (
            await pool.query(
              'SELECT id, user_id, workspace_id FROM mcp_profile_identities ORDER BY id',
            )
          ).rows,
        ).toEqual(profiles.rows);
      });
      await assertSchemaHealthy('mcp-profile-identities');
    },
    testTimeout,
  );

  it(
    '0066 defaults existing Source-only and historical Share rows without inferring no-homework completion',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0065_assignment_react_renderer');
        const userId = randomUUID();
        const studentId = randomUUID();
        const workspaceId = randomUUID();
        const sourceId = randomUUID();
        const historicalId = randomUUID();
        const jobId = randomUUID();
        const recordingId = randomUUID();
        const transcriptId = randomUUID();
        await pool.query(
          `INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,'hash','user')`,
          [userId, `${userId}@migration.test`],
        );
        await pool.query(`INSERT INTO workspaces(id,name) VALUES($1,'Migration test')`, [
          workspaceId,
        ]);
        await pool.query(`INSERT INTO students(id,student,workspace_id) VALUES($1,'Test',$2)`, [
          studentId,
          workspaceId,
        ]);
        await pool.query(
          `INSERT INTO recordings(id,workspace_id,source,student_id,storage_uri,bytes,status) VALUES($1,$2,'upload',$3,'local://audio',12,'transcribed')`,
          [recordingId, workspaceId, studentId],
        );
        await pool.query(
          `INSERT INTO transcripts(id,recording_id,storage_uri,working_version,content_hash,stt_provider,mode,model,language,fallback_used) VALUES($1,$2,'local://transcript',1,$3,'manual','timeline','manual','auto',false)`,
          [transcriptId, recordingId, 'a'.repeat(64)],
        );
        const source = {
          lessonId: null,
          recordingId,
          transcriptId,
          transcriptWorkingVersion: 1,
          transcriptStorageUri: 'local://transcript',
          transcriptHash: 'a'.repeat(64),
        };
        const snapshot = { student: { studentId }, source, context: null, create: null };
        await pool.query(
          `INSERT INTO assignment_sessions(id,user_id,student_id,recording_id,transcript_id,confirmed_step,confirmed_snapshot) VALUES($1,$2,$3,$4,$5,'source',$6)`,
          [sourceId, userId, studentId, recordingId, transcriptId, snapshot],
        );
        // Model rows retained by the prior historical cutover, then restore its write guard.
        await pool.query('ALTER TABLE jobs DISABLE TRIGGER historical_jobs_read_only');
        await pool.query(
          'ALTER TABLE assignment_sessions DISABLE TRIGGER historical_sessions_read_only',
        );
        try {
          await pool.query(
            `INSERT INTO jobs(id,state,student_id,md_storage_uri) VALUES($1,'succeeded',$2,'local://frozen-history.md')`,
            [jobId, studentId],
          );
          await pool.query(
            `INSERT INTO assignment_sessions(id,user_id,student_id,confirmed_step,confirmed_snapshot,share_job_id) VALUES($1,$2,$3,'share',$4,$5)`,
            [
              historicalId,
              userId,
              studentId,
              {
                ...snapshot,
                context: { teacherNotes: null },
                create: { draftStorageUri: 'local://frozen-history.md', draftHash: 'b'.repeat(64) },
              },
              jobId,
            ],
          );
        } finally {
          await pool.query('ALTER TABLE jobs ENABLE TRIGGER historical_jobs_read_only');
          await pool.query(
            'ALTER TABLE assignment_sessions ENABLE TRIGGER historical_sessions_read_only',
          );
        }
        const original = (
          await pool.query(
            'SELECT id,confirmed_snapshot,confirmed_step,revision FROM assignment_sessions ORDER BY id',
          )
        ).rows;
        await runMigrations();
        expect(
          (
            await pool.query(
              'SELECT id,confirmed_snapshot,confirmed_step,revision FROM assignment_sessions ORDER BY id',
            )
          ).rows,
        ).toEqual(original);
        expect(
          (
            await pool.query(
              'SELECT homework_intent,transcript_completed_at,transcript_completion_history FROM assignment_sessions',
            )
          ).rows,
        ).toEqual([
          {
            homework_intent: 'create',
            transcript_completed_at: null,
            transcript_completion_history: [],
          },
          {
            homework_intent: 'create',
            transcript_completed_at: null,
            transcript_completion_history: [],
          },
        ]);
        expect(
          (
            await pool.query(
              'SELECT historical_assignment_session(s) AS historical FROM assignment_sessions s WHERE id=$1',
              [historicalId],
            )
          ).rows[0].historical,
        ).toBe(true);
        await expect(
          pool.query('UPDATE assignment_sessions SET revision=revision+1 WHERE id=$1', [
            historicalId,
          ]),
        ).rejects.toThrow('legacy_assignment_read_only');
        expect(
          (
            await pool.query('SELECT md_storage_uri,assignment_artifact FROM jobs WHERE id=$1', [
              jobId,
            ])
          ).rows[0],
        ).toEqual({ md_storage_uri: 'local://frozen-history.md', assignment_artifact: null });
        const indexes = (
          await pool.query(
            `SELECT indexname,indexdef FROM pg_indexes WHERE tablename='assignment_sessions'`,
          )
        ).rows;
        expect(
          indexes.find((row) => row.indexname === 'idx_assignment_sessions_user_active_updated')
            .indexdef,
        ).toContain('transcript_completed_at IS NULL');
        expect(
          indexes.find((row) => row.indexname === 'idx_assignment_sessions_lesson_updated')
            .indexdef,
        ).toContain('transcript_completed_at IS NULL');
        expect(
          indexes.find((row) => row.indexname === 'idx_assignment_sessions_user_active_recording'),
        ).toBeUndefined();
      });
    },
    testTimeout,
  );

  it(
    '0065 admits React renderer 3 without changing frozen artifact identity',
    async () => {
      await withAdminClient(async (pool) => {
        await pool.query(`CREATE TABLE drafts (storage_uri text, working_version integer, content_hash text);
        CREATE TABLE jobs (id text PRIMARY KEY, prompt_package_id text, draft_id text);`);
        for (const filename of [
          '0062_assignment_v1_authority.sql',
          '0063_assignment_native_renderer.sql',
        ])
          await pool.query(await fs.readFile(path.join(migrationsPath, filename), 'utf8'));
        const artifact = {
          format: 'assignment_v1',
          schemaVersion: 1,
          serializationVersion: 1,
          workingVersion: 1,
          contentHash: 'a'.repeat(64),
          storageUri: `local://drafts/content/${'a'.repeat(64)}.json`,
        };
        const insert = (renderer: number | null, value = artifact) =>
          pool.query(
            `INSERT INTO jobs(id,prompt_package_id,draft_id,assignment_artifact,assignment_renderer_version)
         VALUES($1,'prompt','draft',$2::jsonb,$3)`,
            [randomUUID(), JSON.stringify(value), renderer],
          );
        await expect(insert(3)).rejects.toThrow('jobs_assignment_artifact_identity');
        await pool.query(
          await fs.readFile(
            path.join(migrationsPath, '0065_assignment_react_renderer.sql'),
            'utf8',
          ),
        );
        await insert(3);
        expect(
          (await pool.query('SELECT assignment_artifact,assignment_renderer_version FROM jobs'))
            .rows,
        ).toEqual([{ assignment_artifact: artifact, assignment_renderer_version: 3 }]);
        await expect(insert(4)).rejects.toThrow('jobs_assignment_artifact_identity');
        await expect(insert(null)).rejects.toThrow('jobs_assignment_artifact_identity');
        await expect(insert(3, { ...artifact, schemaVersion: 2 })).rejects.toThrow(
          'jobs_assignment_artifact_identity',
        );
        await expect(pool.query('UPDATE jobs SET assignment_renderer_version=2')).rejects.toThrow(
          'Frozen assignment',
        );
      });
    },
    testTimeout,
  );

  it(
    '0063 admits native renderer 2 while retaining historical jobs and frozen typed identity',
    async () => {
      await withAdminClient(async (pool) => {
        // Exercise the real cutover SQL against only the columns owned by its constraint.
        await pool.query(`
        CREATE TABLE drafts (storage_uri text, working_version integer, content_hash text);
        CREATE TABLE jobs (id text PRIMARY KEY, prompt_package_id text, draft_id text);
      `);
        await pool.query(
          await fs.readFile(path.join(migrationsPath, '0062_assignment_v1_authority.sql'), 'utf8'),
        );
        const artifact = {
          format: 'assignment_v1',
          schemaVersion: 1,
          serializationVersion: 1,
          workingVersion: 1,
          contentHash: 'a'.repeat(64),
          storageUri: `local://drafts/d/content/${'a'.repeat(64)}.json`,
        };
        const insert = (id: string, renderer: number | null, value: unknown = artifact) =>
          pool.query(
            `INSERT INTO jobs (id, prompt_package_id, draft_id, assignment_artifact, assignment_renderer_version)
          VALUES ($1, 'prompt', 'draft', $2::jsonb, $3)`,
            [id, value === null ? null : JSON.stringify(value), renderer],
          );
        await insert('markdown', null, null);
        await insert('historical', 1);
        const before = (await pool.query('SELECT * FROM jobs ORDER BY id')).rows;
        await expect(insert('native-before', 2)).rejects.toThrow(
          'jobs_assignment_artifact_identity',
        );
        await pool.query(
          await fs.readFile(
            path.join(migrationsPath, '0063_assignment_native_renderer.sql'),
            'utf8',
          ),
        );
        expect((await pool.query('SELECT * FROM jobs ORDER BY id')).rows).toEqual(before);
        await insert('native', 2);
        await expect(insert('unsupported', 3)).rejects.toThrow('jobs_assignment_artifact_identity');
        await expect(insert('missing-version', null)).rejects.toThrow(
          'jobs_assignment_artifact_identity',
        );
        await expect(insert('incomplete', 2, { ...artifact, contentHash: null })).rejects.toThrow(
          'jobs_assignment_artifact_identity',
        );
        await expect(
          pool.query("UPDATE jobs SET assignment_renderer_version = 2 WHERE id = 'historical'"),
        ).rejects.toThrow('Frozen assignment');
        await expect(
          pool.query(
            "UPDATE jobs SET assignment_artifact = NULL, assignment_renderer_version = NULL WHERE id = 'native'",
          ),
        ).rejects.toThrow('Frozen assignment');
      });
    },
    testTimeout,
  );

  it(
    '0062 preserves legacy reads and freezes typed authority without a lossy rollback conversion',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0061_ordinary_memory_replay');
        const recordingId = randomUUID(),
          transcriptId = randomUUID(),
          promptId = randomUUID(),
          legacyId = randomUUID(),
          typedId = randomUUID();
        const workspaceId = randomUUID(),
          studentId = randomUUID();
        await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Typed migration')`, [
          workspaceId,
        ]);
        await pool.query(
          `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Migration learner', $2)`,
          [studentId, workspaceId],
        );
        await pool.query(
          `INSERT INTO recordings (id, student_id, source, storage_uri, bytes, status) VALUES ($1, $2, 'upload', 'local://test.mp3', 1, 'transcribed')`,
          [recordingId, studentId],
        );
        await pool.query(
          `INSERT INTO transcripts (id, recording_id, storage_uri, stt_provider, mode, model, language, fallback_used) VALUES ($1, $2, 'local://test.txt', 'deepgram', 'timeline', 'nova-3', 'auto', false)`,
          [transcriptId, recordingId],
        );
        await pool.query(
          `INSERT INTO prompt_packages (id, recording_id, transcript_id, template_version, storage_uri) VALUES ($1, $2, $3, 'legacy', 'local://prompt.txt')`,
          [promptId, recordingId, transcriptId],
        );
        await pool.query(
          `INSERT INTO drafts (id, prompt_package_id, storage_uri, working_version, content_hash) VALUES ($1, $2, 'local://legacy.md', 1, repeat('b', 64))`,
          [legacyId, promptId],
        );
        await pool.query(
          await fs.readFile(path.join(migrationsPath, '0062_assignment_v1_authority.sql'), 'utf8'),
        );
        expect(
          (await pool.query(`SELECT format, storage_uri FROM drafts WHERE id = $1`, [legacyId]))
            .rows[0],
        ).toEqual({ format: 'markdown', storage_uri: 'local://legacy.md' });
        const hash = 'a'.repeat(64);
        const uri = `local://drafts/${typedId}/content/${hash}.json`;
        await pool.query(
          `INSERT INTO drafts (id, prompt_package_id, format, storage_uri, working_version, content_hash) VALUES ($1, $2, 'assignment_v1', $3, 1, $4)`,
          [typedId, promptId, uri, hash],
        );
        await expect(
          pool.query(`UPDATE drafts SET format = 'markdown' WHERE id = $1`, [typedId]),
        ).rejects.toThrow('authority format');
        const artifact = {
          format: 'assignment_v1',
          schemaVersion: 1,
          serializationVersion: 1,
          workingVersion: 1,
          storageUri: uri,
          contentHash: hash,
        };
        const jobId = randomUUID();
        await pool.query(
          `INSERT INTO jobs (id, state, prompt_package_id, draft_id, assignment_artifact, assignment_renderer_version) VALUES ($1, 'queued', $2, $3, $4::jsonb, 1)`,
          [jobId, promptId, typedId, JSON.stringify(artifact)],
        );
        await expect(
          pool.query(
            `UPDATE jobs SET assignment_artifact = NULL, assignment_renderer_version = NULL WHERE id = $1`,
            [jobId],
          ),
        ).rejects.toThrow('Frozen assignment');
        await expect(
          pool.query(
            `INSERT INTO jobs (id, state, prompt_package_id, draft_id, assignment_artifact, assignment_renderer_version) VALUES ($1, 'queued', $2, $3, $4::jsonb, 1)`,
            [randomUUID(), promptId, typedId, JSON.stringify({ ...artifact, contentHash: null })],
          ),
        ).rejects.toThrow('jobs_assignment_artifact_identity');
      });
    },
    testTimeout,
  );

  it(
    '0060 preserves user-owned settings and refuses undisposed legacy tokens',
    async () => {
      const userId = randomUUID();
      const settingsId = randomUUID();
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0059_student_owned_profile_revisions');
        await pool.query(
          `INSERT INTO users (id, email, password_hash) VALUES ($1, 'settings@example.com', 'fixture')`,
          [userId],
        );
        await pool.query(
          `INSERT INTO user_settings
         (id, user_id, elevenlabs_key_encrypted, notion_token_encrypted, tts_provider,
          default_preset, default_voice_accent, default_tts_strategy, enable_notifications,
          created_at, updated_at)
         VALUES ($1, $2, 'fixture-ciphertext', 'fixture-legacy-token', 'inworld',
                 'b2-intermediate', 'british', 'dialogue', FALSE,
                 '2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z')`,
          [settingsId, userId],
        );
      });
      await expect(runMigrations()).rejects.toThrow('legacy values require private export');
      await withAdminClient(async (pool) => {
        const before = await pool.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
        expect(before.rows[0].id).toBe(settingsId);
        expect(before.rows[0].notion_token_encrypted).toBe('fixture-legacy-token');
        const ledger = await pool.query(
          "SELECT 1 FROM schema_migrations WHERE id = '0060_user_settings_owner_key'",
        );
        expect(ledger.rowCount).toBe(0);
        // Empty stored values also require disposition; do not silently discard them.
        await pool.query(
          "UPDATE user_settings SET notion_token_encrypted = '' WHERE user_id = $1",
          [userId],
        );
      });
      await expect(runMigrations()).rejects.toThrow('legacy values require private export');
      await withAdminClient(async (pool) => {
        await pool.query(
          'UPDATE user_settings SET notion_token_encrypted = NULL WHERE user_id = $1',
          [userId],
        );
        // Capture after disposition because the existing update trigger advances updated_at.
        const before = await pool.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
        const { id: _id, notion_token_encrypted: _token, ...retained } = before.rows[0];
        await runMigrations();
        const after = await pool.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
        expect(after.rows).toEqual([retained]);
        const pk = await pool.query(
          "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'user_settings'::regclass AND contype = 'p'",
        );
        expect(pk.rows).toEqual([{ definition: 'PRIMARY KEY (user_id)' }]);
        await expect(
          pool.query('INSERT INTO user_settings (user_id) VALUES ($1)', [userId]),
        ).rejects.toMatchObject({ code: '23505' });
        await expect(
          pool.query('INSERT INTO user_settings (user_id) VALUES ($1)', [randomUUID()]),
        ).rejects.toMatchObject({ code: '23503' });
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        expect(
          (await pool.query('SELECT 1 FROM user_settings WHERE user_id = $1', [userId])).rowCount,
        ).toBe(0);
      });
      await assertSchemaHealthy('settings-owner-key');
    },
    testTimeout,
  );

  it(
    'fresh bootstrap applies all migrations and verifies cleanly',
    async () => {
      await runMigrations();
      await assertSchemaHealthy('fresh-bootstrap');
    },
    testTimeout,
  );

  it(
    '0059 copies shared and historical histories per student, freezes unbound state, and preserves recorded lineage',
    async () => {
      const a = randomUUID(),
        b = randomUUID(),
        wa = randomUUID(),
        wb = randomUUID();
      const v1 = randomUUID(),
        v2 = randomUUID(),
        old = randomUUID(),
        orphan = randomUUID();
      const candidate = randomUUID(),
        recording = randomUUID(),
        transcript = randomUUID(),
        pkg = randomUUID();
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0058_mcp_oauth_foundation');
        await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1,'A'),($2,'B')`, [wa, wb]);
        await pool.query(
          `INSERT INTO profiles (id,label,provenance) VALUES ('shared.md','Shared','tutor_only'),('old.md','Old','unknown'),('orphan.md','Unbound','unknown')`,
        );
        await pool.query(
          `INSERT INTO students (id,student,workspace_id,profile_id) VALUES ($1,'A',$2,'shared.md'),($3,'B',$4,'shared.md')`,
          [a, wa, b, wb],
        );
        await pool.query(
          `INSERT INTO profile_revisions (id,profile_id,content,structured_content,content_hash,source,status,version_number,version_label,created_at,activated_at,restored_from_revision_id) VALUES
        ($1,'shared.md','Original','{"overallLevel":"B1"}',repeat('a',64),'create','deprecated',1,'v1','2025-01-01','2025-01-01',NULL),
        ($2,'shared.md','Original restored','{"overallLevel":"B1"}',repeat('b',64),'restore','active',2,'v2','2025-01-02','2025-01-02',$1),
        ($3,'old.md','Old tutor history',NULL,repeat('c',64),'update','active',1,'v1','2024-01-01','2024-01-01',NULL),
        ($4,'orphan.md','Unbound meaningful text',NULL,repeat('d',64),'create','active',1,'v1','2023-01-01','2023-01-01',NULL)`,
          [v1, v2, old, orphan],
        );
        await pool.query(
          `UPDATE profiles SET active_revision_id = CASE id WHEN 'shared.md' THEN $1::uuid WHEN 'old.md' THEN $2::uuid ELSE $3::uuid END`,
          [v2, old, orphan],
        );
        await pool.query(
          `INSERT INTO student_profile_bindings (id,student_id,profile_id,effective_from,effective_to) VALUES ($1,$2,'old.md','2024-01-01','2025-01-01')`,
          [randomUUID(), a],
        );
        await pool.query(
          `INSERT INTO student_profile_candidates (id,student_id,target_section,candidate_key,fact,category,authority,confidence,review_needed,status,promoted_revision_id) VALUES ($1,$2,'goals_motivation','goal:test','Goal','goal','student_stated','high',false,'promoted',$3)`,
          [candidate, a, old],
        );
        await pool.query(
          `INSERT INTO student_profile_candidate_draft_revisions (candidate_id,revision_id) VALUES ($1,$2)`,
          [candidate, old],
        );
        await pool.query(
          `INSERT INTO recordings (id,source,workspace_id,student_id,storage_uri,bytes,status) VALUES ($1,'upload',$2,$3,'s3://fixture/audio',10,'queued')`,
          [recording, wb, b],
        );
        await pool.query(
          `INSERT INTO transcripts (id,recording_id,storage_uri,mode,model,language,fallback_used) VALUES ($1,$2,'s3://fixture/text','timeline','fixture','en',false)`,
          [transcript, recording],
        );
        await pool.query(
          `INSERT INTO prompt_packages (id,recording_id,transcript_id,student_id,template_version,storage_uri,resolved_profile_id,resolved_profile_revision_id,resolved_profile_version_label,resolved_profile_hash) VALUES ($1,$2,$3,$4,'template.md','s3://fixture/pkg','shared.md',$5,'v1',repeat('a',64))`,
          [pkg, recording, transcript, b, v1],
        );
      });
      await runMigrations();
      await withAdminClient(async (pool) => {
        const revisions = await pool.query(
          `SELECT * FROM student_profile_revisions ORDER BY student_id,version_number`,
        );
        const ar = revisions.rows.filter((r) => r.student_id === a),
          br = revisions.rows.filter((r) => r.student_id === b);
        expect(ar).toHaveLength(3);
        expect(br).toHaveLength(2);
        expect(ar.map((r) => r.version_number)).toEqual([1, 2, 3]);
        for (const studentRows of [ar, br]) {
          const first = studentRows.find((r) => r.legacy_revision_id === v1),
            restored = studentRows.find((r) => r.legacy_revision_id === v2);
          expect(restored).toMatchObject({
            status: 'active',
            restored_from_revision_id: first.id,
            content: 'Original restored',
            content_hash: 'b'.repeat(64),
          });
          expect(first.structured_content).toEqual({ overallLevel: 'B1' });
        }
        expect(ar.find((r) => r.legacy_revision_id === v1).id).not.toBe(
          br.find((r) => r.legacy_revision_id === v1).id,
        );
        expect(ar.find((r) => r.legacy_revision_id === old).status).toBe('deprecated');
        expect(revisions.rows.some((r) => r.legacy_revision_id === orphan)).toBe(false);
        const archived = await pool.query(
          `SELECT content FROM legacy_profile_revisions WHERE id = $1`,
          [orphan],
        );
        expect(archived.rows[0].content).toBe('Unbound meaningful text');
        const historical = await pool.query(
          `SELECT resolved_profile_id,resolved_profile_revision_id,resolved_profile_version_label,resolved_profile_hash FROM prompt_packages WHERE id = $1`,
          [pkg],
        );
        expect(historical.rows[0]).toEqual({
          resolved_profile_id: 'shared.md',
          resolved_profile_revision_id: v1,
          resolved_profile_version_label: 'v1',
          resolved_profile_hash: 'a'.repeat(64),
        });
        const promoted = await pool.query(
          `SELECT promoted_revision_id FROM student_profile_candidates WHERE id = $1`,
          [candidate],
        );
        expect(promoted.rows[0].promoted_revision_id).toBe(
          ar.find((r) => r.legacy_revision_id === old).id,
        );
        const links = await pool.query(
          `SELECT student_id,revision_id FROM student_profile_candidate_draft_revisions WHERE candidate_id = $1`,
          [candidate],
        );
        expect(links.rows[0]).toEqual({
          student_id: a,
          revision_id: promoted.rows[0].promoted_revision_id,
        });
        await expect(
          pool.query(
            `UPDATE student_profile_candidates SET promoted_revision_id = $2 WHERE id = $1`,
            [candidate, br[0].id],
          ),
        ).rejects.toMatchObject({ code: '23503' });
        for (const table of [
          'legacy_profiles',
          'legacy_profile_revisions',
          'legacy_student_profile_bindings',
        ])
          await expect(pool.query(`UPDATE ${table} SET created_at = created_at`)).rejects.toThrow(
            'Legacy profile storage is frozen',
          );
        const columns = await pool.query(
          `SELECT table_name,column_name FROM information_schema.columns WHERE table_name='students' AND column_name='profile_id'`,
        );
        expect(columns.rows).toEqual([]);
      });
      await assertSchemaHealthy('student-owned-profile-cutover');
      const recordedA = await getRecordedProfileRevision(a, v1, 'a'.repeat(64));
      const recordedB = await getRecordedProfileRevision(b, v1, 'a'.repeat(64));
      expect(recordedA?.studentId).toBe(a);
      expect(recordedB?.studentId).toBe(b);
      expect(recordedA?.id).not.toBe(recordedB?.id);
      expect(await getRecordedProfileRevision(a, v1, 'incorrect-hash')).toBeNull();
      expect(await getRecordedProfileRevision(randomUUID(), v1, 'a'.repeat(64))).toBeNull();
      expect(await getProfileRevisionById(a, v1)).toBeNull();
    },
    testTimeout,
  );

  it.each(['succeeded', 'queued'] as const)(
    '0059 preserves historical enrichment successes and rejects conflicting live operations: %s',
    async (state) => {
      const student = randomUUID(),
        user = randomUUID(),
        session = randomUUID();
      const recording = randomUUID(),
        transcript = randomUUID();
      const revisions = [randomUUID(), randomUUID()] as const;
      const operations = [randomUUID(), randomUUID()];
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0058_mcp_oauth_foundation');
        await pool.query(`INSERT INTO users (id,email,password_hash) VALUES ($1,$2,'fixture')`, [
          user,
          `${user}@example.test`,
        ]);
        await pool.query(
          `INSERT INTO profiles (id,label) VALUES ('one.md','One'),('two.md','Two')`,
        );
        await pool.query(
          `INSERT INTO students (id,student,workspace_id,profile_id) VALUES ($1,'Owner','00000000-0000-4000-8000-000000000001','two.md')`,
          [student],
        );
        for (let i = 0; i < 2; i++) {
          await pool.query(
            `INSERT INTO profile_revisions (id,profile_id,content,content_hash,source,status,version_number,version_label) VALUES ($1,$2,'Historical content',repeat('a',64),'create','active',1,'v1')`,
            [revisions[i], i === 0 ? 'one.md' : 'two.md'],
          );
        }
        await pool.query(
          `INSERT INTO recordings (id,source,student_id,workspace_id,storage_uri,bytes,status) VALUES ($1,'upload',$2,'00000000-0000-4000-8000-000000000001','s3://fixture/audio',10,'queued')`,
          [recording, student],
        );
        await pool.query(
          `INSERT INTO transcripts (id,recording_id,storage_uri,mode,model,language,fallback_used) VALUES ($1,$2,'s3://fixture/text','timeline','fixture','en',false)`,
          [transcript, recording],
        );
        const snapshot = {
          student: { studentId: student },
          source: null,
          context: { profileRevisionId: revisions[0], profileRevisionHash: 'a'.repeat(64) },
          create: null,
        };
        await pool.query(
          `INSERT INTO assignment_sessions (id,user_id,student_id,confirmed_step,confirmed_snapshot) VALUES ($1,$2,$3,'context',$4)`,
          [session, user, student, JSON.stringify(snapshot)],
        );
        for (let i = 0; i < 2; i++) {
          await pool.query(
            `INSERT INTO profile_initial_enrichment_operations (id,profile_id,student_id,assignment_session_id,recording_id,transcript_id,transcript_storage_uri,transcript_hash,source_identity_kind,source_fingerprint_scheme,source_fingerprint,state,seed_revision_id,seed_revision_hash,result_revision_id) VALUES ($1,$2,$3,$4,$5,$6,'s3://fixture/text',repeat('a',64),'audio','prepared-media-sha256-v1',repeat('b',64),$7,$8,repeat('a',64),$8)`,
            [
              operations[i],
              i === 0 ? 'one.md' : 'two.md',
              student,
              session,
              recording,
              transcript,
              state,
              revisions[i],
            ],
          );
        }
      });
      if (state === 'queued') {
        await expect(runMigrations()).rejects.toThrow();
        await withAdminClient(async (pool) => {
          expect(
            (
              await pool.query(
                `SELECT to_regclass('profiles') AS old, to_regclass('student_profile_revisions') AS current`,
              )
            ).rows[0],
          ).toEqual({ old: 'profiles', current: null });
          expect(
            (
              await pool.query(
                `SELECT COUNT(*)::int AS count FROM profile_initial_enrichment_operations`,
              )
            ).rows[0].count,
          ).toBe(2);
        });
        return;
      }
      await runMigrations();
      await withAdminClient(async (pool) => {
        const preserved = await pool.query(
          `SELECT op.id,op.legacy_profile_id,op.state,r.legacy_revision_id FROM profile_initial_enrichment_operations op JOIN student_profile_revisions r ON r.id=op.result_revision_id AND r.student_id=op.student_id ORDER BY op.legacy_profile_id`,
        );
        expect(preserved.rows).toEqual(
          operations.map((id, i) => ({
            id,
            legacy_profile_id: i === 0 ? 'one.md' : 'two.md',
            state,
            legacy_revision_id: revisions[i],
          })),
        );
        const frozen = await pool.query(
          `SELECT confirmed_snapshot FROM assignment_sessions WHERE id=$1`,
          [session],
        );
        expect(frozen.rows[0].confirmed_snapshot.context.profileRevisionId).toBe(revisions[0]);
      });
      expect(
        (await getRecordedProfileRevision(student, revisions[0], 'a'.repeat(64)))?.studentId,
      ).toBe(student);
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
        await expect(
          pool.query(`DELETE FROM students WHERE id = $1`, [studentId]),
        ).rejects.toThrow();
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
    '0050 adds a nullable preparation identity without inventing one for historical recordings',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0049_recording_ingest_readiness');
        const workspaceId = '10000000-0000-4000-8000-000000000050';
        const studentId = '20000000-0000-4000-8000-000000000050';
        await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Tutor C')`, [workspaceId]);
        await pool.query(
          `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Alex', $2)`,
          [studentId, workspaceId],
        );
        await pool.query(
          await fs.readFile(
            path.join(migrationsPath, '0050_recording_media_preparation_version.sql'),
            'utf8',
          ),
        );
        await pool.query(
          `INSERT INTO recordings
             (id, workspace_id, source, student_id, storage_uri, audio_lifecycle, bytes, status,
              media_preparation_version)
           VALUES
             ('30000000-0000-4000-8000-000000000050', $1, 'upload', $2,
              's3://audio/historical.opus', 'retained', 10, 'failed', NULL),
             ('30000000-0000-4000-8000-000000000051', $1, 'upload', $2,
              's3://audio/prepared.opus', 'retained', 10, 'queued', 'recording-media-v1')`,
          [workspaceId, studentId],
        );

        const rows = await pool.query(
          `SELECT media_preparation_version FROM recordings ORDER BY id ASC`,
        );
        expect(rows.rows.map((row) => row.media_preparation_version)).toEqual([
          null,
          'recording-media-v1',
        ]);
      });
    },
    testTimeout,
  );

  it(
    '0053 makes historical Source-confirmed retained audio unavailable without a replay',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0052_recording_upload_candidate_cleanup_schedule');
        const userId = '00000000-0000-4000-8000-000000000053';
        const workspaceId = '10000000-0000-4000-8000-000000000053';
        const studentId = '20000000-0000-4000-8000-000000000053';
        const confirmedRecordingId = '30000000-0000-4000-8000-000000000053';
        const unconfirmedRecordingId = '30000000-0000-4000-8000-000000000054';
        const rollingDeployRecordingId = '30000000-0000-4000-8000-000000000055';
        await pool.query(
          `INSERT INTO users (id, email, password_hash, role)
           VALUES ($1, 'cleanup-migration@example.test', 'hash', 'user')`,
          [userId],
        );
        await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Cleanup migration')`, [
          workspaceId,
        ]);
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [workspaceId, userId],
        );
        await pool.query(
          `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Alex', $2)`,
          [studentId, workspaceId],
        );
        await pool.query(
          `INSERT INTO recordings
             (id, workspace_id, source, student_id, storage_uri, audio_lifecycle, bytes, status)
           VALUES
             ($1, $3, 'upload', $4, $5, 'retained', 10, 'transcribed'),
             ($2, $3, 'upload', $4, $6, 'retained', 10, 'transcribed')`,
          [
            confirmedRecordingId,
            unconfirmedRecordingId,
            workspaceId,
            studentId,
            `local://recordings/${confirmedRecordingId}.mp3`,
            `local://recordings/${unconfirmedRecordingId}.mp3`,
          ],
        );
        await pool.query(
          `INSERT INTO assignment_sessions
             (id, user_id, student_id, recording_id, revision, confirmed_step, confirmed_snapshot)
           VALUES (gen_random_uuid(), $1, $2, $3, 1, 'source', $4::jsonb)`,
          [
            userId,
            studentId,
            confirmedRecordingId,
            JSON.stringify({
              student: { studentId },
              source: { recordingId: confirmedRecordingId },
              context: null,
              create: null,
            }),
          ],
        );

        await pool.query(
          await fs.readFile(
            path.join(migrationsPath, '0053_recording_audio_cleanup_backfill.sql'),
            'utf8',
          ),
        );
        await pool.query(
          `INSERT INTO recordings
             (id, workspace_id, source, student_id, storage_uri, audio_lifecycle, bytes, status)
           VALUES ($1, $2, 'upload', $3, $4, 'retained', 10, 'transcribed')`,
          [
            rollingDeployRecordingId,
            workspaceId,
            studentId,
            `local://recordings/${rollingDeployRecordingId}.mp3`,
          ],
        );
        await pool.query(
          `INSERT INTO assignment_sessions
             (id, user_id, student_id, recording_id, revision, confirmed_step, confirmed_snapshot)
           VALUES (gen_random_uuid(), $1, $2, $3, 1, 'source', $4::jsonb)`,
          [
            userId,
            studentId,
            rollingDeployRecordingId,
            JSON.stringify({
              student: { studentId },
              source: { recordingId: rollingDeployRecordingId },
              context: null,
              create: null,
            }),
          ],
        );

        const rows = await pool.query(
          `SELECT id, audio_lifecycle, audio_deletion_requested_at
           FROM recordings WHERE id IN ($1, $2, $3) ORDER BY id`,
          [confirmedRecordingId, unconfirmedRecordingId, rollingDeployRecordingId],
        );
        expect(rows.rows).toEqual([
          {
            id: confirmedRecordingId,
            audio_lifecycle: 'pending',
            audio_deletion_requested_at: expect.any(Date),
          },
          {
            id: unconfirmedRecordingId,
            audio_lifecycle: 'retained',
            audio_deletion_requested_at: null,
          },
          {
            id: rollingDeployRecordingId,
            audio_lifecycle: 'pending',
            audio_deletion_requested_at: expect.any(Date),
          },
        ]);
      });
    },
    testTimeout,
  );

  it(
    '0054 deterministically assigns duplicate historical sources and audits the loser',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0053_recording_audio_cleanup_backfill');
        const userId = '00000000-0000-4000-8000-000000000054';
        const workspaceId = '10000000-0000-4000-8000-000000000054';
        const studentId = '20000000-0000-4000-8000-000000000054';
        const winnerSessionId = '40000000-0000-4000-8000-000000000054';
        const loserSessionId = '40000000-0000-4000-8000-000000000055';
        const winnerRecordingId = '30000000-0000-4000-8000-000000000056';
        const loserRecordingId = '30000000-0000-4000-8000-000000000057';
        const winnerTranscriptId = '50000000-0000-4000-8000-000000000054';
        const loserTranscriptId = '50000000-0000-4000-8000-000000000055';
        const fingerprint = 'f'.repeat(64);
        await pool.query(
          `INSERT INTO users (id, email, password_hash, role)
           VALUES ($1, 'source-cutover@example.test', 'hash', 'user')`,
          [userId],
        );
        await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Source cutover')`, [
          workspaceId,
        ]);
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [workspaceId, userId],
        );
        await pool.query(
          `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Ari', $2)`,
          [studentId, workspaceId],
        );
        await pool.query(
          `INSERT INTO recordings (
             id, workspace_id, source, student_id, storage_uri, audio_lifecycle,
             sha256, bytes, status
           ) VALUES
             ($1, $3, 'upload', $4, $5, 'retained', $7, 10, 'transcribed'),
             ($2, $3, 'upload', $4, $6, 'retained', $7, 10, 'transcribed')`,
          [
            winnerRecordingId,
            loserRecordingId,
            workspaceId,
            studentId,
            `local://recordings/${winnerRecordingId}.mp3`,
            `local://recordings/${loserRecordingId}.mp3`,
            fingerprint,
          ],
        );
        await pool.query(
          `INSERT INTO transcripts (
             id, recording_id, storage_uri, working_version, content_hash, stt_provider,
             mode, model, language, fallback_used
           ) VALUES
             ($1, $3, $5, 1, $7, 'deepgram', 'timeline', 'nova-3', 'multi', false),
             ($2, $4, $6, 1, $7, 'deepgram', 'timeline', 'nova-3', 'multi', false)`,
          [
            winnerTranscriptId,
            loserTranscriptId,
            winnerRecordingId,
            loserRecordingId,
            `local://transcripts/${winnerTranscriptId}.txt`,
            `local://transcripts/${loserTranscriptId}.txt`,
            'a'.repeat(64),
          ],
        );
        const snapshot = (recordingId: string, transcriptId: string, storageUri: string) =>
          JSON.stringify({
            student: { studentId },
            source: {
              lessonId: null,
              recordingId,
              transcriptId,
              transcriptWorkingVersion: 1,
              transcriptStorageUri: storageUri,
              transcriptHash: 'a'.repeat(64),
            },
            context: null,
            create: null,
          });
        await pool.query(
          `INSERT INTO assignment_sessions (
             id, user_id, student_id, recording_id, transcript_id, revision,
             confirmed_step, confirmed_snapshot, created_at, updated_at
           ) VALUES
             ($1, $3, $4, $5, $7, 2, 'source', $9::jsonb,
              '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
             ($2, $3, $4, $6, $8, 2, 'source', $10::jsonb,
              '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z')`,
          [
            winnerSessionId,
            loserSessionId,
            userId,
            studentId,
            winnerRecordingId,
            loserRecordingId,
            winnerTranscriptId,
            loserTranscriptId,
            snapshot(
              winnerRecordingId,
              winnerTranscriptId,
              `local://transcripts/${winnerTranscriptId}.txt`,
            ),
            snapshot(
              loserRecordingId,
              loserTranscriptId,
              `local://transcripts/${loserTranscriptId}.txt`,
            ),
          ],
        );

        const winnerPackageId = randomUUID();
        const loserPackageId = randomUUID();
        await pool.query(
          `INSERT INTO prompt_packages
             (id, recording_id, transcript_id, student_id, template_version, storage_uri)
           VALUES ($1, $3, $5, $7, 'test', 'local://prompt/winner'),
                  ($2, $4, $6, $7, 'test', 'local://prompt/loser')`,
          [
            winnerPackageId,
            loserPackageId,
            winnerRecordingId,
            loserRecordingId,
            winnerTranscriptId,
            loserTranscriptId,
            studentId,
          ],
        );
        await pool.query(
          `UPDATE assignment_sessions
           SET prompt_package_id = CASE id WHEN $1 THEN $3::uuid ELSE $4::uuid END
           WHERE id IN ($1, $2)`,
          [winnerSessionId, loserSessionId, winnerPackageId, loserPackageId],
        );

        await pool.query(
          await fs.readFile(
            path.join(migrationsPath, '0054_canonical_assignment_source_ownership.sql'),
            'utf8',
          ),
        );
        const binding = await pool.query(
          `SELECT assignment_session_id, source_fingerprint
           FROM assignment_source_bindings`,
        );
        expect(binding.rows).toEqual([
          { assignment_session_id: winnerSessionId, source_fingerprint: fingerprint },
        ]);
        const audit = await pool.query(
          `SELECT prior_assignment_session_id, canonical_assignment_session_id, reason
           FROM assignment_source_binding_audit`,
        );
        expect(audit.rows).toEqual([
          {
            prior_assignment_session_id: loserSessionId,
            canonical_assignment_session_id: winnerSessionId,
            reason: 'earliest_creation_tiebreak',
          },
        ]);
        await pool.query(
          await fs.readFile(
            path.join(migrationsPath, '0055_prompt_package_assignment_provenance.sql'),
            'utf8',
          ),
        );
        const provenance = await pool.query(
          `SELECT id, assignment_session_id FROM prompt_packages WHERE id IN ($1, $2) ORDER BY id`,
          [winnerPackageId, loserPackageId],
        );
        expect(provenance.rows).toEqual(
          [
            { id: winnerPackageId, assignment_session_id: winnerSessionId },
            { id: loserPackageId, assignment_session_id: loserSessionId },
          ].sort((left, right) => left.id.localeCompare(right.id)),
        );
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
        FROM legacy_profile_revisions
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
        workspace: randomUUID(),
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
          await pool.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Cutover fixture')`, [
            ids.workspace,
          ]);
          await pool.query(
            `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Alpha Tester', $2)`,
            [ids.student, ids.workspace],
          );
          await pool.query(
            `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Other Tester', $2)`,
            [ids.otherStudent, ids.workspace],
          );
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

        // Keep the historical cutover assertions at their original boundary, then
        // upgrade the fixture before exercising the current application reader.
        await runMigrations();
        await expect(
          resolveHomeworkMemorySourceFromSucceededJob(ids.rerunJob),
        ).rejects.toMatchObject({ code: 'legacy_assignment_read_only' });
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
  it(
    'sunsets historical Markdown only after quiescence and preserves evidence without conversion',
    async () => {
      await withAdminClient(async (pool) => {
        await applyMigrationsThrough(pool, '0063_assignment_native_renderer');
        const ids = Array.from({ length: 15 }, () => randomUUID());
        const [
          user,
          workspace,
          student,
          recording,
          transcript,
          prompt,
          draft,
          queued,
          running,
          published,
          session,
          batch,
          item,
          claim,
          typedDraft,
        ] = ids;
        const hash = 'a'.repeat(64);
        await pool.query(
          `INSERT INTO users(id,email,password_hash,role) VALUES($1,'sunset@example.test','hash','user')`,
          [user],
        );
        await pool.query(`INSERT INTO workspaces(id,name) VALUES($1,'sunset')`, [workspace]);
        await pool.query(
          `INSERT INTO students(id,student,workspace_id) VALUES($1,'Historical Student',$2)`,
          [student, workspace],
        );
        await pool.query(
          `INSERT INTO recordings(id,workspace_id,source,student_id,bytes,status,audio_lifecycle) VALUES($1,$2,'manual_transcript',$3,0,'transcribed','not_retained')`,
          [recording, workspace, student],
        );
        await pool.query(
          `INSERT INTO transcripts(id,recording_id,storage_uri,mode,model,language,stt_provider,fallback_used) VALUES($1,$2,'local://original/transcript.json','timeline','manual','en','manual',false)`,
          [transcript, recording],
        );
        await pool.query(
          `INSERT INTO prompt_packages(id,recording_id,transcript_id,student_id,template_version,storage_uri,request_envelope) VALUES($1,$2,$3,$4,'historical-revision','local://original/prompt.txt','{"promptVersion":"assignment_v1"}')`,
          [prompt, recording, transcript, student],
        );
        await pool.query(
          `INSERT INTO drafts(id,prompt_package_id,format,storage_uri,working_version,content_hash) VALUES($1,$2,'markdown','local://original/homework.md',1,$3),($4,$2,'assignment_v1',$5,1,$3)`,
          [draft, prompt, hash, typedDraft, `local://drafts/content/${hash}.json`],
        );
        await pool.query(
          `INSERT INTO jobs(id,state,student_id,md_storage_uri,html_url,manifest_path) VALUES($1,'queued',$4,'local://original/queued.md',NULL,NULL),($2,'running',$4,'local://original/running.md',NULL,NULL),($3,'succeeded',$4,'local://original/homework.md','https://example.test/retained.html','local://original/manifest.json')`,
          [queued, running, published, student],
        );
        await pool.query(
          `INSERT INTO assignment_sessions(id,user_id,student_id,draft_id,prompt_package_id,confirmed_snapshot,confirmed_step,revision) VALUES($1,$2,$3,$4,$5,$6,'student',1)`,
          [
            session,
            user,
            student,
            draft,
            prompt,
            { student: { studentId: student }, source: null, context: null, create: null },
          ],
        );
        const enrichment = randomUUID();
        await pool.query(
          `INSERT INTO profile_initial_enrichment_operations
          (id,student_id,assignment_session_id,recording_id,transcript_id,transcript_storage_uri,
          transcript_hash,source_identity_kind,source_fingerprint_scheme,source_fingerprint,state,
          generation_input,validated_result,result_hash)
          VALUES($1,$2,$3,$4,$5,'local://original/transcript.json',$6,'manual_transcript',
          'manual-transcript-text-v1',$6,'queued','{"prompt":"retained input"}','{"retained":"result"}',$6)`,
          [enrichment, student, session, recording, transcript, hash],
        );
        const memory = randomUUID(),
          action = randomUUID();
        await pool.query(
          `INSERT INTO homework_memory_entries(id,student_id,job_id,assignment_lineage_key,schema_version,generated_at,provider,model,status,published_at) VALUES($1,$2,$3,$3,'homework-memory.v1',NOW(),'openai','gpt-5.4-nano','pending',NOW())`,
          [memory, student, published],
        );
        await pool.query(
          `INSERT INTO job_action_history(id,job_id,action_type,requested_at,outcome,message,created_job_id) VALUES($1,$2,'rerun',NOW(),'succeeded','Queued before sunset',$3)`,
          [action, published, queued],
        );
        await pool.query(
          `INSERT INTO student_memory_openai_batch_runs(id,workload,model,input_jsonl_sha256,input_bytes,item_count) VALUES($1,'homework_memory','gpt-5.4-nano',$2,10,1)`,
          [batch, hash],
        );
        await pool.query(
          `INSERT INTO student_memory_openai_batch_items(id,run_id,student_id,workload,model,custom_id,canonical_scope_key,source_version_hash,request_envelope,response_schema_fingerprint,request_body,source_refs) VALUES($1,$2,$3,'homework_memory','gpt-5.4-nano','historical',$4,$5,'{}',$5,'{}',$6)`,
          [item, batch, student, published, hash, { jobId: published }],
        );
        await pool.query(
          `INSERT INTO student_memory_openai_batch_claims(id,item_id,workload,canonical_scope_key,source_version_hash) VALUES($1,$2,'homework_memory',$3,$4)`,
          [claim, item, published, hash],
        );
        await expect(runMigrations()).rejects.toThrow('quiesced legacy jobs');
        expect(
          (await pool.query(`SELECT state FROM jobs WHERE id=$1`, [queued])).rows[0].state,
        ).toBe('queued');
        await pool.query(`UPDATE jobs SET state='failed' WHERE id=$1`, [running]);
        await pool.query(
          `UPDATE student_memory_openai_batch_runs SET state='submitted',remote_batch_id='remote-history' WHERE id=$1`,
          [batch],
        );
        await expect(runMigrations()).rejects.toThrow(
          'completed or cancelled remote homework Batch',
        );
        await pool.query(
          `UPDATE student_memory_openai_batch_runs SET state='cancelled' WHERE id=$1`,
          [batch],
        );
        // Old cancellation code could assert cancelled before remote cancellation completed.
        await expect(runMigrations()).rejects.toThrow('fresh status poll');
        await recordStudentMemoryOpenAiBatchRemoteStatus({
          runId: batch!,
          remote: { id: 'remote-history', status: 'cancelling' },
        });
        await expect(runMigrations()).rejects.toThrow('fresh status poll');
        await recordStudentMemoryOpenAiBatchRemoteStatus({
          runId: batch!,
          remote: { id: 'remote-history', status: 'cancelled' },
        });
        for (const state of ['submitting', 'uncertain']) {
          await pool.query(
            'UPDATE profile_initial_enrichment_operations SET state=$2 WHERE id=$1',
            [enrichment, state],
          );
          await expect(runMigrations()).rejects.toThrow('quiesced profile enrichment submissions');
        }
        await pool.query(
          "UPDATE profile_initial_enrichment_operations SET state='result_ready' WHERE id=$1",
          [enrichment],
        );
        const enrichmentEvidence = (
          await pool.query(
            'SELECT generation_input,validated_result,result_hash FROM profile_initial_enrichment_operations WHERE id=$1',
            [enrichment],
          )
        ).rows[0];
        const evidence = (
          await pool.query(`SELECT md_storage_uri,html_url,manifest_path FROM jobs WHERE id=$1`, [
            published,
          ])
        ).rows[0];
        const snapshot = (
          await pool.query(`SELECT confirmed_snapshot FROM assignment_sessions WHERE id=$1`, [
            session,
          ])
        ).rows[0];
        await runMigrations();
        expect(
          (
            await pool.query(
              'SELECT state,failure_code,generation_input,validated_result,result_hash FROM profile_initial_enrichment_operations WHERE id=$1',
              [enrichment],
            )
          ).rows[0],
        ).toEqual({
          ...enrichmentEvidence,
          state: 'superseded',
          failure_code: 'legacy_assignment_read_only',
        });
        await expect(
          pool.query(
            "UPDATE profile_initial_enrichment_operations SET state='queued' WHERE id=$1",
            [enrichment],
          ),
        ).rejects.toThrow('legacy_assignment_read_only');

        expect(
          (
            await pool.query(`SELECT md_storage_uri,html_url,manifest_path FROM jobs WHERE id=$1`, [
              published,
            ])
          ).rows[0],
        ).toEqual(evidence);
        expect(
          (
            await pool.query(`SELECT confirmed_snapshot FROM assignment_sessions WHERE id=$1`, [
              session,
            ])
          ).rows[0],
        ).toEqual(snapshot);
        expect(
          (await pool.query(`SELECT state,error FROM jobs WHERE id=$1`, [queued])).rows[0],
        ).toEqual({ state: 'failed', error: 'legacy_assignment_read_only' });
        expect(
          (
            await pool.query(
              `SELECT status,generation_notes FROM homework_memory_entries WHERE id=$1`,
              [memory],
            )
          ).rows[0],
        ).toMatchObject({
          status: 'failed',
          generation_notes: { error: 'legacy_assignment_read_only' },
        });
        expect(
          (
            await pool.query(
              `SELECT state,claim_state,source_refs FROM student_memory_openai_batch_items WHERE id=$1`,
              [item],
            )
          ).rows[0],
        ).toEqual({
          state: 'terminal_failure',
          claim_state: 'terminal_failure',
          source_refs: { jobId: published },
        });
        expect(
          (
            await pool.query(`SELECT state FROM student_memory_openai_batch_claims WHERE id=$1`, [
              claim,
            ])
          ).rows[0].state,
        ).toBe('terminal_failure');
        expect(
          (
            await pool.query(
              `SELECT outcome,message,created_job_id FROM job_action_history WHERE id=$1`,
              [action],
            )
          ).rows[0],
        ).toEqual({
          outcome: 'succeeded',
          message: 'Queued before sunset',
          created_job_id: queued,
        });
        for (const [sql, id] of [
          [`UPDATE jobs SET state='queued' WHERE id=$1`, queued],
          [`UPDATE jobs SET html_url='https://example.test/replaced.html' WHERE id=$1`, published],
          [`UPDATE drafts SET storage_uri='local://replacement.md' WHERE id=$1`, draft],
          [
            `UPDATE assignment_sessions SET draft_id=NULL,prompt_package_id=NULL WHERE id=$1`,
            session,
          ],
          [
            `UPDATE student_memory_openai_batch_items SET state='retryable_failure' WHERE id=$1`,
            item,
          ],
        ])
          await expect(pool.query(sql!, [id])).rejects.toThrow('legacy_assignment_read_only');
        await expect(
          pool.query(`INSERT INTO jobs(id,state) VALUES($1,'queued')`, [randomUUID()]),
        ).rejects.toThrow('legacy_assignment_read_only');
        const artifact = {
          format: 'assignment_v1',
          schemaVersion: 1,
          serializationVersion: 1,
          workingVersion: 1,
          contentHash: hash,
          storageUri: `local://drafts/content/${hash}.json`,
        };
        const typed = randomUUID();
        await pool.query(
          `INSERT INTO jobs(id,state,prompt_package_id,draft_id,assignment_artifact,assignment_renderer_version) VALUES($1,'queued',$2,$3,$4,2)`,
          [typed, prompt, typedDraft, artifact],
        );
        await pool.query(`UPDATE jobs SET state='running' WHERE id=$1`, [typed]);
        expect(
          (await pool.query(`SELECT state,assignment_artifact FROM jobs WHERE id=$1`, [typed]))
            .rows[0],
        ).toEqual({ state: 'running', assignment_artifact: artifact });
        expect(
          (
            await pool.query(
              `SELECT template_version,storage_uri FROM prompt_packages WHERE id=$1`,
              [prompt],
            )
          ).rows[0],
        ).toEqual({
          template_version: 'historical-revision',
          storage_uri: 'local://original/prompt.txt',
        });
        await expect(resolveHomeworkMemorySourceFromSucceededJob(published!)).rejects.toMatchObject(
          { code: 'legacy_assignment_read_only' },
        );
      });
    },
    testTimeout,
  );
});
