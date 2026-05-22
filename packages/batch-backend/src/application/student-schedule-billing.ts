import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type {
  AddStudentPackageRequest,
  CreateStudentLessonRequest,
  RecordStudentPaymentRequest,
  StudentCreditEventDto,
  StudentCreditSummaryDto,
  StudentLatestHiddenReminderDto,
  StudentLessonDto,
  StudentLessonHomeworkDto,
  StudentLessonHomeworkStatus,
  StudentLessonPlanDto,
  StudentLessonRecurrenceRuleDto,
  StudentLessonRecurrenceSlotDto,
  StudentLessonStatus,
  StudentPaymentRecordDto,
  StudentReminderLessonSummaryDto,
  StudentReminderRecommendationDto,
  StudentScheduleBillingSurfaceResponse,
  UpdateStudentLessonPlanRequest,
  UpdateStudentLessonRequest,
  UpsertStudentLessonRecurrenceRequest,
} from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_LOW_BALANCE_THRESHOLD = 2;
const DEFAULT_GENERATION_HORIZON_DAYS = 56;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE_ALIASES = new Map<string, string>([
  ['GMT', 'UTC'],
  ['UTC+7', 'Asia/Bangkok'],
  ['GMT+7', 'Asia/Bangkok'],
]);

interface StudentContext {
  id: string;
  name: string;
  workspaceId: string | null;
}

interface LessonRow {
  id: string;
  student_id: string;
  workspace_id: string | null;
  starts_at: Date;
  timezone: string;
  duration_minutes: number;
  status: StudentLessonStatus;
  consumes_credit: boolean;
  title: string | null;
  notes: string | null;
  credit_event_id: string | null;
  recurrence_rule_id: string | null;
  recurrence_slot_id: string | null;
  recurrence_occurrence_key: string | null;
  recurrence_origin: 'manual' | 'generated';
  recurrence_override_kind: 'manual_edit' | 'manual_reschedule' | 'manual_cancel' | null;
  created_at: Date;
  updated_at: Date;
  homework_status: StudentLessonHomeworkStatus;
  homework_assignment_session_id: string | null;
  homework_prompt_package_id: string | null;
  homework_draft_id: string | null;
  homework_job_id: string | null;
  homework_memory_entry_id: string | null;
  homework_html_url: string | null;
  homework_updated_at: Date | null;
}

interface CreditEventRow {
  id: string;
  student_id: string;
  workspace_id: string | null;
  event_type: StudentCreditEventDto['eventType'];
  quantity_delta: number;
  source_lesson_id: string | null;
  source_payment_id: string | null;
  note: string | null;
  voided_at: Date | null;
  created_at: Date;
}

interface PaymentRow {
  id: string;
  student_id: string;
  workspace_id: string | null;
  amount_minor: number;
  currency: string;
  method: string | null;
  received_at: Date | string;
  external_url: string | null;
  note: string | null;
  voided_at: Date | null;
  created_at: Date;
}

interface LessonPlanRow {
  student_id: string;
  workspace_id: string | null;
  timezone: string;
  default_duration_minutes: number;
  cadence: string | null;
  preferred_times: string | null;
  scheduling_notes: string | null;
  updated_at: Date;
}

interface RecurrenceRuleRow {
  id: string;
  student_id: string;
  workspace_id: string | null;
  timezone: string;
  frequency: 'weekly';
  starts_on: string;
  ends_on: string | null;
  status: 'active' | 'paused' | 'archived';
  generation_horizon_days: number;
  materialized_through: string | null;
  updated_at: Date;
}

interface RecurrenceSlotRow {
  id: string;
  rule_id: string;
  iso_weekday: number;
  local_start_time: string;
  duration_minutes: number;
  sort_order: number;
}

interface NormalizedRecurrenceSlot {
  isoWeekday: number;
  localStartTime: string;
  durationMinutes: number;
}

interface ReminderPreferences {
  preferredChannel: 'manual' | 'telegram' | 'email';
  lowBalanceThreshold: number;
  enableUpcomingLesson: boolean;
  enableLowBalance: boolean;
  enablePaymentFollowup: boolean;
  hiddenLessonFollowupKeys: Set<string>;
  latestHiddenLessonFollowupKey: string | null;
  latestHiddenLessonFollowupLessonId: string | null;
  latestHiddenLessonFollowupAt: Date | null;
}

export class StudentScheduleBillingError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_request',
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const LESSON_HOMEWORK_SELECT = `
  student_lessons.*,
  CASE
    WHEN lesson_homework_memory.id IS NOT NULL THEN 'memory_ready'
    WHEN lesson_published_job.id IS NOT NULL THEN 'published'
    WHEN lesson_active_job.id IS NOT NULL THEN 'publishing'
    WHEN lesson_draft.id IS NOT NULL THEN 'draft_in_progress'
    WHEN lesson_assignment_session.id IS NOT NULL THEN 'session_in_progress'
    ELSE 'not_started'
  END AS homework_status,
  lesson_assignment_session.id AS homework_assignment_session_id,
  COALESCE(
    lesson_homework_memory.prompt_package_id,
    lesson_published_job.prompt_package_id,
    lesson_active_job.prompt_package_id,
    lesson_draft.prompt_package_id,
    lesson_assignment_session.prompt_package_id
  ) AS homework_prompt_package_id,
  COALESCE(
    lesson_homework_memory.draft_id,
    lesson_published_job.draft_id,
    lesson_active_job.draft_id,
    lesson_draft.id,
    lesson_assignment_session.draft_id
  ) AS homework_draft_id,
  COALESCE(lesson_published_job.id, lesson_active_job.id) AS homework_job_id,
  lesson_homework_memory.id AS homework_memory_entry_id,
  lesson_published_job.html_url AS homework_html_url,
  COALESCE(
    lesson_homework_memory.generated_at,
    lesson_published_job.updated_at,
    lesson_active_job.updated_at,
    lesson_draft.updated_at,
    lesson_assignment_session.updated_at
  ) AS homework_updated_at
`;

const LESSON_HOMEWORK_JOINS = `
  LEFT JOIN LATERAL (
    SELECT id, prompt_package_id, draft_id, updated_at
    FROM assignment_sessions
    WHERE lesson_id = student_lessons.id
      AND archived_at IS NULL
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  ) lesson_assignment_session ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, prompt_package_id, updated_at
    FROM drafts
    WHERE lesson_id = student_lessons.id
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  ) lesson_draft ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, prompt_package_id, draft_id, html_url,
           COALESCE(finished_at, updated_at, created_at) AS updated_at
    FROM jobs
    WHERE lesson_id = student_lessons.id
      AND state = 'succeeded'
    ORDER BY COALESCE(finished_at, updated_at, created_at) DESC, id DESC
    LIMIT 1
  ) lesson_published_job ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, prompt_package_id, draft_id,
           COALESCE(finished_at, updated_at, created_at) AS updated_at
    FROM jobs
    WHERE lesson_id = student_lessons.id
      AND state IN ('queued', 'running', 'awaiting_approval')
    ORDER BY COALESCE(finished_at, updated_at, created_at) DESC, id DESC
    LIMIT 1
  ) lesson_active_job ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, prompt_package_id, draft_id, job_id, generated_at
    FROM homework_memory_entries
    WHERE lesson_id = student_lessons.id
      AND status = 'ready'
    ORDER BY generated_at DESC, created_at DESC, id DESC
    LIMIT 1
  ) lesson_homework_memory ON TRUE
`;

