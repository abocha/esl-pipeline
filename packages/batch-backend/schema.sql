-- packages/batch-backend/schema.sql
-- Minimal Postgres schema for @esl-pipeline/batch-backend jobs and users tables.
-- Aligns with:
-- - JobRecord / JobState in packages/batch-backend/src/domain/job-model.ts
-- - Repository queries in packages/batch-backend/src/domain/job-repository.ts
-- - UserRecord in packages/batch-backend/src/domain/user-model.ts
-- - UserRepository queries in packages/batch-backend/src/domain/user-repository.ts
-- - Public contracts documented in packages/batch-backend/README.md
--
-- This file is intended to be mounted into the Postgres container in
-- docker-compose.yml / docker-compose.prod.yml and applied manually or via CI with:
--   docker exec -i "$(docker compose -p esl-pipeline -f docker-compose.yml ps -q postgres)" \
--     psql -U esl -d esl_batch -f /schema/batch-backend/schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NULL
);

-- Jobs table (references users for ownership/auditing)
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  md TEXT NULL,
  md_storage_uri TEXT NULL,
  preset TEXT NULL,
  learning_preset_id TEXT NULL,
  learning_preset_version TEXT NULL,
  prompt_snapshot_version TEXT NULL,
  prompt_alias TEXT NULL,
  with_tts BOOLEAN NULL,
  upload TEXT NULL,
  voice_id TEXT NULL,
  voice_accent TEXT NULL,
  force_tts BOOLEAN NULL,
  notion_database TEXT NULL,
  publish_target TEXT NULL,
  mode TEXT NULL,
  tts_provider TEXT NULL,
  google_tts_model TEXT NULL,
  notion_url TEXT NULL,
  anytype_url TEXT NULL,
  html_url TEXT NULL,
  auto_publish BOOLEAN DEFAULT FALSE,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  manifest_path TEXT NULL,
  error TEXT NULL,
  user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  transcribe_workdir TEXT NULL,
  transcript_path TEXT NULL,
  prompt_payload TEXT NULL,
  prompt_notes TEXT NULL,
  profile_path TEXT NULL,
  recording_id UUID NULL,
  transcript_id UUID NULL,
  prompt_package_id UUID NULL,
  draft_id UUID NULL
);

