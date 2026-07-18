-- Closed-alpha hard cutover: unfinished assignment/editor state is intentionally discarded.
-- Completed jobs, published URLs, homework memory, rerun lineage, and storage objects are retained.
DELETE FROM assignment_sessions;
DELETE FROM drafts;
DELETE FROM prompt_packages;

DROP INDEX IF EXISTS idx_assignment_sessions_lesson_updated;
DROP INDEX IF EXISTS idx_assignment_sessions_user_active_recording;
DROP INDEX IF EXISTS idx_assignment_sessions_user_active_updated;

ALTER TABLE assignment_sessions
  DROP COLUMN current_stage,
  DROP COLUMN archived_at,
  ALTER COLUMN student_id SET NOT NULL,
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN confirmed_step TEXT NOT NULL,
  ADD COLUMN confirmed_snapshot JSONB NOT NULL,
  ADD COLUMN creation_request_id TEXT,
  ADD COLUMN selected_profile_id TEXT,
  ADD COLUMN selected_profile_revision_id UUID,
  ADD COLUMN selected_profile_revision_hash TEXT,
  ADD COLUMN share_job_id UUID;

ALTER TABLE assignment_sessions
  ADD CONSTRAINT assignment_sessions_revision_check CHECK (revision > 0),
  ADD CONSTRAINT assignment_sessions_confirmed_step_check
    CHECK (confirmed_step IN ('student', 'source', 'context', 'create', 'share')),
  ADD CONSTRAINT assignment_sessions_confirmed_snapshot_check CHECK (
    jsonb_typeof(confirmed_snapshot) = 'object'
    AND confirmed_snapshot ?& ARRAY['student', 'source', 'context', 'create']
    AND jsonb_typeof(confirmed_snapshot -> 'student') = 'object'
    AND NULLIF(confirmed_snapshot #>> '{student,studentId}', '') IS NOT NULL
    AND (confirmed_snapshot #>> '{student,studentId}')::uuid = student_id
    AND (
      confirmed_snapshot -> 'source' = 'null'::jsonb
      OR jsonb_typeof(confirmed_snapshot -> 'source') = 'object'
    )
    AND (
      confirmed_snapshot -> 'context' = 'null'::jsonb
      OR jsonb_typeof(confirmed_snapshot -> 'context') = 'object'
    )
    AND (
      confirmed_snapshot -> 'create' = 'null'::jsonb
      OR jsonb_typeof(confirmed_snapshot -> 'create') = 'object'
    )
  ),
  ADD CONSTRAINT assignment_sessions_creation_request_id_check
    CHECK (creation_request_id IS NULL OR btrim(creation_request_id) <> ''),
  ADD CONSTRAINT assignment_sessions_selected_profile_revision_hash_check CHECK (
    selected_profile_revision_hash IS NULL
    OR selected_profile_revision_hash ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT assignment_sessions_share_job_id_fkey
    FOREIGN KEY (share_job_id) REFERENCES jobs(id),
  ADD CONSTRAINT assignment_sessions_share_job_id_key UNIQUE (share_job_id),
  ADD CONSTRAINT assignment_sessions_selected_profile_revision_id_fkey
    FOREIGN KEY (selected_profile_revision_id) REFERENCES profile_revisions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_assignment_sessions_user_creation_request
  ON assignment_sessions (user_id, creation_request_id)
  WHERE creation_request_id IS NOT NULL;

CREATE UNIQUE INDEX idx_assignment_sessions_user_active_recording
  ON assignment_sessions (user_id, recording_id)
  WHERE confirmed_step <> 'share' AND recording_id IS NOT NULL;

CREATE INDEX idx_assignment_sessions_user_active_updated
  ON assignment_sessions (user_id, updated_at DESC, id DESC)
  WHERE confirmed_step <> 'share';

CREATE INDEX idx_assignment_sessions_lesson_updated
  ON assignment_sessions (lesson_id, updated_at DESC, id DESC)
  WHERE confirmed_step <> 'share' AND lesson_id IS NOT NULL;

ALTER TABLE transcripts
  ADD COLUMN working_version INTEGER,
  ADD COLUMN content_hash TEXT,
  ADD CONSTRAINT transcripts_working_content_pair_check CHECK (
    (working_version IS NULL AND content_hash IS NULL)
    OR (
      working_version > 0
      AND content_hash ~ '^[0-9a-f]{64}$'
    )
  );

ALTER TABLE drafts
  ADD COLUMN working_version INTEGER NOT NULL,
  ADD COLUMN content_hash TEXT NOT NULL,
  ADD CONSTRAINT drafts_working_version_check CHECK (working_version > 0),
  ADD CONSTRAINT drafts_content_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE lesson_memory_entries
  ADD COLUMN source_storage_uri TEXT,
  ADD COLUMN source_content_hash TEXT,
  ADD CONSTRAINT lesson_memory_entries_confirmed_source_pair_check CHECK (
    (source_storage_uri IS NULL AND source_content_hash IS NULL)
    OR (
      NULLIF(btrim(source_storage_uri), '') IS NOT NULL
      AND source_content_hash ~ '^[0-9a-f]{64}$'
    )
  );

CREATE UNIQUE INDEX idx_lesson_memory_entries_transcript_source_hash
  ON lesson_memory_entries (transcript_id, source_content_hash)
  WHERE source_content_hash IS NOT NULL;
