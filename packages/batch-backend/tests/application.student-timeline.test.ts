import { assignmentArtifactFixture } from './assignment-v1.test-harness.js';
import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createEmptyFoundationalProfile } from '../src/application/foundational-profile.js';
import {
  getStudentActivity,
  StudentActivityQueryError,
} from '../src/application/student-activity.js';
import {
  addStudentPackage,
  applyGeneratedLessonTitleIfPlaceholder,
  createStudentLesson,
  hideStudentLessonFollowupReminder,
  undoLatestHiddenStudentReminder,
  updateStudentLesson,
  upsertPrimaryStudentLessonRecurrence,
} from '../src/application/student-schedule-billing.js';
import {
  getStudentTimeline,
  type StudentTimelineType,
} from '../src/application/student-timeline.js';
import { insertJob, updateJobStateAndResult } from '../src/domain/job-repository.js';
import {
  activateProfileRevision,
  insertProfileRevision,
} from '../src/domain/profile-revision-repository.js';
import {
  insertStudentProfileCandidate,
  linkStudentProfileCandidatesToDraftRevision,
  markStudentProfileCandidatesPromotedByRevision,
  updateStudentProfileCandidateReview,
} from '../src/domain/student-profile-candidate-repository.js';
import {
  archiveStudent,
  deleteStudent,
  insertStudent,
  restoreStudent,
  updateStudent,
} from '../src/domain/student-repository.js';
import { deriveStudentId } from '../src/domain/student-utils.js';
import { withPgClient } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

async function truncateTimelineTables() {
  await withPgClient(async (client) => {
    await client.query(`
      TRUNCATE TABLE
        users,
        job_action_history,
        jobs,
        drafts,
        prompt_packages,
        transcripts,
        recordings,
        student_payment_records,
        student_credit_events,
        student_reminder_preferences,
        student_lesson_recurrence_slots,
        student_lesson_recurrence_rules,
        student_lesson_plans,
        student_lessons,
        workspace_business_settings,
        workspaces,
        template_revisions,
        templates,
        student_profile_revisions,
        students
      RESTART IDENTITY CASCADE
    `);
  });
}

