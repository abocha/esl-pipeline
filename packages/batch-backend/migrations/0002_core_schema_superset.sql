CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY,
  state TEXT NOT NULL,
  md TEXT NULL,
  md_storage_uri TEXT NULL,
  recording_id UUID NULL,
  transcript_id UUID NULL,
  prompt_package_id UUID NULL,
  draft_id UUID NULL,
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
  notion_url TEXT NULL,
  anytype_url TEXT NULL,
  html_url TEXT NULL,
  auto_publish BOOLEAN NOT NULL DEFAULT FALSE,
  manifest_path TEXT NULL,
  source_job_id UUID NULL,
  transcribe_workdir TEXT NULL,
  transcript_path TEXT NULL,
  prompt_payload TEXT NULL,
  prompt_notes TEXT NULL,
  profile_path TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  error TEXT NULL,
  user_id UUID NULL
);

ALTER TABLE jobs ALTER COLUMN md DROP NOT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS md_storage_uri TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS recording_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcript_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_package_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS draft_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS preset TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS learning_preset_id TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS learning_preset_version TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_snapshot_version TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_alias TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS with_tts BOOLEAN NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS upload TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS voice_id TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS voice_accent TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS force_tts BOOLEAN NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notion_database TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS publish_target TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS mode TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS notion_url TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS anytype_url TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS html_url TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS manifest_path TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_job_id UUID NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcribe_workdir TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS transcript_path TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_payload TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_notes TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS profile_path TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS user_id UUID NULL;

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

