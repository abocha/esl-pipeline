-- packages/batch-backend/schema.sql
-- GENERATED FILE: refresh with `pnpm --filter @esl-pipeline/batch-backend db:generate-baseline`.
-- Do not hand-edit.
-- Fresh-install baseline generated from the full versioned migration chain.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';

CREATE FUNCTION public.app_current_user_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $_$
  SELECT CASE
    WHEN NULLIF(current_setting('app.user_id', true), '') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN NULLIF(current_setting('app.user_id', true), '')::uuid
    ELSE NULL
  END
$_$;

CREATE FUNCTION public.app_current_user_role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  SELECT NULLIF(current_setting('app.user_role', true), '')
$$;

CREATE FUNCTION public.app_rls_bypass() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  SELECT COALESCE(NULLIF(current_setting('app.rls_bypass', true), ''), 'off') = 'on'
$$;

CREATE FUNCTION public.resolve_jobs_student_id(p_current_student_id uuid, p_recording_id uuid, p_prompt_package_id uuid, p_draft_id uuid, p_source_job_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_student_id UUID;
BEGIN
  IF p_current_student_id IS NOT NULL THEN
    RETURN p_current_student_id;
  END IF;

  IF p_recording_id IS NOT NULL THEN
    SELECT r.student_id
    INTO v_student_id
    FROM recordings r
    WHERE r.id = p_recording_id;

    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;
  END IF;

  IF p_prompt_package_id IS NOT NULL THEN
    SELECT p.student_id
    INTO v_student_id
    FROM prompt_packages p
    WHERE p.id = p_prompt_package_id;

    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;

    SELECT r.student_id
    INTO v_student_id
    FROM prompt_packages p
    LEFT JOIN recordings r ON r.id = p.recording_id
    WHERE p.id = p_prompt_package_id;

    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;
  END IF;

  IF p_draft_id IS NOT NULL THEN
    SELECT COALESCE(d.student_id, p.student_id, r.student_id)
    INTO v_student_id
    FROM drafts d
    LEFT JOIN prompt_packages p ON p.id = d.prompt_package_id
    LEFT JOIN recordings r ON r.id = p.recording_id
    WHERE d.id = p_draft_id;

    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;
  END IF;

  IF p_source_job_id IS NOT NULL THEN
    SELECT j.student_id
    INTO v_student_id
    FROM jobs j
    WHERE j.id = p_source_job_id;

    IF v_student_id IS NOT NULL THEN
      RETURN v_student_id;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE FUNCTION public.set_drafts_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_homework_memory_entries_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_jobs_student_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.student_id IS NULL THEN
      NEW.student_id := resolve_jobs_student_id(
        NULL,
        NEW.recording_id,
        NEW.prompt_package_id,
        NEW.draft_id,
        NEW.source_job_id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF (
    NEW.recording_id IS DISTINCT FROM OLD.recording_id
    OR NEW.prompt_package_id IS DISTINCT FROM OLD.prompt_package_id
    OR NEW.draft_id IS DISTINCT FROM OLD.draft_id
    OR NEW.source_job_id IS DISTINCT FROM OLD.source_job_id
    OR NEW.student_id IS NULL
  ) THEN
    NEW.student_id := resolve_jobs_student_id(
      NULL,
      NEW.recording_id,
      NEW.prompt_package_id,
      NEW.draft_id,
      NEW.source_job_id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_jobs_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_lesson_memory_entries_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_ops_actions_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_profiles_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_prompt_packages_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_recordings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_student_memory_snapshots_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_student_profile_candidates_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_students_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_transcripts_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_uploaded_files_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_user_settings_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_users_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE public.drafts (
    id uuid NOT NULL,
    prompt_package_id uuid NOT NULL,
    student_id uuid,
    storage_uri text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.generation_budget_counters (
    bucket_type text NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    request_count integer DEFAULT 0 NOT NULL,
    reserved_tokens bigint DEFAULT 0 NOT NULL,
    actual_tokens bigint DEFAULT 0 NOT NULL
);

CREATE TABLE public.homework_memory_entries (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    job_id uuid NOT NULL,
    assignment_lineage_key uuid NOT NULL,
    schema_version text NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    status text NOT NULL,
    source_kind text DEFAULT 'published_assignment'::text NOT NULL,
    content_hash text,
    generation_notes jsonb,
    homework_summary text,
    topic text,
    grammar_targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    vocabulary_targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    review_targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    task_list jsonb DEFAULT '[]'::jsonb NOT NULL,
    pronunciation_focus jsonb DEFAULT '[]'::jsonb NOT NULL,
    study_text_type text,
    input_type text,
    communicative_outcome text,
    teacher_follow_up_cues jsonb DEFAULT '[]'::jsonb NOT NULL,
    published_at timestamp with time zone NOT NULL,
    publish_targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    superseded_by_id uuid,
    superseded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    prompt_package_id uuid,
    draft_id uuid,
    recording_id uuid,
    transcript_id uuid,
    CONSTRAINT homework_memory_entries_input_type_check CHECK (((input_type IS NULL) OR (input_type = ANY (ARRAY['generate'::text, 'authentic'::text])))),
    CONSTRAINT homework_memory_entries_source_kind_check CHECK ((source_kind = 'published_assignment'::text)),
    CONSTRAINT homework_memory_entries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text, 'superseded'::text]))),
    CONSTRAINT homework_memory_entries_study_text_type_check CHECK (((study_text_type IS NULL) OR (study_text_type = ANY (ARRAY['monologue'::text, 'dialogue'::text]))))
);