export async function getStudentScheduleBillingSurface(
  studentId: string,
): Promise<StudentScheduleBillingSurfaceResponse | null> {
  return withPgClient(async (client) => {
    const context = await getStudentContext(client, studentId);
    if (!context) return null;
    return getSurfaceForContext(client, context);
  });
}

export async function hideStudentLessonFollowupReminder(
  studentId: string,
  lessonId: string,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    const context = await requireStudentContext(client, studentId);
    const lesson = await getLessonRow(client, studentId, lessonId);
    if (!lesson) {
      throw new StudentScheduleBillingError('not_found', 404, 'Lesson not found');
    }
    await upsertReminderSuppression(client, context, {
      suppressionKey: getLessonFollowupSuppressionKey(context, lesson.id),
      lessonId: lesson.id,
      actorUserId: actorUserId ?? null,
    });
    return getSurfaceForContext(client, context);
  });
}

export async function undoLatestHiddenStudentReminder(
  studentId: string,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    const context = await requireStudentContext(client, studentId);
    const prefs = await getReminderPreferences(client, context);
    if (!prefs.latestHiddenLessonFollowupKey) {
      return getSurfaceForContext(client, context);
    }
    await client.query(
      `
      UPDATE student_reminder_preferences
      SET hidden_lesson_followup_keys = array_remove(hidden_lesson_followup_keys, $2),
          latest_hidden_lesson_followup_key = NULL,
          latest_hidden_lesson_followup_lesson_id = NULL,
          latest_hidden_lesson_followup_at = NULL,
          updated_by = $3,
          updated_at = NOW()
      WHERE student_id = $1
      `,
      [context.id, prefs.latestHiddenLessonFollowupKey, actorUserId ?? null],
    );
    return getSurfaceForContext(client, context);
  });
}

export async function updateStudentLessonPlan(
  studentId: string,
  params: UpdateStudentLessonPlanRequest,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    const context = await requireStudentContext(client, studentId);
    await client.query(
      `
      INSERT INTO student_lesson_plans (
        student_id,
        workspace_id,
        timezone,
        default_duration_minutes,
        cadence,
        preferred_times,
        scheduling_notes,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (student_id) DO UPDATE
      SET
        workspace_id = EXCLUDED.workspace_id,
        timezone = EXCLUDED.timezone,
        default_duration_minutes = EXCLUDED.default_duration_minutes,
        cadence = EXCLUDED.cadence,
        preferred_times = EXCLUDED.preferred_times,
        scheduling_notes = EXCLUDED.scheduling_notes,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      `,
      [
        studentId,
        context.workspaceId,
        params.timezone ?? DEFAULT_TIMEZONE,
        params.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES,
        params.cadence ?? null,
        params.preferredTimes ?? null,
        params.schedulingNotes ?? null,
        actorUserId ?? null,
      ],
    );
    return getSurfaceForContext(client, context);
  });
}

export async function upsertPrimaryStudentLessonRecurrence(
  studentId: string,
  params: UpsertStudentLessonRecurrenceRequest,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    const context = await requireStudentContext(client, studentId);
    const timezone = normalizeTimezone(params.timezone);
    const startsOn = parseDateInput(params.startsOn, 'Invalid recurrence start date');
    const endsOn =
      params.endsOn === null || params.endsOn === undefined
        ? null
        : parseDateInput(params.endsOn, 'Invalid recurrence end date');
    if (endsOn && compareDateInputs(endsOn, startsOn) < 0) {
      throw new StudentScheduleBillingError(
        'invalid_request',
        400,
        'Recurrence end date must be on or after the start date',
      );
    }
    const slots = normalizeRecurrenceSlots(params.slots);
    const existing = await getPrimaryRecurrenceRuleRow(client, studentId);
    const ruleId = existing?.id ?? randomUUID();
    const status = params.status ?? existing?.status ?? 'active';
    const horizon =
      params.generationHorizonDays ??
      existing?.generation_horizon_days ??
      DEFAULT_GENERATION_HORIZON_DAYS;
    if (!Number.isInteger(horizon) || horizon < 7 || horizon > 366) {
      throw new StudentScheduleBillingError(
        'invalid_request',
        400,
        'Recurrence generation horizon must be between 7 and 366 days',
      );
    }
    const existingSlots = existing ? await listRecurrenceSlots(client, existing.id) : [];

    await client.query(
      `
      INSERT INTO student_lesson_recurrence_rules (
        id,
        student_id,
        workspace_id,
        timezone,
        frequency,
        starts_on,
        ends_on,
        status,
        generation_horizon_days,
        updated_by,
        created_by
      )
      VALUES ($1, $2, $3, $4, 'weekly', $5::date, $6::date, $7, $8, $9, $9)
      ON CONFLICT (id) DO UPDATE
      SET
        workspace_id = EXCLUDED.workspace_id,
        timezone = EXCLUDED.timezone,
        frequency = EXCLUDED.frequency,
        starts_on = EXCLUDED.starts_on,
        ends_on = EXCLUDED.ends_on,
        status = EXCLUDED.status,
        generation_horizon_days = EXCLUDED.generation_horizon_days,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      `,
      [
        ruleId,
        studentId,
        context.workspaceId,
        timezone,
        startsOn,
        endsOn,
        status,
        horizon,
        actorUserId ?? null,
      ],
    );

    const currentSlots = await replaceRecurrenceSlots(client, ruleId, slots, existingSlots);
    const desiredOccurrenceKeys = buildDesiredOccurrenceKeys({
      timezone,
      startsOn,
      endsOn,
      status,
      generationHorizonDays: horizon,
      slots: currentSlots,
    });
    await markFutureGeneratedLessonsObsolete(
      client,
      ruleId,
      actorUserId ?? null,
      desiredOccurrenceKeys,
    );
    if (desiredOccurrenceKeys.size === 0) {
      await client.query(
        `
        UPDATE student_lesson_recurrence_rules
        SET materialized_through = NULL,
            updated_at = NOW()
        WHERE id = $1
        `,
        [ruleId],
      );
    }

    await materializeStudentRecurrenceForContext(client, context, actorUserId ?? null);
    return getSurfaceForContext(client, context);
  });
}