ALTER TABLE recordings ADD COLUMN IF NOT EXISTS source TEXT NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS student_id UUID NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS source_path TEXT NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS storage_uri TEXT NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS sha256 TEXT NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS bytes BIGINT NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS duration_sec INTEGER NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS channels INTEGER NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS status TEXT NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS error TEXT NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS transcripts (
  id UUID PRIMARY KEY,
  recording_id UUID NOT NULL,
  storage_uri TEXT NOT NULL,
  raw_response_uri TEXT NULL,
  mode TEXT NOT NULL DEFAULT 'timeline',
  model TEXT NOT NULL DEFAULT 'nova-3',
  language TEXT NOT NULL DEFAULT 'multi',
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  summary_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS recording_id UUID NULL;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS storage_uri TEXT NULL;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS raw_response_uri TEXT NULL;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS mode TEXT NULL;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS model TEXT NULL;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS language TEXT NULL;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN NULL;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS summary_json JSONB NULL;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS prompt_packages (
  id UUID PRIMARY KEY,
  recording_id UUID NOT NULL,
  transcript_id UUID NOT NULL,
  student_id UUID NULL,
  profile_path TEXT NULL,
  resolved_profile_id TEXT NULL,
  resolved_profile_hash TEXT NULL,
  resolved_profile_revision_id UUID NULL,
  resolved_profile_updated_at TIMESTAMPTZ NULL,
  resolved_profile_version_label TEXT NULL,
  resolved_profile_status TEXT NULL,
  resolved_template_id TEXT NULL,
  resolved_template_hash TEXT NULL,
  resolved_template_revision_id UUID NULL,
  resolved_template_updated_at TIMESTAMPTZ NULL,
  resolved_template_version_label TEXT NULL,
  resolved_template_status TEXT NULL,
  resolved_voice_capabilities_hash TEXT NULL,
  resolved_voice_capabilities_generated_at TIMESTAMPTZ NULL,
  resolved_voice_capabilities_snapshot JSONB NULL,
  template_version TEXT NOT NULL,
  notes TEXT NULL,
  storage_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS recording_id UUID NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS transcript_id UUID NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS student_id UUID NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS profile_path TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_id TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_hash TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_revision_id UUID NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_updated_at TIMESTAMPTZ NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_version_label TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_profile_status TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_id TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_hash TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_revision_id UUID NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_updated_at TIMESTAMPTZ NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_version_label TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_template_status TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_voice_capabilities_hash TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_voice_capabilities_generated_at TIMESTAMPTZ NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS resolved_voice_capabilities_snapshot JSONB NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS template_version TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS notes TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS storage_uri TEXT NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE prompt_packages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY,
  prompt_package_id UUID NOT NULL,
  student_id UUID NULL,
  storage_uri TEXT NOT NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS prompt_package_id UUID NULL;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS student_id UUID NULL;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS storage_uri TEXT NULL;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS created_by UUID NULL;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS profile_revisions (
  id UUID PRIMARY KEY,
  profile_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'update',
  status TEXT NOT NULL DEFAULT 'active',
  version_number INTEGER NOT NULL DEFAULT 1,
  version_label TEXT NOT NULL DEFAULT 'v1',
  activated_at TIMESTAMPTZ NULL,
  deprecated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL,
  restored_from_revision_id UUID NULL
);

ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS profile_id TEXT NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS content TEXT NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS content_hash TEXT NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS source TEXT NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS version_number INTEGER NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS version_label TEXT NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS created_by UUID NULL;
ALTER TABLE profile_revisions ADD COLUMN IF NOT EXISTS restored_from_revision_id UUID NULL;

CREATE TABLE IF NOT EXISTS template_revisions (
  id UUID PRIMARY KEY,
  template_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'update',
  status TEXT NOT NULL DEFAULT 'active',
  version_number INTEGER NOT NULL DEFAULT 1,
  version_label TEXT NOT NULL DEFAULT 'v1',
  activated_at TIMESTAMPTZ NULL,
  deprecated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL,
  restored_from_revision_id UUID NULL
);

ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS template_id TEXT NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS content TEXT NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS content_hash TEXT NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS source TEXT NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS version_number INTEGER NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS version_label TEXT NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS deprecated_at TIMESTAMPTZ NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS created_by UUID NULL;
ALTER TABLE template_revisions ADD COLUMN IF NOT EXISTS restored_from_revision_id UUID NULL;

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

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active_revision_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS label TEXT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS active_revision_id UUID NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  active_revision_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE templates ADD COLUMN IF NOT EXISTS label TEXT NULL;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS active_revision_id UUID NULL;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS student_profile_bindings (
  id UUID PRIMARY KEY,
  student_id UUID NOT NULL,
  profile_id TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ NULL,
  reason TEXT NULL,
  changed_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS student_id UUID NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS profile_id TEXT NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS effective_from TIMESTAMPTZ NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS effective_to TIMESTAMPTZ NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS reason TEXT NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS changed_by UUID NULL;
ALTER TABLE student_profile_bindings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS job_action_history (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL,
  action_type TEXT NOT NULL,
  payload_json JSONB NULL,
  requested_at TIMESTAMPTZ NOT NULL,
  requested_by UUID NULL,
  outcome TEXT NOT NULL,
  message TEXT NOT NULL,
  error_code TEXT NULL,
  created_job_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE job_action_history ADD COLUMN IF NOT EXISTS job_id UUID NULL;
ALTER TABLE job_action_history ADD COLUMN IF NOT EXISTS action_type TEXT NULL;
ALTER TABLE job_action_history ADD COLUMN IF NOT EXISTS payload_json JSONB NULL;
ALTER TABLE job_action_history ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ NULL;
ALTER TABLE job_action_history ADD COLUMN IF NOT EXISTS requested_by UUID NULL;
ALTER TABLE job_action_history ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'succeeded';
ALTER TABLE job_action_history ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
ALTER TABLE job_action_history ADD COLUMN IF NOT EXISTS error_code TEXT NULL;
ALTER TABLE job_action_history ADD COLUMN IF NOT EXISTS created_job_id UUID NULL;
ALTER TABLE job_action_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS generation_budget_counters (
  bucket_type TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  reserved_tokens BIGINT NOT NULL DEFAULT 0,
  actual_tokens BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_type, bucket_start, provider, model)
);

ALTER TABLE generation_budget_counters ADD COLUMN IF NOT EXISTS bucket_type TEXT;
ALTER TABLE generation_budget_counters ADD COLUMN IF NOT EXISTS bucket_start TIMESTAMPTZ;
ALTER TABLE generation_budget_counters ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE generation_budget_counters ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE generation_budget_counters ADD COLUMN IF NOT EXISTS request_count INTEGER;
ALTER TABLE generation_budget_counters ADD COLUMN IF NOT EXISTS reserved_tokens BIGINT;
ALTER TABLE generation_budget_counters ADD COLUMN IF NOT EXISTS actual_tokens BIGINT;
ALTER TABLE generation_budget_counters ALTER COLUMN request_count SET DEFAULT 0;
ALTER TABLE generation_budget_counters ALTER COLUMN reserved_tokens SET DEFAULT 0;
ALTER TABLE generation_budget_counters ALTER COLUMN actual_tokens SET DEFAULT 0;
UPDATE generation_budget_counters SET request_count = 0 WHERE request_count IS NULL;
UPDATE generation_budget_counters SET reserved_tokens = 0 WHERE reserved_tokens IS NULL;
UPDATE generation_budget_counters SET actual_tokens = 0 WHERE actual_tokens IS NULL;
ALTER TABLE generation_budget_counters ALTER COLUMN request_count SET NOT NULL;
ALTER TABLE generation_budget_counters ALTER COLUMN reserved_tokens SET NOT NULL;
ALTER TABLE generation_budget_counters ALTER COLUMN actual_tokens SET NOT NULL;

CREATE TABLE IF NOT EXISTS uploaded_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  storage_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  sanitized_filename TEXT NULL,
  file_size BIGINT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_provider TEXT NOT NULL DEFAULT 'filesystem',
  s3_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, storage_key)
);

CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE,
  elevenlabs_key_encrypted TEXT NULL,
  notion_token_encrypted TEXT NULL,
  tts_provider TEXT NOT NULL DEFAULT 'elevenlabs',
  default_preset TEXT NOT NULL DEFAULT 'b1-default',
  default_voice_accent TEXT NOT NULL DEFAULT 'american',
  default_tts_strategy TEXT NOT NULL DEFAULT 'auto',
  enable_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

