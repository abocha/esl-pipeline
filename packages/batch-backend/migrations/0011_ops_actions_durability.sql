CREATE TABLE IF NOT EXISTS ops_actions (
  operation_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  state TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  requested_by TEXT NULL,
  requested_by_user_id TEXT NULL,
  message TEXT NULL,
  command TEXT NOT NULL,
  exit_code INTEGER NULL,
  stdout_tail TEXT NULL,
  stderr_tail TEXT NULL,
  owner_id TEXT NULL,
  ownership_claimed_at TIMESTAMPTZ NULL,
  ownership_expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ops_actions_action_check
    CHECK (action IN ('backup_upload', 'restore_drill_download_only')),
  CONSTRAINT ops_actions_state_check
    CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
  CONSTRAINT ops_actions_started_at_order_check
    CHECK (started_at IS NULL OR started_at >= requested_at),
  CONSTRAINT ops_actions_finished_at_order_check
    CHECK (finished_at IS NULL OR finished_at >= requested_at)
);

CREATE INDEX IF NOT EXISTS idx_ops_actions_operation_id_lookup
  ON ops_actions (operation_id);

CREATE INDEX IF NOT EXISTS idx_ops_actions_retention_scan
  ON ops_actions (finished_at ASC)
  WHERE finished_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ops_actions_state_finished_at
  ON ops_actions (state, finished_at ASC);

CREATE OR REPLACE FUNCTION set_ops_actions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_ops_actions_updated_at ON ops_actions;

CREATE TRIGGER trg_set_ops_actions_updated_at
BEFORE UPDATE ON ops_actions
FOR EACH ROW
EXECUTE FUNCTION set_ops_actions_updated_at();
