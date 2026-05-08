CREATE TABLE IF NOT EXISTS student_lesson_recurrence_rules (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  workspace_id UUID NULL REFERENCES workspaces(id) ON DELETE SET NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  frequency TEXT NOT NULL DEFAULT 'weekly',
  starts_on DATE NOT NULL DEFAULT CURRENT_DATE,
  ends_on DATE NULL,
  status TEXT NOT NULL DEFAULT 'active',
  generation_horizon_days INTEGER NOT NULL DEFAULT 56,
  materialized_through DATE NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_lesson_recurrence_rules_frequency_check CHECK (frequency IN ('weekly')),
  CONSTRAINT student_lesson_recurrence_rules_status_check CHECK (status IN ('active', 'paused', 'archived')),
  CONSTRAINT student_lesson_recurrence_rules_horizon_check CHECK (generation_horizon_days BETWEEN 7 AND 366),
  CONSTRAINT student_lesson_recurrence_rules_date_window_check CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS student_lesson_recurrence_slots (
  id UUID PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES student_lesson_recurrence_rules(id) ON DELETE CASCADE,
  iso_weekday INTEGER NOT NULL,
  local_start_time TIME NOT NULL,
  duration_minutes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_lesson_recurrence_slots_weekday_check CHECK (iso_weekday BETWEEN 1 AND 7),
  CONSTRAINT student_lesson_recurrence_slots_duration_check CHECK (duration_minutes > 0)
);

ALTER TABLE student_lessons ADD COLUMN IF NOT EXISTS recurrence_rule_id UUID NULL;
ALTER TABLE student_lessons ADD COLUMN IF NOT EXISTS recurrence_slot_id UUID NULL;
ALTER TABLE student_lessons ADD COLUMN IF NOT EXISTS recurrence_occurrence_key TEXT NULL;
ALTER TABLE student_lessons ADD COLUMN IF NOT EXISTS recurrence_origin TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE student_lessons ADD COLUMN IF NOT EXISTS recurrence_override_kind TEXT NULL;
ALTER TABLE student_lessons ADD COLUMN IF NOT EXISTS recurrence_obsolete_at TIMESTAMPTZ NULL;
ALTER TABLE student_lessons ADD COLUMN IF NOT EXISTS recurrence_obsolete_by UUID NULL;
ALTER TABLE student_lessons ADD COLUMN IF NOT EXISTS recurrence_obsolete_reason TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_lessons_recurrence_rule_id_fkey'
  ) THEN
    ALTER TABLE student_lessons
      ADD CONSTRAINT student_lessons_recurrence_rule_id_fkey
      FOREIGN KEY (recurrence_rule_id) REFERENCES student_lesson_recurrence_rules(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_lessons_recurrence_slot_id_fkey'
  ) THEN
    ALTER TABLE student_lessons
      ADD CONSTRAINT student_lessons_recurrence_slot_id_fkey
      FOREIGN KEY (recurrence_slot_id) REFERENCES student_lesson_recurrence_slots(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_lessons_recurrence_obsolete_by_fkey'
  ) THEN
    ALTER TABLE student_lessons
      ADD CONSTRAINT student_lessons_recurrence_obsolete_by_fkey
      FOREIGN KEY (recurrence_obsolete_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_lessons_recurrence_origin_check'
  ) THEN
    ALTER TABLE student_lessons
      ADD CONSTRAINT student_lessons_recurrence_origin_check
      CHECK (recurrence_origin IN ('manual', 'generated'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_lessons_recurrence_override_kind_check'
  ) THEN
    ALTER TABLE student_lessons
      ADD CONSTRAINT student_lessons_recurrence_override_kind_check
      CHECK (
        recurrence_override_kind IS NULL
        OR recurrence_override_kind IN ('manual_edit', 'manual_reschedule', 'manual_cancel')
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_lesson_recurrence_rules_primary_active
  ON student_lesson_recurrence_rules (student_id)
  WHERE status <> 'archived';

CREATE INDEX IF NOT EXISTS idx_student_lesson_recurrence_rules_student
  ON student_lesson_recurrence_rules (student_id, status, id);

CREATE INDEX IF NOT EXISTS idx_student_lesson_recurrence_slots_rule
  ON student_lesson_recurrence_slots (rule_id, iso_weekday, local_start_time, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_student_lessons_recurrence_occurrence_active
  ON student_lessons (recurrence_rule_id, recurrence_occurrence_key)
  WHERE recurrence_rule_id IS NOT NULL
    AND recurrence_occurrence_key IS NOT NULL
    AND recurrence_obsolete_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_student_lessons_student_active_schedule
  ON student_lessons (student_id, starts_at DESC, id DESC)
  WHERE recurrence_obsolete_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_student_lessons_workspace_active_schedule
  ON student_lessons (workspace_id, starts_at ASC, id ASC)
  WHERE recurrence_obsolete_at IS NULL;
