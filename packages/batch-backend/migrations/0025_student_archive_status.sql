ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS archived_by UUID NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS archive_reason TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'students_archived_by_fkey'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_archived_by_fkey
      FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_students_active_student
  ON students (student ASC, id ASC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_students_archived_at
  ON students (archived_at DESC, id DESC)
  WHERE archived_at IS NOT NULL;
