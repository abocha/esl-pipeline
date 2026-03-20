ALTER TABLE homework_memory_entries
  ADD COLUMN IF NOT EXISTS prompt_package_id UUID NULL REFERENCES prompt_packages(id) ON DELETE SET NULL;

ALTER TABLE homework_memory_entries
  ADD COLUMN IF NOT EXISTS draft_id UUID NULL REFERENCES drafts(id) ON DELETE SET NULL;

ALTER TABLE homework_memory_entries
  ADD COLUMN IF NOT EXISTS recording_id UUID NULL REFERENCES recordings(id) ON DELETE SET NULL;

ALTER TABLE homework_memory_entries
  ADD COLUMN IF NOT EXISTS transcript_id UUID NULL REFERENCES transcripts(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'homework_memory_entries_assignment_lineage_key_fkey'
  ) THEN
    ALTER TABLE homework_memory_entries
      ADD CONSTRAINT homework_memory_entries_assignment_lineage_key_fkey
      FOREIGN KEY (assignment_lineage_key) REFERENCES jobs(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'homework_memory_entries_study_text_type_check'
  ) THEN
    ALTER TABLE homework_memory_entries
      ADD CONSTRAINT homework_memory_entries_study_text_type_check
      CHECK (study_text_type IS NULL OR study_text_type IN ('monologue', 'dialogue'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'homework_memory_entries_input_type_check'
  ) THEN
    ALTER TABLE homework_memory_entries
      ADD CONSTRAINT homework_memory_entries_input_type_check
      CHECK (input_type IS NULL OR input_type IN ('generate', 'authentic'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_homework_memory_entries_job_generated_at
  ON homework_memory_entries (job_id, generated_at DESC, id DESC);