CREATE TABLE public.job_action_history (
    id uuid NOT NULL,
    job_id uuid NOT NULL,
    action_type text NOT NULL,
    payload_json jsonb,
    requested_at timestamp with time zone NOT NULL,
    requested_by uuid,
    outcome text NOT NULL,
    message text NOT NULL,
    error_code text,
    created_job_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT job_action_history_action_type_check CHECK ((action_type = ANY (ARRAY['rerun'::text, 'cancel'::text, 'edit_metadata'::text]))),
    CONSTRAINT job_action_history_outcome_check CHECK ((outcome = ANY (ARRAY['succeeded'::text, 'failed'::text])))
);

CREATE TABLE public.jobs (
    id uuid NOT NULL,
    state text NOT NULL,
    md text,
    md_storage_uri text,
    recording_id uuid,
    transcript_id uuid,
    prompt_package_id uuid,
    draft_id uuid,
    preset text,
    learning_preset_id text,
    learning_preset_version text,
    prompt_snapshot_version text,
    prompt_alias text,
    with_tts boolean,
    upload text,
    voice_id text,
    voice_accent text,
    force_tts boolean,
    notion_database text,
    publish_target text,
    mode text,
    notion_url text,
    anytype_url text,
    html_url text,
    auto_publish boolean DEFAULT false NOT NULL,
    manifest_path text,
    source_job_id uuid,
    transcribe_workdir text,
    transcript_path text,
    prompt_payload text,
    prompt_notes text,
    profile_path text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    error text,
    user_id uuid,
    student_id uuid,
    tts_provider text,
    google_tts_model text,
    study_text_elevenlabs_model text,
    CONSTRAINT jobs_google_tts_model_check CHECK (((google_tts_model IS NULL) OR (google_tts_model = ANY (ARRAY['chirp3_hd'::text, 'studio'::text, 'neural2'::text, 'wavenet'::text])))),
    CONSTRAINT jobs_mode_check CHECK (((mode IS NULL) OR (mode = ANY (ARRAY['auto'::text, 'dialogue'::text, 'tts'::text])))),
    CONSTRAINT jobs_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'awaiting_approval'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT jobs_study_text_elevenlabs_model_check CHECK (((study_text_elevenlabs_model IS NULL) OR (study_text_elevenlabs_model = ANY (ARRAY['eleven_v3'::text, 'eleven_multilingual_v2'::text, 'eleven_flash_v2_5'::text, 'eleven_flash_v2'::text])))),
    CONSTRAINT jobs_tts_provider_check CHECK (((tts_provider IS NULL) OR (tts_provider = ANY (ARRAY['elevenlabs'::text, 'google'::text]))))
);

CREATE TABLE public.lesson_memory_entries (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    transcript_id uuid NOT NULL,
    recording_id uuid NOT NULL,
    schema_version text NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    status text NOT NULL,
    source_kind text DEFAULT 'lesson_transcript'::text NOT NULL,
    generation_notes jsonb,
    lesson_summary text,
    topics_discussed jsonb DEFAULT '[]'::jsonb NOT NULL,
    mistake_patterns jsonb DEFAULT '[]'::jsonb NOT NULL,
    grammar_reviewed jsonb DEFAULT '[]'::jsonb NOT NULL,
    grammar_watchlist jsonb DEFAULT '[]'::jsonb NOT NULL,
    vocabulary_focus jsonb DEFAULT '[]'::jsonb NOT NULL,
    pronunciation_focus jsonb DEFAULT '[]'::jsonb NOT NULL,
    student_facts jsonb DEFAULT '[]'::jsonb NOT NULL,
    progress_signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    follow_up_recommendations jsonb DEFAULT '[]'::jsonb NOT NULL,
    superseded_by_id uuid,
    superseded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lesson_memory_entries_source_kind_check CHECK ((source_kind = 'lesson_transcript'::text)),
    CONSTRAINT lesson_memory_entries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text, 'superseded'::text])))
);

CREATE TABLE public.ops_actions (
    operation_id text NOT NULL,
    action text NOT NULL,
    state text NOT NULL,
    requested_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    requested_by text,
    requested_by_user_id text,
    message text,
    command text NOT NULL,
    exit_code integer,
    stdout_tail text,
    stderr_tail text,
    owner_id text,
    ownership_claimed_at timestamp with time zone,
    ownership_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_actions_action_check CHECK ((action = ANY (ARRAY['backup_upload'::text, 'restore_drill_download_only'::text]))),
    CONSTRAINT ops_actions_finished_at_order_check CHECK (((finished_at IS NULL) OR (finished_at >= requested_at))),
    CONSTRAINT ops_actions_started_at_order_check CHECK (((started_at IS NULL) OR (started_at >= requested_at))),
    CONSTRAINT ops_actions_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text])))
);

