CREATE TABLE IF NOT EXISTS student_memory_snapshots (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'student_memory_rollup',
  lesson_memory_entry_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  homework_memory_entry_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  content_hash TEXT NULL,
  generation_notes JSONB NULL,
  stable_strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
  recurring_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  active_review_backlog JSONB NOT NULL DEFAULT '[]'::jsonb,
  recent_progress JSONB NOT NULL DEFAULT '[]'::jsonb,
  personal_facts JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_assignment_directions JSONB NOT NULL DEFAULT '[]'::jsonb,
  unresolved_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  snapshot_summary TEXT NULL,
  superseded_by_id UUID NULL REFERENCES student_memory_snapshots(id) ON DELETE SET NULL,
  superseded_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_memory_snapshots_status_check
    CHECK (status IN ('pending', 'ready', 'failed', 'superseded')),
  CONSTRAINT student_memory_snapshots_source_kind_check
    CHECK (source_kind = 'student_memory_rollup')
);

CREATE INDEX IF NOT EXISTS idx_student_memory_snapshots_student_generated_at
  ON student_memory_snapshots (student_id, generated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_student_memory_snapshots_status_generated_at
  ON student_memory_snapshots (status, generated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_student_memory_snapshots_student_ready_lookup
  ON student_memory_snapshots (student_id, generated_at DESC, id DESC)
  WHERE status = 'ready';

CREATE OR REPLACE FUNCTION set_student_memory_snapshots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_student_memory_snapshots_updated_at ON student_memory_snapshots;

CREATE TRIGGER set_student_memory_snapshots_updated_at
BEFORE UPDATE ON student_memory_snapshots
FOR EACH ROW
EXECUTE FUNCTION set_student_memory_snapshots_updated_at();
