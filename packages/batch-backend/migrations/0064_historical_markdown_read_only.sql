-- ABO-30 / ESL-7: sunset execution, retain historical rows, bytes and outputs.
-- Stop the old API and all workers before applying. A running legacy job or
-- unfinished remote homework Batch is an explicit quiescence blocker.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM jobs WHERE assignment_artifact IS NULL AND state = 'running') THEN
    RAISE EXCEPTION 'Historical Markdown cutover requires quiesced legacy jobs';
  END IF;
  IF EXISTS (
    SELECT 1 FROM student_memory_openai_batch_items i
    JOIN student_memory_openai_batch_runs r ON r.id = i.run_id
    WHERE i.workload = 'homework_memory'
      AND (i.source_refs ->> 'sourceFormat') IS DISTINCT FROM 'assignment_v1'
      AND r.remote_batch_id IS NOT NULL
      AND (r.state NOT IN ('completed', 'failed', 'expired', 'cancelled', 'reconciled')
        OR (r.operator_audit #>> '{remoteStatusConfirmation,batchId}') IS DISTINCT FROM r.remote_batch_id
        OR COALESCE(r.operator_audit #>> '{remoteStatusConfirmation,status}', '')
          NOT IN ('completed', 'failed', 'expired', 'cancelled')
        OR (r.state <> 'reconciled' AND
          (r.operator_audit #>> '{remoteStatusConfirmation,status}') IS DISTINCT FROM r.state))
  ) THEN
    RAISE EXCEPTION 'Historical Markdown cutover requires completed or cancelled remote homework Batch work confirmed by a fresh status poll';
  END IF;
END;
$$;

CREATE FUNCTION historical_assignment_session(s assignment_sessions) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN (s.confirmed_snapshot -> 'create' IS NOT NULL
    AND s.confirmed_snapshot -> 'create' <> 'null'::jsonb
    AND (s.confirmed_snapshot #>> '{create,artifact,format}') IS DISTINCT FROM 'assignment_v1')
    OR EXISTS (SELECT 1 FROM drafts d WHERE d.id = s.draft_id AND d.format <> 'assignment_v1')
    OR EXISTS (SELECT 1 FROM prompt_packages p WHERE p.id = s.prompt_package_id
      AND (p.request_envelope ->> 'promptVersion') IS DISTINCT FROM 'assignment_v1');
END;
$$;

-- Unresolved provider reservations must be drained before retirement, never revived.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM profile_initial_enrichment_operations op
    JOIN assignment_sessions s ON s.id = op.assignment_session_id
    WHERE historical_assignment_session(s) AND op.state IN ('submitting', 'uncertain')) THEN
    RAISE EXCEPTION 'Historical Markdown cutover requires quiesced profile enrichment submissions';
  END IF;
END;
$$;

UPDATE profile_initial_enrichment_operations op SET state = 'superseded',
  failure_code = 'legacy_assignment_read_only', updated_at = NOW()
FROM assignment_sessions s WHERE s.id = op.assignment_session_id
  AND historical_assignment_session(s) AND op.state IN ('waiting_evidence', 'queued', 'result_ready');

UPDATE jobs SET state = 'failed', error = 'legacy_assignment_read_only',
  finished_at = COALESCE(finished_at, NOW()), updated_at = NOW()
WHERE assignment_artifact IS NULL AND state IN ('queued', 'awaiting_approval');

UPDATE homework_memory_entries h SET status = 'failed',
  generation_notes = COALESCE(h.generation_notes, '{}'::jsonb)
    || '{"error":"legacy_assignment_read_only"}'::jsonb, updated_at = NOW()
FROM jobs j WHERE h.job_id = j.id AND j.assignment_artifact IS NULL AND h.status = 'pending';

UPDATE lesson_memory_entries l SET status = 'failed',
  generation_notes = COALESCE(l.generation_notes, '{}'::jsonb)
    || '{"error":"legacy_assignment_read_only"}'::jsonb, updated_at = NOW()
FROM assignment_sessions s WHERE l.assignment_session_id = s.id
  AND historical_assignment_session(s) AND l.status = 'pending';

UPDATE student_memory_openai_batch_items SET state = 'terminal_failure',
  claim_state = 'terminal_failure',
  normalized_error = COALESCE(normalized_error, '{}'::jsonb)
    || '{"code":"legacy_assignment_read_only"}'::jsonb, updated_at = NOW()
WHERE workload = 'homework_memory'
  AND (source_refs ->> 'sourceFormat') IS DISTINCT FROM 'assignment_v1'
  AND state IN ('planned', 'submitted', 'completed', 'retryable_failure');

UPDATE student_memory_openai_batch_claims c SET state = 'terminal_failure', updated_at = NOW()
FROM student_memory_openai_batch_items i
WHERE c.item_id = i.id AND i.workload = 'homework_memory'
  AND (i.source_refs ->> 'sourceFormat') IS DISTINCT FROM 'assignment_v1'
  AND c.state IN ('active', 'retryable_failure');

-- Frozen legacy sessions remain available through ordinary history reads. Do not
-- clear their source bindings, snapshots, prompt evidence, links or revisions.
CREATE FUNCTION reject_historical_assignment_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'drafts' THEN
    IF NEW.format <> 'assignment_v1' THEN RAISE EXCEPTION 'legacy_assignment_read_only'; END IF;
  ELSIF TG_TABLE_NAME = 'jobs' THEN
    IF NEW.assignment_artifact IS NULL THEN RAISE EXCEPTION 'legacy_assignment_read_only'; END IF;
  ELSIF TG_TABLE_NAME = 'assignment_sessions' THEN
    IF historical_assignment_session(NEW)
      OR (TG_OP = 'UPDATE' AND historical_assignment_session(OLD)) THEN
      RAISE EXCEPTION 'legacy_assignment_read_only';
    END IF;
  ELSIF TG_TABLE_NAME = 'homework_memory_entries' THEN
    IF EXISTS (SELECT 1 FROM jobs WHERE id = NEW.job_id AND assignment_artifact IS NULL) THEN
      RAISE EXCEPTION 'legacy_assignment_read_only';
    END IF;
  ELSIF TG_TABLE_NAME = 'profile_initial_enrichment_operations' THEN
    IF NEW.state IN ('waiting_evidence', 'queued', 'submitting', 'result_ready', 'uncertain', 'succeeded')
      AND EXISTS (SELECT 1 FROM assignment_sessions s WHERE s.id = NEW.assignment_session_id
        AND historical_assignment_session(s)) THEN
      RAISE EXCEPTION 'legacy_assignment_read_only';
    END IF;
  ELSIF TG_TABLE_NAME = 'student_memory_openai_batch_items' THEN
    IF NEW.workload = 'homework_memory'
      AND (NEW.source_refs ->> 'sourceFormat') IS DISTINCT FROM 'assignment_v1'
      AND NEW.state IN ('planned', 'submitted', 'completed', 'imported', 'retryable_failure') THEN
      RAISE EXCEPTION 'legacy_assignment_read_only';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER historical_drafts_read_only BEFORE INSERT OR UPDATE ON drafts
  FOR EACH ROW EXECUTE FUNCTION reject_historical_assignment_write();
CREATE TRIGGER historical_jobs_read_only BEFORE INSERT OR UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION reject_historical_assignment_write();
CREATE TRIGGER historical_sessions_read_only BEFORE INSERT OR UPDATE ON assignment_sessions
  FOR EACH ROW EXECUTE FUNCTION reject_historical_assignment_write();
CREATE TRIGGER historical_homework_memory_read_only BEFORE INSERT OR UPDATE ON homework_memory_entries
  FOR EACH ROW EXECUTE FUNCTION reject_historical_assignment_write();
CREATE TRIGGER historical_homework_batch_read_only BEFORE INSERT OR UPDATE ON student_memory_openai_batch_items
  FOR EACH ROW EXECUTE FUNCTION reject_historical_assignment_write();

CREATE TRIGGER historical_profile_enrichment_read_only BEFORE INSERT OR UPDATE ON profile_initial_enrichment_operations
  FOR EACH ROW EXECUTE FUNCTION reject_historical_assignment_write();

-- No down migration: old executors are incompatible. Roll back only to a reader
-- that respects this sunset, retaining every historical object and output.
