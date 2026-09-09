import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getStudentTimeline,
  type StudentTimelineType,
} from '../src/application/student-timeline.js';
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
        profile_revisions,
        student_profile_bindings,
        students,
        profiles
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
        )
        VALUES ($1, $2, $3, 's3://bucket/draft.txt', 1, repeat('a', 64), $4, $4)
        `,
        [draftId, promptPackageId, studentId, times.draft],
      );
      await client.query(
        `
        INSERT INTO jobs (id, state, recording_id, transcript_id, prompt_package_id, draft_id, created_at, updated_at, finished_at, error)
        VALUES ($1, 'failed', $2, $3, $4, $5, $6, $6, $6, 'boom')
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

  it('includes student profile binding changes with governance details', async () => {
    const studentId = deriveStudentId('Nina');
    const profileId = 'profiles/nina.md';
    const bindingId = randomUUID();
    const changedBy = randomUUID();
    const createdAt = new Date('2024-01-06T00:00:00.000Z');

    await withPgClient(async (client) => {
      await client.query(
        `
        INSERT INTO profiles (id, label, active_revision_id)
        VALUES ($1, 'Nina profile', NULL)
        `,
        [profileId],
      );
      await client.query(
        `
        INSERT INTO students (id, student, profile_id)
        VALUES ($1, 'Nina', $2)
        `,
        [studentId, profileId],
      );
      await client.query(
        `
        INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
        VALUES ($1, $2, 'hash', 'user', true, $3, $3)
        `,
        [changedBy, `${changedBy.replaceAll('-', '').slice(0, 16)}@example.com`, createdAt],
      );
      await client.query(
        `
        INSERT INTO student_profile_bindings (
          id,
          student_id,
          profile_id,
          effective_from,
          effective_to,
          reason,
          changed_by,
          created_at
        )
        VALUES ($1, $2, $3, $4, NULL, 'student_update', $5, $4)
        `,
        [bindingId, studentId, profileId, createdAt, changedBy],
      );
    });

    const timeline = await getStudentTimeline(studentId, {
      types: ['student_profile_binding_changed'],
    });

    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]?.type).toBe('student_profile_binding_changed');
    expect(timeline.items[0]?.status).toBe('binding_changed');
    expect(timeline.items[0]?.details).toMatchObject({
      bindingId,
      profileId,
      reason: 'student_update',
      changedBy,
    });
  });

  it('includes revision lifecycle and job action events with deterministic filtering', async () => {
    const studentId = deriveStudentId('Mila');
    const profileId = 'profiles/mila.md';
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
        INSERT INTO profiles (id, label, active_revision_id)
        VALUES ($1, 'Mila profile', NULL)
        `,
        [profileId],
      );
      await client.query(
        `
        INSERT INTO templates (id, label, active_revision_id)
        VALUES ($1, 'Default template', NULL)
        `,
        [templateId],
      );
      await client.query(
        `
        INSERT INTO students (id, student, profile_id)
        VALUES ($1, 'Mila', $2)
        `,
        [studentId, profileId],
      );
      await client.query(
        `
        INSERT INTO student_profile_bindings (
          id,
          student_id,
          profile_id,
          effective_from,
          effective_to,
          reason,
          changed_by,
          created_at
        )
        VALUES ($1, $2, $3, $4, NULL, 'seed', NULL, $4)
        `,
        [randomUUID(), studentId, profileId, eventAt],
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
        )
        VALUES ($1, 'succeeded', $2, $3, $4, $5, $5, $5)
        `,
        [jobId, recordingId, transcriptId, promptPackageId, eventAt],
      );
      await client.query(
        `
        INSERT INTO profile_revisions (
          id,
          profile_id,
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
        [profileRevisionId, profileId, eventAt],
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
