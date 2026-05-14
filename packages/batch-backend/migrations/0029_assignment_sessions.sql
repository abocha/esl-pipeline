CREATE TABLE IF NOT EXISTS assignment_sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id UUID NULL REFERENCES students(id) ON DELETE SET NULL,
  recording_id UUID NULL REFERENCES recordings(id) ON DELETE SET NULL,
  transcript_id UUID NULL REFERENCES transcripts(id) ON DELETE SET NULL,
  prompt_package_id UUID NULL REFERENCES prompt_packages(id) ON DELETE SET NULL,
  draft_id UUID NULL REFERENCES drafts(id) ON DELETE SET NULL,
  current_stage TEXT NOT NULL DEFAULT 'source',
  publish_target TEXT NULL,
  selected_tts_provider TEXT NULL,
  selected_tts_strategy TEXT NULL,
  selected_tts_model TEXT NULL,
  selected_preset TEXT NULL,
  selected_generation_provider TEXT NULL,
  selected_generation_model TEXT NULL,
  teacher_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ NULL,
  CONSTRAINT assignment_sessions_stage_check
    CHECK (current_stage IN ('source', 'context', 'assignment', 'review')),
  CONSTRAINT assignment_sessions_publish_target_check
    CHECK (publish_target IS NULL OR publish_target = 'html'),
  CONSTRAINT assignment_sessions_tts_provider_check
    CHECK (selected_tts_provider IS NULL OR selected_tts_provider IN ('elevenlabs', 'google')),
  CONSTRAINT assignment_sessions_tts_strategy_check
    CHECK (selected_tts_strategy IS NULL OR selected_tts_strategy IN ('auto', 'dialogue', 'tts')),
  CONSTRAINT assignment_sessions_generation_provider_check
    CHECK (
      selected_generation_provider IS NULL
      OR selected_generation_provider IN ('openai', 'google_ai_studio', 'openrouter')
    )
);

CREATE INDEX IF NOT EXISTS idx_assignment_sessions_user_updated
  ON assignment_sessions (user_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_assignment_sessions_user_active_updated
  ON assignment_sessions (user_id, updated_at DESC, id DESC)
  WHERE archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_assignment_sessions_user_active_recording
  ON assignment_sessions (user_id, recording_id)
  WHERE archived_at IS NULL AND recording_id IS NOT NULL;
