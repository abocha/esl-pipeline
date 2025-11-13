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
-- docker-compose.batch-backend.yml and applied manually or via CI with:
--   docker exec -i esl-backend-postgres \
--     psql -U esl -d esl_batch -f /schema/batch-backend/schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  md TEXT NOT NULL,
  preset TEXT NULL,
  with_tts BOOLEAN NULL,
  upload TEXT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  manifest_path TEXT NULL,
  error TEXT NULL
);

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

-- Trigger function to keep updated_at in sync on any UPDATE.
CREATE OR REPLACE FUNCTION set_jobs_updated_at()
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
  CHECK (state IN ('queued', 'running', 'succeeded', 'failed'));

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