export async function createStudentLesson(
  studentId: string,
  params: CreateStudentLessonRequest,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    const context = await requireStudentContext(client, studentId);
    const lessonId = randomUUID();
    await client.query(
      `
      INSERT INTO student_lessons (
        id,
        student_id,
        workspace_id,
        starts_at,
        timezone,
        duration_minutes,
        status,
        consumes_credit,
        title,
        notes,
        recurrence_origin,
        created_by,
        updated_by,
        completed_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual', $11, $11, $12)
      `,
      [
        lessonId,
        studentId,
        context.workspaceId,
        params.startsAt,
        params.timezone ?? DEFAULT_TIMEZONE,
        params.durationMinutes ?? DEFAULT_DURATION_MINUTES,
        params.status ?? 'scheduled',
        params.consumesCredit ?? false,
        params.title ?? null,
        params.notes ?? null,
        actorUserId ?? null,
        params.status === 'completed' ? (actorUserId ?? null) : null,
      ],
    );
    await reconcileLessonCreditEvent(client, lessonId, actorUserId ?? null);
    return getSurfaceForContext(client, context);
  });
}

export async function updateStudentLesson(
  studentId: string,
  lessonId: string,
  params: UpdateStudentLessonRequest,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    const context = await requireStudentContext(client, studentId);
    const existing = await getLessonRow(client, studentId, lessonId);
    if (!existing) {
      throw new StudentScheduleBillingError('not_found', 404, 'Lesson not found');
    }

    const nextStatus = params.status ?? existing.status;
    const nextStartsAt = params.startsAt ?? existing.starts_at.toISOString();
    const nextOverrideKind = getNextOverrideKind(existing, params, nextStatus, nextStartsAt);
    await client.query(
      `
      UPDATE student_lessons
      SET
        starts_at = $3,
        timezone = $4,
        duration_minutes = $5,
        status = $6,
        consumes_credit = $7,
        title = $8,
        notes = $9,
        updated_by = $10,
        recurrence_override_kind = $11,
        completed_by = CASE
          WHEN $6 = 'completed' AND status <> 'completed' THEN $10
          WHEN $6 <> 'completed' THEN NULL
          ELSE completed_by
        END,
        updated_at = NOW()
      WHERE id = $1
        AND student_id = $2
      `,
      [
        lessonId,
        studentId,
        params.startsAt ?? existing.starts_at.toISOString(),
        params.timezone ?? existing.timezone,
        params.durationMinutes ?? existing.duration_minutes,
        nextStatus,
        params.consumesCredit ?? existing.consumes_credit,
        params.title === undefined ? existing.title : params.title,
        params.notes === undefined ? existing.notes : params.notes,
        actorUserId ?? null,
        nextOverrideKind,
      ],
    );
    await reconcileLessonCreditEvent(client, lessonId, actorUserId ?? null);
    return getSurfaceForContext(client, context);
  });
}

export async function addStudentPackage(
  studentId: string,
  params: AddStudentPackageRequest,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    const context = await requireStudentContext(client, studentId);
    let paymentId: string | null = null;
    if (params.payment) {
      paymentId = randomUUID();
      await insertPayment(client, context, paymentId, params.payment, actorUserId ?? null);
    }
    await insertCreditEvent(client, {
      context,
      eventType: 'credit_added',
      quantityDelta: params.lessons,
      sourceLessonId: null,
      sourcePaymentId: paymentId,
      note: params.note ?? null,
      actorUserId: actorUserId ?? null,
    });
    return getSurfaceForContext(client, context);
  });
}

export async function adjustStudentCredits(
  studentId: string,
  params: { quantityDelta: number; note?: string | null },
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    const context = await requireStudentContext(client, studentId);
    await insertCreditEvent(client, {
      context,
      eventType: 'credit_adjusted',
      quantityDelta: params.quantityDelta,
      sourceLessonId: null,
      sourcePaymentId: null,
      note: params.note ?? null,
      actorUserId: actorUserId ?? null,
    });
    return getSurfaceForContext(client, context);
  });
}

export async function recordStudentPayment(
  studentId: string,
  params: RecordStudentPaymentRequest,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    const context = await requireStudentContext(client, studentId);
    await insertPayment(client, context, randomUUID(), params, actorUserId ?? null);
    return getSurfaceForContext(client, context);
  });
}

async function getSurfaceForContext(
  client: PoolClient,
  context: StudentContext,
): Promise<StudentScheduleBillingSurfaceResponse> {
  await materializeStudentRecurrenceForContext(client, context, null);
  const plan = await getLessonPlan(client, context);
  const recurrenceRule = await getPrimaryRecurrenceRule(client, context.id);
  const nextLesson = await getNextLesson(client, context.id);
  const lessons = await listLessons(client, context.id);
  const creditEvents = await listCreditEvents(client, context.id);
  const payments = await listPayments(client, context.id);
  const reminderPrefs = await getReminderPreferences(client, context);
  const elapsedHomeworkFollowups = (
    await listOverdueLessonHomeworkFollowups(client, context.id)
  ).filter(
    (lesson) =>
      !reminderPrefs.hiddenLessonFollowupKeys.has(
        getLessonFollowupSuppressionKey(context, lesson.id),
      ),
  );
  const creditSummary = await getCreditSummary(
    client,
    context.id,
    reminderPrefs.lowBalanceThreshold,
  );

  return {
    studentId: context.id,
    workspaceId: context.workspaceId,
    lessonPlan: plan,
    recurrenceRule,
    nextLesson: nextLesson ? mapLesson(nextLesson) : null,
    lessons: lessons.map((lesson) => mapLesson(lesson)),
    creditSummary,
    creditEvents: creditEvents.map((event) => mapCreditEvent(event)),
    payments: payments.map((payment) => mapPayment(payment)),
    latestHiddenReminder: await getLatestHiddenReminder(client, context, reminderPrefs),
    reminders: buildReminderRecommendations({
      studentName: context.name,
      nextLesson,
      elapsedHomeworkFollowups,
      creditSummary,
      preferredChannel: reminderPrefs.preferredChannel,
      enableUpcomingLesson: reminderPrefs.enableUpcomingLesson,
      enableLowBalance: reminderPrefs.enableLowBalance,
      enablePaymentFollowup: reminderPrefs.enablePaymentFollowup,
    }),
  };
}

async function getStudentContext(
  client: PoolClient,
  studentId: string,
): Promise<StudentContext | null> {
  await ensureDefaultWorkspace(client);
  const result = await client.query<{
    id: string;
    student: string;
    workspace_id: string | null;
  }>(
    `
    SELECT id, student, COALESCE(workspace_id, $2::uuid) AS workspace_id
    FROM students
    WHERE id = $1
      AND archived_at IS NULL
    `,
    [studentId, DEFAULT_WORKSPACE_ID],
  );
  const row = result.rows[0];
  return row ? { id: row.id, name: row.student, workspaceId: row.workspace_id } : null;
}

async function requireStudentContext(
  client: PoolClient,
  studentId: string,
): Promise<StudentContext> {
  const context = await getStudentContext(client, studentId);
  if (!context) {
    throw new StudentScheduleBillingError('not_found', 404, 'Student not found');
  }
  return context;
}

