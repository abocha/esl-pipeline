import './support/bootstrap-pg-test-env.js';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closePgPool, withPgClient, withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv, resolveTestTimeout, writeTestArtifact } from './support/test-env.js';

requirePgTestEnv();
const testTimeout = resolveTestTimeout(120_000);

const TARGET_STUDENT_ID = 'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const OTHER_STUDENT_ID = 'bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const THIRD_STUDENT_ID = 'ccccccc3-cccc-4ccc-8ccc-ccccccccccc3';
const TARGET_USER_ID = 'ddddddd4-dddd-4ddd-8ddd-ddddddddddd4';
const OTHER_USER_ID = 'eeeeeee5-eeee-4eee-8eee-eeeeeeeeeee5';
const TARGET_RECORDING_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_TRANSCRIPT_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_HOMEWORK_JOB_ID = '33333333-3333-4333-8333-333333333333';

interface ExplainPlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: ExplainPlanNode[];
}

interface ExplainPlanResult {
  Plan: ExplainPlanNode;
}

function collectIndexNames(node: ExplainPlanNode, found: Set<string>): void {
  const indexName = node['Index Name'];
  if (typeof indexName === 'string' && indexName.length > 0) {
    found.add(indexName);
  }
  for (const child of node.Plans ?? []) {
    collectIndexNames(child, found);
  }
}

function hasSeqScanOnRelation(node: ExplainPlanNode, relationName: string): boolean {
  if (node['Node Type'] === 'Seq Scan' && node['Relation Name'] === relationName) {
    return true;
  }
  return (node.Plans ?? []).some((child) => hasSeqScanOnRelation(child, relationName));
}

async function explainQuery(
  scenario: string,
  sql: string,
  values: (string | Date | string[])[],
): Promise<ExplainPlanResult> {
  const result = await withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL enable_seqscan = off');
      await client.query('SET LOCAL enable_indexscan = on');
      await client.query('SET LOCAL enable_bitmapscan = on');
      await client.query('SET LOCAL enable_sort = off');
      const explainResult = await client.query(`EXPLAIN (FORMAT JSON, COSTS FALSE) ${sql}`, values);
      await client.query('COMMIT');
      return explainResult.rows[0] as Record<string, unknown>;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  const planArray = result['QUERY PLAN'] as ExplainPlanResult[] | undefined;
  const plan = planArray?.[0];
  if (!plan) {
    throw new Error(`EXPLAIN returned no plan for scenario "${scenario}"`);
  }
  await writeTestArtifact(`query-plan-${scenario}.json`, plan);
  return plan;
}