CREATE TABLE public.profile_revisions (
    id uuid NOT NULL,
    profile_id text NOT NULL,
    content text NOT NULL,
    content_hash text NOT NULL,
    source text DEFAULT 'update'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    version_label text DEFAULT 'v1'::text NOT NULL,
    activated_at timestamp with time zone,
    deprecated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    restored_from_revision_id uuid,
    structured_content jsonb,
    CONSTRAINT profile_revisions_source_check CHECK ((source = ANY (ARRAY['create'::text, 'update'::text, 'restore'::text, 'starter_profile_form'::text, 'candidate_promotion'::text, 'legacy_normalization'::text, 'lesson_population'::text]))),
    CONSTRAINT profile_revisions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'deprecated'::text]))),
    CONSTRAINT profile_revisions_version_number_check CHECK (((version_number IS NULL) OR (version_number > 0)))
);

CREATE TABLE public.profiles (
    id text NOT NULL,
    label text NOT NULL,
    active_revision_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.prompt_packages (
    id uuid NOT NULL,
    recording_id uuid NOT NULL,
    transcript_id uuid NOT NULL,
    student_id uuid,
    profile_path text,
    resolved_profile_id text,
    resolved_profile_hash text,
    resolved_profile_revision_id uuid,
    resolved_profile_updated_at timestamp with time zone,
    resolved_profile_version_label text,
    resolved_profile_status text,
    resolved_template_id text,
    resolved_template_hash text,
    resolved_template_revision_id uuid,
    resolved_template_updated_at timestamp with time zone,
    resolved_template_version_label text,
    resolved_template_status text,
    resolved_voice_capabilities_hash text,
    resolved_voice_capabilities_generated_at timestamp with time zone,
    resolved_voice_capabilities_snapshot jsonb,
    template_version text NOT NULL,
    notes text,
    storage_uri text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    student_memory_snapshot_id uuid,
    student_memory_snapshot_hash text,
    selected_lesson_memory_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    selected_homework_memory_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    retrieval_policy_version text
);

CREATE TABLE public.recordings (
    id uuid NOT NULL,
    source text NOT NULL,
    student_id uuid,
    source_path text,
    storage_uri text NOT NULL,
    sha256 text,
    bytes bigint NOT NULL,
    duration_sec integer,
    channels integer,
    status text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recordings_source_check CHECK ((source = 'upload'::text)),
    CONSTRAINT recordings_status_check CHECK ((status = ANY (ARRAY['ingested'::text, 'queued'::text, 'transcribing'::text, 'transcribed'::text, 'failed'::text])))
);

CREATE TABLE public.schema_migrations (
    id text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    execution_ms integer NOT NULL,
    tool_version text NOT NULL
);

CREATE TABLE public.student_memory_snapshots (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    schema_version text NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    status text NOT NULL,
    source_kind text DEFAULT 'student_memory_rollup'::text NOT NULL,
    lesson_memory_entry_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    homework_memory_entry_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    content_hash text,
    generation_notes jsonb,
    stable_strengths jsonb DEFAULT '[]'::jsonb NOT NULL,
    recurring_issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    active_review_backlog jsonb DEFAULT '[]'::jsonb NOT NULL,
    recent_progress jsonb DEFAULT '[]'::jsonb NOT NULL,
    personal_facts jsonb DEFAULT '[]'::jsonb NOT NULL,
    recommended_assignment_directions jsonb DEFAULT '[]'::jsonb CONSTRAINT student_memory_snapshots_recommended_assignment_direct_not_null NOT NULL,
    unresolved_issues jsonb DEFAULT '[]'::jsonb NOT NULL,
    snapshot_summary text,
    superseded_by_id uuid,
    superseded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_memory_snapshots_source_kind_check CHECK ((source_kind = 'student_memory_rollup'::text)),
    CONSTRAINT student_memory_snapshots_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text, 'superseded'::text])))
);

CREATE TABLE public.student_profile_bindings (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    profile_id text NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    effective_to timestamp with time zone,
    reason text,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_profile_bindings_effective_window_check CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))
);

CREATE TABLE public.student_profile_candidate_draft_revisions (
    candidate_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.student_profile_candidates (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    target_section text NOT NULL,
    candidate_key text NOT NULL,
    fact text NOT NULL,
    approved_fact text,
    category text NOT NULL,
    authority text NOT NULL,
    confidence text NOT NULL,
    review_needed boolean DEFAULT true NOT NULL,
    source_snapshot_id uuid,
    source_lesson_memory_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'pending_review'::text NOT NULL,
    review_state text DEFAULT 'unreviewed'::text NOT NULL,
    reviewer_id uuid,
    reviewer_note text,
    reviewed_at timestamp with time zone,
    promoted_revision_id uuid,
    promoted_at timestamp with time zone,
    superseded_by_id uuid,
    superseded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_profile_candidates_authority_check CHECK ((authority = ANY (ARRAY['teacher_confirmed'::text, 'student_stated'::text, 'model_inferred'::text]))),
    CONSTRAINT student_profile_candidates_confidence_check CHECK ((confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT student_profile_candidates_review_state_check CHECK ((review_state = ANY (ARRAY['unreviewed'::text, 'deferred'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT student_profile_candidates_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text, 'promoted'::text, 'superseded'::text]))),
    CONSTRAINT student_profile_candidates_target_section_check CHECK ((target_section = ANY (ARRAY['goals_motivation'::text, 'work_communication_context'::text, 'interests_personal_context'::text, 'learning_preferences_study_habits'::text, 'long_running_strengths'::text, 'persistent_challenges_constraints'::text])))
);

CREATE TABLE public.students (
    id uuid NOT NULL,
    student text NOT NULL,
    db_id text,
    page_parent_id text,
    color_preset text,
    voices jsonb DEFAULT '{}'::jsonb NOT NULL,
    manifest_preset text,
    accent_preference text,
    profile_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.template_revisions (
    id uuid NOT NULL,
    template_id text NOT NULL,
    content text NOT NULL,
    content_hash text NOT NULL,
    source text DEFAULT 'update'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    version_number integer DEFAULT 1 NOT NULL,
    version_label text DEFAULT 'v1'::text NOT NULL,
    activated_at timestamp with time zone,
    deprecated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    restored_from_revision_id uuid,
    CONSTRAINT template_revisions_source_check CHECK ((source = ANY (ARRAY['create'::text, 'update'::text, 'restore'::text]))),
    CONSTRAINT template_revisions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'deprecated'::text]))),
    CONSTRAINT template_revisions_version_number_check CHECK (((version_number IS NULL) OR (version_number > 0)))
);

