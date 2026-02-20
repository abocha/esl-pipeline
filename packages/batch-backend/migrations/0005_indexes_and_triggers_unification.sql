CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      CREATE EXTENSION pg_trgm;
    EXCEPTION
      WHEN insufficient_privilege THEN
        NULL;
    END;
  END IF;
END $$;

-- Jobs
CREATE INDEX IF NOT EXISTS idx_jobs_state_created_at ON jobs (state, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs (state);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs (created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_source_job_id ON jobs (source_job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_jobs_recording_id ON jobs (recording_id);
CREATE INDEX IF NOT EXISTS idx_jobs_transcript_id ON jobs (transcript_id);
CREATE INDEX IF NOT EXISTS idx_jobs_prompt_package_id ON jobs (prompt_package_id);
CREATE INDEX IF NOT EXISTS idx_jobs_draft_id ON jobs (draft_id);

-- Users
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- Recordings
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings (status);
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings (created_at);
CREATE INDEX IF NOT EXISTS idx_recordings_source ON recordings (source);
CREATE INDEX IF NOT EXISTS idx_recordings_student_id ON recordings (student_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_recordings_source_path_trgm
      ON recordings USING gin (source_path gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_recordings_storage_uri_trgm
      ON recordings USING gin (storage_uri gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_recordings_id_trgm
      ON recordings USING gin ((id::text) gin_trgm_ops);
  END IF;
END $$;

-- Transcripts / prompt packages / drafts
CREATE INDEX IF NOT EXISTS idx_transcripts_recording_id ON transcripts (recording_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_recording_id ON prompt_packages (recording_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_transcript_id ON prompt_packages (transcript_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_student_id ON prompt_packages (student_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_resolved_profile_id ON prompt_packages (resolved_profile_id);
CREATE INDEX IF NOT EXISTS idx_prompt_packages_resolved_template_id ON prompt_packages (resolved_template_id);
CREATE INDEX IF NOT EXISTS idx_drafts_prompt_package_id ON drafts (prompt_package_id);
CREATE INDEX IF NOT EXISTS idx_drafts_student_id ON drafts (student_id);
CREATE INDEX IF NOT EXISTS idx_drafts_created_by ON drafts (created_by);

-- Revisions and profile/template tables
CREATE INDEX IF NOT EXISTS idx_profile_revisions_profile_id_created_at ON profile_revisions (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_revisions_profile_id_hash ON profile_revisions (profile_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_template_revisions_template_id_created_at ON template_revisions (template_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_template_revisions_template_id_hash ON template_revisions (template_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_profiles_label ON profiles (label);
CREATE INDEX IF NOT EXISTS idx_profiles_active_revision_id ON profiles (active_revision_id);
CREATE INDEX IF NOT EXISTS idx_templates_label ON templates (label);
CREATE INDEX IF NOT EXISTS idx_templates_active_revision_id ON templates (active_revision_id);

-- Students and bindings
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_student_lower_unique ON students ((LOWER(student)));
CREATE INDEX IF NOT EXISTS idx_students_profile_id ON students (profile_id);
CREATE INDEX IF NOT EXISTS idx_students_created_at ON students (created_at);
CREATE INDEX IF NOT EXISTS idx_student_profile_bindings_student_id ON student_profile_bindings (student_id);
CREATE INDEX IF NOT EXISTS idx_student_profile_bindings_profile_id ON student_profile_bindings (profile_id);
CREATE INDEX IF NOT EXISTS idx_student_profile_bindings_effective_from ON student_profile_bindings (effective_from DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_student_profile_bindings_single_active
  ON student_profile_bindings (student_id) WHERE effective_to IS NULL;

-- Job action history and generation budget
CREATE INDEX IF NOT EXISTS idx_job_action_history_job_id_requested_at ON job_action_history (job_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_action_history_created_job_id ON job_action_history (created_job_id);
CREATE INDEX IF NOT EXISTS idx_job_action_history_action_type ON job_action_history (action_type);
CREATE INDEX IF NOT EXISTS idx_generation_budget_counters_provider_model ON generation_budget_counters (provider, model);
CREATE INDEX IF NOT EXISTS idx_generation_budget_counters_bucket_start ON generation_budget_counters (bucket_start);

-- Uploaded files and settings
CREATE INDEX IF NOT EXISTS idx_uploaded_files_user_id ON uploaded_files (user_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_storage_key ON uploaded_files (storage_key);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_created_at ON uploaded_files (created_at);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_storage_provider ON uploaded_files (storage_provider);
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings (user_id);

-- Trigger functions
CREATE OR REPLACE FUNCTION set_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_recordings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_transcripts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_prompt_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_students_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_uploaded_files_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_user_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS set_jobs_updated_at ON jobs;
CREATE TRIGGER set_jobs_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION set_jobs_updated_at();

DROP TRIGGER IF EXISTS set_recordings_updated_at ON recordings;
CREATE TRIGGER set_recordings_updated_at
BEFORE UPDATE ON recordings
FOR EACH ROW
EXECUTE FUNCTION set_recordings_updated_at();

DROP TRIGGER IF EXISTS set_transcripts_updated_at ON transcripts;
CREATE TRIGGER set_transcripts_updated_at
BEFORE UPDATE ON transcripts
FOR EACH ROW
EXECUTE FUNCTION set_transcripts_updated_at();

DROP TRIGGER IF EXISTS set_prompt_packages_updated_at ON prompt_packages;
CREATE TRIGGER set_prompt_packages_updated_at
BEFORE UPDATE ON prompt_packages
FOR EACH ROW
EXECUTE FUNCTION set_prompt_packages_updated_at();

DROP TRIGGER IF EXISTS set_drafts_updated_at ON drafts;
CREATE TRIGGER set_drafts_updated_at
BEFORE UPDATE ON drafts
FOR EACH ROW
EXECUTE FUNCTION set_drafts_updated_at();

DROP TRIGGER IF EXISTS set_students_updated_at ON students;
CREATE TRIGGER set_students_updated_at
BEFORE UPDATE ON students
FOR EACH ROW
EXECUTE FUNCTION set_students_updated_at();

DROP TRIGGER IF EXISTS set_profiles_updated_at ON profiles;
CREATE TRIGGER set_profiles_updated_at
BEFORE UPDATE ON profiles
FOR EACH ROW
EXECUTE FUNCTION set_profiles_updated_at();

DROP TRIGGER IF EXISTS set_users_updated_at ON users;
CREATE TRIGGER set_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_users_updated_at();

DROP TRIGGER IF EXISTS set_uploaded_files_updated_at ON uploaded_files;
CREATE TRIGGER set_uploaded_files_updated_at
BEFORE UPDATE ON uploaded_files
FOR EACH ROW
EXECUTE FUNCTION set_uploaded_files_updated_at();

DROP TRIGGER IF EXISTS set_user_settings_updated_at ON user_settings;
CREATE TRIGGER set_user_settings_updated_at
BEFORE UPDATE ON user_settings
FOR EACH ROW
EXECUTE FUNCTION set_user_settings_updated_at();