async function getLessonPlan(
  client: PoolClient,
  context: StudentContext,
): Promise<StudentLessonPlanDto> {
  const result = await client.query<LessonPlanRow>(
    `
    SELECT student_id, workspace_id, timezone, default_duration_minutes, cadence,
           preferred_times, scheduling_notes, updated_at
    FROM student_lesson_plans
    WHERE student_id = $1
    `,
    [context.id],
  );
  const row = result.rows[0];
  return {
    studentId: context.id,
    workspaceId: row?.workspace_id ?? context.workspaceId,
    timezone: row?.timezone ?? DEFAULT_TIMEZONE,
    defaultDurationMinutes: row?.default_duration_minutes ?? DEFAULT_DURATION_MINUTES,
    cadence: row?.cadence ?? null,
    preferredTimes: row?.preferred_times ?? null,
    schedulingNotes: row?.scheduling_notes ?? null,
    updatedAt: row?.updated_at ? row.updated_at.toISOString() : null,
  };
}

async function getPrimaryRecurrenceRule(
  client: PoolClient,
  studentId: string,
): Promise<StudentLessonRecurrenceRuleDto | null> {
  const row = await getPrimaryRecurrenceRuleRow(client, studentId);
  if (!row) {
    return null;
  }
  const slots = await listRecurrenceSlots(client, row.id);
  return mapRecurrenceRule(row, slots);
}

async function getPrimaryRecurrenceRuleRow(
  client: PoolClient,
  studentId: string,
): Promise<RecurrenceRuleRow | null> {
  const result = await client.query<RecurrenceRuleRow>(
    `
    SELECT
      id,
      student_id,
      workspace_id,
      timezone,
      frequency,
      starts_on::text AS starts_on,
      ends_on::text AS ends_on,
      status,
      generation_horizon_days,
      materialized_through::text AS materialized_through,
      updated_at
    FROM student_lesson_recurrence_rules
    WHERE student_id = $1
      AND status <> 'archived'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
    `,
    [studentId],
  );
  return result.rows[0] ?? null;
}

async function listRecurrenceSlots(
  client: PoolClient,
  ruleId: string,
): Promise<RecurrenceSlotRow[]> {
  const result = await client.query<RecurrenceSlotRow>(
    `
    SELECT
      id,
      rule_id,
      iso_weekday,
      local_start_time::text AS local_start_time,
      duration_minutes,
      sort_order
    FROM student_lesson_recurrence_slots
    WHERE rule_id = $1
    ORDER BY sort_order ASC, iso_weekday ASC, local_start_time ASC, id ASC
    `,
    [ruleId],
  );
  return result.rows;
}

async function replaceRecurrenceSlots(
  client: PoolClient,
  ruleId: string,
  slots: NormalizedRecurrenceSlot[],
  existingSlots: RecurrenceSlotRow[],
): Promise<RecurrenceSlotRow[]> {
  const existingByIdentity = new Map(
    existingSlots.map((slot) => [recurrenceSlotIdentityFromRow(slot), slot]),
  );
  const currentSlotIds: string[] = [];

  for (const [index, slot] of slots.entries()) {
    const existing = existingByIdentity.get(recurrenceSlotIdentity(slot));
    const slotId = existing?.id ?? randomUUID();
    currentSlotIds.push(slotId);
    await client.query(
      `
      INSERT INTO student_lesson_recurrence_slots (
        id,
        rule_id,
        iso_weekday,
        local_start_time,
        duration_minutes,
        sort_order
      )
      VALUES ($1, $2, $3, $4::time, $5, $6)
      ON CONFLICT (id) DO UPDATE
      SET
        iso_weekday = EXCLUDED.iso_weekday,
        local_start_time = EXCLUDED.local_start_time,
        duration_minutes = EXCLUDED.duration_minutes,
        sort_order = EXCLUDED.sort_order
      `,
      [slotId, ruleId, slot.isoWeekday, slot.localStartTime, slot.durationMinutes, index],
    );
  }

  await client.query(
    `
    DELETE FROM student_lesson_recurrence_slots
    WHERE rule_id = $1
      AND NOT (id = ANY($2::uuid[]))
    `,
    [ruleId, currentSlotIds],
  );

  return listRecurrenceSlots(client, ruleId);
}

async function materializeStudentRecurrenceForContext(
  client: PoolClient,
  context: StudentContext,
  actorUserId: string | null,
): Promise<void> {
  const rule = await getPrimaryRecurrenceRuleRow(client, context.id);
  if (!rule || rule.status !== 'active') {
    return;
  }
  const slots = await listRecurrenceSlots(client, rule.id);
  if (slots.length === 0) {
    return;
  }

  const today = toDateInputInTimeZone(new Date(), normalizeTimezone(rule.timezone));
  const fromDate = compareDateInputs(rule.starts_on, today) > 0 ? rule.starts_on : today;
  const horizonEnd = addDaysToDateInput(today, rule.generation_horizon_days);
  const throughDate =
    rule.ends_on && compareDateInputs(rule.ends_on, horizonEnd) < 0 ? rule.ends_on : horizonEnd;
  if (compareDateInputs(throughDate, fromDate) < 0) {
    return;
  }

  const occurrences = buildWeeklyOccurrences(fromDate, throughDate, slots);
  for (const occurrence of occurrences) {
    await client.query(
      `
      INSERT INTO student_lessons (
        id,
        student_id,
        workspace_id,
        starts_at,
        timezone,
        duration_minutes,
        status,
        consumes_credit,
        title,
        notes,
        recurrence_rule_id,
        recurrence_slot_id,
        recurrence_occurrence_key,
        recurrence_origin,
        created_by,
        updated_by
      )
      VALUES (
        $1,
        $2,
        $3,
        ($4::timestamp AT TIME ZONE $5),
        $5,
        $6,
        'scheduled',
        TRUE,
        NULL,
        NULL,
        $7,
        $8,
        $9,
        'generated',
        $10,
        $10
      )
      ON CONFLICT DO NOTHING
      `,
      [
        randomUUID(),
        context.id,
        context.workspaceId,
        `${occurrence.localDate} ${occurrence.localStartTime}`,
        normalizeTimezone(rule.timezone),
        occurrence.durationMinutes,
        rule.id,
        occurrence.slotId,
        occurrence.occurrenceKey,
        actorUserId,
      ],
    );
  }

  await client.query(
    `
    UPDATE student_lesson_recurrence_rules
    SET materialized_through = $2::date,
        updated_at = NOW()
    WHERE id = $1
    `,
    [rule.id, throughDate],
  );
}

export async function materializeWorkspaceLessonRecurrences(): Promise<void> {
  await withPgClient(async (client) => {
    await materializeWorkspaceLessonRecurrencesWithClient(client);
  });
}