async function seedJobsForPlanChecks(): Promise<void> {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      'TRUNCATE TABLE users, students, job_action_history, jobs, recordings, transcripts, lesson_memory_entries, homework_memory_entries, student_profile_candidates RESTART IDENTITY CASCADE',
    );
    await client.query(
      `
      INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
      VALUES
        ($1, 'plan-user-target@example.com', 'hash', 'user', TRUE, NOW(), NOW()),
        ($2, 'plan-user-other@example.com', 'hash', 'user', TRUE, NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
      `,
      [TARGET_USER_ID, OTHER_USER_ID],
    );
    await client.query(
      `
      INSERT INTO students (id, student, created_at, updated_at)
      VALUES
        ($1, 'Plan Target', NOW(), NOW()),
        ($2, 'Plan Other', NOW(), NOW()),
        ($3, 'Plan Third', NOW(), NOW())
      ON CONFLICT (id) DO NOTHING
      `,
      [TARGET_STUDENT_ID, OTHER_STUDENT_ID, THIRD_STUDENT_ID],
    );
    await client.query(
      `
      INSERT INTO jobs (
        id,
        state,
        md,
        student_id,
        user_id,
        publish_target,
        created_at,
        updated_at,
        finished_at
      )
      SELECT
        uuid_generate_v4(),
        CASE
          WHEN gs % 7 = 0 THEN 'failed'
          WHEN gs % 3 = 0 THEN 'succeeded'
          ELSE 'queued'
        END,
        'fixtures/plan-seed.md',
        CASE
          WHEN gs <= 120 THEN $1::uuid
          WHEN gs % 2 = 0 THEN $2::uuid
          ELSE $3::uuid
        END,
        CASE
          WHEN gs <= 120 THEN $4::uuid
          ELSE $5::uuid
        END,
        CASE
          WHEN gs % 5 = 0 THEN NULL
          ELSE 'html'
        END,
        NOW() - ((gs + 10)::text || ' minutes')::interval,
        NOW() - (gs::text || ' minutes')::interval,
        CASE
          WHEN gs % 3 = 0 OR gs % 7 = 0
            THEN NOW() - ((gs - 1)::text || ' minutes')::interval
          ELSE NULL
        END
      FROM generate_series(1, 6000) AS gs
      `,
      [TARGET_STUDENT_ID, OTHER_STUDENT_ID, THIRD_STUDENT_ID, TARGET_USER_ID, OTHER_USER_ID],
    );
    await client.query(
      `
      INSERT INTO jobs (
        id,
        state,
        md,
        student_id,
        user_id,
        publish_target,
        created_at,
        updated_at,
        finished_at
      )
      VALUES (
        $1::uuid,
        'succeeded',
        'fixtures/homework-memory.md',
        $2::uuid,
        $3::uuid,
        'html',
        NOW() - interval '2 hours',
        NOW() - interval '1 hour',
        NOW() - interval '1 hour'
      )
      ON CONFLICT (id) DO NOTHING
      `,
      [TARGET_HOMEWORK_JOB_ID, TARGET_STUDENT_ID, TARGET_USER_ID],
    );
    await client.query(
      `
      INSERT INTO recordings (
        id,
        source,
        student_id,
        source_path,
        storage_uri,
        sha256,
        bytes,
        status,
        created_at,
        updated_at
      )
      VALUES (
        $1::uuid,
        'upload',
        $2::uuid,
        '/tmp/plan-recording.opus',
        'local://plan-recording.opus',
        'hash',
        128,
        'transcribed',
        NOW() - interval '4 hours',
        NOW() - interval '3 hours'
      )
      `,
      [TARGET_RECORDING_ID, TARGET_STUDENT_ID],
    );
    await client.query(
      `
      INSERT INTO transcripts (
        id,
        recording_id,
        storage_uri,
        created_at,
        updated_at
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        'local://plan-transcript.json',
        NOW() - interval '3 hours',
        NOW() - interval '2 hours'
      )
      `,
      [TARGET_TRANSCRIPT_ID, TARGET_RECORDING_ID],
    );
    await client.query(
      `
      INSERT INTO lesson_memory_entries (
        id,
        student_id,
        transcript_id,
        recording_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        lesson_summary,
        created_at,
        updated_at
      )
      SELECT
        uuid_generate_v4(),
        CASE WHEN gs <= 80 THEN $1::uuid ELSE $2::uuid END,
        $3::uuid,
        $4::uuid,
        'lesson-memory.v1',
        NOW() - (gs::text || ' minutes')::interval,
        'openai',
        'gpt-5.2',
        CASE WHEN gs % 5 = 0 THEN 'failed' ELSE 'ready' END,
        'lesson_transcript',
        'Lesson memory summary',
        NOW() - (gs::text || ' minutes')::interval,
        NOW() - (gs::text || ' minutes')::interval
      FROM generate_series(1, 160) AS gs
      `,
      [TARGET_STUDENT_ID, OTHER_STUDENT_ID, TARGET_TRANSCRIPT_ID, TARGET_RECORDING_ID],
    );
    await client.query(
      `
      INSERT INTO homework_memory_entries (
        id,
        student_id,
        job_id,
        assignment_lineage_key,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        homework_summary,
        published_at,
        created_at,
        updated_at
      )
      SELECT
        uuid_generate_v4(),
        CASE WHEN gs <= 90 THEN $1::uuid ELSE $2::uuid END,
        $3::uuid,
        $3::uuid,
        'homework-memory.v1',
        NOW() - (gs::text || ' minutes')::interval,
        'openrouter',
        'qwen/qwen3.5',
        CASE WHEN gs % 6 = 0 THEN 'superseded' ELSE 'ready' END,
        'published_assignment',
        'Homework memory summary',
        NOW() - (gs::text || ' minutes')::interval,
        NOW() - (gs::text || ' minutes')::interval,
        NOW() - (gs::text || ' minutes')::interval
      FROM generate_series(1, 180) AS gs
      `,
      [TARGET_STUDENT_ID, OTHER_STUDENT_ID, TARGET_HOMEWORK_JOB_ID],
    );
    await client.query(
      `
      INSERT INTO student_profile_candidates (
        id,
        student_id,
        target_section,
        candidate_key,
        fact,
        category,
        authority,
        confidence,
        status,
        review_state,
        created_at,
        updated_at
      )
      SELECT
        uuid_generate_v4(),
        CASE WHEN gs <= 100 THEN $1::uuid ELSE $2::uuid END,
        'goals_motivation',
        'plan-candidate-' || gs::text,
        'Candidate fact ' || gs::text,
        'goals',
        'model_inferred',
        'medium',
        CASE WHEN gs % 7 = 0 THEN 'approved' ELSE 'pending_review' END,
        CASE
          WHEN gs % 11 = 0 THEN 'deferred'
          WHEN gs % 7 = 0 THEN 'approved'
          ELSE 'unreviewed'
        END,
        NOW() - (gs::text || ' minutes')::interval,
        NOW() - (gs::text || ' minutes')::interval
      FROM generate_series(1, 220) AS gs
      `,
      [TARGET_STUDENT_ID, OTHER_STUDENT_ID],
    );

    await client.query('ANALYZE jobs');
    await client.query('ANALYZE lesson_memory_entries');
    await client.query('ANALYZE homework_memory_entries');
    await client.query('ANALYZE student_profile_candidates');
  });
}

