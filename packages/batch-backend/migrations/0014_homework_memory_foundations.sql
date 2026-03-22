CREATE TABLE IF NOT EXISTS homework_memory_entries (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  assignment_lineage_key UUID NOT NULL,
  schema_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'published_assignment',
  content_hash TEXT NULL,
  generation_notes JSONB NULL,
  homework_summary TEXT NULL,
  topic TEXT NULL,
  grammar_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  vocabulary_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  task_list JSONB NOT NULL DEFAULT '[]'::jsonb,
  pronunciation_focus JSONB NOT NULL DEFAULT '[]'::jsonb,
  study_text_type TEXT NULL,
  input_type TEXT NULL,
  communicative_outcome TEXT NULL,
  teacher_follow_up_cues JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ NOT NULL,
  publish_targets JSONB NOT NULL DEFAULT '[]'::jsonb,
  superseded_by_id UUID NULL REFERENCES homework_memory_entries(id) ON DELETE SET NULL,
  superseded_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT homework_memory_entries_status_check
    CHECK (status IN ('pending', 'ready', 'failed', 'superseded')),
  CONSTRAINT homework_memory_entries_source_kind_check
    CHECK (source_kind = 'published_assignment')
);

CREATE INDEX IF NOT EXISTS idx_homework_memory_entries_student_generated_at
  ON homework_memory_entries (student_id, generated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_homework_memory_entries_lineage_generated_at
  ON homework_memory_entries (assignment_lineage_key, generated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_homework_memory_entries_status_generated_at
  ON homework_memory_entries (status, generated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_homework_memory_entries_lineage_ready_lookup
  ON homework_memory_entries (assignment_lineage_key, generated_at DESC, id DESC)
  WHERE status = 'ready';

CREATE OR REPLACE FUNCTION set_homework_memory_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_homework_memory_entries_updated_at ON homework_memory_entries;

CREATE TRIGGER set_homework_memory_entries_updated_at
BEFORE UPDATE ON homework_memory_entries
FOR EACH ROW
EXECUTE FUNCTION set_homework_memory_entries_updated_at();