export async function materializeWorkspaceLessonRecurrencesWithClient(
  client: PoolClient,
): Promise<void> {
  const result = await client.query<{
    id: string;
    student: string;
    workspace_id: string | null;
  }>(
    `
    SELECT DISTINCT students.id, students.student, COALESCE(students.workspace_id, $1::uuid) AS workspace_id
    FROM students
    JOIN student_lesson_recurrence_rules ON student_lesson_recurrence_rules.student_id = students.id
    WHERE students.archived_at IS NULL
      AND student_lesson_recurrence_rules.status = 'active'
    ORDER BY students.id ASC
    `,
    [DEFAULT_WORKSPACE_ID],
  );
  for (const row of result.rows) {
    await materializeStudentRecurrenceForContext(
      client,
      { id: row.id, name: row.student, workspaceId: row.workspace_id },
      null,
    );
  }
}

async function markFutureGeneratedLessonsObsolete(
  client: PoolClient,
  ruleId: string,
  actorUserId: string | null,
  desiredOccurrenceKeys: Set<string>,
): Promise<void> {
  const desiredKeys = [...desiredOccurrenceKeys];
  const desiredKeyClause =
    desiredKeys.length > 0 ? 'AND NOT (recurrence_occurrence_key = ANY($3::text[]))' : '';
  await client.query(
    `
    UPDATE student_lessons
    SET recurrence_obsolete_at = NOW(),
        recurrence_obsolete_by = $2,
        recurrence_obsolete_reason = 'recurrence_rule_changed',
        updated_by = $2,
        updated_at = NOW()
    WHERE recurrence_rule_id = $1
      AND recurrence_origin = 'generated'
      AND recurrence_override_kind IS NULL
      AND status = 'scheduled'
      AND starts_at >= NOW()
      AND recurrence_obsolete_at IS NULL
      ${desiredKeyClause}
    `,
    desiredKeys.length > 0 ? [ruleId, actorUserId, desiredKeys] : [ruleId, actorUserId],
  );
}

async function getReminderPreferences(
  client: PoolClient,
  context: StudentContext,
): Promise<ReminderPreferences> {
  const result = await client.query<{
    preferred_channel: 'manual' | 'telegram' | 'email';
    low_balance_threshold: number;
    enable_upcoming_lesson: boolean;
    enable_low_balance: boolean;
    enable_payment_followup: boolean;
    hidden_lesson_followup_keys: string[];
    latest_hidden_lesson_followup_key: string | null;
    latest_hidden_lesson_followup_lesson_id: string | null;
    latest_hidden_lesson_followup_at: Date | null;
  }>(
    `
    SELECT preferred_channel, low_balance_threshold, enable_upcoming_lesson,
           enable_low_balance, enable_payment_followup, hidden_lesson_followup_keys,
           latest_hidden_lesson_followup_key, latest_hidden_lesson_followup_lesson_id,
           latest_hidden_lesson_followup_at
    FROM student_reminder_preferences
    WHERE student_id = $1
    `,
    [context.id],
  );
  return {
    preferredChannel: result.rows[0]?.preferred_channel ?? 'manual',
    lowBalanceThreshold: result.rows[0]?.low_balance_threshold ?? DEFAULT_LOW_BALANCE_THRESHOLD,
    enableUpcomingLesson: result.rows[0]?.enable_upcoming_lesson ?? true,
    enableLowBalance: result.rows[0]?.enable_low_balance ?? true,
    enablePaymentFollowup: result.rows[0]?.enable_payment_followup ?? true,
    hiddenLessonFollowupKeys: new Set(result.rows[0]?.hidden_lesson_followup_keys ?? []),
    latestHiddenLessonFollowupKey: result.rows[0]?.latest_hidden_lesson_followup_key ?? null,
    latestHiddenLessonFollowupLessonId:
      result.rows[0]?.latest_hidden_lesson_followup_lesson_id ?? null,
    latestHiddenLessonFollowupAt: result.rows[0]?.latest_hidden_lesson_followup_at ?? null,
  };
}

async function getCreditSummary(
  client: PoolClient,
  studentId: string,
  lowBalanceThreshold: number,
): Promise<StudentCreditSummaryDto> {
  const result = await client.query<{
    purchased: string | number | null;
    consumed: string | number | null;
    adjustments: string | number | null;
    remaining: string | number | null;
  }>(
    `
    SELECT
      COALESCE(SUM(quantity_delta) FILTER (WHERE event_type = 'credit_added'), 0) AS purchased,
      ABS(COALESCE(SUM(quantity_delta) FILTER (WHERE event_type = 'credit_consumed'), 0)) AS consumed,
      COALESCE(SUM(quantity_delta) FILTER (WHERE event_type = 'credit_adjusted'), 0) AS adjustments,
      COALESCE(SUM(quantity_delta), 0) AS remaining
    FROM student_credit_events
    WHERE student_id = $1
      AND voided_at IS NULL
    `,
    [studentId],
  );
  const row = result.rows[0];
  const purchased = Number(row?.purchased ?? 0);
  const consumed = Number(row?.consumed ?? 0);
  const adjustments = Number(row?.adjustments ?? 0);
  const remaining = Number(row?.remaining ?? 0);
  return {
    purchased,
    consumed,
    adjustments,
    remaining,
    lowBalanceThreshold,
    isLow: remaining <= lowBalanceThreshold,
    isNegative: remaining < 0,
  };
}

async function getNextLesson(client: PoolClient, studentId: string): Promise<LessonRow | null> {
  const result = await client.query<LessonRow>(
    `
    SELECT ${LESSON_HOMEWORK_SELECT}
    FROM student_lessons
    ${LESSON_HOMEWORK_JOINS}
    WHERE student_id = $1
      AND recurrence_obsolete_at IS NULL
      AND status = 'scheduled'
      AND starts_at >= NOW()
    ORDER BY starts_at ASC, id ASC
    LIMIT 1
    `,
    [studentId],
  );
  return result.rows[0] ?? null;
}

async function listLessons(client: PoolClient, studentId: string): Promise<LessonRow[]> {
  const result = await client.query<LessonRow>(
    `
    SELECT ${LESSON_HOMEWORK_SELECT}
    FROM student_lessons
    ${LESSON_HOMEWORK_JOINS}
    WHERE student_id = $1
      AND recurrence_obsolete_at IS NULL
    ORDER BY starts_at DESC, id DESC
    LIMIT 30
    `,
    [studentId],
  );
  return result.rows;
}

async function listOverdueLessonHomeworkFollowups(
  client: PoolClient,
  studentId: string,
): Promise<LessonRow[]> {
  const result = await client.query<LessonRow>(
    `
    SELECT ${LESSON_HOMEWORK_SELECT}
    FROM student_lessons
    ${LESSON_HOMEWORK_JOINS}
    WHERE student_id = $1
      AND recurrence_obsolete_at IS NULL
      AND status IN ('scheduled', 'completed')
      AND starts_at + (duration_minutes * INTERVAL '1 minute') <= NOW()
      AND lesson_homework_memory.id IS NULL
      AND lesson_published_job.id IS NULL
    ORDER BY starts_at DESC, id DESC
    LIMIT 30
    `,
    [studentId],
  );
  return result.rows.filter(isLessonHomeworkFollowUpDue);
}

