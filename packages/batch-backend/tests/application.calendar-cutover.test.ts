import './support/bootstrap-pg-test-env.js';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

import { applyCalendarCutover, planCalendarCutover } from '../src/application/calendar-cutover.js';
import { closePgPool, createPgPool } from '../src/infrastructure/db.js';

afterAll(() => closePgPool());

async function fixture() {
  const workspaceId = randomUUID();
  const studentId = randomUUID();
  const lessonId = randomUUID();
  const pool = createPgPool();
  await pool.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [workspaceId, 'Cutover test']);
  await pool.query('INSERT INTO students(id,workspace_id,student) VALUES($1,$2,$3)', [
    studentId,
    workspaceId,
    'Synthetic student',
  ]);
  await pool.query(
    `INSERT INTO student_lessons(id,workspace_id,student_id,starts_at)
    VALUES($1,$2,$3,'2030-01-01T10:00:00Z')`,
    [lessonId, workspaceId, studentId],
  );
  return { workspaceId, studentId, lessonId, pool };
}

describe('reviewed internal schedule cutover', () => {
  it('hides only scoped unused placeholders while retaining immutable activity and all ledger rows', async () => {
    const first = await fixture();
    const other = await fixture();
    const plan = await planCalendarCutover(first.workspaceId);
    expect(plan.lessons).toEqual([
      expect.objectContaining({ id: first.lessonId, eligible: true, activityCount: 1 }),
    ]);
    expect(JSON.stringify(plan)).not.toContain('Synthetic student');
    await expect(applyCalendarCutover(plan, plan.fingerprint)).resolves.toMatchObject({
      hidden: 1,
    });
    const result = await first.pool.query(
      `SELECT id,status,schedule_hidden_reason FROM student_lessons WHERE id=ANY($1::uuid[]) ORDER BY id`,
      [[first.lessonId, other.lessonId]],
    );
    expect(result.rows.find((row) => row.id === first.lessonId)).toMatchObject({
      status: 'scheduled',
      schedule_hidden_reason: 'internal_scheduler_retired',
    });
    expect(result.rows.find((row) => row.id === other.lessonId)).toMatchObject({
      schedule_hidden_reason: null,
    });
    const activity = await first.pool.query(
      'SELECT count(*)::int AS count FROM student_activity WHERE entity_id=$1',
      [first.lessonId],
    );
    expect(activity.rows[0].count).toBe(1);
    await expect(applyCalendarCutover(plan, plan.fingerprint)).rejects.toThrow('drift');
  });

  it('protects credit references in either direction and lifecycle history', async () => {
    const { workspaceId, studentId, lessonId, pool } = await fixture();
    await pool.query(
      `INSERT INTO student_credit_events(id,student_id,workspace_id,event_type,quantity_delta,source_lesson_id)
      VALUES($1,$2,$3,'credit_adjusted',1,$4)`,
      [randomUUID(), studentId, workspaceId, lessonId],
    );
    const second = randomUUID();
    await pool.query(
      `INSERT INTO student_lessons(id,workspace_id,student_id,starts_at,status,consumes_credit)
      VALUES($1,$2,$3,'2030-01-02T10:00:00Z','completed',true)`,
      [second, workspaceId, studentId],
    );
    const plan = await planCalendarCutover(workspaceId);
    expect(plan.lessons.every((row) => !row.eligible)).toBe(true);
    expect(plan.lessons.find((row) => row.id === lessonId)?.protectedBy).toContain(
      'student_credit_events.source_lesson_id',
    );
    await expect(applyCalendarCutover(plan, plan.fingerprint)).resolves.toMatchObject({
      hidden: 0,
    });
  });

  it('rejects a manifest when a completion or new downstream reference appears after inventory', async () => {
    const { workspaceId, lessonId, pool } = await fixture();
    const plan = await planCalendarCutover(workspaceId);
    await pool.query(
      "UPDATE student_lessons SET status='completed',consumes_credit=true WHERE id=$1",
      [lessonId],
    );
    await expect(applyCalendarCutover(plan, plan.fingerprint)).rejects.toThrow('drift');
    expect(
      (await pool.query('SELECT schedule_hidden_at FROM student_lessons WHERE id=$1', [lessonId]))
        .rows[0].schedule_hidden_at,
    ).toBeNull();
  });

  it('protects a reverse credit pointer, reminder keys and non-FK immutable source evidence', async () => {
    const { workspaceId, studentId, lessonId, pool } = await fixture();
    const creditId = randomUUID();
    await pool.query(
      `INSERT INTO student_credit_events(id,student_id,workspace_id,event_type,quantity_delta)
      VALUES($1,$2,$3,'credit_added',1)`,
      [creditId, studentId, workspaceId],
    );
    await pool.query('UPDATE student_lessons SET credit_event_id=$2 WHERE id=$1', [
      lessonId,
      creditId,
    ]);
    await pool.query(
      `INSERT INTO student_reminder_preferences(student_id,workspace_id,hidden_lesson_followup_keys)
      VALUES($1,$2,ARRAY[$3])`,
      [studentId, workspaceId, `lesson:${lessonId}:followup`],
    );
    await pool.query(
      `INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
      VALUES($1,$2,'homework_started','operations',$3,'system',$4::jsonb)`,
      [studentId, workspaceId, randomUUID(), JSON.stringify({ source: { lessonId } })],
    );
    const plan = await planCalendarCutover(workspaceId);
    expect(plan.lessons[0]).toMatchObject({
      eligible: false,
      protectedBy: expect.arrayContaining([
        'credit_fact',
        'reminder_reference',
        'immutable_lifecycle_or_downstream_activity',
      ]),
    });
    await expect(applyCalendarCutover(plan, plan.fingerprint)).resolves.toMatchObject({
      hidden: 0,
    });
    await expect(
      applyCalendarCutover({ ...plan, workspaceId: randomUUID() }, plan.fingerprint),
    ).rejects.toThrow('fingerprint');
  });
});