describe('integration/query-plan-regression', () => {
  beforeAll(async () => {
    await seedJobsForPlanChecks();
  }, testTimeout);

  beforeEach(async () => {
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query('ANALYZE jobs');
    });
  }, testTimeout);

  afterAll(async () => {
    await closePgPool();
  });

  it(
    'list-jobs path keeps ordered user index usage',
    async () => {
      const plan = await explainQuery(
        'list-jobs-user',
        `
      SELECT id
      FROM jobs
      WHERE user_id = $1::uuid
        AND created_at >= $2
        AND created_at <= $3
      ORDER BY created_at DESC, id DESC
      LIMIT 50
      `,
        [
          TARGET_USER_ID,
          new Date('2020-01-01T00:00:00.000Z'),
          new Date('2040-01-01T00:00:00.000Z'),
        ],
      );

      const indexNames = new Set<string>();
      collectIndexNames(plan.Plan, indexNames);
      expect(indexNames.has('idx_jobs_user_created_at_id')).toBe(true);
      expect(hasSeqScanOnRelation(plan.Plan, 'jobs')).toBe(false);
    },
    testTimeout,
  );

  it(
    'readiness path keeps selective index usage without seq scans',
    async () => {
      const plan = await explainQuery(
        'readiness-window',
        `
      SELECT COUNT(*)
      FROM jobs
      WHERE publish_target = 'html'
        AND state = 'succeeded'
        AND created_at >= $1
        AND created_at <= $2
      `,
        [new Date('2020-01-01T00:00:00.000Z'), new Date('2040-01-01T00:00:00.000Z')],
      );

      const indexNames = new Set<string>();
      collectIndexNames(plan.Plan, indexNames);
      expect(
        [
          'idx_jobs_state',
          'idx_jobs_state_created_at',
          'idx_jobs_publish_target_state_created_at',
        ].some((indexName) => indexNames.has(indexName)),
      ).toBe(true);
      expect(hasSeqScanOnRelation(plan.Plan, 'jobs')).toBe(false);
    },
    testTimeout,
  );

  it(
    'student summary path keeps student/date index usage',
    async () => {
      const plan = await explainQuery(
        'student-summary',
        `
      SELECT student_id, MAX(COALESCE(finished_at, updated_at, created_at))
      FROM jobs
      WHERE student_id = ANY($1::uuid[])
      GROUP BY student_id
      `,
        [[TARGET_STUDENT_ID]],
      );

      const indexNames = new Set<string>();
      collectIndexNames(plan.Plan, indexNames);
      expect(indexNames.has('idx_jobs_student_created_at_id')).toBe(true);
      expect(hasSeqScanOnRelation(plan.Plan, 'jobs')).toBe(false);
    },
    testTimeout,
  );

  it(
    'student overview lesson memory path keeps ready student index usage',
    async () => {
      const plan = await explainQuery(
        'student-overview-lesson-memory',
        `
      SELECT lesson_memory_entries.id
      FROM lesson_memory_entries
      INNER JOIN transcripts t ON t.id = lesson_memory_entries.transcript_id
      WHERE lesson_memory_entries.student_id = $1::uuid
        AND lesson_memory_entries.status = 'ready'
        AND lesson_memory_entries.generated_at >= t.updated_at
      ORDER BY lesson_memory_entries.generated_at DESC, lesson_memory_entries.created_at DESC, lesson_memory_entries.id DESC
      LIMIT 5
      `,
        [TARGET_STUDENT_ID],
      );

      const indexNames = new Set<string>();
      collectIndexNames(plan.Plan, indexNames);
      expect(indexNames.has('idx_lesson_memory_entries_student_ready_generated_at')).toBe(true);
      expect(hasSeqScanOnRelation(plan.Plan, 'lesson_memory_entries')).toBe(false);
    },
    testTimeout,
  );

  it(
    'student overview homework memory path keeps ready student index usage',
    async () => {
      const plan = await explainQuery(
        'student-overview-homework-memory',
        `
      SELECT id
      FROM homework_memory_entries
      WHERE student_id = $1::uuid
        AND status = 'ready'
      ORDER BY generated_at DESC, created_at DESC, id DESC
      LIMIT 5
      `,
        [TARGET_STUDENT_ID],
      );

      const indexNames = new Set<string>();
      collectIndexNames(plan.Plan, indexNames);
      expect(indexNames.has('idx_homework_memory_entries_student_ready_generated_at')).toBe(true);
      expect(hasSeqScanOnRelation(plan.Plan, 'homework_memory_entries')).toBe(false);
    },
    testTimeout,
  );

  it(
    'student learning candidates path keeps combined status/review index usage',
    async () => {
      const plan = await explainQuery(
        'student-learning-candidates',
        `
      SELECT id
      FROM student_profile_candidates
      WHERE student_id = $1::uuid
        AND status = 'pending_review'
        AND review_state = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 10
      `,
        [TARGET_STUDENT_ID, 'unreviewed'],
      );

      const indexNames = new Set<string>();
      collectIndexNames(plan.Plan, indexNames);
      expect(
        indexNames.has('idx_student_profile_candidates_student_status_review_created_at'),
      ).toBe(true);
      expect(hasSeqScanOnRelation(plan.Plan, 'student_profile_candidates')).toBe(false);
    },
    testTimeout,
  );
});