CREATE TABLE public.templates (
    id text NOT NULL,
    label text NOT NULL,
    active_revision_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.transcripts (
    id uuid NOT NULL,
    recording_id uuid NOT NULL,
    storage_uri text NOT NULL,
    raw_response_uri text,
    mode text DEFAULT 'timeline'::text NOT NULL,
    model text DEFAULT 'nova-3'::text NOT NULL,
    language text DEFAULT 'multi'::text NOT NULL,
    fallback_used boolean DEFAULT false NOT NULL,
    summary_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stt_provider text DEFAULT 'deepgram'::text NOT NULL,
    CONSTRAINT transcripts_mode_check CHECK ((mode = ANY (ARRAY['timeline'::text, 'stack'::text]))),
    CONSTRAINT transcripts_stt_provider_check CHECK ((stt_provider = ANY (ARRAY['deepgram'::text, 'elevenlabs'::text, 'google'::text])))
);

CREATE TABLE public.uploaded_files (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    storage_key text NOT NULL,
    original_filename text NOT NULL,
    sanitized_filename text,
    file_size bigint NOT NULL,
    mime_type text NOT NULL,
    storage_provider text DEFAULT 'filesystem'::text NOT NULL,
    s3_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uploaded_files_file_size_check CHECK ((file_size >= 0)),
    CONSTRAINT uploaded_files_storage_provider_check CHECK ((storage_provider = ANY (ARRAY['s3'::text, 'minio'::text, 'filesystem'::text])))
);

CREATE TABLE public.user_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    elevenlabs_key_encrypted text,
    notion_token_encrypted text,
    tts_provider text DEFAULT 'elevenlabs'::text NOT NULL,
    default_preset text DEFAULT 'b1-default'::text NOT NULL,
    default_voice_accent text DEFAULT 'american'::text NOT NULL,
    default_tts_strategy text DEFAULT 'auto'::text NOT NULL,
    enable_notifications boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_settings_tts_provider_check CHECK ((tts_provider = ANY (ARRAY['elevenlabs'::text, 'google'::text]))),
    CONSTRAINT user_settings_tts_strategy_check CHECK ((default_tts_strategy = ANY (ARRAY['auto'::text, 'dialogue'::text, 'tts'::text])))
);

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'user'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    CONSTRAINT users_email_check CHECK ((email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text)),
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'user'::text, 'viewer'::text])))
);

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.generation_budget_counters
    ADD CONSTRAINT generation_budget_counters_pkey PRIMARY KEY (bucket_type, bucket_start, provider, model);

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.job_action_history
    ADD CONSTRAINT job_action_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lesson_memory_entries
    ADD CONSTRAINT lesson_memory_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ops_actions
    ADD CONSTRAINT ops_actions_pkey PRIMARY KEY (operation_id);

ALTER TABLE ONLY public.profile_revisions
    ADD CONSTRAINT profile_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompt_packages
    ADD CONSTRAINT prompt_packages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.recordings
    ADD CONSTRAINT recordings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_memory_snapshots
    ADD CONSTRAINT student_memory_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_profile_bindings
    ADD CONSTRAINT student_profile_bindings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_profile_candidate_draft_revisions
    ADD CONSTRAINT student_profile_candidate_draft_revisions_pkey PRIMARY KEY (candidate_id, revision_id);

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.template_revisions
    ADD CONSTRAINT template_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transcripts
    ADD CONSTRAINT transcripts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_user_id_storage_key_key UNIQUE (user_id, storage_key);

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

CREATE INDEX idx_drafts_created_by ON public.drafts USING btree (created_by);

CREATE INDEX idx_drafts_prompt_package_id ON public.drafts USING btree (prompt_package_id);

CREATE INDEX idx_drafts_student_id ON public.drafts USING btree (student_id);

CREATE INDEX idx_generation_budget_counters_bucket_start ON public.generation_budget_counters USING btree (bucket_start);

CREATE INDEX idx_generation_budget_counters_provider_model ON public.generation_budget_counters USING btree (provider, model);

