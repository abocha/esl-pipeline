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
    await client.query('TRUNCATE TABLE users, job_action_history, jobs RESTART IDENTITY CASCADE');
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

    await client.query('ANALYZE jobs');
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
});
