import type {
  StudentActivityCategory,
  StudentActivityFact,
  StudentActivityItem,
  StudentActivityResponse,
} from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';

export interface StudentActivityParams {
  category?: 'all' | 'lessons' | 'profile' | 'billing';
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export class StudentActivityQueryError extends Error {}

interface ActivityRow {
  id: string;
  type: string;
  category: StudentActivityCategory;
  occurred_at: Date;
  sort_at: string;
  upper_at: string;
  entity_id: string;
  payload: Record<string, unknown>;
  evidence: StudentActivityItem['evidence'];
  actor_kind: 'user' | 'system' | 'unknown';
  actor_user_id: string | null;
  effects: StudentActivityFact[];
}

// One mandatory query owns all parent identities, filtering and ordering. Related
// credit effects attach only AFTER parents have been paged, by persisted identity.
const activityQuery = `
WITH authorized_student AS (
  SELECT id, workspace_id FROM students WHERE id=$1 AND (workspace_id=$2 OR (workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid))
), parents AS (
  SELECT 'activity:'||a.id::text AS id,a.type,a.category,a.occurred_at,a.entity_id,a.payload,
    'recorded'::text AS evidence,a.actor_kind,a.actor_user_id
  FROM student_activity a JOIN authorized_student s ON s.id=a.student_id AND COALESCE(a.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)=$2
  WHERE (a.type<>'homework_started' OR EXISTS (SELECT 1 FROM assignment_sessions own WHERE own.id=a.entity_id AND own.user_id=$3 AND own.student_id=s.id))
    AND (a.type<>'homework_failed' OR EXISTS (SELECT 1 FROM jobs own WHERE own.id=a.entity_id AND own.user_id=$3 AND own.student_id=s.id))

  UNION ALL
  SELECT 'student:'||s.id,'student_created','lifecycle',s.created_at,s.id,
    jsonb_build_object('name',s.student),'legacy','unknown',NULL::uuid
  FROM students s JOIN authorized_student auth ON auth.id=s.id
  WHERE NOT EXISTS (SELECT 1 FROM student_activity a WHERE a.student_id=s.id AND a.type='student_created')

  UNION ALL
  SELECT 'lesson:'||l.id,'lesson_created','lessons',l.created_at,l.id,
    jsonb_build_object('after',jsonb_build_object('startsAt',l.starts_at,'timezone',l.timezone,
      'durationMinutes',l.duration_minutes,'title',l.title,'status',l.status),
      'generated',l.recurrence_origin='generated'),'legacy','unknown',NULL::uuid
  FROM student_lessons l JOIN authorized_student s ON s.id=l.student_id
  WHERE (l.workspace_id=$2 OR (l.workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid)) AND l.recurrence_obsolete_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM student_activity a WHERE a.student_id=s.id AND a.entity_id=l.id AND a.type='lesson_created')

  UNION ALL
  SELECT 'revision:'||r.id,CASE WHEN r.restored_from_revision_id IS NULL THEN 'profile_saved' ELSE 'profile_restored' END,
    'profile',r.created_at,r.id,jsonb_build_object('version',r.version_label,'source',r.source,
      'restoredFromRevisionId',r.restored_from_revision_id),'retained','unknown',NULL::uuid
  FROM student_profile_revisions r JOIN authorized_student s ON s.id=r.student_id
  WHERE NOT EXISTS (SELECT 1 FROM student_activity a WHERE a.student_id=s.id AND a.entity_id=r.id AND a.type IN ('profile_saved','profile_restored'))

  UNION ALL
  SELECT 'candidate-review:'||c.id,'candidate_'||c.review_state,'profile',c.reviewed_at,c.id,
    jsonb_build_object('section',c.target_section,'fact',COALESCE(c.approved_fact,c.fact),
      'note',c.reviewer_note),'retained','unknown',NULL::uuid
  FROM student_profile_candidates c JOIN authorized_student s ON s.id=c.student_id
  WHERE c.reviewed_at IS NOT NULL AND c.review_state IN ('approved','rejected','deferred')
    AND NOT EXISTS (SELECT 1 FROM student_activity a WHERE a.student_id=s.id AND a.entity_id=c.id AND a.type IN ('candidate_approved','candidate_rejected','candidate_deferred'))

  UNION ALL
  SELECT 'candidate-promotion:'||c.id,'candidate_promoted','profile',c.promoted_at,c.id,
    jsonb_build_object('section',c.target_section,'fact',COALESCE(c.approved_fact,c.fact),
      'promotedRevisionId',c.promoted_revision_id),'retained','unknown',NULL::uuid
  FROM student_profile_candidates c JOIN authorized_student s ON s.id=c.student_id
  WHERE c.promoted_at IS NOT NULL AND NOT EXISTS
    (SELECT 1 FROM student_activity a WHERE a.student_id=s.id AND a.entity_id=c.id AND a.type='candidate_promoted')

  UNION ALL
  SELECT 'payment:'||p.id,'payment_recorded','billing',p.created_at,p.id,
    jsonb_build_object('amountMinor',p.amount_minor,'currency',p.currency,'receivedAt',p.received_at,
      'method',p.method,'note',p.note),'retained','unknown',NULL::uuid
  FROM student_payment_records p JOIN authorized_student s ON s.id=p.student_id
  WHERE (p.workspace_id=$2 OR (p.workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid))

  UNION ALL
  SELECT 'payment-void:'||p.id,'payment_voided','billing',p.voided_at,p.id,
    jsonb_build_object('amountMinor',p.amount_minor,'currency',p.currency,'receivedAt',p.received_at),'retained','unknown',NULL::uuid
  FROM student_payment_records p JOIN authorized_student s ON s.id=p.student_id
  WHERE (p.workspace_id=$2 OR (p.workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid)) AND p.voided_at IS NOT NULL

  UNION ALL
  SELECT 'credit:'||c.id,CASE c.event_type WHEN 'credit_added' THEN 'credits_added'
    WHEN 'credit_consumed' THEN 'credits_consumed' ELSE 'credits_adjusted' END,
    'billing',c.created_at,c.id,jsonb_build_object('quantity',c.quantity_delta,'note',c.note,
      'lessonId',c.source_lesson_id,'paymentId',c.source_payment_id),'retained','unknown',NULL::uuid
  FROM student_credit_events c JOIN authorized_student s ON s.id=c.student_id
  WHERE (c.workspace_id=$2 OR (c.workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid)) AND c.activity_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM student_payment_records p WHERE p.id=c.source_payment_id AND p.student_id=s.id AND (p.workspace_id=$2 OR (p.workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid)))

  UNION ALL
  SELECT 'credit-reversal:'||c.id,'credits_reversed','billing',c.voided_at,c.id,
    jsonb_build_object('quantity',-c.quantity_delta,'note',c.note,'lessonId',c.source_lesson_id),
    'retained','unknown',NULL::uuid
  FROM student_credit_events c JOIN authorized_student s ON s.id=c.student_id
  WHERE (c.workspace_id=$2 OR (c.workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid)) AND c.voided_at IS NOT NULL AND c.reversal_activity_id IS NULL

  UNION ALL
  SELECT 'transcript:'||a.id||':'||(finish.event->>'resultingRevision'),'transcript_saved','lessons',
    (finish.event->>'completedAt')::timestamptz,a.id,
    jsonb_build_object('source',finish.event->'source','revision',finish.event->'resultingRevision',
      'homeworkIntent',a.homework_intent,'lessonId',finish.event#>>'{source,lessonId}'),
    'retained','user',a.user_id
  FROM assignment_sessions a JOIN authorized_student s ON s.id=a.student_id
  CROSS JOIN LATERAL jsonb_array_elements(a.transcript_completion_history) finish(event)
  WHERE a.user_id=$3 AND finish.event->>'studentId'=s.id::text

  UNION ALL
  SELECT 'publication:'||j.id,'homework_published','lessons',COALESCE(j.finished_at,j.updated_at,j.created_at),j.id,
    jsonb_build_object('lessonId',j.lesson_id,'htmlUrl',j.html_url,'sourceJobId',j.source_job_id,
      'publicationSequence',j.publication_sequence,'contentHash',j.published_content_hash),
    CASE WHEN j.published_content_hash IS NOT NULL AND j.publication_sequence>0 AND j.finished_at IS NOT NULL THEN 'retained' ELSE 'legacy' END,
    'system',NULL::uuid
  FROM jobs j
  LEFT JOIN recordings r ON r.id=j.recording_id
  LEFT JOIN prompt_packages p ON p.id=j.prompt_package_id
  LEFT JOIN drafts d ON d.id=j.draft_id
  LEFT JOIN prompt_packages pd ON pd.id=d.prompt_package_id
  JOIN authorized_student s ON s.id=COALESCE(j.student_id,r.student_id,p.student_id,d.student_id,pd.student_id)
  WHERE j.state='succeeded' AND j.html_url IS NOT NULL

  UNION ALL
  SELECT 'legacy-failure:'||j.id,'homework_failed','lessons',COALESCE(j.finished_at,j.updated_at),j.id,
    jsonb_build_object('lessonId',j.lesson_id,'sourceJobId',j.source_job_id),'legacy','system',NULL::uuid
  FROM jobs j JOIN authorized_student s ON s.id=j.student_id
  WHERE j.user_id=$3 AND j.publish_target='html' AND j.state='failed' AND NOT EXISTS
    (SELECT 1 FROM student_activity a WHERE a.student_id=s.id AND a.entity_id=j.id AND a.type='homework_failed')
), cutoff AS (
  -- Action timestamps also come from application clocks. Include every parent
  -- visible to this statement even if its clock is slightly ahead of PostgreSQL.
  SELECT COALESCE($8::timestamptz,GREATEST(statement_timestamp(),MAX(occurred_at))) AS upper_at FROM parents
), billing_parents AS (
  -- Resolve the finite set once; a correlated credit scan per parent was
  -- quadratic on representative histories with thousands of recorded actions.
  SELECT 'activity:'||link.id::text AS id FROM student_credit_events c
  CROSS JOIN LATERAL unnest(ARRAY[c.activity_id,c.reversal_activity_id]) link(id)
  WHERE $4::text='billing' AND c.student_id=$1 AND link.id IS NOT NULL
    AND (c.workspace_id=$2 OR (c.workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid))
), bounded AS (
  SELECT p.*,cutoff.upper_at FROM parents p CROSS JOIN cutoff
  WHERE ($4::text='all' OR p.category=$4 OR ($4::text='billing' AND p.id IN (SELECT id FROM billing_parents)))
    AND ($5::date IS NULL OR p.occurred_at >= $5::date::timestamp AT TIME ZONE $7)
    AND ($6::date IS NULL OR p.occurred_at < ($6::date+1)::timestamp AT TIME ZONE $7)
    AND p.occurred_at <= cutoff.upper_at
    AND ($9::timestamptz IS NULL OR (p.occurred_at,p.id) < ($9::timestamptz,$10::text))
  ORDER BY p.occurred_at DESC,p.id DESC LIMIT $11
)
SELECT b.*,to_char(b.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_at,
  to_char(b.upper_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS upper_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('label',effect.label,'value',effect.value) ORDER BY effect.id) FROM (
    SELECT c.id::text AS id, 'Credits' AS label,CASE WHEN c.quantity_delta>0 THEN '+' ELSE '' END||c.quantity_delta::text AS value
    FROM student_credit_events c WHERE c.student_id=$1 AND (c.workspace_id=$2 OR (c.workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid)) AND
      (('activity:'||c.activity_id::text)=b.id OR (b.type='payment_recorded' AND c.source_payment_id=b.entity_id))
    UNION ALL
    SELECT 'reversal:'||c.id,'Credits reversed',CASE WHEN -c.quantity_delta>0 THEN '+' ELSE '' END||(-c.quantity_delta)::text
    FROM student_credit_events c WHERE c.student_id=$1 AND (c.workspace_id=$2 OR (c.workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid)) AND ('activity:'||c.reversal_activity_id::text)=b.id
  ) effect),'[]'::jsonb) AS effects
FROM bounded b ORDER BY b.occurred_at DESC,b.id DESC
`;

interface Cursor {
  context: string;
  upper: string;
  at: string;
  id: string;
}

export async function getStudentActivity(
  workspaceId: string,
  studentId: string,
  userId: string,
  params: StudentActivityParams = {},
): Promise<StudentActivityResponse | null> {
  const category = params.category ?? 'all';
  const limit = params.limit ?? 30;
  if (
    !['all', 'lessons', 'profile', 'billing'].includes(category) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new StudentActivityQueryError('Invalid activity filters');
  for (const date of [params.from, params.to]) {
    if (
      date !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date.startsWith('0000') ||
        !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) ||
        new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
    )
      throw new StudentActivityQueryError('Invalid activity date');
  }
  if (params.from && params.to && params.from > params.to)
    throw new StudentActivityQueryError('Invalid activity date range');
  return withPgClient(async (client) => {
    const authorized = await client.query<{ timezone: string }>(
      `SELECT COALESCE(b.timezone,'UTC') AS timezone FROM students s LEFT JOIN workspace_business_settings b ON b.workspace_id=COALESCE(s.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid) WHERE s.id=$1 AND (s.workspace_id=$2 OR (s.workspace_id IS NULL AND $2='00000000-0000-4000-8000-000000000001'::uuid))`,
      [studentId, workspaceId],
    );
    const timezone = authorized.rows[0]?.timezone;
    if (!timezone) return null;
    const context = JSON.stringify([
      workspaceId,
      studentId,
      userId,
      category,
      params.from ?? null,
      params.to ?? null,
      timezone,
    ]);
    let cursor: Cursor | null = null;
    if (params.cursor) {
      try {
        if (params.cursor.length > 4096) throw new Error('cursor size');
        cursor = JSON.parse(Buffer.from(params.cursor, 'base64url').toString('utf8')) as Cursor;
        if (
          cursor.context !== context ||
          typeof cursor.id !== 'string' ||
          cursor.id.length === 0 ||
          cursor.id.length > 200 ||
          !Number.isFinite(Date.parse(cursor.upper)) ||
          !Number.isFinite(Date.parse(cursor.at)) ||
          new Date(cursor.upper).toISOString().slice(0, 19) !== cursor.upper.slice(0, 19) ||
          new Date(cursor.at).toISOString().slice(0, 19) !== cursor.at.slice(0, 19) ||
          cursor.at > cursor.upper ||
          cursor.at.startsWith('0000') ||
          cursor.upper.startsWith('0000') ||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(cursor.upper) ||
          !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(cursor.at)
        )
          throw new Error('cursor context');
      } catch {
        throw new StudentActivityQueryError('Invalid activity cursor; refresh the list');
      }
    }
    const result = await client.query<ActivityRow>(activityQuery, [
      studentId,
      workspaceId,
      userId,
      category,
      params.from ?? null,
      params.to ?? null,
      timezone,
      cursor?.upper ?? null,
      cursor?.at ?? null,
      cursor?.id ?? null,
      limit + 1,
    ]);
    const page = result.rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => mapActivity(row, studentId, timezone)),
      nextCursor:
        result.rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                context,
                upper: last.upper_at,
                at: last.sort_at,
                id: last.id,
              } satisfies Cursor),
            ).toString('base64url')
          : null,
      timezone,
      coverage: {
        recordingStartedAt: null,
        notice:
          'Earlier changes and actors may be missing. Some older entries reflect the current state.',
      },
    };
  });
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
const actionLabels: Record<string, string> = {
  lesson_created: 'Lesson scheduled',
  lesson_changed: 'Lesson changed',
  lesson_completed: 'Lesson completed',
  lesson_restored: 'Lesson restored to scheduled',
  lesson_canceled: 'Lesson canceled',
  lesson_no_show: 'Lesson marked no-show',
  profile_saved: 'Profile saved',
  profile_restored: 'Profile restored',
  profile_activated: 'Profile activated',
  candidate_approved: 'Suggestion approved',
  candidate_rejected: 'Suggestion rejected',
  candidate_deferred: 'Suggestion deferred',
  candidate_promoted: 'Suggestion added to profile',
  payment_recorded: 'Payment recorded',
  payment_voided: 'Payment voided',
  credits_added: 'Credits added',
  credits_consumed: 'Credits used',
  credits_adjusted: 'Credits adjusted',
  credits_reversed: 'Credits reversed',
  student_created: 'Student created',
  student_renamed: 'Student renamed',
  student_archived: 'Student archived',
  student_restored: 'Student restored',
};