CREATE INDEX idx_homework_memory_entries_job_generated_at ON public.homework_memory_entries USING btree (job_id, generated_at DESC, id DESC);

CREATE INDEX idx_homework_memory_entries_lineage_generated_at ON public.homework_memory_entries USING btree (assignment_lineage_key, generated_at DESC, id DESC);

CREATE INDEX idx_homework_memory_entries_lineage_ready_lookup ON public.homework_memory_entries USING btree (assignment_lineage_key, generated_at DESC, id DESC) WHERE (status = 'ready'::text);

CREATE INDEX idx_homework_memory_entries_status_generated_at ON public.homework_memory_entries USING btree (status, generated_at DESC, id DESC);

CREATE INDEX idx_homework_memory_entries_student_generated_at ON public.homework_memory_entries USING btree (student_id, generated_at DESC, id DESC);

CREATE INDEX idx_homework_memory_entries_student_ready_generated_at ON public.homework_memory_entries USING btree (student_id, generated_at DESC, created_at DESC, id DESC) WHERE (status = 'ready'::text);

CREATE INDEX idx_job_action_history_action_type ON public.job_action_history USING btree (action_type);

CREATE INDEX idx_job_action_history_created_job_id ON public.job_action_history USING btree (created_job_id);

CREATE INDEX idx_job_action_history_job_id_requested_at ON public.job_action_history USING btree (job_id, requested_at DESC);

CREATE INDEX idx_jobs_created_at ON public.jobs USING btree (created_at);

CREATE INDEX idx_jobs_created_at_id ON public.jobs USING btree (created_at DESC, id DESC);

CREATE INDEX idx_jobs_draft_id ON public.jobs USING btree (draft_id);

CREATE INDEX idx_jobs_prompt_package_id ON public.jobs USING btree (prompt_package_id);

CREATE INDEX idx_jobs_publish_target_state_created_at ON public.jobs USING btree (publish_target, state, created_at DESC);

CREATE INDEX idx_jobs_recording_id ON public.jobs USING btree (recording_id);

CREATE INDEX idx_jobs_source_job_id ON public.jobs USING btree (source_job_id);

CREATE INDEX idx_jobs_state ON public.jobs USING btree (state);

CREATE INDEX idx_jobs_state_created_at ON public.jobs USING btree (state, created_at);

CREATE INDEX idx_jobs_student_created_at_id ON public.jobs USING btree (student_id, created_at DESC, id DESC);

CREATE INDEX idx_jobs_transcript_id ON public.jobs USING btree (transcript_id);

CREATE INDEX idx_jobs_user_created_at_id ON public.jobs USING btree (user_id, created_at DESC, id DESC);

CREATE INDEX idx_jobs_user_id ON public.jobs USING btree (user_id);

CREATE INDEX idx_lesson_memory_entries_recording_generated_at ON public.lesson_memory_entries USING btree (recording_id, generated_at DESC, id DESC);

CREATE INDEX idx_lesson_memory_entries_status_generated_at ON public.lesson_memory_entries USING btree (status, generated_at DESC, id DESC);

CREATE INDEX idx_lesson_memory_entries_student_generated_at ON public.lesson_memory_entries USING btree (student_id, generated_at DESC, id DESC);

CREATE INDEX idx_lesson_memory_entries_student_ready_generated_at ON public.lesson_memory_entries USING btree (student_id, generated_at DESC, created_at DESC, id DESC) WHERE (status = 'ready'::text);

CREATE INDEX idx_lesson_memory_entries_transcript_generated_at ON public.lesson_memory_entries USING btree (transcript_id, generated_at DESC, id DESC);

CREATE INDEX idx_lesson_memory_entries_transcript_ready_lookup ON public.lesson_memory_entries USING btree (transcript_id, generated_at DESC, id DESC) WHERE (status = 'ready'::text);

CREATE INDEX idx_ops_actions_operation_id_lookup ON public.ops_actions USING btree (operation_id);

CREATE INDEX idx_ops_actions_retention_scan ON public.ops_actions USING btree (finished_at) WHERE (finished_at IS NOT NULL);

CREATE INDEX idx_ops_actions_state_finished_at ON public.ops_actions USING btree (state, finished_at);

CREATE INDEX idx_profile_revisions_profile_id_created_at ON public.profile_revisions USING btree (profile_id, created_at DESC);

CREATE INDEX idx_profile_revisions_profile_id_hash ON public.profile_revisions USING btree (profile_id, content_hash);

CREATE UNIQUE INDEX idx_profile_revisions_profile_version ON public.profile_revisions USING btree (profile_id, version_number);

CREATE UNIQUE INDEX idx_profile_revisions_single_active ON public.profile_revisions USING btree (profile_id) WHERE (status = 'active'::text);

CREATE INDEX idx_profiles_active_revision_id ON public.profiles USING btree (active_revision_id);

CREATE INDEX idx_profiles_label ON public.profiles USING btree (label);

CREATE INDEX idx_prompt_packages_recording_id ON public.prompt_packages USING btree (recording_id);

CREATE INDEX idx_prompt_packages_resolved_profile_id ON public.prompt_packages USING btree (resolved_profile_id);

CREATE INDEX idx_prompt_packages_resolved_template_id ON public.prompt_packages USING btree (resolved_template_id);

