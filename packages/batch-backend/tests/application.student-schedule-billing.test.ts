import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  addStudentPackage,
  adjustStudentCredits,
  createStudentLesson,
  getStudentScheduleBillingSurface,
  updateStudentLesson,
} from '../src/application/student-schedule-billing.js';
import { closePgPool, withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) {
  requirePgTestEnv();
}

const describeIfPg = hasPgTestEnv ? describe : describe.skip;
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

async function resetScheduleBillingTables() {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      TRUNCATE TABLE
        student_reminder_preferences,
        student_payment_records,
        student_credit_events,
        student_lessons,
        student_lesson_plans,
        workspace_memberships,
        students,
      users
      RESTART IDENTITY CASCADE
      `,
    );
    await client.query(
      `
      INSERT INTO workspaces (id, name)
      VALUES ($1, 'Default workspace')
      ON CONFLICT (id) DO NOTHING
      `,
      [DEFAULT_WORKSPACE_ID],
    );
  });
}

async function seedStudent() {
  const userId = randomUUID();
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO users (id, email, password_hash, role)
      VALUES ($1, 'teacher@example.com', 'hash', 'user')
      `,
      [userId],
    );
    await client.query(
      `
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES ($1, $2, 'owner')
      `,
      [DEFAULT_WORKSPACE_ID, userId],
    );
    await client.query(
      `
      INSERT INTO students (id, student, workspace_id, created_at, updated_at)
      VALUES ($1, 'Alex', $2, NOW(), NOW())
      `,
      [studentId, DEFAULT_WORKSPACE_ID],
    );
  });
  return { studentId, userId };
}

async function seedStudentWithoutWorkspace() {
  const userId = randomUUID();
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query('DELETE FROM workspaces WHERE id = $1', [DEFAULT_WORKSPACE_ID]);
    await client.query(
      `
      INSERT INTO users (id, email, password_hash, role)
      VALUES ($1, 'teacher@example.com', 'hash', 'user')
      `,
      [userId],
    );
    await client.query(
      `
      INSERT INTO students (id, student, workspace_id, created_at, updated_at)
      VALUES ($1, 'Alex', NULL, NOW(), NOW())
      `,
      [studentId],
    );
  });
  return { studentId, userId };
}

describeIfPg('application/student-schedule-billing', () => {
  beforeEach(async () => {
    await resetScheduleBillingTables();
  });

  afterAll(async () => {
    await resetScheduleBillingTables();
    await closePgPool();
  });

  it('adds lesson packages, records payment facts, and derives the remaining balance', async () => {
    const { studentId, userId } = await seedStudent();

    const surface = await addStudentPackage(
      studentId,
      {
        lessons: 8,
        note: 'May package',
        payment: {
          amountMinor: 12000,
          currency: 'USD',
          method: 'Bank transfer',
          receivedAt: '2026-05-06',
          note: 'Paid in full',
        },
      },
      userId,
    );

    expect(surface.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(surface.creditSummary).toMatchObject({
      purchased: 8,
      consumed: 0,
      remaining: 8,
      isLow: false,
      isNegative: false,
    });
    expect(surface.payments).toHaveLength(1);
    expect(surface.payments[0]).toMatchObject({
      amountMinor: 12000,
      currency: 'USD',
      method: 'Bank transfer',
      receivedAt: '2026-05-06',
    });
  });

  it('consumes exactly one credit when a chargeable lesson is completed and voids it if uncharged', async () => {
    const { studentId, userId } = await seedStudent();
    await addStudentPackage(studentId, { lessons: 1 }, userId);

    let surface = await createStudentLesson(
      studentId,
      {
        startsAt: '2026-05-07T10:00:00.000Z',
        status: 'completed',
        consumesCredit: true,
      },
      userId,
    );

    const lesson = surface.lessons[0];
    expect(lesson).toBeDefined();
    const lessonId = lesson?.id ?? '';
    expect(surface.creditSummary.remaining).toBe(0);
    expect(
      surface.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(1);

    surface = await updateStudentLesson(
      studentId,
      lessonId,
      {
        status: 'completed',
        consumesCredit: true,
      },
      userId,
    );
    expect(surface.creditSummary.remaining).toBe(0);
    expect(
      surface.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(1);

    surface = await updateStudentLesson(
      studentId,
      lessonId,
      {
        status: 'completed',
        consumesCredit: false,
      },
      userId,
    );
    expect(surface.creditSummary.remaining).toBe(1);
    expect(
      surface.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(0);
  });

  it('returns honest empty-state reminders for students without lessons or credits', async () => {
    const { studentId } = await seedStudent();

    const surface = await getStudentScheduleBillingSurface(studentId);

    expect(surface?.nextLesson).toBeNull();
    expect(surface?.creditSummary.remaining).toBe(0);
    expect(surface?.reminders.map((reminder) => reminder.type)).toEqual([
      'no_next_lesson',
      'low_balance',
      'payment_followup',
    ]);
  });

  it('self-heals the default workspace for baseline-created students without workspace data', async () => {
    const { studentId, userId } = await seedStudentWithoutWorkspace();

    const surface = await addStudentPackage(studentId, { lessons: 3 }, userId);

    expect(surface.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(surface.creditSummary.remaining).toBe(3);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query('SELECT id FROM workspaces WHERE id = $1', [
        DEFAULT_WORKSPACE_ID,
      ]);
      expect(result.rowCount).toBe(1);
    });
  });

  it('derives credit totals from all active events while returning a bounded event list', async () => {
    const { studentId, userId } = await seedStudent();

    for (let index = 0; index < 60; index += 1) {
      await adjustStudentCredits(
        studentId,
        { quantityDelta: 1, note: `Adjustment ${index}` },
        userId,
      );
    }

    const surface = await getStudentScheduleBillingSurface(studentId);

    expect(surface?.creditEvents).toHaveLength(50);
    expect(surface?.creditSummary).toMatchObject({
      adjustments: 60,
      remaining: 60,
      isLow: false,
    });
  });

  it('honors stored reminder opt-outs', async () => {
    const { studentId, userId } = await seedStudent();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `
        INSERT INTO student_reminder_preferences (
          student_id,
          workspace_id,
          preferred_channel,
          low_balance_threshold,
          enable_upcoming_lesson,
          enable_low_balance,
          enable_payment_followup,
          updated_by
        )
        VALUES ($1, $2, 'email', 2, FALSE, TRUE, FALSE, $3)
        `,
        [studentId, DEFAULT_WORKSPACE_ID, userId],
      );
    });

    const surface = await getStudentScheduleBillingSurface(studentId);

    expect(surface?.reminders).toHaveLength(1);
    expect(surface?.reminders[0]).toMatchObject({
      type: 'low_balance',
      channel: 'email',
    });
  });
});
