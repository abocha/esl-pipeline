import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

import { createPgPool, withSanitizedPgLogging } from '../infrastructure/db.js';

interface LessonInventory {
  id: string;
  studentId: string;
  fingerprint: string;
  activityCount: number;
  protectedBy: string[];
  eligible: boolean;
}

interface RetiredPlanInventory {
  studentId: string;
  fingerprint: string;
  ruleIds: string[];
  slotIds: string[];
}

export interface CalendarCutoverManifest {
  version: 1;
  action: 'hide-unused-internal-schedule';
  workspaceId: string;
  capturedAt: string;
  fingerprint: string;
  plans: RetiredPlanInventory[];
  lessons: LessonInventory[];
}

interface LessonReference {
  table_name: string;
  column_name: string;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function inventoryFingerprint(
  workspaceId: string,
  inventory: Pick<CalendarCutoverManifest, 'plans' | 'lessons'>,
): string {
  return digest({ version: 1, action: 'hide-unused-internal-schedule', workspaceId, ...inventory });
}

function identifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function requireUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('A workspace UUID is required.');
  }
}

async function lessonReferences(client: PoolClient): Promise<LessonReference[]> {
  const result = await client.query<LessonReference>(`
    SELECT DISTINCT c.relname AS table_name, a.attname AS column_name
    FROM pg_constraint k
    JOIN pg_class c ON c.oid=k.conrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(k.conkey)
    WHERE k.contype='f' AND k.confrelid='public.student_lessons'::regclass
      AND n.nspname='public'
    ORDER BY c.relname, a.attname
  `);
  return result.rows;
}