CREATE INDEX idx_prompt_packages_student_id ON public.prompt_packages USING btree (student_id);

CREATE INDEX idx_prompt_packages_student_memory_snapshot_id ON public.prompt_packages USING btree (student_memory_snapshot_id);

CREATE INDEX idx_prompt_packages_transcript_id ON public.prompt_packages USING btree (transcript_id);

CREATE INDEX idx_recordings_created_at ON public.recordings USING btree (created_at);

CREATE INDEX idx_recordings_source ON public.recordings USING btree (source);

CREATE INDEX idx_recordings_status ON public.recordings USING btree (status);

CREATE INDEX idx_recordings_student_id ON public.recordings USING btree (student_id);

CREATE INDEX idx_schema_migrations_applied_at ON public.schema_migrations USING btree (applied_at DESC);

CREATE INDEX idx_student_memory_snapshots_status_generated_at ON public.student_memory_snapshots USING btree (status, generated_at DESC, id DESC);

CREATE INDEX idx_student_memory_snapshots_student_generated_at ON public.student_memory_snapshots USING btree (student_id, generated_at DESC, id DESC);

CREATE INDEX idx_student_memory_snapshots_student_ready_lookup ON public.student_memory_snapshots USING btree (student_id, generated_at DESC, id DESC) WHERE (status = 'ready'::text);

CREATE INDEX idx_student_profile_bindings_effective_from ON public.student_profile_bindings USING btree (effective_from DESC);

CREATE INDEX idx_student_profile_bindings_profile_id ON public.student_profile_bindings USING btree (profile_id);

CREATE UNIQUE INDEX idx_student_profile_bindings_single_active ON public.student_profile_bindings USING btree (student_id) WHERE (effective_to IS NULL);

CREATE INDEX idx_student_profile_bindings_student_id ON public.student_profile_bindings USING btree (student_id);

CREATE INDEX idx_student_profile_candidate_draft_revisions_revision ON public.student_profile_candidate_draft_revisions USING btree (revision_id, candidate_id);

CREATE INDEX idx_student_profile_candidates_student_candidate_key ON public.student_profile_candidates USING btree (student_id, candidate_key, created_at DESC, id DESC);

CREATE INDEX idx_student_profile_candidates_student_created_at ON public.student_profile_candidates USING btree (student_id, created_at DESC, id DESC);

CREATE INDEX idx_student_profile_candidates_student_review_state_created_at ON public.student_profile_candidates USING btree (student_id, review_state, created_at DESC, id DESC);

CREATE INDEX idx_student_profile_candidates_student_status_created_at ON public.student_profile_candidates USING btree (student_id, status, created_at DESC, id DESC);

CREATE INDEX idx_student_profile_candidates_student_status_review_created_at ON public.student_profile_candidates USING btree (student_id, status, review_state, created_at DESC, id DESC);

CREATE INDEX idx_students_created_at ON public.students USING btree (created_at);

CREATE INDEX idx_students_profile_id ON public.students USING btree (profile_id);

CREATE UNIQUE INDEX idx_students_student_lower_unique ON public.students USING btree (lower(student));

CREATE UNIQUE INDEX idx_template_revisions_single_active ON public.template_revisions USING btree (template_id) WHERE (status = 'active'::text);

CREATE INDEX idx_template_revisions_template_id_created_at ON public.template_revisions USING btree (template_id, created_at DESC);

CREATE INDEX idx_template_revisions_template_id_hash ON public.template_revisions USING btree (template_id, content_hash);

CREATE UNIQUE INDEX idx_template_revisions_template_version ON public.template_revisions USING btree (template_id, version_number);

CREATE INDEX idx_templates_active_revision_id ON public.templates USING btree (active_revision_id);

CREATE INDEX idx_templates_label ON public.templates USING btree (label);

CREATE INDEX idx_transcripts_recording_id ON public.transcripts USING btree (recording_id);

CREATE INDEX idx_uploaded_files_created_at ON public.uploaded_files USING btree (created_at);

CREATE INDEX idx_uploaded_files_storage_key ON public.uploaded_files USING btree (storage_key);

CREATE INDEX idx_uploaded_files_storage_provider ON public.uploaded_files USING btree (storage_provider);

CREATE INDEX idx_uploaded_files_user_id ON public.uploaded_files USING btree (user_id);

CREATE INDEX idx_user_settings_user_id ON public.user_settings USING btree (user_id);

CREATE INDEX idx_users_email ON public.users USING btree (email);

CREATE INDEX idx_users_role ON public.users USING btree (role);

CREATE TRIGGER set_drafts_updated_at BEFORE UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.set_drafts_updated_at();

CREATE TRIGGER set_homework_memory_entries_updated_at BEFORE UPDATE ON public.homework_memory_entries FOR EACH ROW EXECUTE FUNCTION public.set_homework_memory_entries_updated_at();

CREATE TRIGGER set_jobs_student_id BEFORE INSERT OR UPDATE OF recording_id, prompt_package_id, draft_id, source_job_id, student_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_jobs_student_id();

CREATE TRIGGER set_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_jobs_updated_at();