async function listCreditEvents(client: PoolClient, studentId: string): Promise<CreditEventRow[]> {
  const result = await client.query<CreditEventRow>(
    `
    SELECT *
    FROM student_credit_events
    WHERE student_id = $1
      AND voided_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 50
    `,
    [studentId],
  );
  return result.rows;
}

async function listPayments(client: PoolClient, studentId: string): Promise<PaymentRow[]> {
  const result = await client.query<PaymentRow>(
    `
    SELECT
      id,
      student_id,
      workspace_id,
      amount_minor,
      currency,
      method,
      received_at::text AS received_at,
      external_url,
      note,
      voided_at,
      created_at
    FROM student_payment_records
    WHERE student_id = $1
      AND voided_at IS NULL
    ORDER BY received_at DESC, created_at DESC, id DESC
    LIMIT 20
    `,
    [studentId],
  );
  return result.rows;
}

async function getLessonRow(
  client: PoolClient,
  studentId: string,
  lessonId: string,
): Promise<LessonRow | null> {
  const result = await client.query<LessonRow>(
    `
    SELECT ${LESSON_HOMEWORK_SELECT}
    FROM student_lessons
    ${LESSON_HOMEWORK_JOINS}
    WHERE student_lessons.id = $1
      AND student_lessons.student_id = $2
    `,
    [lessonId, studentId],
  );
  return result.rows[0] ?? null;
}

async function reconcileLessonCreditEvent(
  client: PoolClient,
  lessonId: string,
  actorUserId: string | null,
): Promise<void> {
  const result = await client.query<LessonRow>('SELECT * FROM student_lessons WHERE id = $1', [
    lessonId,
  ]);
  const lesson = result.rows[0];
  if (!lesson) return;

  const shouldConsume = lesson.status === 'completed' && lesson.consumes_credit;
  if (shouldConsume && !lesson.credit_event_id) {
    const eventId = await insertCreditEvent(client, {
      context: {
        id: lesson.student_id,
        name: '',
        workspaceId: lesson.workspace_id,
      },
      eventType: 'credit_consumed',
      quantityDelta: -1,
      sourceLessonId: lesson.id,
      sourcePaymentId: null,
      note: 'Lesson completed',
      actorUserId,
    });
    await client.query('UPDATE student_lessons SET credit_event_id = $2 WHERE id = $1', [
      lesson.id,
      eventId,
    ]);
  } else if (!shouldConsume && lesson.credit_event_id) {
    await client.query(
      `
      UPDATE student_credit_events
      SET voided_at = COALESCE(voided_at, NOW()),
          voided_by = $2
      WHERE id = $1
      `,
      [lesson.credit_event_id, actorUserId],
    );
    await client.query('UPDATE student_lessons SET credit_event_id = NULL WHERE id = $1', [
      lesson.id,
    ]);
  }
}

async function insertCreditEvent(
  client: PoolClient,
  params: {
    context: StudentContext;
    eventType: StudentCreditEventDto['eventType'];
    quantityDelta: number;
    sourceLessonId: string | null;
    sourcePaymentId: string | null;
    note: string | null;
    actorUserId: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `
    INSERT INTO student_credit_events (
      id, student_id, workspace_id, event_type, quantity_delta,
      source_lesson_id, source_payment_id, note, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      id,
      params.context.id,
      params.context.workspaceId,
      params.eventType,
      params.quantityDelta,
      params.sourceLessonId,
      params.sourcePaymentId,
      params.note,
      params.actorUserId,
    ],
  );
  return id;
}

async function insertPayment(
  client: PoolClient,
  context: StudentContext,
  id: string,
  params: RecordStudentPaymentRequest,
  actorUserId: string | null,
): Promise<void> {
  await client.query(
    `
    INSERT INTO student_payment_records (
      id, student_id, workspace_id, amount_minor, currency, method,
      received_at, external_url, note, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8, $9, $10)
    `,
    [
      id,
      context.id,
      context.workspaceId,
      params.amountMinor,
      params.currency.toUpperCase(),
      params.method ?? null,
      params.receivedAt ?? null,
      params.externalUrl ?? null,
      params.note ?? null,
      actorUserId,
    ],
  );
}

function buildReminderRecommendations(params: {
  studentName: string;
  nextLesson: LessonRow | null;
  elapsedHomeworkFollowups: LessonRow[];
  creditSummary: StudentCreditSummaryDto;
  preferredChannel: 'manual' | 'telegram' | 'email';
  enableUpcomingLesson: boolean;
  enableLowBalance: boolean;
  enablePaymentFollowup: boolean;
}): StudentReminderRecommendationDto[] {
  const recommendations: StudentReminderRecommendationDto[] = [];
  const channel = params.preferredChannel;
  if (params.enableUpcomingLesson && !params.nextLesson) {
    recommendations.push({
      type: 'no_next_lesson',
      channel,
      actionIntent: 'copy_text',
      severity: 'attention',
      title: 'Schedule the next lesson',
      message: 'No upcoming lesson is scheduled.',
      copyText: `Hi ${params.studentName}, let's schedule our next English lesson.`,
    });
  }
  if (params.enableLowBalance && params.creditSummary.isLow) {
    const remaining = params.creditSummary.remaining;
    recommendations.push({
      type: 'low_balance',
      channel,
      actionIntent: 'copy_text',
      severity: remaining < 0 ? 'urgent' : 'attention',
      title: remaining < 0 ? 'Balance is negative' : 'Lesson credits are low',
      message: `${remaining} lesson credit${Math.abs(remaining) === 1 ? '' : 's'} remaining.`,
      copyText:
        remaining < 0
          ? `Hi ${params.studentName}, your lesson balance is currently ${remaining}. Please top up when you can.`
          : `Hi ${params.studentName}, you have ${remaining} lesson credit${remaining === 1 ? '' : 's'} remaining. Would you like to top up?`,
    });
  }
  if (params.enablePaymentFollowup && params.creditSummary.remaining <= 0) {
    recommendations.push({
      type: 'payment_followup',
      channel,
      actionIntent: 'copy_text',
      severity: params.creditSummary.remaining < 0 ? 'urgent' : 'attention',
      title: 'Payment follow-up ready',
      message: 'The student needs new paid lesson credits.',
      copyText: `Hi ${params.studentName}, please send payment for the next lesson package when convenient.`,
    });
  }
  for (const lesson of params.elapsedHomeworkFollowups) {
    recommendations.push({
      type: 'lesson_followup',
      channel: 'manual',
      actionIntent: 'complete_lesson_and_start_assignment',
      lessonId: lesson.id,
      lessonStatus: lesson.status,
      lessonConsumesCredit: lesson.consumes_credit,
      lessonSummary: mapLessonSummary(lesson),
      severity: 'attention',
      title: 'Finish lesson follow-up',
      message: 'The scheduled lesson time has passed and homework is not published yet.',
      copyText: `Complete ${params.studentName}'s lesson record and start the homework assignment.`,
    });
  }
  return recommendations;
}

