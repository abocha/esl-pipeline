import path from 'node:path';

import { withPgClient } from '../infrastructure/db.js';

export type StudentTimelineType =
  | 'recording_ingested'
  | 'transcript_ready'
  | 'prompt_package_created'
  | 'draft_saved'
  | 'job_awaiting_approval'
  | 'job_completed'
  | 'student_profile_binding_changed'
  | 'profile_revision_saved'
  | 'profile_revision_restored'
  | 'profile_revision_activated'
  | 'template_revision_saved'
  | 'template_revision_restored'
  | 'template_revision_activated'
  | 'job_action_rerun'
  | 'job_action_cancel'
  | 'job_action_edit_metadata'
  | 'lesson_created'
  | 'lesson_updated'
  | 'lesson_completed'
  | 'lesson_canceled'
  | 'lesson_no_show'
  | 'lesson_plan_updated'
  | 'lesson_recurrence_updated'
  | 'credit_event_recorded'
  | 'payment_recorded'
  | 'reminder_hidden'
  | 'business_settings_updated';

export interface StudentTimelineItem {
  type: StudentTimelineType;
  studentId: string;
  recordingId?: string | null;
  transcriptId?: string | null;
  promptPackageId?: string | null;
  draftId?: string | null;
  jobId?: string | null;
  status: string;
  createdAt: string;
  displayName: string;
  details?: Record<string, unknown>;
}