CREATE TRIGGER set_lesson_memory_entries_updated_at BEFORE UPDATE ON public.lesson_memory_entries FOR EACH ROW EXECUTE FUNCTION public.set_lesson_memory_entries_updated_at();

CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_profiles_updated_at();

CREATE TRIGGER set_prompt_packages_updated_at BEFORE UPDATE ON public.prompt_packages FOR EACH ROW EXECUTE FUNCTION public.set_prompt_packages_updated_at();

CREATE TRIGGER set_recordings_updated_at BEFORE UPDATE ON public.recordings FOR EACH ROW EXECUTE FUNCTION public.set_recordings_updated_at();

CREATE TRIGGER set_student_memory_snapshots_updated_at BEFORE UPDATE ON public.student_memory_snapshots FOR EACH ROW EXECUTE FUNCTION public.set_student_memory_snapshots_updated_at();

CREATE TRIGGER set_student_profile_candidates_updated_at BEFORE UPDATE ON public.student_profile_candidates FOR EACH ROW EXECUTE FUNCTION public.set_student_profile_candidates_updated_at();

CREATE TRIGGER set_students_updated_at BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.set_students_updated_at();

CREATE TRIGGER set_transcripts_updated_at BEFORE UPDATE ON public.transcripts FOR EACH ROW EXECUTE FUNCTION public.set_transcripts_updated_at();

CREATE TRIGGER set_uploaded_files_updated_at BEFORE UPDATE ON public.uploaded_files FOR EACH ROW EXECUTE FUNCTION public.set_uploaded_files_updated_at();

CREATE TRIGGER set_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.set_user_settings_updated_at();

CREATE TRIGGER set_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_users_updated_at();