async function upsertReminderSuppression(
  client: PoolClient,
  context: StudentContext,
  params: {
    suppressionKey: string;
    lessonId: string;
    actorUserId: string | null;
  },
): Promise<void> {
  await client.query(
    `
    INSERT INTO student_reminder_preferences (
      student_id,
      workspace_id,
      hidden_lesson_followup_keys,
      latest_hidden_lesson_followup_key,
      latest_hidden_lesson_followup_lesson_id,
      latest_hidden_lesson_followup_at,
      updated_by
    )
    VALUES ($1, $2, ARRAY[$3]::text[], $3, $4, NOW(), $5)
    ON CONFLICT (student_id) DO UPDATE
    SET workspace_id = EXCLUDED.workspace_id,
        hidden_lesson_followup_keys = CASE
          WHEN student_reminder_preferences.hidden_lesson_followup_keys @> ARRAY[$3]::text[]
            THEN student_reminder_preferences.hidden_lesson_followup_keys
          ELSE array_append(student_reminder_preferences.hidden_lesson_followup_keys, $3)
        END,
        latest_hidden_lesson_followup_key = $3,
        latest_hidden_lesson_followup_lesson_id = $4,
        latest_hidden_lesson_followup_at = NOW(),
        updated_by = $5,
        updated_at = NOW()
    `,
    [context.id, context.workspaceId, params.suppressionKey, params.lessonId, params.actorUserId],
  );
}

async function getLatestHiddenReminder(
  client: PoolClient,
  context: StudentContext,
  prefs: ReminderPreferences,
): Promise<StudentLatestHiddenReminderDto | null> {
  if (!prefs.latestHiddenLessonFollowupLessonId) return null;
  const lesson = await getLessonRow(client, context.id, prefs.latestHiddenLessonFollowupLessonId);
  return {
    type: 'lesson_followup',
    lessonId: prefs.latestHiddenLessonFollowupLessonId,
    hiddenAt: prefs.latestHiddenLessonFollowupAt
      ? prefs.latestHiddenLessonFollowupAt.toISOString()
      : null,
    lessonSummary: lesson ? mapLessonSummary(lesson) : null,
  };
}

function getLessonFollowupSuppressionKey(context: StudentContext, lessonId: string): string {
  return [
    context.workspaceId ?? DEFAULT_WORKSPACE_ID,
    context.id,
    lessonId,
    'lesson_followup',
  ].join(':');
}

function mapLessonSummary(row: LessonRow): StudentReminderLessonSummaryDto {
  return {
    lessonId: row.id,
    startsAt: row.starts_at ? row.starts_at.toISOString() : null,
    durationMinutes: row.duration_minutes ?? null,
    title: row.title ?? null,
  };
}

async function ensureDefaultWorkspace(client: PoolClient): Promise<void> {
  await client.query(
    `
    INSERT INTO workspaces (id, name)
    VALUES ($1, 'Default workspace')
    ON CONFLICT (id) DO NOTHING
    `,
    [DEFAULT_WORKSPACE_ID],
  );
}

async function withPgTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

function normalizeRecurrenceSlots(slots: UpsertStudentLessonRecurrenceRequest['slots']) {
  if (!Array.isArray(slots) || slots.length === 0) {
    throw new StudentScheduleBillingError(
      'invalid_request',
      400,
      'At least one recurrence slot is required',
    );
  }
  return slots.map((slot) => {
    if (!Number.isInteger(slot.isoWeekday) || slot.isoWeekday < 1 || slot.isoWeekday > 7) {
      throw new StudentScheduleBillingError('invalid_request', 400, 'Invalid recurrence weekday');
    }
    if (!/^\d{2}:\d{2}$/.test(slot.localStartTime)) {
      throw new StudentScheduleBillingError(
        'invalid_request',
        400,
        'Invalid recurrence start time',
      );
    }
    const [hoursText, minutesText] = slot.localStartTime.split(':');
    const hours = Number(hoursText);
    const minutes = Number(minutesText);
    if (hours > 23 || minutes > 59) {
      throw new StudentScheduleBillingError(
        'invalid_request',
        400,
        'Invalid recurrence start time',
      );
    }
    if (
      !Number.isInteger(slot.durationMinutes) ||
      slot.durationMinutes <= 0 ||
      slot.durationMinutes > 24 * 60
    ) {
      throw new StudentScheduleBillingError('invalid_request', 400, 'Invalid recurrence duration');
    }
    return {
      isoWeekday: slot.isoWeekday,
      localStartTime: slot.localStartTime,
      durationMinutes: slot.durationMinutes,
    };
  });
}

function recurrenceSlotIdentity(slot: NormalizedRecurrenceSlot): string {
  return `${slot.isoWeekday}|${slot.localStartTime}|${slot.durationMinutes}`;
}

function recurrenceSlotIdentityFromRow(slot: RecurrenceSlotRow): string {
  return recurrenceSlotIdentity({
    isoWeekday: slot.iso_weekday,
    localStartTime: slot.local_start_time.slice(0, 5),
    durationMinutes: slot.duration_minutes,
  });
}

function buildDesiredOccurrenceKeys(params: {
  timezone: string;
  startsOn: string;
  endsOn: string | null;
  status: RecurrenceRuleRow['status'];
  generationHorizonDays: number;
  slots: RecurrenceSlotRow[];
}): Set<string> {
  if (params.status !== 'active' || params.slots.length === 0) {
    return new Set();
  }
  const today = toDateInputInTimeZone(new Date(), normalizeTimezone(params.timezone));
  const fromDate = compareDateInputs(params.startsOn, today) > 0 ? params.startsOn : today;
  const horizonEnd = addDaysToDateInput(today, params.generationHorizonDays);
  const throughDate =
    params.endsOn && compareDateInputs(params.endsOn, horizonEnd) < 0 ? params.endsOn : horizonEnd;
  if (compareDateInputs(throughDate, fromDate) < 0) {
    return new Set();
  }
  return new Set(
    buildWeeklyOccurrences(fromDate, throughDate, params.slots).map(
      (occurrence) => occurrence.occurrenceKey,
    ),
  );
}

function buildWeeklyOccurrences(
  fromDate: string,
  throughDate: string,
  slots: RecurrenceSlotRow[],
): {
  slotId: string;
  localDate: string;
  localStartTime: string;
  durationMinutes: number;
  occurrenceKey: string;
}[] {
  const occurrences: {
    slotId: string;
    localDate: string;
    localStartTime: string;
    durationMinutes: number;
    occurrenceKey: string;
  }[] = [];
  for (
    let date = fromDate;
    compareDateInputs(date, throughDate) <= 0;
    date = addDaysToDateInput(date, 1)
  ) {
    const weekday = isoWeekdayForDateInput(date);
    for (const slot of slots) {
      if (slot.iso_weekday !== weekday) {
        continue;
      }
      const localStartTime = slot.local_start_time.slice(0, 5);
      occurrences.push({
        slotId: slot.id,
        localDate: date,
        localStartTime,
        durationMinutes: slot.duration_minutes,
        occurrenceKey: `${slot.id}:${date}`,
      });
    }
  }
  return occurrences;
}

