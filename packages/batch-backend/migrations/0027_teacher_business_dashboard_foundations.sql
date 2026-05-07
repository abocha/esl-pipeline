CREATE TABLE IF NOT EXISTS workspace_business_settings (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  default_currency CHAR(3) NOT NULL DEFAULT 'USD',
  default_lesson_rate_minor INTEGER NOT NULL DEFAULT 0,
  default_lesson_duration_minutes INTEGER NOT NULL DEFAULT 60,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  forecast_horizon_days INTEGER NOT NULL DEFAULT 45,
  no_show_rate_basis_points INTEGER NOT NULL DEFAULT 0,
  cancellation_rate_basis_points INTEGER NOT NULL DEFAULT 0,
  top_up_threshold INTEGER NOT NULL DEFAULT 2,
  updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workspace_business_settings_currency_check CHECK (default_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT workspace_business_settings_rate_check CHECK (default_lesson_rate_minor >= 0),
  CONSTRAINT workspace_business_settings_duration_check CHECK (default_lesson_duration_minutes > 0),
  CONSTRAINT workspace_business_settings_horizon_check CHECK (forecast_horizon_days BETWEEN 7 AND 180),
  CONSTRAINT workspace_business_settings_no_show_rate_check CHECK (no_show_rate_basis_points BETWEEN 0 AND 10000),
  CONSTRAINT workspace_business_settings_cancellation_rate_check CHECK (cancellation_rate_basis_points BETWEEN 0 AND 10000),
  CONSTRAINT workspace_business_settings_top_up_threshold_check CHECK (top_up_threshold >= 0)
);

INSERT INTO workspace_business_settings (workspace_id)
VALUES ('00000000-0000-4000-8000-000000000001')
ON CONFLICT (workspace_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_student_lessons_workspace_starts_at
  ON student_lessons (workspace_id, starts_at ASC, id ASC);
CREATE INDEX IF NOT EXISTS idx_student_payment_records_workspace_received_at
  ON student_payment_records (workspace_id, received_at DESC, created_at DESC, id DESC)
  WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_student_credit_events_workspace_active
  ON student_credit_events (workspace_id, student_id, created_at DESC, id DESC)
  WHERE voided_at IS NULL;
