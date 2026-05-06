CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO workspaces (id, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'Default workspace')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT workspace_memberships_role_check
    CHECK (role IN ('owner', 'admin', 'member', 'viewer'))
);

INSERT INTO workspace_memberships (workspace_id, user_id, role)
SELECT '00000000-0000-4000-8000-000000000001'::UUID, users.id, 'owner'
FROM users
ON CONFLICT (workspace_id, user_id) DO NOTHING;

ALTER TABLE students ADD COLUMN IF NOT EXISTS workspace_id UUID NULL;

UPDATE students
SET workspace_id = '00000000-0000-4000-8000-000000000001'
WHERE workspace_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_workspace_id_fkey'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS student_lesson_plans (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  default_duration_minutes INTEGER NOT NULL DEFAULT 60,
  cadence TEXT NULL,
  preferred_times TEXT NULL,
  scheduling_notes TEXT NULL,
  updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_lesson_plans_duration_check CHECK (default_duration_minutes > 0)
);

CREATE TABLE IF NOT EXISTS student_lessons (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'scheduled',
  consumes_credit BOOLEAN NOT NULL DEFAULT FALSE,
  title TEXT NULL,
  notes TEXT NULL,
  credit_event_id UUID NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  completed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_lessons_duration_check CHECK (duration_minutes > 0),
  CONSTRAINT student_lessons_status_check CHECK (status IN ('scheduled', 'completed', 'canceled', 'no_show'))
);

CREATE TABLE IF NOT EXISTS student_credit_events (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL,
  source_lesson_id UUID NULL REFERENCES student_lessons(id) ON DELETE SET NULL,
  source_payment_id UUID NULL,
  note TEXT NULL,
  voided_at TIMESTAMPTZ NULL,
  voided_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_credit_events_type_check
    CHECK (event_type IN ('credit_added', 'credit_consumed', 'credit_adjusted')),
  CONSTRAINT student_credit_events_nonzero_check CHECK (quantity_delta <> 0)
);

ALTER TABLE student_lessons
  ADD CONSTRAINT student_lessons_credit_event_id_fkey
  FOREIGN KEY (credit_event_id) REFERENCES student_credit_events(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS student_payment_records (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  amount_minor INTEGER NOT NULL,
  currency CHAR(3) NOT NULL,
  method TEXT NULL,
  received_at DATE NOT NULL DEFAULT CURRENT_DATE,
  external_url TEXT NULL,
  note TEXT NULL,
  voided_at TIMESTAMPTZ NULL,
  voided_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_payment_records_amount_check CHECK (amount_minor > 0),
  CONSTRAINT student_payment_records_currency_check CHECK (currency ~ '^[A-Z]{3}$')
);

ALTER TABLE student_credit_events
  ADD CONSTRAINT student_credit_events_source_payment_id_fkey
  FOREIGN KEY (source_payment_id) REFERENCES student_payment_records(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS student_reminder_preferences (
  student_id UUID PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  preferred_channel TEXT NOT NULL DEFAULT 'manual',
  low_balance_threshold INTEGER NOT NULL DEFAULT 2,
  enable_upcoming_lesson BOOLEAN NOT NULL DEFAULT TRUE,
  enable_low_balance BOOLEAN NOT NULL DEFAULT TRUE,
  enable_payment_followup BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_reminder_preferences_channel_check
    CHECK (preferred_channel IN ('manual', 'telegram', 'email')),
  CONSTRAINT student_reminder_preferences_threshold_check CHECK (low_balance_threshold >= 0)
);

CREATE INDEX IF NOT EXISTS idx_students_workspace_id ON students (workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_id ON workspace_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_student_lessons_student_starts_at ON student_lessons (student_id, starts_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_student_lessons_student_next ON student_lessons (student_id, starts_at ASC, id ASC)
  WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_student_credit_events_student_created_at ON student_credit_events (student_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_student_credit_events_student_active ON student_credit_events (student_id, created_at DESC, id DESC)
  WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_student_payment_records_student_received_at ON student_payment_records (student_id, received_at DESC, created_at DESC, id DESC)
  WHERE voided_at IS NULL;