describe('student-timeline', () => {
  beforeAll(async () => {
    await truncateTimelineTables();
  });

  afterAll(async () => {
    await truncateTimelineTables();
  });

  beforeEach(async () => {
    await truncateTimelineTables();
  });

  it('orders timeline items and supports type/status filters', async () => {
    const studentId = deriveStudentId('Anna');
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const promptPackageId = randomUUID();
    const draftId = randomUUID();
    const jobId = randomUUID();

    const times = {
      recording: new Date('2024-01-01T00:00:00.000Z'),
      transcript: new Date('2024-01-02T00:00:00.000Z'),
      prompt: new Date('2024-01-03T00:00:00.000Z'),
      draft: new Date('2024-01-04T00:00:00.000Z'),
      job: new Date('2024-01-05T00:00:00.000Z'),
    };

    await withPgClient(async (client) => {
      await client.query(`INSERT INTO students (id, student) VALUES ($1, 'Anna')`, [studentId]);
      await client.query(
        `
        INSERT INTO recordings (id, source, student_id, source_path, storage_uri, bytes, status, created_at, updated_at)
        VALUES ($1, 'upload', $2, 'anna/lesson-1.opus', 's3://bucket/lesson-1.opus', 1024, 'queued', $3, $3)
        `,
        [recordingId, studentId, times.recording],
      );
      await client.query(
        `
        INSERT INTO transcripts (id, recording_id, storage_uri, mode, model, language, fallback_used, created_at, updated_at)
        VALUES ($1, $2, 's3://bucket/transcript.txt', 'timeline', 'nova-3', 'multi', false, $3, $3)
        `,
        [transcriptId, recordingId, times.transcript],
      );
      await client.query(
        `
        INSERT INTO prompt_packages (id, recording_id, transcript_id, student_id, template_version, storage_uri, created_at, updated_at)
        VALUES ($1, $2, $3, $4, 'template.md', 's3://bucket/prompt.txt', $5, $5)
        `,
        [promptPackageId, recordingId, transcriptId, studentId, times.prompt],
      );
      await client.query(
        `
        INSERT INTO drafts (
          id, prompt_package_id, student_id, storage_uri, working_version, content_hash,
          created_at, updated_at
        , format)
        VALUES ($1, $2, $3, 'local://drafts/content/' ||  repeat('a', 64) || '.json', 1, repeat('a', 64), $4, $4, 'assignment_v1')
        `,
        [draftId, promptPackageId, studentId, times.draft],
      );
      await client.query(
        `
        INSERT INTO jobs (id, state, recording_id, transcript_id, prompt_package_id, draft_id, created_at, updated_at, finished_at, error, assignment_artifact, assignment_renderer_version)
        VALUES ($1, 'failed', $2, $3, $4, $5, $6, $6, $6, 'boom', '{"format":"assignment_v1","schemaVersion":1,"serializationVersion":1,"workingVersion":1,"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","storageUri":"local://drafts/content/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"}'::jsonb, 2)
        `,
        [jobId, recordingId, transcriptId, promptPackageId, draftId, times.job],
      );
    });

    const timeline = await getStudentTimeline(studentId, { order: 'desc' });
    expect(timeline.items[0]?.type).toBe('job_completed');
    expect(timeline.items.map((item) => item.type)).toEqual([
      'job_completed',
      'draft_saved',
      'prompt_package_created',
      'transcript_ready',
      'recording_ingested',
    ]);

    const draftOnly = await getStudentTimeline(studentId, { types: ['draft_saved'] });
    expect(draftOnly.items).toHaveLength(1);
    expect(draftOnly.items[0]?.type).toBe('draft_saved');

    const failedOnly = await getStudentTimeline(studentId, { statuses: ['failed'] });
    expect(failedOnly.items).toHaveLength(1);
    expect(failedOnly.items[0]?.status).toBe('failed');

    const legacyAliasType = 'job_approved' as unknown as StudentTimelineType;
    const legacyAliasFilter = await getStudentTimeline(studentId, { types: [legacyAliasType] });
    expect(legacyAliasFilter.items).toHaveLength(0);
  });

  it('includes revision lifecycle and job action events with deterministic filtering', async () => {
    const studentId = deriveStudentId('Mila');
    const templateId = 'templates/default.md';
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const promptPackageId = randomUUID();
    const jobId = randomUUID();
    const actionId = randomUUID();
    const profileRevisionId = randomUUID();
    const templateRevisionId = randomUUID();
    const eventAt = new Date('2024-02-01T10:00:00.000Z');

    await withPgClient(async (client) => {
      await client.query(
        `
        INSERT INTO templates (id, label, active_revision_id)
        VALUES ($1, 'Default template', NULL)
        `,
        [templateId],
      );
      await client.query(
        `
        INSERT INTO students (id, student)
        VALUES ($1, 'Mila')
        `,
        [studentId],
      );
      await client.query(
        `
        INSERT INTO recordings (
          id,
          source,
          student_id,
          source_path,
          storage_uri,
          bytes,
          status,
          created_at,
          updated_at
        )
        VALUES ($1, 'upload', $2, 'mila/audio.opus', 's3://bucket/mila/audio.opus', 1024, 'transcribed', $3, $3)
        `,
        [recordingId, studentId, eventAt],
      );
      await client.query(
        `
        INSERT INTO transcripts (
          id,
          recording_id,
          storage_uri,
          mode,
          model,
          language,
          fallback_used,
          created_at,
          updated_at
        )
        VALUES ($1, $2, 's3://bucket/mila/transcript.txt', 'timeline', 'nova-3', 'multi', false, $3, $3)
        `,
        [transcriptId, recordingId, eventAt],
      );
      await client.query(
        `
        INSERT INTO prompt_packages (
          id,
          recording_id,
          transcript_id,
          student_id,
          resolved_template_id,
          template_version,
          storage_uri,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, 'template.md', 's3://bucket/mila/prompt.txt', $6, $6)
        `,
        [promptPackageId, recordingId, transcriptId, studentId, templateId, eventAt],
      );
      await client.query(
        `
        INSERT INTO jobs (
          id,
          state,
          recording_id,
          transcript_id,
          prompt_package_id,
          created_at,
          updated_at,
          finished_at
        , assignment_artifact, assignment_renderer_version, draft_id)
        VALUES ($1, 'succeeded', $2, $3, $4, $5, $5, $5, '{"format":"assignment_v1","schemaVersion":1,"serializationVersion":1,"workingVersion":1,"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","storageUri":"local://drafts/content/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"}'::jsonb, 2, uuid_generate_v4())
        `,
        [jobId, recordingId, transcriptId, promptPackageId, eventAt],
      );
      await client.query(
        `
        INSERT INTO student_profile_revisions (
          id,
          student_id,
          content,
          content_hash,
          source,
          status,
          version_number,
          version_label,
          activated_at,
          deprecated_at,
          created_at,
          created_by,
          restored_from_revision_id
        )
        VALUES ($1, $2, 'content', 'hash', 'restore', 'active', 1, 'v1', $3, NULL, $3, NULL, NULL)
        `,
        [profileRevisionId, studentId, eventAt],
      );
      await client.query(
        `
        INSERT INTO template_revisions (
          id,
          template_id,
          content,
          content_hash,
          source,
          status,
          version_number,
          version_label,
          activated_at,
          deprecated_at,
          created_at,
          created_by,
          restored_from_revision_id
        )
        VALUES ($1, $2, 'template', 'template-hash', 'restore', 'active', 1, 'v1', $3, NULL, $3, NULL, NULL)
        `,
        [templateRevisionId, templateId, eventAt],
      );
      await client.query(
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
          $1,
          $2,
          'rerun',
          '{}'::jsonb,
          $3,
          NULL,
          'succeeded',
          'Publish rerun queued',
          NULL,
          NULL,
          $3
        )
        `,
        [actionId, jobId, eventAt],
      );
    });

    const timeline = await getStudentTimeline(studentId, {
      from: new Date('2024-02-01T09:59:00.000Z'),
      to: new Date('2024-02-01T10:01:00.000Z'),
    });

    expect(timeline.items.some((item) => item.type === 'profile_revision_restored')).toBe(true);
    expect(timeline.items.some((item) => item.type === 'profile_revision_activated')).toBe(true);
    expect(timeline.items.some((item) => item.type === 'template_revision_restored')).toBe(true);
    expect(timeline.items.some((item) => item.type === 'template_revision_activated')).toBe(true);
    const actionEvent = timeline.items.find((item) => item.type === 'job_action_rerun');
    expect(actionEvent?.status).toBe('succeeded');
    expect(actionEvent?.details).toMatchObject({
      actionType: 'rerun',
      message: 'Publish rerun queued',
    });
  });

  it('includes schedule, billing, business, and reminder events', async () => {
    const studentId = deriveStudentId('Rina');
    const workspaceId = randomUUID();
    const lessonId = randomUUID();
    const recurrenceRuleId = randomUUID();
    const creditEventId = randomUUID();
    const paymentId = randomUUID();
    const times = {
      workspace: new Date('2024-03-01T08:00:00.000Z'),
      lessonCreated: new Date('2024-03-02T08:00:00.000Z'),
      lessonUpdated: new Date('2024-03-03T08:00:00.000Z'),
      billing: new Date('2024-03-04T08:00:00.000Z'),
      reminder: new Date('2024-03-05T08:00:00.000Z'),
    };

    await withPgClient(async (client) => {
      await client.query(
        `
        INSERT INTO workspaces (id, name, created_at, updated_at)
        VALUES ($1, 'Rina workspace', $2, $2)
        `,
        [workspaceId, times.workspace],
      );
      await client.query(
        `
        INSERT INTO workspace_business_settings (
          workspace_id,
          default_currency,
          default_lesson_rate_minor,
          default_lesson_duration_minutes,
          timezone,
          forecast_horizon_days,
          top_up_threshold,
          created_at,
          updated_at
        )
        VALUES ($1, 'USD', 12000, 60, 'UTC', 45, 2, $2, $2)
        `,
        [workspaceId, times.workspace],
      );
      await client.query(
        `
        INSERT INTO students (id, student, workspace_id)
        VALUES ($1, 'Rina', $2)
        `,
        [studentId, workspaceId],
      );
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
          created_at,
          updated_at
        )
        VALUES ($1, $2, 'UTC', 60, 'weekly', 'Mondays', 'Keep mornings', $3, $3)
        `,
        [studentId, workspaceId, times.lessonCreated],
      );
      await client.query(
        `
        INSERT INTO student_lesson_recurrence_rules (
          id,
          student_id,
          workspace_id,
          timezone,
          frequency,
          starts_on,
          status,
          generation_horizon_days,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, 'UTC', 'weekly', '2024-03-01', 'active', 56, $4, $4)
        `,
        [recurrenceRuleId, studentId, workspaceId, times.lessonCreated],
      );
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
          recurrence_rule_id,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, '2024-03-02T09:00:00.000Z', 'UTC', 60, 'completed', true, 'Pitch practice', $4, $5, $6)
        `,
        [
          lessonId,
          studentId,
          workspaceId,
          recurrenceRuleId,
          times.lessonCreated,
          times.lessonUpdated,
        ],
      );
      await client.query(
        `
        INSERT INTO student_payment_records (
          id,
          student_id,
          workspace_id,
          amount_minor,
          currency,
          method,
          received_at,
          note,
          created_at
        )
        VALUES ($1, $2, $3, 120000, 'USD', 'bank', '2024-03-04', 'March package', $4)
        `,
        [paymentId, studentId, workspaceId, times.billing],
      );
      await client.query(
        `
        INSERT INTO student_credit_events (
          id,
          student_id,
          workspace_id,
          event_type,
          quantity_delta,
          source_lesson_id,
          source_payment_id,
          note,
          created_at
        )
        VALUES ($1, $2, $3, 'credit_added', 8, $4, $5, 'Package purchase', $6)
        `,
        [creditEventId, studentId, workspaceId, lessonId, paymentId, times.billing],
      );
      await client.query(
        `
        INSERT INTO student_reminder_preferences (
          student_id,
          workspace_id,
          latest_hidden_lesson_followup_key,
          latest_hidden_lesson_followup_lesson_id,
          latest_hidden_lesson_followup_at,
          created_at,
          updated_at
        )
        VALUES ($1, $2, 'lesson_followup:' || $3::text, $3::uuid, $4, $4, $4)
        `,
        [studentId, workspaceId, lessonId, times.reminder],
      );
    });

    const timeline = await getStudentTimeline(studentId, {
      types: [
        'lesson_created',
        'lesson_completed',
        'lesson_plan_updated',
        'lesson_recurrence_updated',
        'credit_event_recorded',
        'payment_recorded',
        'reminder_hidden',
        'business_settings_updated',
      ],
      order: 'asc',
    });

    expect(timeline.items.map((item) => item.type)).toEqual([
      'business_settings_updated',
      'lesson_created',
      'lesson_plan_updated',
      'lesson_recurrence_updated',
      'lesson_completed',
      'credit_event_recorded',
      'payment_recorded',
      'reminder_hidden',
    ]);
    expect(timeline.items.find((item) => item.type === 'lesson_completed')?.details).toMatchObject({
      lessonId,
      title: 'Pitch practice',
      status: 'completed',
      durationMinutes: 60,
    });
    expect(
      timeline.items.find((item) => item.type === 'credit_event_recorded')?.details,
    ).toMatchObject({
      creditEventId,
      quantityDelta: 8,
      sourceLessonId: lessonId,
      sourcePaymentId: paymentId,
    });
    expect(timeline.items.find((item) => item.type === 'payment_recorded')?.details).toMatchObject({
      paymentId,
      amountMinor: 120000,
      currency: 'USD',
    });
    expect(timeline.items.find((item) => item.type === 'reminder_hidden')?.details).toMatchObject({
      lessonId,
    });
  });
});

describe('student activity owner-to-feed contract', () => {
  beforeEach(truncateTimelineTables);
  afterAll(truncateTimelineTables);

  async function fixture() {
    const userId = randomUUID(),
      workspaceId = randomUUID();
    await withPgClient(async (client) => {
      await client.query(
        "INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,'unused','user')",
        [userId, `${userId}@example.test`],
      );
      await client.query("INSERT INTO workspaces(id,name) VALUES($1,'Activity fixture')", [
        workspaceId,
      ]);
      await client.query(
        "INSERT INTO workspace_business_settings(workspace_id,timezone) VALUES($1,'Asia/Bangkok')",
        [workspaceId],
      );
    });
    const student = await insertStudent({ student: 'Mina', workspaceId, actorUserId: userId });
    const read = (params: Parameters<typeof getStudentActivity>[3] = {}) =>
      getStudentActivity(workspaceId, student.id, userId, params);
    return { userId, workspaceId, studentId: student.id, read };
  }

  it('preserves complete → restore → complete and time changes, with causal credit effects on their parent pages', async () => {
    const f = await fixture();
    const surface = await createStudentLesson(
      f.workspaceId,
      f.studentId,
      {
        startsAt: '2026-10-17T07:00:00Z',
        timezone: 'Asia/Bangkok',
        durationMinutes: 50,
        title: 'Travel plans',
      },
      f.userId,
    );
    const lessonId = surface.lessons[0]!.id;
    await updateStudentLesson(
      f.workspaceId,
      f.studentId,
      lessonId,
      { status: 'completed', consumesCredit: true },
      f.userId,
    );
    const afterComplete = await f.read();
    await updateStudentLesson(
      f.workspaceId,
      f.studentId,
      lessonId,
      { status: 'completed', consumesCredit: true },
      f.userId,
    );
    expect((await f.read())?.items.map((x) => x.id)).toEqual(afterComplete?.items.map((x) => x.id));
    await updateStudentLesson(
      f.workspaceId,
      f.studentId,
      lessonId,
      { status: 'scheduled', consumesCredit: false },
      f.userId,
    );
    await updateStudentLesson(
      f.workspaceId,
      f.studentId,
      lessonId,
      { status: 'completed', consumesCredit: true },
      f.userId,
    );
    await updateStudentLesson(
      f.workspaceId,
      f.studentId,
      lessonId,
      { startsAt: '2026-10-18T08:00:00Z', durationMinutes: 75 },
      f.userId,
    );
    const full = await f.read();
    const lessons = full!.items.filter((x) => x.category === 'lessons');
    expect(lessons.map((x) => x.type)).toEqual([
      'lesson_changed',
      'lesson_completed',
      'lesson_restored',
      'lesson_completed',
      'lesson_created',
    ]);
    expect(lessons[0]).toMatchObject({
      subject: 'Lesson moved · Travel plans',
      evidence: 'recorded',
      actor: { kind: 'user', label: 'Tutor' },
      effectiveAt: '2026-10-18T08:00:00+00:00',
    });
    expect(lessons[0]!.details).toEqual(
      expect.arrayContaining([
        { label: 'Previous duration', value: '50 min' },
        { label: 'Duration', value: '75 min' },
      ]),
    );
    expect(lessons.filter((x) => x.type === 'lesson_completed').map((x) => x.effects)).toEqual([
      [{ label: 'Credits', value: '-1' }],
      [{ label: 'Credits', value: '-1' }],
    ]);
    expect(lessons.find((x) => x.type === 'lesson_restored')!.effects).toEqual([
      { label: 'Credits reversed', value: '+1' },
    ]);
    expect(full!.items.some((x) => x.type.startsWith('credits_'))).toBe(false);
    const billing = (await f.read({ category: 'billing', limit: 1 }))!;
    expect(billing.items[0]).toMatchObject({
      type: 'lesson_completed',
      effects: [{ label: 'Credits', value: '-1' }],
    });
    const reversal = (await f.read({
      category: 'billing',
      limit: 1,
      cursor: billing.nextCursor!,
    }))!;
    expect(reversal.items[0]).toMatchObject({
      type: 'lesson_restored',
      effects: [{ label: 'Credits reversed', value: '+1' }],
    });

    const pages = [];
    let cursor: string | undefined;
    do {
      const page = (await f.read({ limit: 1, cursor }))!;
      pages.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(pages.map((x) => x.id)).toEqual(full!.items.map((x) => x.id));
    expect(
      pages
        .filter((x) => x.type === 'lesson_completed')
        .every((x) => x.effects?.[0]?.value === '-1'),
    ).toBe(true);
    expect(await getStudentActivity(randomUUID(), f.studentId, f.userId)).toBeNull();
    await expect(
      updateStudentLesson(randomUUID(), f.studentId, lessonId, { status: 'canceled' }, f.userId),
    ).rejects.toThrow();
    expect((await f.read())?.items.map((x) => x.id)).toEqual(full!.items.map((x) => x.id));
  });

  it('rolls back domain mutation and ledger effects when required recording fails', async () => {
    const f = await fixture();
    const lessonId = (
      await createStudentLesson(
        f.workspaceId,
        f.studentId,
        { startsAt: '2026-10-17T07:00:00Z', title: 'Rollback lesson' },
        f.userId,
      )
    ).lessons[0]!.id;
    await withPgClient(async (client) => {
      await client.query(
        `CREATE FUNCTION fail_activity_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='lesson_completed' THEN RAISE EXCEPTION 'injected activity failure'; END IF; RETURN NEW; END $$`,
      );
      await client.query(
        'CREATE TRIGGER fail_activity_test BEFORE INSERT ON student_activity FOR EACH ROW EXECUTE FUNCTION fail_activity_test()',
      );
    });
    try {
      await expect(
        updateStudentLesson(
          f.workspaceId,
          f.studentId,
          lessonId,
          { status: 'completed', consumesCredit: true },
          f.userId,
        ),
      ).rejects.toThrow('injected activity failure');
    } finally {
      await withPgClient(async (client) => {
        await client.query('DROP TRIGGER fail_activity_test ON student_activity');
        await client.query('DROP FUNCTION fail_activity_test()');
      });
    }
    expect((await f.read())?.items.map((x) => x.type)).toEqual([
      'lesson_created',
      'student_created',
    ]);
    await withPgClient(async (client) => {
      expect(
        (
          await client.query('SELECT status,credit_event_id FROM student_lessons WHERE id=$1', [
            lessonId,
          ])
        ).rows[0],
      ).toMatchObject({ status: 'scheduled', credit_event_id: null });
      expect(
        (
          await client.query('SELECT count(*) FROM student_credit_events WHERE student_id=$1', [
            f.studentId,
          ])
        ).rows[0].count,
      ).toBe('0');
    });
  });

  it('records lifecycle, repeated activations and review decisions without stale-actor attribution or no-op duplicates', async () => {
    const f = await fixture();
    await updateStudent({
      id: f.studentId,
      workspaceId: f.workspaceId,
      student: 'Mina Lee',
      actorUserId: f.userId,
    });
    await archiveStudent({ id: f.studentId, workspaceId: f.workspaceId, archivedBy: f.userId });
    await archiveStudent({ id: f.studentId, workspaceId: f.workspaceId, archivedBy: f.userId });
    await restoreStudent(f.studentId, { workspaceId: f.workspaceId, actorUserId: f.userId });
    const profile = createEmptyFoundationalProfile();
    profile.primaryGoals = ['Discuss travel plans'];
    const r1 = await insertProfileRevision({
      studentId: f.studentId,
      content: 'Profile one',
      contentHash: 'a'.repeat(64),
      structuredContent: profile,
      status: 'draft',
      createdBy: f.userId,
    });
    const r2 = await insertProfileRevision({
      studentId: f.studentId,
      content: 'Profile two',
      contentHash: 'b'.repeat(64),
      status: 'draft',
      createdBy: f.userId,
      source: 'restore',
      restoredFromRevisionId: r1.id,
    });
    await activateProfileRevision(f.studentId, r1.id, f.userId);
    await activateProfileRevision(f.studentId, r1.id, f.userId);
    await activateProfileRevision(f.studentId, r2.id, f.userId);
    await activateProfileRevision(f.studentId, r1.id, f.userId);
    const candidate = await insertStudentProfileCandidate({
      studentId: f.studentId,
      targetSection: 'goals_motivation',
      candidateKey: 'goal:travel',
      fact: 'Discuss travel plans',
      category: 'goal',
      authority: 'student_stated',
      confidence: 'high',
      reviewNeeded: true,
    });
    const review = { studentId: f.studentId, candidateId: candidate.id, reviewerId: f.userId };
    await updateStudentProfileCandidateReview({
      ...review,
      status: 'pending_review',
      reviewState: 'deferred',
    });
    await updateStudentProfileCandidateReview({
      ...review,
      status: 'rejected',
      reviewState: 'rejected',
    });
    await updateStudentProfileCandidateReview({
      ...review,
      status: 'approved',
      reviewState: 'approved',
      approvedFact: 'Discuss travel plans',
    });
    await updateStudentProfileCandidateReview({
      ...review,
      status: 'approved',
      reviewState: 'approved',
      approvedFact: 'Discuss travel plans',
    });
    await linkStudentProfileCandidatesToDraftRevision({
      studentId: f.studentId,
      candidateIds: [candidate.id],
      draftRevisionId: r1.id,
    });
    await markStudentProfileCandidatesPromotedByRevision(r1.id, {
      studentId: f.studentId,
      contentHash: r1.contentHash,
      structuredContent: profile,
      actorUserId: f.userId,
    });
    // Direct/system writer leaves a stale reviewer_id on the row. It is not the actor.
    await withPgClient((client) =>
      client.query(
        "UPDATE student_profile_candidates SET status='pending_review',review_state='deferred' WHERE id=$1",
        [candidate.id],
      ),
    );
    const items = (await f.read({ limit: 100 }))!.items;
    expect(items.filter((x) => x.type === 'student_archived')).toHaveLength(1);
    expect(items.filter((x) => x.type === 'student_restored')).toHaveLength(1);
    expect(items.filter((x) => x.type === 'profile_activated')).toHaveLength(3);
    expect(items.filter((x) => x.type === 'profile_restored')).toHaveLength(1);
    expect(items.filter((x) => x.type === 'candidate_approved')).toHaveLength(1);
    expect(items.some((x) => x.type === 'candidate_deferred')).toBe(true);
    expect(items.some((x) => x.type === 'candidate_rejected')).toBe(true);
    expect(items.filter((x) => x.type === 'candidate_promoted')).toHaveLength(1);
    expect(items.find((x) => x.type === 'candidate_deferred')!.actor).toEqual({ kind: 'unknown' });
    expect(items.find((x) => x.type === 'student_renamed')!.details).toContainEqual({
      label: 'Previous name',
      value: 'Mina',
    });
  });

  it('retains a legacy approval when a new recorded promotion occurs', async () => {
    const f = await fixture();
    const profile = createEmptyFoundationalProfile();
    profile.primaryGoals = ['Discuss travel plans'];
    const revision = await insertProfileRevision({
      studentId: f.studentId,
      content: 'Travel goal',
      contentHash: 'c'.repeat(64),
      structuredContent: profile,
      status: 'active',
      createdBy: f.userId,
    });
    const candidate = await insertStudentProfileCandidate({
      studentId: f.studentId,
      targetSection: 'goals_motivation',
      candidateKey: 'legacy-travel',
      fact: 'Discuss travel plans',
      category: 'goal',
      authority: 'student_stated',
      confidence: 'high',
      reviewNeeded: false,
      status: 'approved',
      reviewState: 'approved',
    });
    // A retained pre-recorder review has its timestamp but no append-only event.
    await withPgClient((client) =>
      client.query(
        "UPDATE student_profile_candidates SET reviewed_at='2026-01-02T10:00:00Z' WHERE id=$1",
        [candidate.id],
      ),
    );
    await linkStudentProfileCandidatesToDraftRevision({
      studentId: f.studentId,
      candidateIds: [candidate.id],
      draftRevisionId: revision.id,
    });
    await markStudentProfileCandidatesPromotedByRevision(revision.id, {
      studentId: f.studentId,
      contentHash: revision.contentHash,
      structuredContent: profile,
      actorUserId: f.userId,
    });
    const rows = (await f.read({ category: 'profile' }))!.items;
    expect(rows.find((x) => x.type === 'candidate_approved')).toMatchObject({
      evidence: 'retained',
      occurredAt: '2026-01-02T10:00:00.000000Z',
    });
    expect(rows.filter((x) => x.type === 'candidate_promoted')).toHaveLength(1);
    expect(rows.find((x) => x.type === 'candidate_promoted')!.evidence).toBe('recorded');
  });

  it('records reminder hide and undo once and one weekly-schedule change rather than maintenance writes', async () => {
    const f = await fixture();
    const lessonId = (
      await createStudentLesson(
        f.workspaceId,
        f.studentId,
        { startsAt: '2026-10-01T07:00:00Z', title: 'Follow up' },
        f.userId,
      )
    ).lessons[0]!.id;
    await hideStudentLessonFollowupReminder(f.workspaceId, f.studentId, lessonId, f.userId);
    await hideStudentLessonFollowupReminder(f.workspaceId, f.studentId, lessonId, f.userId);
    await undoLatestHiddenStudentReminder(f.workspaceId, f.studentId, f.userId);
    await undoLatestHiddenStudentReminder(f.workspaceId, f.studentId, f.userId);
    const schedule = {
      timezone: 'Asia/Bangkok',
      startsOn: '2026-01-01',
      status: 'paused' as const,
      slots: [{ isoWeekday: 2, localStartTime: '15:00', durationMinutes: 50 }],
    };
    await upsertPrimaryStudentLessonRecurrence(f.workspaceId, f.studentId, schedule, f.userId);
    await upsertPrimaryStudentLessonRecurrence(f.workspaceId, f.studentId, schedule, f.userId);
    await upsertPrimaryStudentLessonRecurrence(
      f.workspaceId,
      f.studentId,
      { ...schedule, generationHorizonDays: 90 },
      f.userId,
    );
    const items = (await f.read())!.items;
    expect(items.filter((x) => x.type === 'reminder_hidden')).toHaveLength(1);
    expect(items.filter((x) => x.type === 'reminder_restored')).toHaveLength(1);
    expect(items.filter((x) => x.type === 'recurrence_changed')).toHaveLength(1);
  });

  it('keeps package payments and credits together and filters action dates in the workspace timezone', async () => {
    const f = await fixture();
    await addStudentPackage(
      f.workspaceId,
      f.studentId,
      { lessons: 8, payment: { amountMinor: 12000, currency: 'USD', receivedAt: '2026-10-01' } },
      f.userId,
    );
    const billing = (await f.read({ category: 'billing' }))!;
    expect(billing.items).toHaveLength(1);
    expect(billing.items[0]).toMatchObject({
      type: 'payment_recorded',
      subject: 'Payment recorded · $120.00',
      effects: [{ label: 'Credits', value: '+8' }],
    });
    // Retained ledger evidence gives independent action-date oracles either side
    // of local midnight; received date is deliberately different.
    await withPgClient((client) =>
      client.query(
        `INSERT INTO student_credit_events(id,student_id,workspace_id,event_type,quantity_delta,created_at) VALUES
      ($1,$3,$4,'credit_adjusted',2,'2026-10-16T16:59:59Z'),($2,$3,$4,'credit_adjusted',3,'2026-10-16T17:00:00Z')`,
        [randomUUID(), randomUUID(), f.studentId, f.workspaceId],
      ),
    );
    expect(
      (await f.read({ category: 'billing', from: '2026-10-17', to: '2026-10-17' }))!.items.map(
        (x) => x.subject,
      ),
    ).toEqual(['Credits adjusted · +3 credits']);
    const page = (await f.read({ limit: 1 }))!;
    await expect(f.read({ category: 'profile', cursor: page.nextCursor! })).rejects.toBeInstanceOf(
      StudentActivityQueryError,
    );
    const malformedCursor = JSON.parse(Buffer.from(page.nextCursor!, 'base64url').toString('utf8'));
    for (const at of ['2026-02-30T10:00:00.000000Z', '0000-01-01T00:00:00.000000Z']) {
      malformedCursor.at = at;
      await expect(
        f.read({ cursor: Buffer.from(JSON.stringify(malformedCursor)).toString('base64url') }),
      ).rejects.toBeInstanceOf(StudentActivityQueryError);
    }
    for (const from of ['2026-02-30', 'not-a-date', '2026-99-01'])
      await expect(f.read({ from })).rejects.toBeInstanceOf(StudentActivityQueryError);
  });

  it('preserves student-authorized public publications across users and legacy inferred ownership without private content', async () => {
    const f = await fixture();
    const otherUser = randomUUID();
    // Each source uses a different learner so a wrong inference or direct-owner
    // priority would leak a false publication into Mina's feed.
    const other = await insertStudent({ student: 'Other student', workspaceId: f.workspaceId });
    await withPgClient((client) =>
      client.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'unused')", [
        otherUser,
        `${otherUser}@example.test`,
      ]),
    );
    const published: string[] = [];
    let legacyUpdatedAt = '';
    for (const source of [
      'direct-null-user',
      'direct-other-user',
      'recording',
      'prompt',
      'draft',
      'draft-prompt',
      'foreign',
    ] as const) {
      const recordingId = randomUUID(),
        transcriptId = randomUUID(),
        promptId = randomUUID(),
        draftId = randomUUID();
      const owner = source === 'foreign' ? other.id : f.studentId;
      await withPgClient(async (client) => {
        await client.query(
          "INSERT INTO recordings(id,student_id,source,storage_uri,status,bytes) VALUES($1,$2,'upload','local://private-recording','transcribed',1)",
          [recordingId, source === 'recording' ? owner : other.id],
        );
        await client.query(
          "INSERT INTO transcripts(id,recording_id,storage_uri,mode,model,language,fallback_used) VALUES($1,$2,'local://private-transcript','timeline','fixture','en',false)",
          [transcriptId, recordingId],
        );
        await client.query(
          "INSERT INTO prompt_packages(id,student_id,recording_id,transcript_id,template_version,storage_uri) VALUES($1,$2,$3,$4,'fixture','local://private-prompt')",
          [
            promptId,
            ['prompt', 'draft-prompt'].includes(source) ? owner : other.id,
            recordingId,
            transcriptId,
          ],
        );
        await client.query(
          "INSERT INTO drafts(id,student_id,prompt_package_id,storage_uri,working_version,content_hash,format) VALUES($1,$2,$3,$4,1,$5,'assignment_v1')",
          [
            draftId,
            source === 'draft' ? owner : null,
            promptId,
            `local://drafts/content/${'a'.repeat(64)}.json`,
            'a'.repeat(64),
          ],
        );
      });
      const job = await insertJob({
        studentId: source.startsWith('direct') || source === 'foreign' ? owner : undefined,
        userId: source === 'direct-null-user' ? undefined : otherUser,
        recordingId: source === 'recording' ? recordingId : undefined,
        promptPackageId: source === 'prompt' ? promptId : randomUUID(),
        draftId: ['draft', 'draft-prompt'].includes(source) ? draftId : randomUUID(),
        assignmentArtifact: assignmentArtifactFixture(),
        assignmentRendererVersion: 2,
        publishTarget: 'html',
      });
      await updateJobStateAndResult({ id: job.id, expectedState: 'queued', nextState: 'running' });
      await updateJobStateAndResult({
        id: job.id,
        expectedState: 'running',
        nextState: 'succeeded',
        htmlUrl: `https://example.test/${job.id}.html`,
        publishedContentHash: 'a'.repeat(64),
        finishedAt: source === 'direct-null-user' ? undefined : new Date(),
      });
      if (source === 'direct-null-user')
        legacyUpdatedAt = await withPgClient(
          async (client) =>
            (
              await client.query(
                `UPDATE jobs SET created_at='2026-01-01T00:00:00Z' WHERE id=$1
            RETURNING to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS actual_updated_at`,
                [job.id],
              )
            ).rows[0].actual_updated_at as string,
        );
      if (source !== 'foreign') published.push(`publication:${job.id}`);
    }
    const rows = (await f.read({ category: 'lessons' }))!.items.filter(
      (x) => x.type === 'homework_published',
    );
    expect(rows.map((x) => x.id).sort()).toEqual(published.sort());
    expect(JSON.stringify(rows)).not.toContain('private-recording');
    expect(JSON.stringify(rows)).not.toContain('private-prompt');
    expect(
      rows.every((x) => x.links.some((link) => link.href.startsWith('https://example.test/'))),
    ).toBe(true);
    expect(rows.filter((x) => x.evidence === 'legacy')).toHaveLength(1);
    expect(rows.find((x) => x.evidence === 'legacy')!.occurredAt).toBe(legacyUpdatedAt);
  });

  it('keeps terminal failure evidence when mutable error details change and confines private failures to their user', async () => {
    const f = await fixture();
    const job = await insertJob({
      studentId: f.studentId,
      userId: f.userId,
      promptPackageId: randomUUID(),
      draftId: randomUUID(),
      assignmentArtifact: assignmentArtifactFixture(),
      assignmentRendererVersion: 2,
      publishTarget: 'html',
    });
    await updateJobStateAndResult({ id: job.id, expectedState: 'queued', nextState: 'running' });
    await updateJobStateAndResult({
      id: job.id,
      expectedState: 'running',
      nextState: 'failed',
      error: 'private raw provider response',
      finishedAt: new Date(),
    });
    const initial = (await f.read())!.items.filter((x) => x.type === 'homework_failed');
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      evidence: 'recorded',
      subject: 'Homework attempt failed',
      links: [{ label: 'Open assignments', href: '/' }],
    });
    expect(JSON.stringify(initial)).not.toContain('provider response');
    await updateJobStateAndResult({
      id: job.id,
      expectedState: 'failed',
      nextState: 'failed',
      error: 'overwritten detail',
    });
    expect(
      (await f.read())!.items.filter((x) => x.type === 'homework_failed').map((x) => x.id),
    ).toEqual(initial.map((x) => x.id));
    expect(
      (await getStudentActivity(f.workspaceId, f.studentId, randomUUID()))!.items.some(
        (x) => x.type === 'homework_failed',
      ),
    ).toBe(false);
  });

  it('suppresses generated placeholder-title enrichment while retaining explicit title edits', async () => {
    const f = await fixture();
    const lessonId = (
      await createStudentLesson(
        f.workspaceId,
        f.studentId,
        { startsAt: '2026-10-17T07:00:00Z', title: 'Untitled lesson' },
        f.userId,
      )
    ).lessons[0]!.id;
    expect(
      await applyGeneratedLessonTitleIfPlaceholder({
        studentId: f.studentId,
        lessonId,
        title: 'Generated topic',
      }),
    ).toBe(true);
    expect((await f.read())!.items.filter((x) => x.type.startsWith('lesson_'))).toHaveLength(1);
    await updateStudentLesson(
      f.workspaceId,
      f.studentId,
      lessonId,
      { title: 'Teacher chosen topic' },
      f.userId,
    );
    expect((await f.read())!.items.find((x) => x.type === 'lesson_changed')!.subject).toBe(
      'Lesson changed · Teacher chosen topic',
    );
  });

  it('enforces credit relation ownership and append-only retention, while erasing a deleted actor reference', async () => {
    const f = await fixture();
    const foreign = await insertStudent({
      student: 'Other learner',
      workspaceId: f.workspaceId,
      actorUserId: f.userId,
    });
    const lessonId = (
      await createStudentLesson(
        f.workspaceId,
        f.studentId,
        { startsAt: '2026-10-17T07:00:00Z' },
        f.userId,
      )
    ).lessons[0]!.id;
    await updateStudentLesson(
      f.workspaceId,
      f.studentId,
      lessonId,
      { status: 'completed', consumesCredit: true },
      f.userId,
    );
    const foreignActivity = await withPgClient(
      async (client) =>
        (
          await client.query('SELECT id FROM student_activity WHERE student_id=$1 LIMIT 1', [
            foreign.id,
          ])
        ).rows[0].id as string,
    );
    await expect(
      withPgClient((client) =>
        client.query('UPDATE student_credit_events SET activity_id=$2 WHERE student_id=$1', [
          f.studentId,
          foreignActivity,
        ]),
      ),
    ).rejects.toThrow('Credit activity ownership mismatch');
    await expect(
      withPgClient((client) =>
        client.query("UPDATE student_activity SET type='student_restored' WHERE student_id=$1", [
          f.studentId,
        ]),
      ),
    ).rejects.toThrow('append-only');
    await expect(
      withPgClient((client) =>
        client.query('DELETE FROM student_activity WHERE student_id=$1', [f.studentId]),
      ),
    ).rejects.toThrow('retention');
    await expect(
      withPgClient((client) =>
        client.query('UPDATE student_credit_events SET source_lesson_id=NULL WHERE student_id=$1', [
          f.studentId,
        ]),
      ),
    ).rejects.toThrow('source is retained');
    // The existing lesson FK may remove its source while the activity row retains
    // the historical subject and the original causal debit identity.
    await withPgClient((client) =>
      client.query('DELETE FROM student_lessons WHERE id=$1', [lessonId]),
    );
    expect((await f.read())!.items.find((x) => x.type === 'lesson_completed')!.effects).toEqual([
      { label: 'Credits', value: '-1' },
    ]);
    await withPgClient((client) => client.query('DELETE FROM users WHERE id=$1', [f.userId]));
    await withPgClient(async (client) => {
      const rows = await client.query(
        'SELECT actor_kind,actor_user_id FROM student_activity WHERE student_id=$1',
        [f.studentId],
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(
        rows.rows.every((row) => row.actor_kind === 'user' && row.actor_user_id === null),
      ).toBe(true);
    });
    expect(await deleteStudent(f.studentId)).toBe(true);
    await withPgClient(async (client) => {
      expect(
        (
          await client.query('SELECT count(*) FROM student_activity WHERE student_id=$1', [
            f.studentId,
          ])
        ).rows[0].count,
      ).toBe('0');
    });
  });

  it('preserves the existing workspace SET NULL retention path without blocking linked ledger cleanup', async () => {
    const f = await fixture();
    const lessonId = (
      await createStudentLesson(
        f.workspaceId,
        f.studentId,
        { startsAt: '2026-10-17T07:00:00Z' },
        f.userId,
      )
    ).lessons[0]!.id;
    await updateStudentLesson(
      f.workspaceId,
      f.studentId,
      lessonId,
      { status: 'completed', consumesCredit: true },
      f.userId,
    );
    await updateStudentLesson(
      f.workspaceId,
      f.studentId,
      lessonId,
      { status: 'scheduled', consumesCredit: false },
      f.userId,
    );
    await withPgClient(async (client) => {
      await client.query('DELETE FROM workspaces WHERE id=$1', [f.workspaceId]);
      expect(
        (await client.query('SELECT workspace_id FROM students WHERE id=$1', [f.studentId])).rows[0]
          .workspace_id,
      ).toBeNull();
      expect(
        (
          await client.query('SELECT count(*) FROM student_activity WHERE student_id=$1', [
            f.studentId,
          ])
        ).rows[0].count,
      ).toBe('0');
      expect(
        (
          await client.query(
            'SELECT workspace_id,activity_id,reversal_activity_id FROM student_credit_events WHERE student_id=$1',
            [f.studentId],
          )
        ).rows,
      ).toEqual([{ workspace_id: null, activity_id: null, reversal_activity_id: null }]);
    });
  });

  it('bounds traversal without claiming a database snapshot and discovers later commits on Refresh', async () => {
    const f = await fixture();
    await updateStudent({
      id: f.studentId,
      workspaceId: f.workspaceId,
      student: 'Mina B',
      actorUserId: f.userId,
    });
    const first = (await f.read({ limit: 1 }))!;
    await updateStudent({
      id: f.studentId,
      workspaceId: f.workspaceId,
      student: 'Mina C',
      actorUserId: f.userId,
    });
    const older = (await f.read({ limit: 1, cursor: first.nextCursor! }))!;
    expect(older.items.map((x) => x.type)).toEqual(['student_created']);
    expect((await f.read())!.items[0]!.subject).toBe('Student renamed · Mina C');
    expect((await f.read())!.coverage.recordingStartedAt).toBeNull();
  });
});
