import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type {
  AddStudentPackageRequest,
  CreateStudentLessonRequest,
  RecordStudentPaymentRequest,
  StudentCreditEventDto,
  StudentCreditSummaryDto,
  StudentLessonDto,
  StudentLessonPlanDto,
  StudentLessonStatus,
  StudentPaymentRecordDto,
  StudentReminderRecommendationDto,
  StudentScheduleBillingSurfaceResponse,
  UpdateStudentLessonPlanRequest,
  UpdateStudentLessonRequest,
} from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_LOW_BALANCE_THRESHOLD = 2;

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
  created_at: Date;
  updated_at: Date;
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

interface ReminderPreferences {
  preferredChannel: 'manual' | 'telegram' | 'email';
  lowBalanceThreshold: number;
  enableUpcomingLesson: boolean;
  enableLowBalance: boolean;
  enablePaymentFollowup: boolean;
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

export async function getStudentScheduleBillingSurface(
  studentId: string,
): Promise<StudentScheduleBillingSurfaceResponse | null> {
  return withPgClient(async (client) => {
    const context = await getStudentContext(client, studentId);
    if (!context) return null;
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
        created_by,
        updated_by,
        completed_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12)
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
        completed_by = CASE
          WHEN $6 = 'completed' AND status <> 'completed' THEN $10
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
  const plan = await getLessonPlan(client, context);
  const nextLesson = await getNextLesson(client, context.id);
  const lessons = await listLessons(client, context.id);
  const creditEvents = await listCreditEvents(client, context.id);
  const payments = await listPayments(client, context.id);
  const reminderPrefs = await getReminderPreferences(client, context);
  const creditSummary = await getCreditSummary(
    client,
    context.id,
    reminderPrefs.lowBalanceThreshold,
  );

  return {
    studentId: context.id,
    workspaceId: context.workspaceId,
    lessonPlan: plan,
    nextLesson: nextLesson ? mapLesson(nextLesson) : null,
    lessons: lessons.map((lesson) => mapLesson(lesson)),
    creditSummary,
    creditEvents: creditEvents.map((event) => mapCreditEvent(event)),
    payments: payments.map((payment) => mapPayment(payment)),
    reminders: buildReminderRecommendations({
      studentName: context.name,
      nextLesson,
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
  }>(
    `
    SELECT preferred_channel, low_balance_threshold, enable_upcoming_lesson,
           enable_low_balance, enable_payment_followup
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
    SELECT *
    FROM student_lessons
    WHERE student_id = $1
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
    SELECT *
    FROM student_lessons
    WHERE student_id = $1
    ORDER BY starts_at DESC, id DESC
    LIMIT 30
    `,
    [studentId],
  );
  return result.rows;
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
    'SELECT * FROM student_lessons WHERE id = $1 AND student_id = $2',
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
      severity: params.creditSummary.remaining < 0 ? 'urgent' : 'attention',
      title: 'Payment follow-up ready',
      message: 'The student needs new paid lesson credits.',
      copyText: `Hi ${params.studentName}, please send payment for the next lesson package when convenient.`,
    });
  }
  return recommendations;
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
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
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
