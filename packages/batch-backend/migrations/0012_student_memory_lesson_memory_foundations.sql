ALTER TABLE prompt_packages
  ADD COLUMN IF NOT EXISTS student_memory_snapshot_id UUID NULL;

ALTER TABLE prompt_packages
  ADD COLUMN IF NOT EXISTS student_memory_snapshot_hash TEXT NULL;

ALTER TABLE prompt_packages
  ADD COLUMN IF NOT EXISTS selected_lesson_memory_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[];

ALTER TABLE prompt_packages
  ADD COLUMN IF NOT EXISTS selected_homework_memory_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[];

ALTER TABLE prompt_packages
  ADD COLUMN IF NOT EXISTS retrieval_policy_version TEXT NULL;

CREATE TABLE IF NOT EXISTS lesson_memory_entries (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  transcript_id UUID NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'lesson_transcript',
  generation_notes JSONB NULL,
  lesson_summary TEXT NULL,
  topics_discussed JSONB NOT NULL DEFAULT '[]'::jsonb,
  mistake_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  grammar_reviewed JSONB NOT NULL DEFAULT '[]'::jsonb,
  grammar_watchlist JSONB NOT NULL DEFAULT '[]'::jsonb,
  vocabulary_focus JSONB NOT NULL DEFAULT '[]'::jsonb,
  pronunciation_focus JSONB NOT NULL DEFAULT '[]'::jsonb,
  student_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  progress_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  follow_up_recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  superseded_by_id UUID NULL REFERENCES lesson_memory_entries(id) ON DELETE SET NULL,
  superseded_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT lesson_memory_entries_status_check
    CHECK (status IN ('pending', 'ready', 'failed', 'superseded')),
  CONSTRAINT lesson_memory_entries_source_kind_check
    CHECK (source_kind = 'lesson_transcript')
);

CREATE INDEX IF NOT EXISTS idx_prompt_packages_student_memory_snapshot_id
  ON prompt_packages (student_memory_snapshot_id);

CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_student_generated_at
  ON lesson_memory_entries (student_id, generated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_transcript_generated_at
  ON lesson_memory_entries (transcript_id, generated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_recording_generated_at
  ON lesson_memory_entries (recording_id, generated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_status_generated_at
  ON lesson_memory_entries (status, generated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_transcript_ready_lookup
  ON lesson_memory_entries (transcript_id, generated_at DESC, id DESC)
  WHERE status = 'ready';

CREATE OR REPLACE FUNCTION set_lesson_memory_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_lesson_memory_entries_updated_at ON lesson_memory_entries;

CREATE TRIGGER set_lesson_memory_entries_updated_at
BEFORE UPDATE ON lesson_memory_entries
FOR EACH ROW
EXECUTE FUNCTION set_lesson_memory_entries_updated_at();
