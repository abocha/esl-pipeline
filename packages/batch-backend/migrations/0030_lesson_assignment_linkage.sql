ALTER TABLE assignment_sessions ADD COLUMN IF NOT EXISTS lesson_id UUID NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS lesson_id UUID NULL;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS lesson_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lesson_id UUID NULL;
ALTER TABLE homework_memory_entries ADD COLUMN IF NOT EXISTS lesson_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignment_sessions_lesson_id_fkey'
  ) THEN
    ALTER TABLE assignment_sessions
      ADD CONSTRAINT assignment_sessions_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES student_lessons(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'prompt_packages_lesson_id_fkey'
  ) THEN
    ALTER TABLE prompt_packages
      ADD CONSTRAINT prompt_packages_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES student_lessons(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drafts_lesson_id_fkey'
  ) THEN
    ALTER TABLE drafts
      ADD CONSTRAINT drafts_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES student_lessons(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_lesson_id_fkey'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES student_lessons(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'homework_memory_entries_lesson_id_fkey'
  ) THEN
    ALTER TABLE homework_memory_entries
      ADD CONSTRAINT homework_memory_entries_lesson_id_fkey
      FOREIGN KEY (lesson_id) REFERENCES student_lessons(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assignment_sessions_lesson_updated
  ON assignment_sessions (lesson_id, updated_at DESC, id DESC)
  WHERE lesson_id IS NOT NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prompt_packages_lesson_updated
  ON prompt_packages (lesson_id, updated_at DESC, id DESC)
  WHERE lesson_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drafts_lesson_updated
  ON drafts (lesson_id, updated_at DESC, id DESC)
  WHERE lesson_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_lesson_updated
  ON jobs (lesson_id, (COALESCE(finished_at, updated_at, created_at)) DESC, id DESC)
  WHERE lesson_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_homework_memory_entries_lesson_ready_generated
  ON homework_memory_entries (lesson_id, generated_at DESC, created_at DESC, id DESC)
  WHERE lesson_id IS NOT NULL AND status = 'ready';
