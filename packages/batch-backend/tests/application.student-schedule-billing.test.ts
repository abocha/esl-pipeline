import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createAssignmentSessionForUser,
  updateAssignmentSessionForUser,
} from '../src/application/assignment-sessions.js';
import {
  addStudentPackage,
  adjustStudentCredits,
  createStudentLesson,
  getStudentScheduleBillingSurface,
  updateStudentLesson,
  upsertPrimaryStudentLessonRecurrence,
} from '../src/application/student-schedule-billing.js';
import {
  getBusinessScheduleSurface,
  getBusinessSettings,
  getBusinessStatsSurface,
  updateBusinessSettings,
} from '../src/application/teacher-business-dashboard.js';
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
        homework_memory_entries,
        jobs,
        drafts,
        prompt_packages,
        transcripts,
        recordings,
        assignment_sessions,
        workspace_business_settings,
        student_lesson_recurrence_slots,
        student_lesson_recurrence_rules,
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

async function seedAdditionalStudent(name: string, archived = false) {
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO students (id, student, workspace_id, archived_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      `,
      [studentId, name, DEFAULT_WORKSPACE_ID, archived ? new Date().toISOString() : null],
    );
  });
  return studentId;
}

async function insertBusinessLesson(params: {
  studentId: string;
  startsAt: string;
  status?: 'scheduled' | 'completed' | 'canceled' | 'no_show';
  consumesCredit?: boolean;
  durationMinutes?: number;
}) {
  const id = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO student_lessons (
        id,
        student_id,
        workspace_id,
        starts_at,
        duration_minutes,
        status,
        consumes_credit
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        id,
        params.studentId,
        DEFAULT_WORKSPACE_ID,
        params.startsAt,
        params.durationMinutes ?? 60,
        params.status ?? 'scheduled',
        params.consumesCredit ?? false,
      ],
    );
  });
  return id;
}

async function insertBusinessCreditEvent(studentId: string, quantityDelta: number) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO student_credit_events (
        id,
        student_id,
        workspace_id,
        event_type,
        quantity_delta
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        randomUUID(),
        studentId,
        DEFAULT_WORKSPACE_ID,
        quantityDelta > 0 ? 'credit_added' : 'credit_consumed',
        quantityDelta,
      ],
    );
  });
}

async function insertSucceededHomeworkJob(params: {
  studentId: string;
  lessonId: string;
  htmlUrl?: string;
}) {
  const jobId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO jobs (
        id,
        state,
        student_id,
        lesson_id,
        publish_target,
        html_url,
        finished_at,
        created_at,
        updated_at
      )
      VALUES ($1, 'succeeded', $2, $3, 'html', $4, NOW(), NOW(), NOW())
      `,
      [jobId, params.studentId, params.lessonId, params.htmlUrl ?? 'https://example.test/hw'],
    );
  });
  return jobId;
}

async function insertFailedHomeworkJob(params: { studentId: string; lessonId: string }) {
  const jobId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO jobs (
        id,
        state,
        student_id,
        lesson_id,
        publish_target,
        error,
        finished_at,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        'failed',
        $2,
        $3,
        'html',
        'later rerun failed',
        NOW() + INTERVAL '1 minute',
        NOW() + INTERVAL '1 minute',
        NOW() + INTERVAL '1 minute'
      )
      `,
      [jobId, params.studentId, params.lessonId],
    );
  });
  return jobId;
}

async function insertBusinessPayment(params: {
  studentId: string;
  amountMinor: number;
  currency: string;
  receivedAt: string;
}) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO student_payment_records (
        id,
        student_id,
        workspace_id,
        amount_minor,
        currency,
        received_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        randomUUID(),
        params.studentId,
        DEFAULT_WORKSPACE_ID,
        params.amountMinor,
        params.currency,
        params.receivedAt,
      ],
    );
  });
}

async function countObsoleteGeneratedLessons(ruleId: string): Promise<number> {
  return withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    const result = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM student_lessons
      WHERE recurrence_rule_id = $1
        AND recurrence_origin = 'generated'
        AND recurrence_obsolete_at IS NOT NULL
      `,
      [ruleId],
    );
    return Number(result.rows[0]?.count ?? 0);
  });
}