function getNextOverrideKind(
  existing: LessonRow,
  params: UpdateStudentLessonRequest,
  nextStatus: StudentLessonStatus,
  nextStartsAt: string,
): LessonRow['recurrence_override_kind'] {
  if (existing.recurrence_origin !== 'generated') {
    return existing.recurrence_override_kind;
  }
  if (nextStatus === 'canceled' && existing.status !== 'canceled') {
    return 'manual_cancel';
  }
  if (params.startsAt && params.startsAt !== existing.starts_at.toISOString()) {
    return 'manual_reschedule';
  }
  if (
    nextStartsAt !== existing.starts_at.toISOString() ||
    params.durationMinutes !== undefined ||
    params.timezone !== undefined ||
    params.consumesCredit !== undefined ||
    params.title !== undefined ||
    params.notes !== undefined
  ) {
    return 'manual_edit';
  }
  return existing.recurrence_override_kind;
}

function parseDateInput(value: string, message: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new StudentScheduleBillingError('invalid_request', 400, message);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new StudentScheduleBillingError('invalid_request', 400, message);
  }
  return value;
}

function toDateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDaysToDateInput(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return toDateInput(new Date(date.getTime() + days * DAY_MS));
}

function compareDateInputs(left: string, right: string): number {
  return left.localeCompare(right);
}

function isoWeekdayForDateInput(value: string): number {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function toDateInputInTimeZone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  return `${partMap.get('year')}-${partMap.get('month')}-${partMap.get('day')}`;
}

function normalizeTimezone(timezone: string): string {
  const trimmed = timezone.trim();
  const alias = TIMEZONE_ALIASES.get(trimmed.toUpperCase());
  const normalized = alias ?? normalizeFixedOffsetTimezone(trimmed) ?? trimmed;
  try {
    toDateInputInTimeZone(new Date(), normalized);
    return normalized;
  } catch {
    throw new StudentScheduleBillingError('invalid_request', 400, 'Invalid timezone');
  }
}

function normalizeFixedOffsetTimezone(timezone: string): string | null {
  const match = /^(?:UTC|GMT)([+-])(\d{1,2})(?::?00)?$/i.exec(timezone.trim());
  if (!match) {
    return null;
  }
  const sign = match[1];
  const hours = Number(match[2]);
  if (!Number.isInteger(hours) || hours > 14) {
    return null;
  }
  if (hours === 0) {
    return 'UTC';
  }
  const etcSign = sign === '+' ? '-' : '+';
  return `Etc/GMT${etcSign}${hours}`;
}

function mapRecurrenceRule(
  row: RecurrenceRuleRow,
  slots: RecurrenceSlotRow[],
): StudentLessonRecurrenceRuleDto {
  return {
    id: row.id,
    studentId: row.student_id,
    workspaceId: row.workspace_id ?? null,
    timezone: normalizeTimezone(row.timezone),
    frequency: row.frequency,
    startsOn: row.starts_on,
    endsOn: row.ends_on ?? null,
    status: row.status,
    generationHorizonDays: row.generation_horizon_days,
    materializedThrough: row.materialized_through ?? null,
    slots: slots.map(mapRecurrenceSlot),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRecurrenceSlot(row: RecurrenceSlotRow): StudentLessonRecurrenceSlotDto {
  return {
    id: row.id,
    ruleId: row.rule_id,
    isoWeekday: row.iso_weekday,
    localStartTime: row.local_start_time.slice(0, 5),
    durationMinutes: row.duration_minutes,
    sortOrder: row.sort_order,
  };
}

function mapLesson(row: LessonRow): StudentLessonDto {
  return {
    id: row.id,
    studentId: row.student_id,
    workspaceId: row.workspace_id ?? null,
    startsAt: row.starts_at.toISOString(),
    timezone: row.timezone,
    durationMinutes: row.duration_minutes,
    status: row.status,
    consumesCredit: row.consumes_credit,
    title: row.title ?? null,
    notes: row.notes ?? null,
    creditEventId: row.credit_event_id ?? null,
    recurrenceRuleId: row.recurrence_rule_id ?? null,
    recurrenceSlotId: row.recurrence_slot_id ?? null,
    recurrenceOccurrenceKey: row.recurrence_occurrence_key ?? null,
    recurrenceOrigin: row.recurrence_origin ?? 'manual',
    recurrenceOverrideKind: row.recurrence_override_kind ?? null,
    homework: mapLessonHomework(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapLessonHomework(row: LessonRow): StudentLessonHomeworkDto {
  return {
    status: row.homework_status ?? 'not_started',
    assignmentSessionId: row.homework_assignment_session_id ?? null,
    promptPackageId: row.homework_prompt_package_id ?? null,
    draftId: row.homework_draft_id ?? null,
    jobId: row.homework_job_id ?? null,
    homeworkMemoryEntryId: row.homework_memory_entry_id ?? null,
    htmlUrl: row.homework_html_url ?? null,
    updatedAt: row.homework_updated_at ? row.homework_updated_at.toISOString() : null,
  };
}

function isLessonHomeworkFollowUpDue(lesson: LessonRow): boolean {
  if (!['scheduled', 'completed'].includes(lesson.status)) return false;
  if (lesson.homework_status === 'published' || lesson.homework_status === 'memory_ready') {
    return false;
  }
  const endsAt = lesson.starts_at.getTime() + lesson.duration_minutes * 60 * 1000;
  return endsAt <= Date.now();
}

function mapCreditEvent(row: CreditEventRow): StudentCreditEventDto {
  return {
    id: row.id,
    studentId: row.student_id,
    workspaceId: row.workspace_id ?? null,
    eventType: row.event_type,
    quantityDelta: row.quantity_delta,
    sourceLessonId: row.source_lesson_id ?? null,
    sourcePaymentId: row.source_payment_id ?? null,
    note: row.note ?? null,
    voidedAt: row.voided_at ? row.voided_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapPayment(row: PaymentRow): StudentPaymentRecordDto {
  const receivedAt =
    row.received_at instanceof Date
      ? row.received_at.toISOString().slice(0, 10)
      : String(row.received_at);
  return {
    id: row.id,
    studentId: row.student_id,
    workspaceId: row.workspace_id ?? null,
    amountMinor: row.amount_minor,
    currency: row.currency,
    method: row.method ?? null,
    receivedAt,
    externalUrl: row.external_url ?? null,
    note: row.note ?? null,
    voidedAt: row.voided_at ? row.voided_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}
