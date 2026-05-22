ALTER TABLE student_profile_candidates
  ADD COLUMN IF NOT EXISTS source_lesson_id uuid,
  ADD COLUMN IF NOT EXISTS source_lesson_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_lesson_title text,
  ADD COLUMN IF NOT EXISTS source_memory_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
  ADD COLUMN IF NOT EXISTS provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS dedup_decision jsonb DEFAULT '{}'::jsonb NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'student_profile_candidates_source_lesson_id_fkey'
  ) THEN
    ALTER TABLE student_profile_candidates
      ADD CONSTRAINT student_profile_candidates_source_lesson_id_fkey
      FOREIGN KEY (source_lesson_id) REFERENCES student_lessons(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_student_profile_candidates_source_lesson
  ON student_profile_candidates (student_id, source_lesson_id, created_at DESC, id DESC)
  WHERE source_lesson_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_student_profile_candidates_dedup_decision
  ON student_profile_candidates (student_id, status, created_at DESC, id DESC)
  WHERE dedup_decision <> '{}'::jsonb;