function addDays(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString();
}

describeIfPg('application/student-schedule-billing', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
    await resetScheduleBillingTables();
  });

  afterAll(async () => {
    vi.useRealTimers();
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
        status: 'scheduled',
        consumesCredit: false,
      },
      userId,
    );
    expect(surface.creditSummary.remaining).toBe(1);
    expect(surface.lessons.find((candidate) => candidate.id === lessonId)).toMatchObject({
      status: 'scheduled',
      consumesCredit: false,
      creditEventId: null,
    });
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query<{ completed_by: string | null }>(
        'SELECT completed_by FROM student_lessons WHERE id = $1',
        [lessonId],
      );
      expect(result.rows[0]?.completed_by).toBeNull();
    });
    expect(
      surface.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(0);

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

  it('surfaces elapsed scheduled lessons as homework follow-ups until homework is published', async () => {
    const { studentId } = await seedStudent();
    const elapsedLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      consumesCredit: true,
    });
    await insertBusinessLesson({
      studentId,
      startsAt: '2999-01-01T10:00:00.000Z',
      consumesCredit: true,
    });

    let surface = await getStudentScheduleBillingSurface(studentId);

    expect(
      surface?.reminders.find(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === elapsedLessonId,
      ),
    ).toMatchObject({
      type: 'lesson_followup',
      actionIntent: 'complete_lesson_and_start_assignment',
      lessonStatus: 'scheduled',
      lessonConsumesCredit: true,
      title: 'Finish lesson follow-up',
    });
    expect(
      surface?.lessons.find((lesson) => lesson.id === elapsedLessonId)?.homework,
    ).toMatchObject({
      status: 'not_started',
    });

    const jobId = await insertSucceededHomeworkJob({ studentId, lessonId: elapsedLessonId });
    await insertFailedHomeworkJob({ studentId, lessonId: elapsedLessonId });
    surface = await getStudentScheduleBillingSurface(studentId);

    expect(
      surface?.reminders.some(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === elapsedLessonId,
      ),
    ).toBe(false);
    expect(
      surface?.lessons.find((lesson) => lesson.id === elapsedLessonId)?.homework,
    ).toMatchObject({
      status: 'published',
      jobId,
      htmlUrl: 'https://example.test/hw',
    });
  });

  it('caps student follow-up reminders after suppressing already published overdue lessons', async () => {
    const { studentId } = await seedStudent();
    const overdueUnpublishedLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      consumesCredit: true,
    });

    for (let index = 0; index < 31; index += 1) {
      const publishedLessonId = await insertBusinessLesson({
        studentId,
        startsAt: `2001-01-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
        consumesCredit: true,
      });
      await insertSucceededHomeworkJob({ studentId, lessonId: publishedLessonId });
    }

    const surface = await getStudentScheduleBillingSurface(studentId);

    expect(
      surface?.reminders.some(
        (reminder) =>
          reminder.type === 'lesson_followup' && reminder.lessonId === overdueUnpublishedLessonId,
      ),
    ).toBe(true);
  });

  it('validates assignment session lesson lineage against the resulting selected student', async () => {
    const { studentId, userId } = await seedStudent();
    const otherStudentId = await seedAdditionalStudent('Bella');
    const matchingLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2026-05-18T10:00:00.000Z',
    });
    const mismatchedLessonId = await insertBusinessLesson({
      studentId: otherStudentId,
      startsAt: '2026-05-19T10:00:00.000Z',
    });

    await expect(
      createAssignmentSessionForUser(userId, {
        studentId,
        lessonId: mismatchedLessonId,
        currentStage: 'source',
      }),
    ).rejects.toThrow('Assignment session lesson must belong to the selected student');

    const session = await createAssignmentSessionForUser(userId, {
      studentId,
      lessonId: matchingLessonId,
      currentStage: 'source',
    });

    await expect(
      updateAssignmentSessionForUser(userId, session.id, {
        studentId: otherStudentId,
      }),
    ).rejects.toThrow('Assignment session lesson must belong to the selected student');

    await expect(
      updateAssignmentSessionForUser(userId, session.id, {
        lessonId: matchingLessonId,
      }),
    ).resolves.toMatchObject({
      id: session.id,
      studentId,
      lessonId: matchingLessonId,
    });
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

  it('materializes weekly recurrence rules idempotently into normal lessons', async () => {
    const { studentId, userId } = await seedStudent();

    const surface = await upsertPrimaryStudentLessonRecurrence(
      studentId,
      {
        timezone: 'Asia/Bangkok',
        startsOn: '2026-05-04',
        generationHorizonDays: 14,
        slots: [
          { isoWeekday: 1, localStartTime: '11:00', durationMinutes: 50 },
          { isoWeekday: 3, localStartTime: '11:00', durationMinutes: 50 },
        ],
      },
      userId,
    );
    const generatedLessonIds = surface.lessons
      .filter((lesson) => lesson.recurrenceOrigin === 'generated')
      .map((lesson) => lesson.id)
      .sort();

    expect(surface.recurrenceRule).toMatchObject({
      timezone: 'Asia/Bangkok',
      status: 'active',
      generationHorizonDays: 14,
    });
    expect(surface.recurrenceRule?.slots).toHaveLength(2);
    expect(generatedLessonIds.length).toBeGreaterThan(0);
    expect(
      surface.lessons.every((lesson) =>
        lesson.recurrenceOrigin === 'manual' ? true : Boolean(lesson.recurrenceOccurrenceKey),
      ),
    ).toBe(true);

    const reloaded = await getStudentScheduleBillingSurface(studentId);
    expect(
      reloaded?.lessons
        .filter((lesson) => lesson.recurrenceOrigin === 'generated')
        .map((lesson) => lesson.id)
        .sort(),
    ).toEqual(generatedLessonIds);
  });

  it('keeps recurrence IDs and active generated lessons stable across no-op saves', async () => {
    const { studentId, userId } = await seedStudent();
    const recurrence = {
      timezone: 'Asia/Bangkok',
      startsOn: '2026-05-04',
      generationHorizonDays: 14,
      slots: [
        { isoWeekday: 1, localStartTime: '11:00', durationMinutes: 50 },
        { isoWeekday: 3, localStartTime: '15:30', durationMinutes: 60 },
      ],
    };

    const first = await upsertPrimaryStudentLessonRecurrence(studentId, recurrence, userId);
    const firstRuleId = first.recurrenceRule?.id ?? '';
    const firstSlots = first.recurrenceRule?.slots.map((slot) => ({
      id: slot.id,
      isoWeekday: slot.isoWeekday,
      localStartTime: slot.localStartTime,
      durationMinutes: slot.durationMinutes,
    }));
    const firstGenerated = first.lessons
      .filter((lesson) => lesson.recurrenceOrigin === 'generated')
      .map((lesson) => ({
        id: lesson.id,
        recurrenceOccurrenceKey: lesson.recurrenceOccurrenceKey,
        recurrenceSlotId: lesson.recurrenceSlotId,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    const second = await upsertPrimaryStudentLessonRecurrence(studentId, recurrence, userId);
    const secondGenerated = second.lessons
      .filter((lesson) => lesson.recurrenceOrigin === 'generated')
      .map((lesson) => ({
        id: lesson.id,
        recurrenceOccurrenceKey: lesson.recurrenceOccurrenceKey,
        recurrenceSlotId: lesson.recurrenceSlotId,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));

    expect(second.recurrenceRule?.id).toBe(firstRuleId);
    expect(
      second.recurrenceRule?.slots.map((slot) => ({
        id: slot.id,
        isoWeekday: slot.isoWeekday,
        localStartTime: slot.localStartTime,
        durationMinutes: slot.durationMinutes,
      })),
    ).toEqual(firstSlots);
    expect(secondGenerated).toEqual(firstGenerated);
    await expect(countObsoleteGeneratedLessons(firstRuleId)).resolves.toBe(0);
  });

  it('reports the actual generated horizon when a recurrence rule shrinks', async () => {
    const { studentId, userId } = await seedStudent();
    const first = await upsertPrimaryStudentLessonRecurrence(
      studentId,
      {
        timezone: 'Asia/Bangkok',
        startsOn: '2026-05-04',
        generationHorizonDays: 56,
        slots: [{ isoWeekday: 1, localStartTime: '11:00', durationMinutes: 50 }],
      },
      userId,
    );
    const initialThrough = first.recurrenceRule?.materializedThrough;

    const shrunk = await upsertPrimaryStudentLessonRecurrence(
      studentId,
      {
        timezone: 'Asia/Bangkok',
        startsOn: '2026-05-04',
        generationHorizonDays: 14,
        slots: [{ isoWeekday: 1, localStartTime: '11:00', durationMinutes: 50 }],
      },
      userId,
    );

    expect(initialThrough).toBeDefined();
    expect(shrunk.recurrenceRule?.materializedThrough).toBeDefined();
    expect(shrunk.recurrenceRule?.materializedThrough).not.toBe(initialThrough);
    expect((shrunk.recurrenceRule?.materializedThrough ?? '') < (initialThrough ?? '')).toBe(true);
  });

  it('uses IANA timezone conversion for half-hour recurrence zones', async () => {
    const { studentId, userId } = await seedStudent();
    const surface = await upsertPrimaryStudentLessonRecurrence(
      studentId,
      {
        timezone: 'Asia/Kolkata',
        startsOn: '2026-05-04',
        generationHorizonDays: 7,
        slots: [{ isoWeekday: 1, localStartTime: '09:30', durationMinutes: 45 }],
      },
      userId,
    );

    const generated = surface.lessons.find((lesson) => lesson.recurrenceOrigin === 'generated');
    expect(generated).toBeDefined();
    expect(generated?.timezone).toBe('Asia/Kolkata');
    expect(generated?.startsAt).toBe('2026-05-11T04:00:00.000Z');
  });

  it('feeds generated recurrence lessons into business schedule and stats', async () => {
    const { studentId, userId } = await seedStudent();
    await updateBusinessSettings({
      defaultCurrency: 'USD',
      defaultLessonRateMinor: 4000,
      noShowRateBasisPoints: 0,
      cancellationRateBasisPoints: 0,
      forecastHorizonDays: 45,
    });

    await upsertPrimaryStudentLessonRecurrence(
      studentId,
      {
        timezone: 'Asia/Bangkok',
        startsOn: '2026-05-11',
        generationHorizonDays: 21,
        slots: [{ isoWeekday: 1, localStartTime: '11:00', durationMinutes: 50 }],
      },
      userId,
    );

    const schedule = await getBusinessScheduleSurface({
      from: '2026-05-11',
      to: '2026-05-11',
    });
    expect(schedule.lessons).toHaveLength(1);
    expect(schedule.lessons[0]).toMatchObject({
      studentId,
      recurrenceOrigin: 'generated',
      durationMinutes: 50,
    });

    const stats = await getBusinessStatsSurface({ month: '2026-05' });
    expect(stats.scheduledLessons).toBeGreaterThan(0);
    expect(stats.forecastMinor).toBe(stats.scheduledLessons * 4000);
  });

  it('keeps manual generated-lesson changes while obsolete placeholders are replaced', async () => {
    const { studentId, userId } = await seedStudent();
    let surface = await upsertPrimaryStudentLessonRecurrence(
      studentId,
      {
        timezone: 'Asia/Bangkok',
        startsOn: '2026-05-04',
        generationHorizonDays: 14,
        slots: [{ isoWeekday: 1, localStartTime: '11:00', durationMinutes: 50 }],
      },
      userId,
    );
    const generated = surface.lessons.find((lesson) => lesson.recurrenceOrigin === 'generated');
    expect(generated).toBeDefined();

    surface = await updateStudentLesson(
      studentId,
      generated?.id ?? '',
      { status: 'canceled', consumesCredit: false },
      userId,
    );
    expect(surface.lessons.find((lesson) => lesson.id === generated?.id)).toMatchObject({
      recurrenceOverrideKind: 'manual_cancel',
      status: 'canceled',
    });

    surface = await upsertPrimaryStudentLessonRecurrence(
      studentId,
      {
        timezone: 'Asia/Bangkok',
        startsOn: '2026-05-04',
        generationHorizonDays: 14,
        slots: [{ isoWeekday: 3, localStartTime: '11:00', durationMinutes: 50 }],
      },
      userId,
    );

    expect(surface.lessons.find((lesson) => lesson.id === generated?.id)).toMatchObject({
      recurrenceOverrideKind: 'manual_cancel',
      status: 'canceled',
    });
    expect(
      surface.lessons.some(
        (lesson) => lesson.recurrenceOrigin === 'generated' && lesson.recurrenceSlotId !== null,
      ),
    ).toBe(true);
  });

  it('preserves chargeable-state edits on generated lesson occurrences', async () => {
    const { studentId, userId } = await seedStudent();
    let surface = await upsertPrimaryStudentLessonRecurrence(
      studentId,
      {
        timezone: 'Asia/Bangkok',
        startsOn: '2026-05-04',
        generationHorizonDays: 14,
        slots: [{ isoWeekday: 1, localStartTime: '11:00', durationMinutes: 50 }],
      },
      userId,
    );
    const generated = surface.lessons.find((lesson) => lesson.recurrenceOrigin === 'generated');
    expect(generated).toBeDefined();

    surface = await updateStudentLesson(
      studentId,
      generated?.id ?? '',
      { status: 'scheduled', consumesCredit: false },
      userId,
    );
    expect(surface.lessons.find((lesson) => lesson.id === generated?.id)).toMatchObject({
      consumesCredit: false,
      recurrenceOverrideKind: 'manual_edit',
      status: 'scheduled',
    });

    surface = await upsertPrimaryStudentLessonRecurrence(
      studentId,
      {
        timezone: 'Asia/Bangkok',
        startsOn: '2026-05-04',
        generationHorizonDays: 14,
        slots: [{ isoWeekday: 3, localStartTime: '11:00', durationMinutes: 50 }],
      },
      userId,
    );
    expect(surface.lessons.find((lesson) => lesson.id === generated?.id)).toMatchObject({
      consumesCredit: false,
      recurrenceOverrideKind: 'manual_edit',
      status: 'scheduled',
    });
  });

  it('self-heals workspace business settings and updates forecast defaults', async () => {
    const settings = await getBusinessSettings();

    expect(settings).toMatchObject({
      workspaceId: DEFAULT_WORKSPACE_ID,
      defaultCurrency: 'USD',
      defaultLessonRateMinor: 0,
      forecastHorizonDays: 45,
    });

    const updated = await updateBusinessSettings({
      defaultCurrency: 'EUR',
      defaultLessonRateMinor: 3500,
      noShowRateBasisPoints: 1000,
      topUpThreshold: 1,
    });

    expect(updated).toMatchObject({
      defaultCurrency: 'EUR',
      defaultLessonRateMinor: 3500,
      noShowRateBasisPoints: 1000,
      topUpThreshold: 1,
    });

    await expect(updateBusinessSettings({ timezone: 'UTC+7' })).resolves.toMatchObject({
      timezone: 'Asia/Bangkok',
    });
    await expect(updateBusinessSettings({ timezone: 'Not/A_Timezone' })).rejects.toThrow(
      'Invalid timezone',
    );
  });

  it('aggregates active-student business schedule, reminders, alerts, and payments', async () => {
    const { studentId: alexId } = await seedStudent();
    const beaId = await seedAdditionalStudent('Bea');
    const archivedId = await seedAdditionalStudent('Archived', true);
    await insertBusinessLesson({
      studentId: alexId,
      startsAt: '2026-05-08T10:00:00.000Z',
      consumesCredit: true,
    });
    await insertBusinessLesson({
      studentId: archivedId,
      startsAt: '2026-05-08T12:00:00.000Z',
    });
    await insertBusinessCreditEvent(alexId, 3);
    await insertBusinessCreditEvent(beaId, -1);
    await insertBusinessPayment({
      studentId: alexId,
      amountMinor: 12000,
      currency: 'USD',
      receivedAt: '2026-05-07',
    });
    await updateBusinessSettings({ topUpThreshold: 4 });

    const surface = await getBusinessScheduleSurface({
      from: '2026-05-07',
      to: '2026-05-09',
    });

    expect(surface.lessons.map((lesson) => lesson.studentName)).toEqual(['Alex']);
    expect(surface.recentPayments).toHaveLength(1);
    expect(surface.creditAlerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: beaId,
          severity: 'urgent',
          remainingCredits: -1,
        }),
        expect.objectContaining({
          studentId: alexId,
          lowBalanceThreshold: 4,
          remainingCredits: 3,
        }),
      ]),
    );
    expect(surface.reminders.map((reminder) => reminder.studentName)).toContain('Bea');
    expect(surface.reminders.map((reminder) => reminder.studentName)).toContain('Alex');
  });

  it('includes overdue lesson homework follow-ups in the business reminder queue outside the selected date range', async () => {
    const { studentId } = await seedStudent();
    const lessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      consumesCredit: true,
    });

    const surface = await getBusinessScheduleSurface();

    expect(surface.lessons.some((lesson) => lesson.id === lessonId)).toBe(false);

    expect(
      surface.reminders.find(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === lessonId,
      ),
    ).toMatchObject({
      studentId,
      studentName: 'Alex',
      actionIntent: 'complete_lesson_and_start_assignment',
      lessonStatus: 'scheduled',
      lessonConsumesCredit: true,
    });

    const jobId = await insertSucceededHomeworkJob({ studentId, lessonId });
    await insertFailedHomeworkJob({ studentId, lessonId });
    const surfaceAfterPublish = await getBusinessScheduleSurface();

    expect(
      surfaceAfterPublish.reminders.some(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === lessonId,
      ),
    ).toBe(false);
    expect(jobId).toBeTruthy();
  });

  it('caps business follow-up reminders after suppressing already published overdue lessons', async () => {
    const { studentId } = await seedStudent();
    const overdueUnpublishedLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      consumesCredit: true,
    });

    for (let index = 0; index < 101; index += 1) {
      const publishedLessonId = await insertBusinessLesson({
        studentId,
        startsAt: `2001-01-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
        consumesCredit: true,
      });
      await insertSucceededHomeworkJob({ studentId, lessonId: publishedLessonId });
    }

    const surface = await getBusinessScheduleSurface();

    expect(
      surface.reminders.some(
        (reminder) =>
          reminder.type === 'lesson_followup' && reminder.lessonId === overdueUnpublishedLessonId,
      ),
    ).toBe(true);
  });

  it('uses the configured business timezone for schedule day ranges', async () => {
    const { studentId } = await seedStudent();
    await updateBusinessSettings({ timezone: 'Asia/Bangkok' });
    await insertBusinessLesson({
      studentId,
      startsAt: '2026-05-06T18:30:00.000Z',
      consumesCredit: true,
    });

    const surface = await getBusinessScheduleSurface({
      from: '2026-05-07',
      to: '2026-05-07',
    });

    expect(surface.lessons).toHaveLength(1);
    expect(surface.lessons[0]).toMatchObject({
      studentId,
      startsAt: '2026-05-06T18:30:00.000Z',
    });
  });

  it('normalizes legacy offset timezone settings before reading schedule surfaces', async () => {
    const { studentId } = await seedStudent();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `
        INSERT INTO workspace_business_settings (workspace_id, timezone)
        VALUES ($1, 'UTC+7')
        ON CONFLICT (workspace_id) DO UPDATE
        SET timezone = EXCLUDED.timezone
        `,
        [DEFAULT_WORKSPACE_ID],
      );
    });
    await insertBusinessLesson({
      studentId,
      startsAt: '2026-05-06T18:30:00.000Z',
      consumesCredit: true,
    });

    const surface = await getBusinessScheduleSurface({
      from: '2026-05-07',
      to: '2026-05-07',
    });

    expect(surface.settings.timezone).toBe('Asia/Bangkok');
    expect(surface.lessons).toHaveLength(1);
  });

  it('computes business stats from payments, taught lessons, forecasts, and excluded currencies', async () => {
    const { studentId: alexId } = await seedStudent();
    const beaId = await seedAdditionalStudent('Bea');
    const archivedId = await seedAdditionalStudent('Archived', true);
    await updateBusinessSettings({
      defaultCurrency: 'USD',
      defaultLessonRateMinor: 4000,
      noShowRateBasisPoints: 1000,
      cancellationRateBasisPoints: 500,
    });
    await insertBusinessLesson({
      studentId: alexId,
      startsAt: '2026-05-03T10:00:00.000Z',
      status: 'completed',
      consumesCredit: true,
      durationMinutes: 75,
    });
    await insertBusinessLesson({
      studentId: alexId,
      startsAt: '2026-05-04T10:00:00.000Z',
      status: 'no_show',
    });
    await insertBusinessLesson({
      studentId: archivedId,
      startsAt: '2026-05-05T10:00:00.000Z',
      status: 'completed',
      consumesCredit: true,
    });
    await insertBusinessLesson({
      studentId: beaId,
      startsAt: addDays(3),
      status: 'scheduled',
    });
    await insertBusinessPayment({
      studentId: alexId,
      amountMinor: 12000,
      currency: 'USD',
      receivedAt: '2026-05-02',
    });
    await insertBusinessPayment({
      studentId: beaId,
      amountMinor: 5000,
      currency: 'EUR',
      receivedAt: '2026-05-02',
    });

    const stats = await getBusinessStatsSurface({ month: '2026-05' });

    expect(stats.collectedMinor).toBe(12000);
    expect(stats.earnedMinor).toBe(4000);
    expect(stats.completedLessons).toBe(1);
    expect(stats.taughtMinutes).toBe(75);
    expect(stats.noShowLessons).toBe(1);
    expect(stats.scheduledGrossMinor).toBe(4000);
    expect(stats.riskAdjustmentMinor).toBe(600);
    expect(stats.forecastMinor).toBe(3400);
    expect(stats.excludedCurrencies).toEqual([
      { currency: 'EUR', amountMinor: 5000, paymentCount: 1 },
    ]);
  });

  it('uses the configured business timezone for monthly lesson stats', async () => {
    const { studentId } = await seedStudent();
    await updateBusinessSettings({
      defaultLessonRateMinor: 4000,
      timezone: 'Asia/Bangkok',
    });
    await insertBusinessLesson({
      studentId,
      startsAt: '2026-04-30T18:30:00.000Z',
      status: 'completed',
      consumesCredit: true,
      durationMinutes: 60,
    });

    const stats = await getBusinessStatsSurface({ month: '2026-05' });

    expect(stats.completedLessons).toBe(1);
    expect(stats.earnedMinor).toBe(4000);
    expect(stats.taughtMinutes).toBe(60);
  });
});
