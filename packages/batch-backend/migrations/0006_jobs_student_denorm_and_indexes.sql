ALTER TABLE jobs ADD COLUMN IF NOT EXISTS student_id UUID NULL;

CREATE OR REPLACE FUNCTION resolve_jobs_student_id(
  p_current_student_id UUID,
  p_recording_id UUID,
  p_prompt_package_id UUID,
  p_draft_id UUID,
  p_source_job_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_student_id UUID;
BEGIN
  IF p_current_student_id IS NOT NULL THEN
    RETURN p_current_student_id;
  END IF;

  IF p_recording_id IS NOT NULL THEN
    SELECT r.student_id
    INTO v_student_id
    FROM recordings r
    WHERE r.id = p_recording_id;

    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;
  END IF;

  IF p_prompt_package_id IS NOT NULL THEN
    SELECT p.student_id
    INTO v_student_id
    FROM prompt_packages p
    WHERE p.id = p_prompt_package_id;

    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;

    SELECT r.student_id
    INTO v_student_id
    FROM prompt_packages p
    LEFT JOIN recordings r ON r.id = p.recording_id
    WHERE p.id = p_prompt_package_id;

    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;
  END IF;

  IF p_draft_id IS NOT NULL THEN
    SELECT COALESCE(d.student_id, p.student_id, r.student_id)
    INTO v_student_id
    FROM drafts d
    LEFT JOIN prompt_packages p ON p.id = d.prompt_package_id
    LEFT JOIN recordings r ON r.id = p.recording_id
    WHERE d.id = p_draft_id;

    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;
  END IF;

  IF p_source_job_id IS NOT NULL THEN
    SELECT j.student_id
    INTO v_student_id
    FROM jobs j
    WHERE j.id = p_source_job_id;

    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

UPDATE jobs j
SET student_id = resolve_jobs_student_id(
  j.student_id,
  j.recording_id,
  j.prompt_package_id,
  j.draft_id,
  j.source_job_id
)
WHERE j.student_id IS DISTINCT FROM resolve_jobs_student_id(
  j.student_id,
  j.recording_id,
  j.prompt_package_id,
  j.draft_id,
  j.source_job_id
);

CREATE OR REPLACE FUNCTION set_jobs_student_id()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.student_id IS NULL THEN
      NEW.student_id := resolve_jobs_student_id(
        NULL,
        NEW.recording_id,
        NEW.prompt_package_id,
        NEW.draft_id,
        NEW.source_job_id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF (
    NEW.recording_id IS DISTINCT FROM OLD.recording_id
    OR NEW.prompt_package_id IS DISTINCT FROM OLD.prompt_package_id
    OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
    OR NEW.source_job_id IS DISTINCT FROM OLD.source_job_id
    OR NEW.student_id IS NULL
  ) THEN
    NEW.student_id := resolve_jobs_student_id(
      NULL,
      NEW.recording_id,
      NEW.prompt_package_id,
      NEW.draft_id,
      NEW.source_job_id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_jobs_student_id ON jobs;
CREATE TRIGGER set_jobs_student_id
BEFORE INSERT OR UPDATE OF recording_id, prompt_package_id, draft_id, source_job_id, student_id
ON jobs
FOR EACH ROW
EXECUTE FUNCTION set_jobs_student_id();

CREATE INDEX IF NOT EXISTS idx_jobs_student_created_at_id
  ON jobs (student_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at_id
  ON jobs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_user_created_at_id
  ON jobs (user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_publish_target_state_created_at
  ON jobs (publish_target, state, created_at DESC);
