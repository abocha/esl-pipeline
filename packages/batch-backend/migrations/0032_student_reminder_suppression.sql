ALTER TABLE public.student_reminder_preferences
  ADD COLUMN hidden_lesson_followup_keys text[] DEFAULT ARRAY[]::text[] NOT NULL,
  ADD COLUMN latest_hidden_lesson_followup_key text,
  ADD COLUMN latest_hidden_lesson_followup_lesson_id uuid,
  ADD COLUMN latest_hidden_lesson_followup_at timestamp with time zone;