const sectionLabels: Record<string, string> = {
  goals_motivation: 'Goals and motivation',
  work_communication_context: 'Work and communication',
  interests_personal_context: 'Interests and personal context',
  learning_preferences_study_habits: 'Learning preferences',
  long_running_strengths: 'Strengths',
  persistent_challenges_constraints: 'Persistent challenges',
};
function mapActivity(row: ActivityRow, studentId: string, timezone: string): StudentActivityItem {
  const p = row.payload;
  const details: StudentActivityFact[] = [];
  const links: StudentActivityItem['links'] = [];
  const fact = (label: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== '')
      details.push({ label, value: String(value) });
  };
  const date = (value: unknown) => {
    const raw = text(value);
    return raw
      ? new Intl.DateTimeFormat('en-GB', {
          timeZone: timezone,
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(raw))
      : null;
  };
  let subject = '';
  let summary: string | null = null;
  let effectiveAt: string | null = null;
  const before = (p.before ?? {}) as Record<string, unknown>;
  const after = (p.after ?? {}) as Record<string, unknown>;
  const lessonId = row.type.startsWith('lesson_') ? row.entity_id : text(p.lessonId);
  if (row.type.startsWith('lesson_')) {
    const title = text(after.title);
    const action =
      row.type === 'lesson_changed' && before.startsAt !== after.startsAt
        ? 'Lesson moved'
        : actionLabels[row.type];
    subject =
      title && title !== 'Untitled lesson'
        ? `${action ?? 'Lesson changed'} · ${title}`
        : (action ?? 'Lesson changed');
    effectiveAt = text(after.startsAt);
    fact('Lesson time', date(after.startsAt));
    fact('Duration', after.durationMinutes === undefined ? null : `${after.durationMinutes} min`);
    if (before.startsAt !== undefined && before.startsAt !== after.startsAt)
      fact('Previous lesson time', date(before.startsAt));
    if (before.durationMinutes !== undefined && before.durationMinutes !== after.durationMinutes)
      fact('Previous duration', `${before.durationMinutes} min`);
    if (before.status !== undefined && before.status !== after.status)
      fact('Status', `${before.status} → ${after.status}`);
    if (before.title !== undefined && before.title !== after.title)
      fact('Previous title', before.title);
    if (before.startsAt !== undefined && before.startsAt !== after.startsAt)
      summary = `${date(before.startsAt)} → ${date(after.startsAt)}`;
    else
      summary = [
        date(after.startsAt),
        after.durationMinutes === undefined ? null : `${after.durationMinutes} min`,
      ]
        .filter(Boolean)
        .join(' · ');
    if (p.generated === true) fact('Schedule', 'Generated from weekly schedule');
    if (row.evidence === 'legacy') fact('Current status', after.status);
  } else if (row.type.startsWith('profile_')) {
    subject = `${actionLabels[row.type]} · ${text(p.version) ?? 'revision'}`;
    fact('Source', p.source);
    if (Array.isArray(p.sections))
      fact('Sections', p.sections.map((s) => sectionLabels[String(s)] ?? String(s)).join(', '));
    if (p.restoredFromRevisionId) fact('Restored from revision', p.restoredFromRevisionId);
    links.push({ label: 'Open profile', href: `/students/${studentId}/learning` });
  } else if (row.type.startsWith('candidate_')) {
    subject = `${actionLabels[row.type] ?? 'Suggestion reviewed'} · ${sectionLabels[String(p.section)] ?? 'Profile'}`;
    summary = text(p.fact);
    fact('Review note', p.note);
    fact('Previous decision', p.previousDecision);
    links.push({ label: 'Review profile suggestions', href: `/students/${studentId}/learning` });
  } else if (row.type.startsWith('payment_')) {
    subject = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: String(p.currency),
    }).format(Number(p.amountMinor) / 100);
    subject = `${actionLabels[row.type]} · ${subject}`;
    effectiveAt = text(p.receivedAt);
    summary = p.receivedAt ? `Received ${String(p.receivedAt)}` : null;
    fact('Received date', p.receivedAt);
    fact('Method', p.method);
    fact('Note', p.note);
    links.push({ label: 'Open payments', href: `/students/${studentId}/schedule-billing` });
  } else if (row.type.startsWith('credits_')) {
    const quantity = Number(p.quantity);
    subject = `${quantity > 0 ? '+' : ''}${quantity} credit${Math.abs(quantity) === 1 ? '' : 's'}`;
    subject = `${actionLabels[row.type]} · ${subject}`;
    fact('Note', p.note);
    links.push({ label: 'Open credit ledger', href: `/students/${studentId}/schedule-billing` });
  } else if (row.type === 'transcript_saved') {
    subject = 'Transcript saved';
    summary = 'Transcript saved without homework';
    const source = (p.source ?? {}) as Record<string, unknown>;
    fact(
      'Current lesson intent',
      p.homeworkIntent === 'create' ? 'Homework started' : 'No homework planned',
    );
    fact('Reviewed transcript version', source.transcriptWorkingVersion);
    fact('Reviewed transcript ID', source.transcriptId);
    fact('Reviewed transcript hash', source.transcriptHash);
    fact('Finish revision', p.revision);
    links.push({
      label: 'Open lesson workspace',
      href: `/?sessionId=${encodeURIComponent(row.entity_id)}`,
    });
  } else if (row.type === 'homework_started') {
    subject = 'Homework started';
    links.push({
      label: 'Continue homework',
      href: `/?sessionId=${encodeURIComponent(row.entity_id)}`,
    });
  } else if (row.type === 'homework_published') {
    subject = p.sourceJobId ? 'Homework correction published' : 'Homework published';
    fact('Publication version', p.publicationSequence);
    fact('Previous publication', p.sourceJobId);
    const href = text(p.htmlUrl);
    if (href && /^https?:\/\//.test(href)) links.push({ label: 'Open published homework', href });
  } else if (row.type === 'homework_failed') {
    subject = 'Homework attempt failed';
    summary = 'The attempt failed. Open the assignment to review recovery options.';
    links.push({
      label: 'Open failed assignment',
      href: `/?jobId=${encodeURIComponent(row.entity_id)}`,
    });
  } else if (row.type === 'recurrence_changed') {
    subject = 'Weekly schedule changed';
    const describe = (value: Record<string, unknown>) =>
      `${String(value.status ?? 'active')} · ${String(value.timezone ?? 'UTC')} · ${String(value.startsOn ?? '')} – ${String(value.endsOn ?? 'ongoing')}`;
    summary = describe(after);
    fact('Weekly slots', Array.isArray(after.slots) ? after.slots.map(String).join(', ') : null);
    if (p.before) fact('Previous schedule', describe(before));
    links.push({ label: 'Open weekly schedule', href: `/students/${studentId}/schedule-billing` });
  } else if (row.type.startsWith('student_')) {
    subject = `${actionLabels[row.type]} · ${text(p.name) ?? 'Student'}`;
    fact('Previous name', p.beforeName);
    fact('Reason', p.reason);
  } else if (row.type.startsWith('reminder_')) {
    subject =
      row.type === 'reminder_hidden' ? 'Follow-up reminder hidden' : 'Follow-up reminder restored';
    summary = row.type === 'reminder_hidden' ? 'Hidden from follow-up' : 'Restored to follow-up';
  }
  if (lessonId)
    links.push({ label: 'Open lesson schedule', href: `/students/${studentId}/schedule-billing` });
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    occurredAt: row.sort_at,
    subject,
    summary,
    actor: {
      kind: row.actor_kind,
      ...(row.actor_kind === 'user' && row.actor_user_id ? { label: 'Tutor' } : {}),
    },
    evidence: row.evidence,
    effectiveAt,
    details,
    links,
    effects: row.effects,
  };
}