-- Phase 2+ transcription tables
CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY,
  source TEXT NOT NULL,
  student_id UUID NULL,
  source_path TEXT NULL,
  storage_uri TEXT NOT NULL,
  sha256 TEXT NULL,
  bytes BIGINT NOT NULL,
  duration_sec INTEGER NULL,
  channels INTEGER NULL,
  status TEXT NOT NULL,
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY,
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  storage_uri TEXT NOT NULL,
  raw_response_uri TEXT NULL,
  mode TEXT NOT NULL DEFAULT 'timeline',
  model TEXT NOT NULL DEFAULT 'nova-3',
  language TEXT NOT NULL DEFAULT 'multi',
  fallback_used BOOLEAN NOT NULL DEFAULT false,
  summary_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompt_packages (
  id UUID PRIMARY KEY,
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  transcript_id UUID NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  student_id UUID NULL,
  student_memory_snapshot_id UUID NULL,
  student_memory_snapshot_hash TEXT NULL,
  selected_lesson_memory_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  selected_homework_memory_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
  retrieval_policy_version TEXT NULL,
  profile_path TEXT NULL,
  resolved_profile_id TEXT NULL,
  resolved_profile_hash TEXT NULL,
  resolved_profile_revision_id UUID NULL,
  resolved_profile_updated_at TIMESTAMPTZ NULL,
  resolved_template_id TEXT NULL,
  resolved_template_hash TEXT NULL,
  resolved_template_revision_id UUID NULL,
  resolved_template_updated_at TIMESTAMPTZ NULL,
  resolved_voice_capabilities_hash TEXT NULL,
  resolved_voice_capabilities_generated_at TIMESTAMPTZ NULL,
  resolved_voice_capabilities_snapshot JSONB NULL,
  template_version TEXT NOT NULL,
  notes TEXT NULL,
  storage_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY,
  prompt_package_id UUID NOT NULL REFERENCES prompt_packages(id) ON DELETE CASCADE,
  storage_uri TEXT NOT NULL,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_revisions (
  id UUID PRIMARY KEY,
  profile_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'update',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  restored_from_revision_id UUID NULL REFERENCES profile_revisions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS template_revisions (
  id UUID PRIMARY KEY,
  template_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'update',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  restored_from_revision_id UUID NULL REFERENCES template_revisions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS students (
  id UUID PRIMARY KEY,
  student TEXT NOT NULL,
  db_id TEXT NULL,
  page_parent_id TEXT NULL,
  color_preset TEXT NULL,
  voices JSONB NOT NULL DEFAULT '{}'::jsonb,
  manifest_preset TEXT NULL,
  accent_preference TEXT NULL,
  profile_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active_revision_id UUID NULL REFERENCES profile_revisions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS student_profile_bindings (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL,
  reason TEXT NULL,
  changed_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure user_id is present on upgrades and has the correct FK
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcribe_workdir TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcript_path TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_payload TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_notes TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS profile_path TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS publish_target TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS anytype_url TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS html_url TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recording_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcript_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_package_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS draft_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS md_storage_uri TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS learning_preset_id TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS learning_preset_version TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_snapshot_version TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_alias TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tts_provider TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS google_tts_model TEXT NULL;
ALTER TABLE jobs ALTER COLUMN md DROP NOT NULL;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_user_id_fkey;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS student_id UUID NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS student_memory_snapshot_id UUID NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS student_memory_snapshot_hash TEXT NULL;
ALTER TABLE prompt_packages
  ADD COLUMN IF NOT EXISTS selected_lesson_memory_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[];
ALTER TABLE prompt_packages
  ADD COLUMN IF NOT EXISTS selected_homework_memory_ids UUID[] NOT NULL DEFAULT ARRAY[]::uuid[];
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS retrieval_policy_version TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_id TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_hash TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_revision_id UUID NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_updated_at TIMESTAMPTZ NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_id TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_hash TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_revision_id UUID NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_updated_at TIMESTAMPTZ NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_voice_capabilities_hash TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_voice_capabilities_generated_at TIMESTAMPTZ NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_voice_capabilities_snapshot JSONB NULL;

ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS profile_id TEXT NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS content TEXT NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS content_hash TEXT NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS source TEXT NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS created_by UUID NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS restored_from_revision_id UUID NULL;

ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS template_id TEXT NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS content TEXT NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS content_hash TEXT NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS source TEXT NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS created_by UUID NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS restored_from_revision_id UUID NULL;

ALTER TABLE students ADD COLUMN IF NOT EXISTS student TEXT NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS db_id TEXT NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS page_parent_id TEXT NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS color_preset TEXT NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS voices JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE students ADD COLUMN IF NOT EXISTS manifest_preset TEXT NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS accent_preference TEXT NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS profile_id TEXT NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS label TEXT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_revision_id UUID NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;

ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS student_id UUID NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS profile_id TEXT NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS reason TEXT NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS changed_by UUID NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_recording_id ON jobs(recording_id);
CREATE INDEX IF NOT EXISTS idx_jobs_transcript_id ON jobs(transcript_id);
CREATE INDEX IF NOT EXISTS idx_jobs_prompt_package_id ON jobs(prompt_package_id);
CREATE INDEX IF NOT EXISTS idx_jobs_draft_id ON jobs(draft_id);

CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at);
CREATE INDEX IF NOT EXISTS idx_transcripts_recording_id ON transcripts(recording_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_recording_id ON prompt_packages(recording_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_transcript_id ON prompt_packages(transcript_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_student_id ON prompt_packages(student_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_student_memory_snapshot_id
  ON prompt_packages(student_memory_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_resolved_profile_id ON prompt_packages(resolved_profile_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_resolved_template_id ON prompt_packages(resolved_template_id);
CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_student_generated_at
  ON lesson_memory_entries(student_id, generated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_transcript_generated_at
  ON lesson_memory_entries(transcript_id, generated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_recording_generated_at
  ON lesson_memory_entries(recording_id, generated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_status_generated_at
  ON lesson_memory_entries(status, generated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_memory_entries_transcript_ready_lookup
  ON lesson_memory_entries(transcript_id, generated_at DESC, id DESC)
  WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS idx_drafts_prompt_package_id ON drafts(prompt_package_id);
CREATE INDEX IF NOT EXISTS idx_drafts_created_by ON drafts(created_by);
CREATE INDEX IF NOT EXISTS idx_profile_revisions_profile_id_created_at ON profile_revisions(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_revisions_profile_id_hash ON profile_revisions(profile_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_template_revisions_template_id_created_at ON template_revisions(template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_template_revisions_template_id_hash ON template_revisions(template_id, content_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_student_lower_unique ON students((LOWER(student)));
CREATE INDEX IF NOT EXISTS idx_students_profile_id ON students(profile_id);
CREATE INDEX IF NOT EXISTS idx_students_created_at ON students(created_at);
CREATE INDEX IF NOT EXISTS idx_profiles_label ON profiles(label);
CREATE INDEX IF NOT EXISTS idx_profiles_active_revision_id ON profiles(active_revision_id);
CREATE INDEX IF NOT EXISTS idx_student_profile_bindings_student_id ON student_profile_bindings(student_id);
CREATE INDEX IF NOT EXISTS idx_student_profile_bindings_profile_id ON student_profile_bindings(profile_id);
CREATE INDEX IF NOT EXISTS idx_student_profile_bindings_effective_from ON student_profile_bindings(effective_from DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profile_bindings_single_active
  ON student_profile_bindings(student_id) WHERE effective_to IS NULL;

-- Trigger function to keep updated_at in sync on any UPDATE.
CREATE OR REPLACE FUNCTION set_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to keep updated_at in sync for recordings on any UPDATE.
CREATE OR REPLACE FUNCTION set_recordings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to keep updated_at in sync for transcripts on any UPDATE.
CREATE OR REPLACE FUNCTION set_transcripts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to keep updated_at in sync for prompt_packages on any UPDATE.
CREATE OR REPLACE FUNCTION set_prompt_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to keep updated_at in sync for lesson_memory_entries on any UPDATE.
CREATE OR REPLACE FUNCTION set_lesson_memory_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to keep updated_at in sync for drafts on any UPDATE.
CREATE OR REPLACE FUNCTION set_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to keep updated_at in sync for students on any UPDATE.
CREATE OR REPLACE FUNCTION set_students_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to keep updated_at in sync for profiles on any UPDATE.
CREATE OR REPLACE FUNCTION set_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to keep updated_at in sync for users on any UPDATE.
CREATE OR REPLACE FUNCTION set_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure a single trigger with the expected name is present for jobs.
DROP TRIGGER IF EXISTS set_jobs_updated_at ON jobs;

CREATE TRIGGER set_jobs_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION set_jobs_updated_at();

-- Ensure a single trigger with the expected name is present for recordings.
DROP TRIGGER IF EXISTS set_recordings_updated_at ON recordings;

CREATE TRIGGER set_recordings_updated_at
BEFORE UPDATE ON recordings
FOR EACH ROW
EXECUTE FUNCTION set_recordings_updated_at();

-- Ensure a single trigger with the expected name is present for transcripts.
DROP TRIGGER IF EXISTS set_transcripts_updated_at ON transcripts;

CREATE TRIGGER set_transcripts_updated_at
BEFORE UPDATE ON transcripts
FOR EACH ROW
EXECUTE FUNCTION set_transcripts_updated_at();

-- Ensure a single trigger with the expected name is present for prompt_packages.
DROP TRIGGER IF EXISTS set_prompt_packages_updated_at ON prompt_packages;

CREATE TRIGGER set_prompt_packages_updated_at
BEFORE UPDATE ON prompt_packages
FOR EACH ROW
EXECUTE FUNCTION set_prompt_packages_updated_at();

-- Ensure a single trigger with the expected name is present for lesson_memory_entries.
DROP TRIGGER IF EXISTS set_lesson_memory_entries_updated_at ON lesson_memory_entries;

CREATE TRIGGER set_lesson_memory_entries_updated_at
BEFORE UPDATE ON lesson_memory_entries
FOR EACH ROW
EXECUTE FUNCTION set_lesson_memory_entries_updated_at();

-- Ensure a single trigger with the expected name is present for drafts.
DROP TRIGGER IF EXISTS set_drafts_updated_at ON drafts;

CREATE TRIGGER set_drafts_updated_at
BEFORE UPDATE ON drafts
FOR EACH ROW
EXECUTE FUNCTION set_drafts_updated_at();

-- Ensure a single trigger with the expected name is present for students.
DROP TRIGGER IF EXISTS set_students_updated_at ON students;

CREATE TRIGGER set_students_updated_at
BEFORE UPDATE ON students
FOR EACH ROW
EXECUTE FUNCTION set_students_updated_at();

-- Ensure a single trigger with the expected name is present for profiles.
DROP TRIGGER IF EXISTS set_profiles_updated_at ON profiles;

CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION set_profiles_updated_at();

-- Ensure a single trigger with the expected name is present for users.
DROP TRIGGER IF EXISTS set_users_updated_at ON users;

CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_users_updated_at();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

-- Roles enum-like validation (using check constraints)
ALTER TABLE users ADD CONSTRAINT users_role_check 
  CHECK (role IN ('admin', 'user', 'viewer'));

-- Jobs state validation
ALTER TABLE jobs ADD CONSTRAINT jobs_state_check 
  CHECK (state IN ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed'));

-- Jobs mode validation (TTS strategy)
ALTER TABLE jobs ADD CONSTRAINT jobs_mode_check
  CHECK (mode IS NULL OR mode IN ('auto', 'dialogue', 'tts'));

ALTER TABLE jobs ADD CONSTRAINT jobs_tts_provider_check
  CHECK (tts_provider IS NULL OR tts_provider IN ('elevenlabs', 'google'));

ALTER TABLE jobs ADD CONSTRAINT jobs_google_tts_model_check
  CHECK (
    google_tts_model IS NULL OR google_tts_model IN ('chirp3_hd', 'studio', 'neural2', 'wavenet')
  );

-- Recordings source validation
ALTER TABLE recordings ADD CONSTRAINT recordings_source_check
  CHECK (source IN ('upload'));

-- Recordings status validation
ALTER TABLE recordings ADD CONSTRAINT recordings_status_check
  CHECK (status IN ('ingested', 'queued', 'transcribing', 'transcribed', 'failed'));

-- Transcript mode validation
ALTER TABLE transcripts ADD CONSTRAINT transcripts_mode_check
  CHECK (mode IN ('timeline', 'stack'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_profile_id_fkey') THEN
    ALTER TABLE students
      ADD CONSTRAINT students_profile_id_fkey
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_profile_bindings_effective_window_check'
  ) THEN
    ALTER TABLE student_profile_bindings
      ADD CONSTRAINT student_profile_bindings_effective_window_check
      CHECK (effective_to IS NULL OR effective_to > effective_from);
  END IF;
END $$;

-- Email format validation (basic)
ALTER TABLE users ADD CONSTRAINT users_email_check
  CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

-- Uploaded files table for file metadata storage
CREATE TABLE IF NOT EXISTS uploaded_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  sanitized_filename TEXT NULL,
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'filesystem', -- 's3', 'minio', 'filesystem'
  s3_url TEXT NULL, -- Presigned URL for S3/MinIO files
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, storage_key)
);

-- Trigger function to keep updated_at in sync for uploaded_files on any UPDATE.
CREATE OR REPLACE FUNCTION set_uploaded_files_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure a single trigger with the expected name is present for uploaded_files.
DROP TRIGGER IF EXISTS set_uploaded_files_updated_at ON uploaded_files;

CREATE TRIGGER set_uploaded_files_updated_at
BEFORE UPDATE ON uploaded_files
FOR EACH ROW
EXECUTE FUNCTION set_uploaded_files_updated_at();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_uploaded_files_user_id ON uploaded_files(user_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_storage_key ON uploaded_files(storage_key);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_created_at ON uploaded_files(created_at);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_storage_provider ON uploaded_files(storage_provider);

-- Storage provider validation
ALTER TABLE uploaded_files ADD CONSTRAINT uploaded_files_storage_provider_check
  CHECK (storage_provider IN ('s3', 'minio', 'filesystem'));

-- File size validation (prevent negative sizes)
ALTER TABLE uploaded_files ADD CONSTRAINT uploaded_files_file_size_check
  CHECK (file_size >= 0);

-- User settings table for API keys and preferences
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- API Keys (encrypted at rest)
  elevenlabs_key_encrypted TEXT NULL,
  notion_token_encrypted TEXT NULL,
  -- TTS Provider
  tts_provider TEXT NOT NULL DEFAULT 'elevenlabs',
  -- Preferences
  default_preset TEXT NOT NULL DEFAULT 'b1-default',
  default_voice_accent TEXT NOT NULL DEFAULT 'american',
  default_tts_strategy TEXT NOT NULL DEFAULT 'auto',
  enable_notifications BOOLEAN NOT NULL DEFAULT true,
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger function for user_settings updated_at
CREATE OR REPLACE FUNCTION set_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_user_settings_updated_at ON user_settings;

CREATE TRIGGER set_user_settings_updated_at
BEFORE UPDATE ON user_settings
FOR EACH ROW
EXECUTE FUNCTION set_user_settings_updated_at();

-- Indexes for user_settings
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- Constraints for user_settings
ALTER TABLE user_settings ADD CONSTRAINT user_settings_tts_strategy_check
  CHECK (default_tts_strategy IN ('auto', 'dialogue', 'tts'));

ALTER TABLE user_settings ADD CONSTRAINT user_settings_tts_provider_check
  CHECK (tts_provider IN ('elevenlabs', 'google'));

-- Ops control action history for durable /ops/actions status across restarts.
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
  ON ops_actions(operation_id);
CREATE INDEX IF NOT EXISTS idx_ops_actions_retention_scan
  ON ops_actions(finished_at ASC)
  WHERE finished_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_actions_state_finished_at
  ON ops_actions(state, finished_at ASC);

CREATE OR REPLACE FUNCTION set_ops_actions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_ops_actions_updated_at ON ops_actions;

CREATE TRIGGER set_ops_actions_updated_at
BEFORE UPDATE ON ops_actions
FOR EACH ROW
EXECUTE FUNCTION set_ops_actions_updated_at();
