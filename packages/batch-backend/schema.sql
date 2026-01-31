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
--   docker exec -i esl-backend-postgres \
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
  preset TEXT NULL,
  with_tts BOOLEAN NULL,
  upload TEXT NULL,
  voice_id TEXT NULL,
  voice_accent TEXT NULL,
  force_tts BOOLEAN NULL,
  notion_database TEXT NULL,
  mode TEXT NULL,
  notion_url TEXT NULL,
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
  profile_path TEXT NULL,
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

-- Ensure user_id is present on upgrades and has the correct FK
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcribe_workdir TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcript_path TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_payload TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_notes TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS profile_path TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recording_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcript_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_package_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS draft_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN DEFAULT FALSE;
ALTER TABLE jobs ALTER COLUMN md DROP NOT NULL;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_user_id_fkey;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

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
CREATE INDEX IF NOT EXISTS idx_drafts_prompt_package_id ON drafts(prompt_package_id);
CREATE INDEX IF NOT EXISTS idx_drafts_created_by ON drafts(created_by);

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

-- Trigger function to keep updated_at in sync for drafts on any UPDATE.
CREATE OR REPLACE FUNCTION set_drafts_updated_at()
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

-- Ensure a single trigger with the expected name is present for drafts.
DROP TRIGGER IF EXISTS set_drafts_updated_at ON drafts;

CREATE TRIGGER set_drafts_updated_at
BEFORE UPDATE ON drafts
FOR EACH ROW
EXECUTE FUNCTION set_drafts_updated_at();

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

-- Recordings source validation
ALTER TABLE recordings ADD CONSTRAINT recordings_source_check
  CHECK (source IN ('scan', 'upload'));

-- Recordings status validation
ALTER TABLE recordings ADD CONSTRAINT recordings_status_check
  CHECK (status IN ('ingested', 'queued', 'transcribing', 'transcribed', 'failed'));

-- Transcript mode validation
ALTER TABLE transcripts ADD CONSTRAINT transcripts_mode_check
  CHECK (mode IN ('timeline', 'stack'));

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
  -- TTS Provider (groundwork for future expansion: 'openai', 'azure', etc.)
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
  CHECK (tts_provider IN ('elevenlabs', 'openai', 'azure', 'google'));