export interface StudentTimelineResponse {
  items: StudentTimelineItem[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export interface StudentTimelineParams {
  types?: StudentTimelineType[];
  statuses?: string[];
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

const MAX_PAGE_LIMIT = 500;

interface TimelineRow {
  type: StudentTimelineType;
  status: string;
  created_at: Date;
  recording_id: string | null;
  transcript_id: string | null;
  prompt_package_id: string | null;
  draft_id: string | null;
  job_id: string | null;
  source_path: string | null;
  storage_uri: string | null;
  error: string | null;
  binding_id: string | null;
  binding_profile_id: string | null;
  binding_reason: string | null;
  binding_changed_by: string | null;
  profile_revision_id: string | null;
  profile_id: string | null;
  profile_source: string | null;
  profile_version_label: string | null;
  template_revision_id: string | null;
  template_id: string | null;
  template_source: string | null;
  template_version_label: string | null;
  action_id: string | null;
  action_type: string | null;
  action_message: string | null;
  action_error_code: string | null;
  action_requested_by: string | null;
  action_created_job_id: string | null;
  html_url: string | null;
  details_json: Record<string, unknown> | null;
}

function deriveDisplayName(params: {
  fallbackId: string;
  sourcePath?: string | null;
  storageUri?: string | null;
}): string {
  const sourcePath = params.sourcePath?.trim() ?? '';
  const storageUri = params.storageUri?.trim() ?? '';
  const candidate = sourcePath || storageUri;
  if (!candidate) return params.fallbackId;
  const cleaned = candidate.split('?')[0]?.split('#')[0] ?? candidate;
  const base = path.basename(cleaned);
  return base && base !== '.' && base !== '/' ? base : params.fallbackId;
}

function normalizeTypeFilter(
  types?: StudentTimelineType[] | string,
): Set<StudentTimelineType> | null {
  if (!types) return null;
  const list = Array.isArray(types) ? types : String(types).split(',');
  const filtered = list
    .map((value) => value.trim())
    .filter((value): value is StudentTimelineType => value.length > 0);
  return filtered.length > 0 ? new Set(filtered) : null;
}

function normalizeStatusFilter(statuses?: string[] | string): Set<string> | null {
  if (!statuses) return null;
  const list = Array.isArray(statuses) ? statuses : String(statuses).split(',');
  const filtered = list.map((value) => value.trim()).filter((value) => value.length > 0);
  return filtered.length > 0 ? new Set(filtered) : null;
}

const timelineQuery = `
  WITH timeline AS (
    SELECT 'recording_ingested'::text AS type,
           r.status::text AS status,
           r.created_at,
           r.id AS recording_id,
           NULL::uuid AS transcript_id,
           NULL::uuid AS prompt_package_id,
           NULL::uuid AS draft_id,
           NULL::uuid AS job_id,
           r.source_path,
           r.storage_uri,
           r.error,
           NULL::uuid AS binding_id,
           NULL::text AS binding_profile_id,
           NULL::text AS binding_reason,
           NULL::uuid AS binding_changed_by,
           NULL::uuid AS profile_revision_id,
           NULL::text AS profile_id,
           NULL::text AS profile_source,
           NULL::text AS profile_version_label,
           NULL::uuid AS template_revision_id,
           NULL::text AS template_id,
           NULL::text AS template_source,
           NULL::text AS template_version_label,
           NULL::uuid AS action_id,
           NULL::text AS action_type,
           NULL::text AS action_message,
           NULL::text AS action_error_code,
           NULL::uuid AS action_requested_by,
           NULL::uuid AS action_created_job_id,
           NULL::text AS html_url,
           NULL::jsonb AS details_json
    FROM recordings r
    WHERE r.student_id = $1

    UNION ALL

    SELECT 'transcript_ready'::text AS type,
           'ready'::text AS status,
           t.created_at,
           t.recording_id,
           t.id AS transcript_id,
           NULL::uuid AS prompt_package_id,
           NULL::uuid AS draft_id,
           NULL::uuid AS job_id,
           r.source_path,
           r.storage_uri,
           NULL::text AS error,
           NULL::uuid AS binding_id,
           NULL::text AS binding_profile_id,
           NULL::text AS binding_reason,
           NULL::uuid AS binding_changed_by,
           NULL::uuid AS profile_revision_id,
           NULL::text AS profile_id,
           NULL::text AS profile_source,
           NULL::text AS profile_version_label,
           NULL::uuid AS template_revision_id,
           NULL::text AS template_id,
           NULL::text AS template_source,
           NULL::text AS template_version_label,
           NULL::uuid AS action_id,
           NULL::text AS action_type,
           NULL::text AS action_message,
           NULL::text AS action_error_code,
           NULL::uuid AS action_requested_by,
           NULL::uuid AS action_created_job_id,
           NULL::text AS html_url,
           NULL::jsonb AS details_json
    FROM transcripts t
    JOIN recordings r ON r.id = t.recording_id
    WHERE r.student_id = $1

    UNION ALL

    SELECT 'prompt_package_created'::text AS type,
           'ready'::text AS status,
           p.created_at,
           p.recording_id,
           p.transcript_id,
           p.id AS prompt_package_id,
           NULL::uuid AS draft_id,
           NULL::uuid AS job_id,
           r.source_path,
           r.storage_uri,
           NULL::text AS error,
           NULL::uuid AS binding_id,
           NULL::text AS binding_profile_id,
           NULL::text AS binding_reason,
           NULL::uuid AS binding_changed_by,
           NULL::uuid AS profile_revision_id,
           NULL::text AS profile_id,
           NULL::text AS profile_source,
           NULL::text AS profile_version_label,
           NULL::uuid AS template_revision_id,
           NULL::text AS template_id,
           NULL::text AS template_source,
           NULL::text AS template_version_label,
           NULL::uuid AS action_id,
           NULL::text AS action_type,
           NULL::text AS action_message,
           NULL::text AS action_error_code,
           NULL::uuid AS action_requested_by,
           NULL::uuid AS action_created_job_id,
           NULL::text AS html_url,
           NULL::jsonb AS details_json
    FROM prompt_packages p
    LEFT JOIN recordings r ON r.id = p.recording_id
    WHERE p.student_id = $1

    UNION ALL

    SELECT 'draft_saved'::text AS type,
           'saved'::text AS status,
           d.created_at,
           p.recording_id,
           p.transcript_id,
           d.prompt_package_id,
           d.id AS draft_id,
           NULL::uuid AS job_id,
           r.source_path,
           r.storage_uri,
           NULL::text AS error,
           NULL::uuid AS binding_id,
           NULL::text AS binding_profile_id,
           NULL::text AS binding_reason,
           NULL::uuid AS binding_changed_by,
           NULL::uuid AS profile_revision_id,
           NULL::text AS profile_id,
           NULL::text AS profile_source,
           NULL::text AS profile_version_label,
           NULL::uuid AS template_revision_id,
           NULL::text AS template_id,
           NULL::text AS template_source,
           NULL::text AS template_version_label,
           NULL::uuid AS action_id,
           NULL::text AS action_type,
           NULL::text AS action_message,
           NULL::text AS action_error_code,
           NULL::uuid AS action_requested_by,
           NULL::uuid AS action_created_job_id,
           NULL::text AS html_url,
           NULL::jsonb AS details_json
    FROM drafts d
    LEFT JOIN prompt_packages p ON p.id = d.prompt_package_id
    LEFT JOIN recordings r ON r.id = p.recording_id
    WHERE d.student_id = $1

    UNION ALL

    SELECT
      CASE
        WHEN j.state = 'awaiting_approval' THEN 'job_awaiting_approval'
        ELSE 'job_completed'
      END::text AS type,
      j.state::text AS status,
      COALESCE(j.finished_at, j.updated_at, j.created_at) AS created_at,
      j.recording_id,
      j.transcript_id,
      j.prompt_package_id,
      j.draft_id,
      j.id AS job_id,
      COALESCE(r.source_path, rp.source_path, rd.source_path) AS source_path,
      COALESCE(r.storage_uri, rp.storage_uri, rd.storage_uri) AS storage_uri,
      j.error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      j.html_url,
      NULL::jsonb AS details_json
    FROM jobs j
    LEFT JOIN recordings r ON r.id = j.recording_id
    LEFT JOIN prompt_packages p ON p.id = j.prompt_package_id
    LEFT JOIN recordings rp ON rp.id = p.recording_id
    LEFT JOIN drafts d ON d.id = j.draft_id
    LEFT JOIN prompt_packages pd ON pd.id = d.prompt_package_id
    LEFT JOIN recordings rd ON rd.id = pd.recording_id
    WHERE (
      j.student_id = $1
      OR (
        j.student_id IS NULL
        AND COALESCE(r.student_id, p.student_id, d.student_id, pd.student_id) = $1
      )
    )
      AND j.state IN ('awaiting_approval', 'succeeded', 'failed')

    UNION ALL

    SELECT 'student_profile_binding_changed'::text AS type,
           'binding_changed'::text AS status,
           spb.created_at,
           NULL::uuid AS recording_id,
           NULL::uuid AS transcript_id,
           NULL::uuid AS prompt_package_id,
           NULL::uuid AS draft_id,
           NULL::uuid AS job_id,
           spb.profile_id AS source_path,
           NULL::text AS storage_uri,
           NULL::text AS error,
           spb.id AS binding_id,
           spb.profile_id AS binding_profile_id,
           spb.reason AS binding_reason,
           spb.changed_by AS binding_changed_by,
           NULL::uuid AS profile_revision_id,
           NULL::text AS profile_id,
           NULL::text AS profile_source,
           NULL::text AS profile_version_label,
           NULL::uuid AS template_revision_id,
           NULL::text AS template_id,
           NULL::text AS template_source,
           NULL::text AS template_version_label,
           NULL::uuid AS action_id,
           NULL::text AS action_type,
           NULL::text AS action_message,
           NULL::text AS action_error_code,
           NULL::uuid AS action_requested_by,
           NULL::uuid AS action_created_job_id,
           NULL::text AS html_url,
           NULL::jsonb AS details_json
    FROM student_profile_bindings spb
    WHERE spb.student_id = $1

    UNION ALL

    SELECT
      CASE
        WHEN pr.source = 'restore' THEN 'profile_revision_restored'
        ELSE 'profile_revision_saved'
      END::text AS type,
      pr.status::text AS status,
      pr.created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      pr.profile_id AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      pr.id AS profile_revision_id,
      pr.profile_id,
      pr.source AS profile_source,
      pr.version_label AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      NULL::jsonb AS details_json
    FROM profile_revisions pr
    WHERE EXISTS (
      SELECT 1
      FROM student_profile_bindings spb
      WHERE spb.student_id = $1 AND spb.profile_id = pr.profile_id
    )
      OR EXISTS (
        SELECT 1
        FROM students s
        WHERE s.id = $1 AND s.profile_id = pr.profile_id
      )

    UNION ALL

    SELECT
      'profile_revision_activated'::text AS type,
      'active'::text AS status,
      COALESCE(pr.activated_at, pr.created_at) AS created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      pr.profile_id AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      pr.id AS profile_revision_id,
      pr.profile_id,
      pr.source AS profile_source,
      pr.version_label AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      NULL::jsonb AS details_json
    FROM profile_revisions pr
    WHERE pr.status = 'active'
      AND pr.activated_at IS NOT NULL
      AND (
        EXISTS (
          SELECT 1
          FROM student_profile_bindings spb
          WHERE spb.student_id = $1 AND spb.profile_id = pr.profile_id
        )
        OR EXISTS (
          SELECT 1
          FROM students s
          WHERE s.id = $1 AND s.profile_id = pr.profile_id
        )
      )

    UNION ALL

    SELECT
      CASE
        WHEN tr.source = 'restore' THEN 'template_revision_restored'
        ELSE 'template_revision_saved'
      END::text AS type,
      tr.status::text AS status,
      tr.created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      tr.template_id AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      tr.id AS template_revision_id,
      tr.template_id,
      tr.source AS template_source,
      tr.version_label AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      NULL::jsonb AS details_json
    FROM template_revisions tr
    WHERE EXISTS (
      SELECT 1
      FROM prompt_packages p
      WHERE p.student_id = $1 AND p.resolved_template_id = tr.template_id
    )

    UNION ALL

    SELECT
      'template_revision_activated'::text AS type,
      'active'::text AS status,
      COALESCE(tr.activated_at, tr.created_at) AS created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      tr.template_id AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      tr.id AS template_revision_id,
      tr.template_id,
      tr.source AS template_source,
      tr.version_label AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      NULL::jsonb AS details_json
    FROM template_revisions tr
    WHERE tr.status = 'active'
      AND tr.activated_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM prompt_packages p
        WHERE p.student_id = $1 AND p.resolved_template_id = tr.template_id
      )

    UNION ALL

    SELECT
      CASE
        WHEN jah.action_type = 'rerun' THEN 'job_action_rerun'
        WHEN jah.action_type = 'cancel' THEN 'job_action_cancel'
        ELSE 'job_action_edit_metadata'
      END::text AS type,
      jah.outcome::text AS status,
      jah.requested_at AS created_at,
      j.recording_id,
      j.transcript_id,
      j.prompt_package_id,
      j.draft_id,
      jah.job_id,
      COALESCE(r.source_path, rp.source_path, rd.source_path) AS source_path,
      COALESCE(r.storage_uri, rp.storage_uri, rd.storage_uri) AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      jah.id AS action_id,
      jah.action_type,
      jah.message AS action_message,
      jah.error_code AS action_error_code,
      jah.requested_by AS action_requested_by,
      jah.created_job_id AS action_created_job_id,
      j.html_url,
      NULL::jsonb AS details_json
    FROM job_action_history jah
    JOIN jobs j ON j.id = jah.job_id
    LEFT JOIN recordings r ON r.id = j.recording_id
    LEFT JOIN prompt_packages p ON p.id = j.prompt_package_id
    LEFT JOIN recordings rp ON rp.id = p.recording_id
    LEFT JOIN drafts d ON d.id = j.draft_id
    LEFT JOIN prompt_packages pd ON pd.id = d.prompt_package_id
    LEFT JOIN recordings rd ON rd.id = pd.recording_id
    WHERE (
      j.student_id = $1
      OR (
        j.student_id IS NULL
        AND COALESCE(r.student_id, p.student_id, d.student_id, pd.student_id, rp.student_id, rd.student_id) = $1
      )
    )

    UNION ALL

    SELECT
      'lesson_created'::text AS type,
      sl.status::text AS status,
      sl.created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      COALESCE(sl.title, 'Lesson ' || sl.id::text) AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      jsonb_build_object(
        'lessonId', sl.id,
        'workspaceId', sl.workspace_id,
        'startsAt', sl.starts_at,
        'timezone', sl.timezone,
        'durationMinutes', sl.duration_minutes,
        'title', sl.title,
        'status', sl.status,
        'consumesCredit', sl.consumes_credit,
        'recurrenceOrigin', sl.recurrence_origin,
        'recurrenceOverrideKind', sl.recurrence_override_kind
      ) AS details_json
    FROM student_lessons sl
    WHERE sl.student_id = $1

    UNION ALL

    SELECT
      CASE
        WHEN sl.status = 'completed' THEN 'lesson_completed'
        WHEN sl.status = 'canceled' THEN 'lesson_canceled'
        WHEN sl.status = 'no_show' THEN 'lesson_no_show'
        ELSE 'lesson_updated'
      END::text AS type,
      sl.status::text AS status,
      sl.updated_at AS created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      COALESCE(sl.title, 'Lesson ' || sl.id::text) AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      jsonb_build_object(
        'lessonId', sl.id,
        'workspaceId', sl.workspace_id,
        'startsAt', sl.starts_at,
        'timezone', sl.timezone,
        'durationMinutes', sl.duration_minutes,
        'title', sl.title,
        'status', sl.status,
        'consumesCredit', sl.consumes_credit,
        'recurrenceOrigin', sl.recurrence_origin,
        'recurrenceOverrideKind', sl.recurrence_override_kind
      ) AS details_json
    FROM student_lessons sl
    WHERE sl.student_id = $1
      AND sl.updated_at > sl.created_at

    UNION ALL

    SELECT
      'lesson_plan_updated'::text AS type,
      'updated'::text AS status,
      slp.updated_at AS created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      'Lesson plan'::text AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      jsonb_build_object(
        'workspaceId', slp.workspace_id,
        'timezone', slp.timezone,
        'defaultDurationMinutes', slp.default_duration_minutes,
        'cadence', slp.cadence,
        'preferredTimes', slp.preferred_times,
        'schedulingNotes', slp.scheduling_notes
      ) AS details_json
    FROM student_lesson_plans slp
    WHERE slp.student_id = $1

    UNION ALL

    SELECT
      'lesson_recurrence_updated'::text AS type,
      slrr.status::text AS status,
      slrr.updated_at AS created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      'Lesson recurrence'::text AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      jsonb_build_object(
        'recurrenceRuleId', slrr.id,
        'workspaceId', slrr.workspace_id,
        'timezone', slrr.timezone,
        'frequency', slrr.frequency,
        'startsOn', slrr.starts_on,
        'endsOn', slrr.ends_on,
        'status', slrr.status,
        'generationHorizonDays', slrr.generation_horizon_days,
        'materializedThrough', slrr.materialized_through
      ) AS details_json
    FROM student_lesson_recurrence_rules slrr
    WHERE slrr.student_id = $1

    UNION ALL

    SELECT
      'credit_event_recorded'::text AS type,
      sce.event_type::text AS status,
      sce.created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      'Credit event ' || sce.id::text AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      jsonb_build_object(
        'creditEventId', sce.id,
        'workspaceId', sce.workspace_id,
        'eventType', sce.event_type,
        'quantityDelta', sce.quantity_delta,
        'sourceLessonId', sce.source_lesson_id,
        'sourcePaymentId', sce.source_payment_id,
        'note', sce.note,
        'voidedAt', sce.voided_at
      ) AS details_json
    FROM student_credit_events sce
    WHERE sce.student_id = $1

    UNION ALL

    SELECT
      'payment_recorded'::text AS type,
      CASE WHEN spr.voided_at IS NULL THEN 'received' ELSE 'voided' END::text AS status,
      spr.created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      'Payment ' || spr.id::text AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      spr.external_url AS html_url,
      jsonb_build_object(
        'paymentId', spr.id,
        'workspaceId', spr.workspace_id,
        'amountMinor', spr.amount_minor,
        'currency', spr.currency,
        'method', spr.method,
        'receivedAt', spr.received_at,
        'note', spr.note,
        'voidedAt', spr.voided_at
      ) AS details_json
    FROM student_payment_records spr
    WHERE spr.student_id = $1

    UNION ALL

    SELECT
      'reminder_hidden'::text AS type,
      'lesson_followup'::text AS status,
      srp.latest_hidden_lesson_followup_at AS created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      'Hidden lesson follow-up reminder'::text AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      jsonb_build_object(
        'workspaceId', srp.workspace_id,
        'lessonId', srp.latest_hidden_lesson_followup_lesson_id,
        'reminderKey', srp.latest_hidden_lesson_followup_key
      ) AS details_json
    FROM student_reminder_preferences srp
    WHERE srp.student_id = $1
      AND srp.latest_hidden_lesson_followup_at IS NOT NULL

    UNION ALL

    SELECT
      'business_settings_updated'::text AS type,
      'updated'::text AS status,
      wbs.updated_at AS created_at,
      NULL::uuid AS recording_id,
      NULL::uuid AS transcript_id,
      NULL::uuid AS prompt_package_id,
      NULL::uuid AS draft_id,
      NULL::uuid AS job_id,
      'Business settings'::text AS source_path,
      NULL::text AS storage_uri,
      NULL::text AS error,
      NULL::uuid AS binding_id,
      NULL::text AS binding_profile_id,
      NULL::text AS binding_reason,
      NULL::uuid AS binding_changed_by,
      NULL::uuid AS profile_revision_id,
      NULL::text AS profile_id,
      NULL::text AS profile_source,
      NULL::text AS profile_version_label,
      NULL::uuid AS template_revision_id,
      NULL::text AS template_id,
      NULL::text AS template_source,
      NULL::text AS template_version_label,
      NULL::uuid AS action_id,
      NULL::text AS action_type,
      NULL::text AS action_message,
      NULL::text AS action_error_code,
      NULL::uuid AS action_requested_by,
      NULL::uuid AS action_created_job_id,
      NULL::text AS html_url,
      jsonb_build_object(
        'workspaceId', wbs.workspace_id,
        'defaultCurrency', wbs.default_currency,
        'defaultLessonRateMinor', wbs.default_lesson_rate_minor,
        'defaultLessonDurationMinutes', wbs.default_lesson_duration_minutes,
        'timezone', wbs.timezone,
        'forecastHorizonDays', wbs.forecast_horizon_days,
        'topUpThreshold', wbs.top_up_threshold
      ) AS details_json
    FROM workspace_business_settings wbs
    JOIN students s ON s.workspace_id = wbs.workspace_id
    WHERE s.id = $1
  )
`;

export async function getStudentTimeline(
  studentId: string,
  params: StudentTimelineParams = {},
): Promise<StudentTimelineResponse> {
  const typeFilter = normalizeTypeFilter(params.types);
  const statusFilter = normalizeStatusFilter(params.statuses);
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const order = params.order ?? 'desc';

  const { rows, total } = await withPgClient(async (client) => {
    const values: (string | string[] | Date)[] = [studentId];
    const filters: string[] = [];
    let paramIndex = 2;

    if (typeFilter && typeFilter.size > 0) {
      values.push([...typeFilter]);
      filters.push(`type = ANY($${paramIndex}::text[])`);
      paramIndex += 1;
    }

    if (statusFilter && statusFilter.size > 0) {
      values.push([...statusFilter]);
      filters.push(`status = ANY($${paramIndex}::text[])`);
      paramIndex += 1;
    }

    if (params.from) {
      values.push(params.from);
      filters.push(`created_at >= $${paramIndex}`);
      paramIndex += 1;
    }

    if (params.to) {
      values.push(params.to);
      filters.push(`created_at <= $${paramIndex}`);
      paramIndex += 1;
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const countQuery = `${timelineQuery} SELECT COUNT(*)::int AS total FROM timeline ${whereClause}`;
    const countResult = await client.query(countQuery, values);

    const orderClause = order === 'asc' ? 'ASC' : 'DESC';
    const dataQuery = `${timelineQuery}
      SELECT type,
             status,
             created_at,
             recording_id,
             transcript_id,
             prompt_package_id,
             draft_id,
             job_id,
             source_path,
             storage_uri,
             error,
             binding_id,
             binding_profile_id,
             binding_reason,
             binding_changed_by,
             profile_revision_id,
             profile_id,
             profile_source,
             profile_version_label,
             template_revision_id,
             template_id,
             template_source,
             template_version_label,
             action_id,
             action_type,
             action_message,
             action_error_code,
             action_requested_by,
             action_created_job_id,
             html_url,
             details_json
      FROM timeline
      ${whereClause}
      ORDER BY
        created_at ${orderClause},
        type ${orderClause},
        COALESCE(
          job_id::text,
          draft_id::text,
          prompt_package_id::text,
          transcript_id::text,
          recording_id::text,
          binding_id::text,
          profile_revision_id::text,
          template_revision_id::text,
          action_id::text,
          source_path,
          ''
        ) ${orderClause}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const dataValues = [...values, limit, offset];
    const dataResult = await client.query(dataQuery, dataValues);

    return {
      rows: dataResult.rows as TimelineRow[],
      total: countResult.rows[0]?.total ?? 0,
    };
  });

  const items = rows.map((row) => {
    const details: Record<string, unknown> = { ...(row.details_json ?? {}) };
    if (row.error) {
      details.error = row.error;
    }
    if (row.html_url) {
      details.htmlUrl = row.html_url;
    }
    if (row.type === 'student_profile_binding_changed') {
      details.bindingId = row.binding_id;
      details.profileId = row.binding_profile_id;
      details.reason = row.binding_reason;
      details.changedBy = row.binding_changed_by;
    }
    if (
      row.type === 'profile_revision_saved' ||
      row.type === 'profile_revision_restored' ||
      row.type === 'profile_revision_activated'
    ) {
      details.profileRevisionId = row.profile_revision_id;
      details.profileId = row.profile_id;
      details.source = row.profile_source;
      details.versionLabel = row.profile_version_label;
    }
    if (
      row.type === 'template_revision_saved' ||
      row.type === 'template_revision_restored' ||
      row.type === 'template_revision_activated'
    ) {
      details.templateRevisionId = row.template_revision_id;
      details.templateId = row.template_id;
      details.source = row.template_source;
      details.versionLabel = row.template_version_label;
    }
    if (
      row.type === 'job_action_rerun' ||
      row.type === 'job_action_cancel' ||
      row.type === 'job_action_edit_metadata'
    ) {
      details.actionId = row.action_id;
      details.actionType = row.action_type;
      details.message = row.action_message;
      details.errorCode = row.action_error_code;
      details.requestedBy = row.action_requested_by;
      details.createdJobId = row.action_created_job_id;
    }

    return {
      type: row.type,
      studentId,
      recordingId: row.recording_id,
      transcriptId: row.transcript_id,
      promptPackageId: row.prompt_package_id,
      draftId: row.draft_id,
      jobId: row.job_id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      displayName: deriveDisplayName({
        fallbackId:
          row.job_id ??
          row.draft_id ??
          row.prompt_package_id ??
          row.transcript_id ??
          row.recording_id ??
          row.binding_id ??
          studentId,
        sourcePath: row.source_path,
        storageUri: row.storage_uri,
      }),
      details: Object.keys(details).length > 0 ? details : undefined,
    };
  });

  return {
    items,
    total,
    limit,
    offset,
    order,
  };
}
