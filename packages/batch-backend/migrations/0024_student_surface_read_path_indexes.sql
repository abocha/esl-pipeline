CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_student_ready_generated_at
  ON lesson_memory_entries (student_id, generated_at DESC, created_at DESC, id DESC)
  WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS idx_homework_memory_entries_student_ready_generated_at
  ON homework_memory_entries (student_id, generated_at DESC, created_at DESC, id DESC)
  WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS idx_student_profile_candidates_student_status_review_created_at
  ON student_profile_candidates (student_id, status, review_state, created_at DESC, id DESC);
