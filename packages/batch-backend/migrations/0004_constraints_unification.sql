-- Users / jobs baseline checks from schema.sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user', 'viewer'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_email_check
      CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_state_check') THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_state_check
      CHECK (state IN ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_mode_check') THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_mode_check
      CHECK (mode IS NULL OR mode IN ('auto', 'dialogue', 'tts'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_user_id_fkey') THEN
    ALTER TABLE jobs DROP CONSTRAINT jobs_user_id_fkey;
  END IF;
  ALTER TABLE jobs
    ADD CONSTRAINT jobs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
END $$;

-- Runtime FK/check set
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recordings_source_check') THEN
    ALTER TABLE recordings DROP CONSTRAINT recordings_source_check;
  END IF;
  ALTER TABLE recordings
    ADD CONSTRAINT recordings_source_check CHECK (source IN ('upload'));
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recordings_status_check') THEN
    ALTER TABLE recordings
      ADD CONSTRAINT recordings_status_check
      CHECK (status IN ('ingested', 'queued', 'transcribing', 'transcribed', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transcripts_mode_check') THEN
    ALTER TABLE transcripts
      ADD CONSTRAINT transcripts_mode_check CHECK (mode IN ('timeline', 'stack'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transcripts_recording_id_fkey') THEN
    ALTER TABLE transcripts
      ADD CONSTRAINT transcripts_recording_id_fkey
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_packages_recording_id_fkey') THEN
    ALTER TABLE prompt_packages
      ADD CONSTRAINT prompt_packages_recording_id_fkey
      FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_packages_transcript_id_fkey') THEN
    ALTER TABLE prompt_packages
      ADD CONSTRAINT prompt_packages_transcript_id_fkey
      FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drafts_prompt_package_id_fkey') THEN
    ALTER TABLE drafts
      ADD CONSTRAINT drafts_prompt_package_id_fkey
      FOREIGN KEY (prompt_package_id) REFERENCES prompt_packages(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drafts_created_by_fkey') THEN
    ALTER TABLE drafts
      ADD CONSTRAINT drafts_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_revisions_created_by_fkey') THEN
    ALTER TABLE profile_revisions
      ADD CONSTRAINT profile_revisions_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_revisions_restored_from_revision_id_fkey') THEN
    ALTER TABLE profile_revisions
      ADD CONSTRAINT profile_revisions_restored_from_revision_id_fkey
      FOREIGN KEY (restored_from_revision_id) REFERENCES profile_revisions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_revisions_source_check') THEN
    ALTER TABLE profile_revisions
      ADD CONSTRAINT profile_revisions_source_check CHECK (source IN ('create', 'update', 'restore'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_revisions_status_check') THEN
    ALTER TABLE profile_revisions
      ADD CONSTRAINT profile_revisions_status_check CHECK (status IN ('draft', 'active', 'deprecated'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_revisions_version_number_check') THEN
    ALTER TABLE profile_revisions
      ADD CONSTRAINT profile_revisions_version_number_check CHECK (version_number IS NULL OR version_number > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_revisions_created_by_fkey') THEN
    ALTER TABLE template_revisions
      ADD CONSTRAINT template_revisions_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_revisions_restored_from_revision_id_fkey') THEN
    ALTER TABLE template_revisions
      ADD CONSTRAINT template_revisions_restored_from_revision_id_fkey
      FOREIGN KEY (restored_from_revision_id) REFERENCES template_revisions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_revisions_source_check') THEN
    ALTER TABLE template_revisions
      ADD CONSTRAINT template_revisions_source_check CHECK (source IN ('create', 'update', 'restore'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_revisions_status_check') THEN
    ALTER TABLE template_revisions
      ADD CONSTRAINT template_revisions_status_check CHECK (status IN ('draft', 'active', 'deprecated'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_revisions_version_number_check') THEN
    ALTER TABLE template_revisions
      ADD CONSTRAINT template_revisions_version_number_check CHECK (version_number IS NULL OR version_number > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_active_revision_id_fkey') THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_active_revision_id_fkey
      FOREIGN KEY (active_revision_id) REFERENCES profile_revisions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'templates_active_revision_id_fkey') THEN
    ALTER TABLE templates
      ADD CONSTRAINT templates_active_revision_id_fkey
      FOREIGN KEY (active_revision_id) REFERENCES template_revisions(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_revisions_template_id_fkey') THEN
    ALTER TABLE template_revisions
      ADD CONSTRAINT template_revisions_template_id_fkey
      FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_revisions_profile_id_fkey') THEN
    ALTER TABLE profile_revisions
      ADD CONSTRAINT profile_revisions_profile_id_fkey
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

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
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_profile_bindings_student_id_fkey') THEN
    ALTER TABLE student_profile_bindings
      ADD CONSTRAINT student_profile_bindings_student_id_fkey
      FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_profile_bindings_profile_id_fkey') THEN
    ALTER TABLE student_profile_bindings
      ADD CONSTRAINT student_profile_bindings_profile_id_fkey
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_profile_bindings_changed_by_fkey') THEN
    ALTER TABLE student_profile_bindings
      ADD CONSTRAINT student_profile_bindings_changed_by_fkey
      FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'student_profile_bindings_effective_window_check') THEN
    ALTER TABLE student_profile_bindings
      ADD CONSTRAINT student_profile_bindings_effective_window_check
      CHECK (effective_to IS NULL OR effective_to > effective_from);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_source_job_id_fkey') THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_source_job_id_fkey
      FOREIGN KEY (source_job_id) REFERENCES jobs(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_action_history_job_id_fkey') THEN
    ALTER TABLE job_action_history
      ADD CONSTRAINT job_action_history_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_action_history_created_job_id_fkey') THEN
    ALTER TABLE job_action_history
      ADD CONSTRAINT job_action_history_created_job_id_fkey
      FOREIGN KEY (created_job_id) REFERENCES jobs(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_action_history_requested_by_fkey') THEN
    ALTER TABLE job_action_history
      ADD CONSTRAINT job_action_history_requested_by_fkey
      FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
DECLARE
  current_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO current_definition
  FROM pg_constraint
  WHERE conname = 'job_action_history_action_type_check'
  LIMIT 1;

  IF current_definition IS NULL THEN
    ALTER TABLE job_action_history
      ADD CONSTRAINT job_action_history_action_type_check
      CHECK (action_type IN ('rerun_audio', 'rerun_publish', 'cancel', 'edit_metadata'));
  ELSIF position('rerun_publish' in current_definition) = 0 THEN
    ALTER TABLE job_action_history
      DROP CONSTRAINT job_action_history_action_type_check;
    ALTER TABLE job_action_history
      ADD CONSTRAINT job_action_history_action_type_check
      CHECK (action_type IN ('rerun_audio', 'rerun_publish', 'cancel', 'edit_metadata'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_action_history_outcome_check') THEN
    ALTER TABLE job_action_history
      ADD CONSTRAINT job_action_history_outcome_check
      CHECK (outcome IN ('succeeded', 'failed'));
  END IF;
END $$;

-- user_settings / uploaded_files constraints
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploaded_files_storage_provider_check') THEN
    ALTER TABLE uploaded_files
      ADD CONSTRAINT uploaded_files_storage_provider_check
      CHECK (storage_provider IN ('s3', 'minio', 'filesystem'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploaded_files_file_size_check') THEN
    ALTER TABLE uploaded_files
      ADD CONSTRAINT uploaded_files_file_size_check
      CHECK (file_size >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_tts_strategy_check') THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_tts_strategy_check
      CHECK (default_tts_strategy IN ('auto', 'dialogue', 'tts'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_tts_provider_check') THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_tts_provider_check
      CHECK (tts_provider IN ('elevenlabs', 'openai', 'azure', 'google'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uploaded_files_user_id_fkey') THEN
    ALTER TABLE uploaded_files
      ADD CONSTRAINT uploaded_files_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_settings_user_id_fkey') THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

