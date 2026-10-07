-- Completed Source-only workflows require capable readers/writers; old images
-- cannot safely read or mutate these outcomes. No historical decision is inferred.
ALTER TABLE assignment_sessions
  ADD COLUMN homework_intent text NOT NULL DEFAULT 'create',
  ADD COLUMN transcript_completed_at timestamptz,
  ADD COLUMN transcript_completion_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN homework_started_from_revision integer;

ALTER TABLE assignment_sessions
  ADD CONSTRAINT assignment_sessions_homework_intent CHECK (homework_intent IN ('create', 'none')),
  ADD CONSTRAINT assignment_sessions_transcript_history_array CHECK (jsonb_typeof(transcript_completion_history) = 'array'),
  ADD CONSTRAINT assignment_sessions_no_homework_downstream CHECK (homework_intent <> 'none' OR
    (confirmed_step IN ('student', 'source') AND confirmed_snapshot->'context' = 'null'::jsonb
      AND confirmed_snapshot->'create' = 'null'::jsonb AND prompt_package_id IS NULL
      AND draft_id IS NULL AND share_job_id IS NULL)),
  ADD CONSTRAINT assignment_sessions_transcript_completion CHECK (transcript_completed_at IS NULL OR COALESCE(
    (homework_intent = 'none' AND confirmed_step = 'source' AND confirmed_snapshot->'source' <> 'null'::jsonb
      AND jsonb_array_length(transcript_completion_history) > 0
      AND transcript_completion_history->-1->'source' = confirmed_snapshot->'source'
      AND (transcript_completion_history->-1->>'resultingRevision')::integer = revision
      AND (transcript_completion_history->-1->>'completedAt')::timestamptz = transcript_completed_at
      AND transcript_completion_history->-1->>'studentId' = student_id::text
      AND COALESCE(to_jsonb(lesson_id), 'null'::jsonb) = confirmed_snapshot#>'{source,lessonId}'
      AND recording_id::text = confirmed_snapshot#>>'{source,recordingId}'
      AND transcript_id::text = confirmed_snapshot#>>'{source,transcriptId}'), false));

CREATE FUNCTION preserve_transcript_completion_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.homework_intent = 'none' AND EXISTS (SELECT 1 FROM prompt_packages WHERE assignment_session_id = NEW.id) THEN
    RAISE EXCEPTION 'assignment_homework_intent_conflict';
  END IF;
  IF jsonb_array_length(NEW.transcript_completion_history) < jsonb_array_length(OLD.transcript_completion_history)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.transcript_completion_history) WITH ORDINALITY e(value, n)
      WHERE NEW.transcript_completion_history->(e.n::integer - 1) IS DISTINCT FROM e.value) THEN
    RAISE EXCEPTION 'transcript_completion_history_immutable';
  END IF;
  IF NEW.transcript_completion_history IS DISTINCT FROM OLD.transcript_completion_history AND
    (jsonb_array_length(NEW.transcript_completion_history) <> jsonb_array_length(OLD.transcript_completion_history) + 1
      OR OLD.transcript_completed_at IS NOT NULL OR NEW.transcript_completed_at IS NULL) THEN
    RAISE EXCEPTION 'transcript_completion_history_invalid_append';
  END IF;
  IF OLD.transcript_completed_at IS NOT NULL AND
    NOT (NEW.homework_intent = 'create' AND NEW.transcript_completed_at IS NULL
      AND NEW.homework_started_from_revision = OLD.revision AND NEW.revision = OLD.revision + 1
      AND NEW.confirmed_snapshot = OLD.confirmed_snapshot AND NEW.lesson_id IS NOT DISTINCT FROM OLD.lesson_id
      AND NEW.recording_id = OLD.recording_id AND NEW.transcript_id = OLD.transcript_id) THEN
    RAISE EXCEPTION 'assignment_session_completed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_transcript_completion_history BEFORE UPDATE ON assignment_sessions
  FOR EACH ROW EXECUTE FUNCTION preserve_transcript_completion_history();

-- Artifact commits serialize with choice saves. Persisted provenance is also the
-- downstream boundary that prevents a competing none switch after admission.
CREATE FUNCTION guard_session_homework_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE session_intent text;
BEGIN
  IF NEW.assignment_session_id IS NOT NULL THEN
    SELECT homework_intent INTO session_intent FROM assignment_sessions
      WHERE id = NEW.assignment_session_id FOR UPDATE;
    IF session_intent IS DISTINCT FROM 'create' THEN RAISE EXCEPTION 'assignment_homework_intent_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_session_homework_prompt BEFORE INSERT OR UPDATE ON prompt_packages
  FOR EACH ROW EXECUTE FUNCTION guard_session_homework_artifact();

-- Repository writers take the session lock first. This backstop also protects
-- raw/older writers without waiting in the inverse transcript -> session order.
CREATE FUNCTION guard_completed_transcript_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_recording uuid; owner_record record;
BEGIN
  IF TG_TABLE_NAME = 'transcripts' THEN source_recording := NEW.recording_id;
  ELSE source_recording := NEW.id; END IF;
  FOR owner_record IN SELECT s.transcript_completed_at FROM assignment_sessions s
    JOIN assignment_source_bindings b ON b.assignment_session_id = s.id
    WHERE b.recording_id = source_recording ORDER BY s.id FOR UPDATE OF s NOWAIT
  LOOP
    IF owner_record.transcript_completed_at IS NOT NULL THEN RAISE EXCEPTION 'assignment_session_completed'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_completed_transcript_insert BEFORE INSERT ON transcripts
  FOR EACH ROW EXECUTE FUNCTION guard_completed_transcript_source();
CREATE TRIGGER guard_completed_transcript_update BEFORE UPDATE OF storage_uri, content_hash, working_version, summary_json, recording_id ON transcripts
  FOR EACH ROW EXECUTE FUNCTION guard_completed_transcript_source();
CREATE TRIGGER guard_completed_recording_source BEFORE UPDATE OF student_id, audio_topology, source_identity_kind, source_fingerprint_scheme, source_fingerprint ON recordings
  FOR EACH ROW EXECUTE FUNCTION guard_completed_transcript_source();

DROP INDEX idx_assignment_sessions_user_active_updated;
CREATE INDEX idx_assignment_sessions_user_active_updated ON assignment_sessions (user_id, updated_at DESC, id DESC)
  WHERE confirmed_step <> 'share' AND transcript_completed_at IS NULL;
DROP INDEX idx_assignment_sessions_lesson_updated;
CREATE INDEX idx_assignment_sessions_lesson_updated ON assignment_sessions (lesson_id, updated_at DESC, id DESC)
  WHERE confirmed_step <> 'share' AND transcript_completed_at IS NULL AND lesson_id IS NOT NULL;
