CREATE TABLE IF NOT EXISTS student_memory_openai_batch_runs (
  id UUID PRIMARY KEY,
  workload TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'planned',
  parent_retry_run_id UUID NULL REFERENCES student_memory_openai_batch_runs(id) ON DELETE SET NULL,
  input_jsonl_sha256 TEXT NOT NULL,
  input_bytes INTEGER NOT NULL,
  item_count INTEGER NOT NULL,
  endpoint TEXT NOT NULL DEFAULT '/v1/responses',
  completion_window TEXT NOT NULL DEFAULT '24h',
  remote_input_file_id TEXT NULL,
  remote_batch_id TEXT NULL,
  remote_output_file_id TEXT NULL,
  remote_error_file_id TEXT NULL,
  remote_request_counts JSONB NULL,
  remote_error JSONB NULL,
  operator_audit JSONB NULL,
  planned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ NULL,
  in_progress_at TIMESTAMPTZ NULL,
  finalizing_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,
  expired_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  reconciled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_memory_openai_batch_runs_workload_check
    CHECK (workload IN ('lesson_memory', 'homework_memory', 'student_memory_snapshot')),
  CONSTRAINT student_memory_openai_batch_runs_provider_check
    CHECK (provider = 'openai'),
  CONSTRAINT student_memory_openai_batch_runs_state_check
    CHECK (state IN ('planned', 'submitted', 'in_progress', 'finalizing', 'completed', 'failed', 'expired', 'cancelled', 'reconciled')),
  CONSTRAINT student_memory_openai_batch_runs_endpoint_check
    CHECK (endpoint = '/v1/responses'),
  CONSTRAINT student_memory_openai_batch_runs_completion_window_check
    CHECK (completion_window = '24h'),
  CONSTRAINT student_memory_openai_batch_runs_input_bytes_check
    CHECK (input_bytes >= 0),
  CONSTRAINT student_memory_openai_batch_runs_item_count_check
    CHECK (item_count > 0)
);

CREATE TABLE IF NOT EXISTS student_memory_openai_batch_items (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES student_memory_openai_batch_runs(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  workload TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL,
  custom_id TEXT NOT NULL UNIQUE,
  canonical_scope_key TEXT NOT NULL,
  source_version_hash TEXT NOT NULL,
  request_envelope JSONB NOT NULL,
  response_schema_fingerprint TEXT NOT NULL,
  request_body JSONB NOT NULL,
  source_refs JSONB NOT NULL,
  claim_state TEXT NOT NULL DEFAULT 'active',
  state TEXT NOT NULL DEFAULT 'planned',
  submitted_at TIMESTAMPTZ NULL,
  remote_request_id TEXT NULL,
  returned_model TEXT NULL,
  finish_reason TEXT NULL,
  usage JSONB NULL,
  normalized_error JSONB NULL,
  imported_canonical_record_id UUID NULL,
  retry_of_item_id UUID NULL REFERENCES student_memory_openai_batch_items(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_memory_openai_batch_items_workload_check
    CHECK (workload IN ('lesson_memory', 'homework_memory', 'student_memory_snapshot')),
  CONSTRAINT student_memory_openai_batch_items_provider_check
    CHECK (provider = 'openai'),
  CONSTRAINT student_memory_openai_batch_items_claim_state_check
    CHECK (claim_state IN ('active', 'superseded_by_online', 'imported', 'stale', 'terminal_failure', 'retryable_failure')),
  CONSTRAINT student_memory_openai_batch_items_state_check
    CHECK (state IN ('planned', 'submitted', 'completed', 'imported', 'stale', 'superseded_by_online', 'terminal_failure', 'retryable_failure'))
);

CREATE TABLE IF NOT EXISTS student_memory_openai_batch_claims (
  id UUID PRIMARY KEY,
  item_id UUID NOT NULL UNIQUE REFERENCES student_memory_openai_batch_items(id) ON DELETE CASCADE,
  workload TEXT NOT NULL,
  canonical_scope_key TEXT NOT NULL,
  source_version_hash TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_memory_openai_batch_claims_workload_check
    CHECK (workload IN ('lesson_memory', 'homework_memory', 'student_memory_snapshot')),
  CONSTRAINT student_memory_openai_batch_claims_state_check
    CHECK (state IN ('active', 'superseded_by_online', 'imported', 'stale', 'terminal_failure', 'retryable_failure'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_memory_openai_batch_active_claim
  ON student_memory_openai_batch_claims (workload, canonical_scope_key, source_version_hash)
  WHERE state = 'active';

CREATE INDEX IF NOT EXISTS idx_student_memory_openai_batch_runs_state
  ON student_memory_openai_batch_runs (state, planned_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_student_memory_openai_batch_items_run
  ON student_memory_openai_batch_items (run_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_student_memory_openai_batch_items_scope
  ON student_memory_openai_batch_items (workload, canonical_scope_key, claim_state);

CREATE OR REPLACE FUNCTION set_student_memory_openai_batch_runs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_student_memory_openai_batch_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_student_memory_openai_batch_claims_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_student_memory_openai_batch_runs_updated_at ON student_memory_openai_batch_runs;
CREATE TRIGGER set_student_memory_openai_batch_runs_updated_at
BEFORE UPDATE ON student_memory_openai_batch_runs
FOR EACH ROW EXECUTE FUNCTION set_student_memory_openai_batch_runs_updated_at();

DROP TRIGGER IF EXISTS set_student_memory_openai_batch_items_updated_at ON student_memory_openai_batch_items;
CREATE TRIGGER set_student_memory_openai_batch_items_updated_at
BEFORE UPDATE ON student_memory_openai_batch_items
FOR EACH ROW EXECUTE FUNCTION set_student_memory_openai_batch_items_updated_at();

DROP TRIGGER IF EXISTS set_student_memory_openai_batch_claims_updated_at ON student_memory_openai_batch_claims;
CREATE TRIGGER set_student_memory_openai_batch_claims_updated_at
BEFORE UPDATE ON student_memory_openai_batch_claims
FOR EACH ROW EXECUTE FUNCTION set_student_memory_openai_batch_claims_updated_at();
