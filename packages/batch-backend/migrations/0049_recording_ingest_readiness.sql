ALTER TABLE recordings ADD COLUMN IF NOT EXISTS workspace_id UUID NULL;

UPDATE recordings r
SET workspace_id = s.workspace_id
FROM students s
WHERE r.student_id = s.id
  AND r.workspace_id IS NULL;

DO $$
DECLARE
  unresolved_ownership_count BIGINT;
  duplicate_winner_recording_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO unresolved_ownership_count
  FROM recordings
  WHERE workspace_id IS NULL;
  IF unresolved_ownership_count > 0 THEN
    RAISE EXCEPTION '0049 unresolved recording workspace ownership: % row(s)',
      unresolved_ownership_count;
  END IF;

  SELECT COUNT(*) INTO duplicate_winner_recording_count
  FROM (
    SELECT recording_id FROM transcripts GROUP BY recording_id HAVING COUNT(*) > 1
  ) duplicate_recordings;
  IF duplicate_winner_recording_count > 0 THEN
    RAISE EXCEPTION '0049 duplicate transcript winners require manual resolution: % recording(s)',
      duplicate_winner_recording_count;
  END IF;
END $$;

ALTER TABLE recordings ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE recordings ALTER COLUMN storage_uri DROP NOT NULL;

CREATE OR REPLACE FUNCTION enforce_recording_workspace_authority()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_workspace_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'recording workspace authority is immutable';
  END IF;
  SELECT workspace_id INTO resolved_workspace_id FROM students WHERE id = NEW.student_id;
  IF resolved_workspace_id IS NULL THEN
    RAISE EXCEPTION 'recording student has no workspace authority';
  END IF;
  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := resolved_workspace_id;
  ELSIF NEW.workspace_id <> resolved_workspace_id THEN
    RAISE EXCEPTION 'recording workspace does not match student workspace authority';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER recordings_workspace_authority_trigger
BEFORE INSERT OR UPDATE OF student_id, workspace_id ON recordings
FOR EACH ROW EXECUTE FUNCTION enforce_recording_workspace_authority();

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS audio_lifecycle TEXT,
  ADD COLUMN IF NOT EXISTS audio_deletion_requested_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS audio_deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS audio_deletion_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS audio_deletion_error_code TEXT NULL,
  ADD COLUMN IF NOT EXISTS audio_deletion_next_attempt_at TIMESTAMPTZ NULL;

UPDATE recordings
SET storage_uri = NULL,
    audio_lifecycle = 'not_retained'
WHERE source = 'manual_transcript';

UPDATE recordings
SET audio_lifecycle = CASE WHEN storage_uri IS NULL THEN 'not_retained' ELSE 'retained' END
WHERE audio_lifecycle IS NULL;

ALTER TABLE recordings ALTER COLUMN audio_lifecycle SET NOT NULL;
ALTER TABLE recordings ALTER COLUMN audio_lifecycle SET DEFAULT 'retained';

ALTER TABLE students
  ADD CONSTRAINT students_id_workspace_unique UNIQUE (id, workspace_id);

ALTER TABLE recordings
  ADD CONSTRAINT recordings_student_workspace_fkey
  FOREIGN KEY (student_id, workspace_id) REFERENCES students(id, workspace_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT recordings_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT,
  ADD CONSTRAINT recordings_audio_lifecycle_check
  CHECK (audio_lifecycle IN ('not_retained', 'retained', 'pending', 'deleting', 'deleted', 'delete_failed')),
  ADD CONSTRAINT recordings_audio_lifecycle_uri_check
  CHECK (
    (audio_lifecycle IN ('not_retained', 'deleted') AND storage_uri IS NULL)
    OR (audio_lifecycle IN ('retained', 'pending', 'deleting', 'delete_failed') AND storage_uri IS NOT NULL)
  ),
  ADD CONSTRAINT recordings_audio_deletion_attempt_count_check
  CHECK (audio_deletion_attempt_count >= 0);

CREATE INDEX IF NOT EXISTS idx_recordings_workspace_id ON recordings(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_recordings_id_workspace_unique
  ON recordings(id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_recordings_workspace_sha256
  ON recordings(workspace_id, sha256, created_at DESC) WHERE sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transcripts_one_winner_per_recording
  ON transcripts(recording_id);

CREATE TABLE transcription_runs (
  id UUID PRIMARY KEY,
  recording_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  request_profile TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  claim_token UUID NULL,
  claimed_at TIMESTAMPTZ NULL,
  claim_expires_at TIMESTAMPTZ NULL,
  submission_slots_reserved INTEGER NOT NULL DEFAULT 0,
  submission_slot_limit INTEGER NOT NULL DEFAULT 3,
  current_submission_slot INTEGER NULL,
  last_submission_outcome TEXT NULL,
  provider_request_id TEXT NULL,
  error_code TEXT NULL,
  error_detail TEXT NULL,
  provider_latency_ms INTEGER NULL,
  total_latency_ms INTEGER NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT transcription_runs_recording_workspace_fkey
    FOREIGN KEY (recording_id, workspace_id)
    REFERENCES recordings(id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT transcription_runs_state_check
    CHECK (state IN ('queued', 'claimed', 'submitting', 'retry_wait', 'succeeded', 'failed')),
  CONSTRAINT transcription_runs_submission_slots_check
    CHECK (submission_slots_reserved >= 0 AND submission_slots_reserved <= submission_slot_limit),
  CONSTRAINT transcription_runs_submission_slot_limit_check CHECK (submission_slot_limit = 3),
  CONSTRAINT transcription_runs_current_slot_check
    CHECK (current_submission_slot IS NULL OR current_submission_slot BETWEEN 1 AND submission_slot_limit),
  CONSTRAINT transcription_runs_outcome_check
    CHECK (last_submission_outcome IS NULL OR last_submission_outcome IN ('known_success', 'known_failure', 'ambiguous'))
);

CREATE UNIQUE INDEX idx_transcription_runs_one_active_per_recording
  ON transcription_runs(recording_id)
  WHERE state IN ('queued', 'claimed', 'submitting', 'retry_wait');
CREATE INDEX idx_transcription_runs_workspace_recording
  ON transcription_runs(workspace_id, recording_id, created_at DESC);