async function snapshot(
  client: PoolClient,
  workspaceId: string,
  references: LessonReference[],
): Promise<Pick<CalendarCutoverManifest, 'plans' | 'lessons'>> {
  const plansResult = await client.query<{
    student_id: string;
    snapshot: { rules?: { id: string; slots?: { id: string }[] }[] };
  }>(
    `
    SELECT student_id, retired_schedule_preferences AS snapshot
    FROM student_lesson_plans WHERE workspace_id=$1 ORDER BY student_id
  `,
    [workspaceId],
  );
  const plans = plansResult.rows.map((row) => ({
    studentId: row.student_id,
    fingerprint: digest(row.snapshot),
    ruleIds: (row.snapshot.rules ?? []).map((rule) => rule.id).sort(),
    slotIds: (row.snapshot.rules ?? [])
      .flatMap((rule) => (rule.slots ?? []).map((slot) => slot.id))
      .sort(),
  }));

  const result = await client.query<{
    id: string;
    student_id: string;
    status: string;
    consumes_credit: boolean;
    credit_event_id: string | null;
    completed_by: string | null;
    schedule_hidden_at: string | null;
    row_snapshot: Record<string, unknown>;
  }>(
    `
    SELECT l.*, to_jsonb(l) AS row_snapshot FROM student_lessons l
    WHERE l.workspace_id=$1
    ORDER BY l.id
  `,
    [workspaceId],
  );
  const lessons: LessonInventory[] = [];
  for (const row of result.rows) {
    const protectedBy: string[] = [];
    if (row.status !== 'scheduled') protectedBy.push('lifecycle_fact');
    if (row.consumes_credit || row.credit_event_id) protectedBy.push('credit_fact');
    if (row.completed_by) protectedBy.push('completion_actor');
    if (row.schedule_hidden_at) protectedBy.push('already_hidden');
    const referenceCounts: Record<string, number> = {};
    for (const reference of references) {
      const key = `${reference.table_name}.${reference.column_name}`;
      const count = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM public.${identifier(reference.table_name)}
         WHERE ${identifier(reference.column_name)}=$1`,
        [row.id],
      );
      referenceCounts[key] = count.rows[0]!.count;
      if (count.rows[0]!.count > 0) protectedBy.push(key);
    }
    // Immutable creation/change activity can remain attached to a hidden placeholder. Any
    // recorded lifecycle or downstream activity is a reason to retain it as unmanaged history.
    const activities = await client.query<{ id: string; type: string; fingerprint: string }>(
      `
      SELECT id, type, md5(to_jsonb(a)::text) AS fingerprint FROM student_activity a
      WHERE workspace_id=$1 AND (
        entity_id=$2 OR jsonb_path_exists(payload, '$.** ? (@ == $lesson)',
          jsonb_build_object('lesson', $2::text))) ORDER BY id
    `,
      [workspaceId, row.id],
    );
    if (
      activities.rows.some(
        (activity) => !['lesson_created', 'lesson_changed'].includes(activity.type),
      )
    ) {
      protectedBy.push('immutable_lifecycle_or_downstream_activity');
    }
    const reminders = await client.query<{ count: number }>(
      `
      SELECT count(*)::int AS count FROM student_reminder_preferences
      WHERE workspace_id=$1 AND (latest_hidden_lesson_followup_lesson_id=$2
        OR EXISTS (SELECT 1 FROM unnest(hidden_lesson_followup_keys) k WHERE k LIKE '%' || $2::text || '%')
        OR latest_hidden_lesson_followup_key LIKE '%' || $2::text || '%')
    `,
      [workspaceId, row.id],
    );
    if (reminders.rows[0]!.count > 0) protectedBy.push('reminder_reference');
    // A frozen source snapshot/history can outlive its nullable lesson_id foreign key.
    const sources = await client.query<{ count: number }>(
      `
      SELECT count(*)::int AS count FROM assignment_sessions a
      WHERE student_id IN (SELECT id FROM students WHERE workspace_id=$1)
        AND jsonb_path_exists(to_jsonb(a), '$.** ? (@ == $lesson)',
        jsonb_build_object('lesson', $2::text))
    `,
      [workspaceId, row.id],
    );
    if (sources.rows[0]!.count > 0) protectedBy.push('assignment_source_or_history');
    lessons.push({
      id: row.id,
      studentId: row.student_id,
      fingerprint: digest({
        row: row.row_snapshot,
        references: referenceCounts,
        activity: activities.rows,
        reminders: reminders.rows[0]!.count,
        sources: sources.rows[0]!.count,
      }),
      activityCount: activities.rowCount ?? 0,
      protectedBy: protectedBy.sort(),
      eligible: protectedBy.length === 0,
    });
  }
  return { plans, lessons };
}

/** Read-only consistent inventory. Contains IDs and digests, never operational notes or emails. */
export async function planCalendarCutover(workspaceId: string): Promise<CalendarCutoverManifest> {
  requireUuid(workspaceId);
  return withSanitizedPgLogging(async () => {
    const client = await createPgPool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const inventory = await snapshot(client, workspaceId, await lessonReferences(client));
      await client.query('COMMIT');
      return {
        version: 1,
        action: 'hide-unused-internal-schedule',
        workspaceId,
        capturedAt: new Date().toISOString(),
        fingerprint: inventoryFingerprint(workspaceId, inventory),
        ...inventory,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}

/** Operator-only, hide-only apply after separately authorized review of the exact manifest. */
export async function applyCalendarCutover(
  manifest: CalendarCutoverManifest,
  expectedFingerprint: string,
): Promise<{ hidden: number; fingerprint: string }> {
  requireUuid(manifest.workspaceId);
  if (
    manifest.version !== 1 ||
    manifest.action !== 'hide-unused-internal-schedule' ||
    manifest.fingerprint !== expectedFingerprint ||
    inventoryFingerprint(manifest.workspaceId, {
      plans: manifest.plans,
      lessons: manifest.lessons,
    }) !== expectedFingerprint
  ) {
    throw new Error('Cutover manifest fingerprint or version is invalid.');
  }
  return withSanitizedPgLogging(async () => {
    const client = await createPgPool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SET LOCAL statement_timeout='30s'");
      const references = await lessonReferences(client);
      const tables = [
        ...new Set([
          'student_lessons',
          'student_activity',
          'student_lesson_plans',
          'student_reminder_preferences',
          'assignment_sessions',
          ...references.map((ref) => ref.table_name),
        ]),
      ].sort();
      // Fence completion, FK insertion and non-FK activity/reminder references while rechecking.
      // This is a brief controlled cutover with application writers paused by the operator.
      await client.query(
        `LOCK TABLE ${tables.map((table) => `public.${identifier(table)}`).join(', ')} IN SHARE ROW EXCLUSIVE MODE`,
      );
      const inventory = await snapshot(client, manifest.workspaceId, references);
      if (inventoryFingerprint(manifest.workspaceId, inventory) !== expectedFingerprint)
        throw new Error('Cutover manifest drift; create and review a fresh plan.');
      const ids = inventory.lessons.filter((lesson) => lesson.eligible).map((lesson) => lesson.id);
      const result = await client.query(
        `
        UPDATE student_lessons SET schedule_hidden_at=now(),
          schedule_hidden_reason='internal_scheduler_retired', updated_at=now()
        WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status='scheduled'
          AND schedule_hidden_at IS NULL
      `,
        [manifest.workspaceId, ids],
      );
      if (result.rowCount !== ids.length) throw new Error('Cutover eligibility changed.');
      await client.query('COMMIT');
      return { hidden: result.rowCount ?? 0, fingerprint: expectedFingerprint };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