CREATE TRIGGER trg_set_ops_actions_updated_at BEFORE UPDATE ON public.ops_actions FOR EACH ROW EXECUTE FUNCTION public.set_ops_actions_updated_at();

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_prompt_package_id_fkey FOREIGN KEY (prompt_package_id) REFERENCES public.prompt_packages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_assignment_lineage_key_fkey FOREIGN KEY (assignment_lineage_key) REFERENCES public.jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.drafts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_prompt_package_id_fkey FOREIGN KEY (prompt_package_id) REFERENCES public.prompt_packages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES public.recordings(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.homework_memory_entries(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES public.transcripts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.job_action_history
    ADD CONSTRAINT job_action_history_created_job_id_fkey FOREIGN KEY (created_job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.job_action_history
    ADD CONSTRAINT job_action_history_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.job_action_history
    ADD CONSTRAINT job_action_history_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_source_job_id_fkey FOREIGN KEY (source_job_id) REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.lesson_memory_entries
    ADD CONSTRAINT lesson_memory_entries_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES public.recordings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lesson_memory_entries
    ADD CONSTRAINT lesson_memory_entries_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lesson_memory_entries
    ADD CONSTRAINT lesson_memory_entries_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.lesson_memory_entries(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.lesson_memory_entries
    ADD CONSTRAINT lesson_memory_entries_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES public.transcripts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profile_revisions
    ADD CONSTRAINT profile_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.profile_revisions
    ADD CONSTRAINT profile_revisions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profile_revisions
    ADD CONSTRAINT profile_revisions_restored_from_revision_id_fkey FOREIGN KEY (restored_from_revision_id) REFERENCES public.profile_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_active_revision_id_fkey FOREIGN KEY (active_revision_id) REFERENCES public.profile_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prompt_packages
    ADD CONSTRAINT prompt_packages_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES public.recordings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_packages
    ADD CONSTRAINT prompt_packages_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES public.transcripts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_memory_snapshots
    ADD CONSTRAINT student_memory_snapshots_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_memory_snapshots
    ADD CONSTRAINT student_memory_snapshots_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.student_memory_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_bindings
    ADD CONSTRAINT student_profile_bindings_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_bindings
    ADD CONSTRAINT student_profile_bindings_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.student_profile_bindings
    ADD CONSTRAINT student_profile_bindings_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_profile_candidate_draft_revisions
    ADD CONSTRAINT student_profile_candidate_draft_revisions_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.student_profile_candidates(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_profile_candidate_draft_revisions
    ADD CONSTRAINT student_profile_candidate_draft_revisions_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.profile_revisions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_promoted_revision_id_fkey FOREIGN KEY (promoted_revision_id) REFERENCES public.profile_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES public.student_memory_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.student_profile_candidates(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.template_revisions
    ADD CONSTRAINT template_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.template_revisions
    ADD CONSTRAINT template_revisions_restored_from_revision_id_fkey FOREIGN KEY (restored_from_revision_id) REFERENCES public.template_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.template_revisions
    ADD CONSTRAINT template_revisions_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.templates(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_active_revision_id_fkey FOREIGN KEY (active_revision_id) REFERENCES public.template_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.transcripts
    ADD CONSTRAINT transcripts_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES public.recordings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE POLICY jobs_user_scope_policy ON public.jobs USING ((public.app_rls_bypass() OR (user_id = public.app_current_user_id()))) WITH CHECK ((public.app_rls_bypass() OR (user_id = public.app_current_user_id())));

CREATE POLICY uploaded_files_user_scope_policy ON public.uploaded_files USING ((public.app_rls_bypass() OR (user_id = public.app_current_user_id()))) WITH CHECK ((public.app_rls_bypass() OR (user_id = public.app_current_user_id())));

CREATE POLICY user_settings_user_scope_policy ON public.user_settings USING ((public.app_rls_bypass() OR (user_id = public.app_current_user_id()))) WITH CHECK ((public.app_rls_bypass() OR (user_id = public.app_current_user_id())));

CREATE POLICY users_self_access_policy ON public.users USING ((public.app_rls_bypass() OR (id = public.app_current_user_id()))) WITH CHECK ((public.app_rls_bypass() OR (id = public.app_current_user_id())));

-- Optional pg_trgm support retained from migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      CREATE EXTENSION pg_trgm;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping pg_trgm extension creation because privileges are insufficient.';
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_recordings_source_path_trgm'
    ) THEN
      CREATE INDEX idx_recordings_source_path_trgm
        ON recordings USING gin (source_path gin_trgm_ops);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_recordings_storage_uri_trgm'
    ) THEN
      CREATE INDEX idx_recordings_storage_uri_trgm
        ON recordings USING gin (storage_uri gin_trgm_ops);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_recordings_id_trgm'
    ) THEN
      CREATE INDEX idx_recordings_id_trgm
        ON recordings USING gin ((id::text) gin_trgm_ops);
    END IF;
  END IF;
END $$;

-- Seed migration ledger so fresh baseline installs report a clean migration state.
INSERT INTO public.schema_migrations (id, checksum, applied_at, execution_ms, tool_version)
VALUES
  ('0001_migration_control_plane', '00797332cf6b21ee6d8482d3f492cd6b70718b831f1e3b528e3a9fa7cd222fae', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0002_core_schema_superset', 'b18910f3ccea7981c704d281f9bf9f17e76c6053abaceabe092eb96fb8fac96f', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0003_revision_lifecycle_and_backfill', '4635f5f3a7b986c15f84dda45c01f416d1c1f906dcc47e9c2994506fd174fbdf', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0004_constraints_unification', '3b099a40ac673860cacf4a40190f56bec78105e11929d8d4507e0fe80c0bb92a', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0005_indexes_and_triggers_unification', '93aa6b0748cf4d42617925411abaf22666315399a3e294962a280e7f64ef8776', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0006_jobs_student_denorm_and_indexes', 'acc6f2b0c095a9350e922e1ecdc45d92390a584170c97f10e40ad974f58f3fb6', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0007_rls_readiness_artifacts', 'c8282df66240b0dd4ca531795d617490e9acf8ad659778f5f2d333c7eef22109', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0008_jobs_tts_provider_and_google_model', '0d01c5424779781a2492ff20e7fba984850ec77097c6c446822ac2b6826b7bc9', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0009_user_settings_tts_provider_canonicalization', '4ed64ed968c6a4adf8d69ce58c5b3ef5752e884d50ee03b6d1a27e1120f987bf', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0010_transcripts_stt_provider', '81a643146264c8e0f6b7470d90dfe2d0a2aa1ce1af3afcc5990584f37ea7983a', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0011_ops_actions_durability', '2c9779fc13d3476393d991926fa78f136295dadba2aae24e693165b80cae9baa', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0012_student_memory_lesson_memory_foundations', '237991cd85a84e04f1fdee057ab5577287583b2fed6f346ba013d7ae10797b66', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0013_student_memory_snapshot_foundations', '3e7baad4e6947336bce540f4eab4189050946ab58480fbc2139107dc7c418168', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0014_homework_memory_foundations', '47487cd13a73f3c695b737226f8c7dbd4ff2c2723f7f76423838aa04edc427ba', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0015_homework_memory_contract_alignment', '14bc78443078281e46f0b7375c50a89f230bbdcb231d3777e23d7ee5e2db6f23', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0016_student_profile_candidates_foundations', '70160d75099b260ddd842f0a1a5c6f1e864bd405e136a37e2163a98066e991f9', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0017_student_profile_candidate_draft_revisions', 'f731fe61af5c9e0b43cf4effc9ca897602f5f83ab8a3cabb6852e3d1a36acab1', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0018_profile_revision_source_expansion', 'cc12fb7fd63205e5dee24c04ba10342b8d9016f057786955d3912d0a2ef606bf', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0019_job_action_rerun_unification', '51d0adb87f2327b9b638404ed18765c1e5271eefc57463c1352852031c9d634c', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0020_jobs_lifecycle_timestamps_backfill', '17acde111d3c46287ee8d819bd2814d4ae4b706bcfd5c1d0fd9a131658599e82', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0021_jobs_publish_study_text_elevenlabs_model', '3f927aa802ae8d49a78556a53c276d28b40fb847e1d86f6faf69adf8c18b6aaf', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0022_profile_revision_structured_content', 'a4153ae99387ea7b9d11ef8750f0899ab8ff7f294fc9c6d1a3749defb89bbde6', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0023_profile_revision_lesson_population_source', '8fcba883ef201a06fc88025b41e8a5141c10d824cd5706a1d7fa91a2d462050c', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0024_student_surface_read_path_indexes', '6c35b4e0f01bfb0f9de0c8161618dfbfdd5904b6eba76f4dae1e34d386576ec6', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1')
ON CONFLICT (id) DO NOTHING;
