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

CREATE FUNCTION public.set_student_memory_openai_batch_claims_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_student_memory_openai_batch_items_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.set_student_memory_openai_batch_runs_updated_at() RETURNS trigger
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

CREATE TABLE public.alpha_invites (
    id uuid NOT NULL,
    email text NOT NULL,
    email_normalized text NOT NULL,
    token_hash text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    invited_by_user_id uuid,
    accepted_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT alpha_invites_email_normalized_check CHECK ((email_normalized = lower(btrim(email_normalized)))),
    CONSTRAINT alpha_invites_expiration_check CHECK ((expires_at > created_at)),
    CONSTRAINT alpha_invites_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'expired'::text])))
);

CREATE TABLE public.assignment_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    student_id uuid NOT NULL,
    recording_id uuid,
    transcript_id uuid,
    prompt_package_id uuid,
    draft_id uuid,
    publish_target text,
    selected_tts_provider text,
    selected_tts_strategy text,
    selected_tts_model text,
    selected_preset text,
    selected_generation_provider text,
    selected_generation_model text,
    teacher_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lesson_id uuid,
    revision integer DEFAULT 1 NOT NULL,
    confirmed_step text NOT NULL,
    confirmed_snapshot jsonb NOT NULL,
    creation_request_id text,
    selected_profile_id text,
    selected_profile_revision_id uuid,
    selected_profile_revision_hash text,
    share_job_id uuid,
    CONSTRAINT assignment_sessions_completed_share_job_check CHECK (((confirmed_step <> 'share'::text) OR (share_job_id IS NOT NULL))),
    CONSTRAINT assignment_sessions_confirmed_snapshot_check CHECK (((jsonb_typeof(confirmed_snapshot) = 'object'::text) AND (confirmed_snapshot ?& ARRAY['student'::text, 'source'::text, 'context'::text, 'create'::text]) AND (jsonb_typeof((confirmed_snapshot -> 'student'::text)) = 'object'::text) AND (NULLIF((confirmed_snapshot #>> '{student,studentId}'::text[]), ''::text) IS NOT NULL) AND (((confirmed_snapshot #>> '{student,studentId}'::text[]))::uuid = student_id) AND (((confirmed_snapshot -> 'source'::text) = 'null'::jsonb) OR (jsonb_typeof((confirmed_snapshot -> 'source'::text)) = 'object'::text)) AND (((confirmed_snapshot -> 'context'::text) = 'null'::jsonb) OR (jsonb_typeof((confirmed_snapshot -> 'context'::text)) = 'object'::text)) AND (((confirmed_snapshot -> 'create'::text) = 'null'::jsonb) OR (jsonb_typeof((confirmed_snapshot -> 'create'::text)) = 'object'::text)))),
    CONSTRAINT assignment_sessions_confirmed_step_check CHECK ((confirmed_step = ANY (ARRAY['student'::text, 'source'::text, 'context'::text, 'create'::text, 'share'::text]))),
    CONSTRAINT assignment_sessions_creation_request_id_check CHECK (((creation_request_id IS NULL) OR (btrim(creation_request_id) <> ''::text))),
    CONSTRAINT assignment_sessions_generation_provider_check CHECK (((selected_generation_provider IS NULL) OR (selected_generation_provider = ANY (ARRAY['openai'::text, 'google_ai_studio'::text, 'openrouter'::text])))),
    CONSTRAINT assignment_sessions_publish_target_check CHECK (((publish_target IS NULL) OR (publish_target = 'html'::text))),
    CONSTRAINT assignment_sessions_revision_check CHECK ((revision > 0)),
    CONSTRAINT assignment_sessions_selected_profile_revision_hash_check CHECK (((selected_profile_revision_hash IS NULL) OR (selected_profile_revision_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT assignment_sessions_tts_provider_check CHECK (((selected_tts_provider IS NULL) OR (selected_tts_provider = ANY (ARRAY['elevenlabs'::text, 'google'::text, 'inworld'::text])))),
    CONSTRAINT assignment_sessions_tts_strategy_check CHECK (((selected_tts_strategy IS NULL) OR (selected_tts_strategy = ANY (ARRAY['auto'::text, 'dialogue'::text, 'tts'::text]))))
);

CREATE TABLE public.drafts (
    id uuid NOT NULL,
    prompt_package_id uuid NOT NULL,
    student_id uuid,
    storage_uri text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lesson_id uuid,
    working_version integer NOT NULL,
    content_hash text NOT NULL,
    CONSTRAINT drafts_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT drafts_working_version_check CHECK ((working_version > 0))
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
    lesson_id uuid,
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
    lesson_id uuid,
    tts_model text,
    publication_sequence bigint DEFAULT 0 NOT NULL,
    published_content_hash text,
    CONSTRAINT jobs_mode_check CHECK (((mode IS NULL) OR (mode = ANY (ARRAY['auto'::text, 'dialogue'::text, 'monologue'::text, 'tts'::text])))),
    CONSTRAINT jobs_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'awaiting_approval'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT jobs_tts_model_check CHECK (((tts_model IS NULL) OR ((tts_provider = 'elevenlabs'::text) AND (tts_model = ANY (ARRAY['eleven_v3'::text, 'eleven_multilingual_v2'::text, 'eleven_flash_v2_5'::text, 'eleven_flash_v2'::text]))) OR ((tts_provider = 'google'::text) AND (tts_model = ANY (ARRAY['chirp3_hd'::text, 'studio'::text, 'neural2'::text, 'wavenet'::text]))) OR ((tts_provider = 'inworld'::text) AND (tts_model = ANY (ARRAY['inworld-tts-2'::text, 'inworld-tts-1.5-max'::text, 'inworld-tts-1.5-mini'::text]))))),
    CONSTRAINT jobs_tts_provider_check CHECK (((tts_provider IS NULL) OR (tts_provider = ANY (ARRAY['elevenlabs'::text, 'google'::text, 'inworld'::text]))))
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
    lesson_title text,
    source_storage_uri text,
    source_content_hash text,
    CONSTRAINT lesson_memory_entries_confirmed_source_pair_check CHECK ((((source_storage_uri IS NULL) AND (source_content_hash IS NULL)) OR ((source_storage_uri IS NOT NULL) AND (source_content_hash IS NOT NULL) AND (NULLIF(btrim(source_storage_uri), ''::text) IS NOT NULL) AND (source_content_hash ~ '^[0-9a-f]{64}$'::text)))),
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
    CONSTRAINT profile_revisions_source_check CHECK ((source = ANY (ARRAY['create'::text, 'update'::text, 'restore'::text, 'starter_profile_form'::text, 'candidate_promotion'::text, 'legacy_normalization'::text, 'lesson_population'::text, 'profile_revision_refresh'::text]))),
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
    template_version text NOT NULL,
    notes text,
    storage_uri text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    student_memory_snapshot_id uuid,
    student_memory_snapshot_hash text,
    selected_lesson_memory_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    selected_homework_memory_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    retrieval_policy_version text,
    lesson_id uuid,
    request_envelope jsonb
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
    audio_topology text,
    CONSTRAINT recordings_audio_topology_check CHECK ((audio_topology = ANY (ARRAY['mixed_recording'::text, 'trusted_split_channels'::text]))),
    CONSTRAINT recordings_source_check CHECK ((source = ANY (ARRAY['upload'::text, 'manual_transcript'::text]))),
    CONSTRAINT recordings_status_check CHECK ((status = ANY (ARRAY['ingested'::text, 'queued'::text, 'transcribing'::text, 'transcribed'::text, 'failed'::text])))
);

CREATE TABLE public.schema_migrations (
    id text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    execution_ms integer NOT NULL,
    tool_version text NOT NULL
);

CREATE TABLE public.student_credit_events (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    workspace_id uuid,
    event_type text NOT NULL,
    quantity_delta integer NOT NULL,
    source_lesson_id uuid,
    source_payment_id uuid,
    note text,
    voided_at timestamp with time zone,
    voided_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_credit_events_nonzero_check CHECK ((quantity_delta <> 0)),
    CONSTRAINT student_credit_events_type_check CHECK ((event_type = ANY (ARRAY['credit_added'::text, 'credit_consumed'::text, 'credit_adjusted'::text])))
);

CREATE TABLE public.student_lesson_plans (
    student_id uuid NOT NULL,
    workspace_id uuid,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    default_duration_minutes integer DEFAULT 60 NOT NULL,
    cadence text,
    preferred_times text,
    scheduling_notes text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_lesson_plans_duration_check CHECK ((default_duration_minutes > 0))
);

CREATE TABLE public.student_lesson_recurrence_rules (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    workspace_id uuid,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    frequency text DEFAULT 'weekly'::text NOT NULL,
    starts_on date DEFAULT CURRENT_DATE NOT NULL,
    ends_on date,
    status text DEFAULT 'active'::text NOT NULL,
    generation_horizon_days integer DEFAULT 56 CONSTRAINT student_lesson_recurrence_rule_generation_horizon_days_not_null NOT NULL,
    materialized_through date,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_lesson_recurrence_rules_date_window_check CHECK (((ends_on IS NULL) OR (ends_on >= starts_on))),
    CONSTRAINT student_lesson_recurrence_rules_frequency_check CHECK ((frequency = 'weekly'::text)),
    CONSTRAINT student_lesson_recurrence_rules_horizon_check CHECK (((generation_horizon_days >= 7) AND (generation_horizon_days <= 366))),
    CONSTRAINT student_lesson_recurrence_rules_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text])))
);

CREATE TABLE public.student_lesson_recurrence_slots (
    id uuid NOT NULL,
    rule_id uuid NOT NULL,
    iso_weekday integer NOT NULL,
    local_start_time time without time zone NOT NULL,
    duration_minutes integer NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_lesson_recurrence_slots_duration_check CHECK ((duration_minutes > 0)),
    CONSTRAINT student_lesson_recurrence_slots_weekday_check CHECK (((iso_weekday >= 1) AND (iso_weekday <= 7)))
);

CREATE TABLE public.student_lessons (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    workspace_id uuid,
    starts_at timestamp with time zone NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    duration_minutes integer DEFAULT 60 NOT NULL,
    status text DEFAULT 'scheduled'::text NOT NULL,
    consumes_credit boolean DEFAULT false NOT NULL,
    title text,
    notes text,
    credit_event_id uuid,
    created_by uuid,
    updated_by uuid,
    completed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    recurrence_rule_id uuid,
    recurrence_slot_id uuid,
    recurrence_occurrence_key text,
    recurrence_origin text DEFAULT 'manual'::text NOT NULL,
    recurrence_override_kind text,
    recurrence_obsolete_at timestamp with time zone,
    recurrence_obsolete_by uuid,
    recurrence_obsolete_reason text,
    CONSTRAINT student_lessons_duration_check CHECK ((duration_minutes > 0)),
    CONSTRAINT student_lessons_recurrence_origin_check CHECK ((recurrence_origin = ANY (ARRAY['manual'::text, 'generated'::text]))),
    CONSTRAINT student_lessons_recurrence_override_kind_check CHECK (((recurrence_override_kind IS NULL) OR (recurrence_override_kind = ANY (ARRAY['manual_edit'::text, 'manual_reschedule'::text, 'manual_cancel'::text])))),
    CONSTRAINT student_lessons_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'completed'::text, 'canceled'::text, 'no_show'::text])))
);

CREATE TABLE public.student_memory_openai_batch_claims (
    id uuid NOT NULL,
    item_id uuid NOT NULL,
    workload text NOT NULL,
    canonical_scope_key text NOT NULL,
    source_version_hash text NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_memory_openai_batch_claims_state_check CHECK ((state = ANY (ARRAY['active'::text, 'superseded_by_online'::text, 'imported'::text, 'stale'::text, 'terminal_failure'::text, 'retryable_failure'::text]))),
    CONSTRAINT student_memory_openai_batch_claims_workload_check CHECK ((workload = ANY (ARRAY['lesson_memory'::text, 'homework_memory'::text, 'student_memory_snapshot'::text])))
);

CREATE TABLE public.student_memory_openai_batch_items (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    student_id uuid NOT NULL,
    workload text NOT NULL,
    provider text DEFAULT 'openai'::text NOT NULL,
    model text NOT NULL,
    custom_id text NOT NULL,
    canonical_scope_key text NOT NULL,
    source_version_hash text NOT NULL,
    request_envelope jsonb NOT NULL,
    response_schema_fingerprint text CONSTRAINT student_memory_openai_batch_response_schema_fingerprin_not_null NOT NULL,
    request_body jsonb NOT NULL,
    source_refs jsonb NOT NULL,
    claim_state text DEFAULT 'active'::text NOT NULL,
    state text DEFAULT 'planned'::text NOT NULL,
    submitted_at timestamp with time zone,
    remote_request_id text,
    returned_model text,
    finish_reason text,
    usage jsonb,
    normalized_error jsonb,
    imported_canonical_record_id uuid,
    retry_of_item_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_memory_openai_batch_items_claim_state_check CHECK ((claim_state = ANY (ARRAY['active'::text, 'superseded_by_online'::text, 'imported'::text, 'stale'::text, 'terminal_failure'::text, 'retryable_failure'::text]))),
    CONSTRAINT student_memory_openai_batch_items_provider_check CHECK ((provider = 'openai'::text)),
    CONSTRAINT student_memory_openai_batch_items_state_check CHECK ((state = ANY (ARRAY['planned'::text, 'submitted'::text, 'completed'::text, 'imported'::text, 'stale'::text, 'superseded_by_online'::text, 'terminal_failure'::text, 'retryable_failure'::text]))),
    CONSTRAINT student_memory_openai_batch_items_workload_check CHECK ((workload = ANY (ARRAY['lesson_memory'::text, 'homework_memory'::text, 'student_memory_snapshot'::text])))
);

CREATE TABLE public.student_memory_openai_batch_runs (
    id uuid NOT NULL,
    workload text NOT NULL,
    provider text DEFAULT 'openai'::text NOT NULL,
    model text NOT NULL,
    state text DEFAULT 'planned'::text NOT NULL,
    parent_retry_run_id uuid,
    input_jsonl_sha256 text NOT NULL,
    input_bytes integer NOT NULL,
    item_count integer NOT NULL,
    endpoint text DEFAULT '/v1/responses'::text NOT NULL,
    completion_window text DEFAULT '24h'::text NOT NULL,
    remote_input_file_id text,
    remote_batch_id text,
    remote_output_file_id text,
    remote_error_file_id text,
    remote_request_counts jsonb,
    remote_error jsonb,
    operator_audit jsonb,
    planned_at timestamp with time zone DEFAULT now() NOT NULL,
    submitted_at timestamp with time zone,
    in_progress_at timestamp with time zone,
    finalizing_at timestamp with time zone,
    completed_at timestamp with time zone,
    failed_at timestamp with time zone,
    expired_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    reconciled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_memory_openai_batch_runs_completion_window_check CHECK ((completion_window = '24h'::text)),
    CONSTRAINT student_memory_openai_batch_runs_endpoint_check CHECK ((endpoint = '/v1/responses'::text)),
    CONSTRAINT student_memory_openai_batch_runs_input_bytes_check CHECK ((input_bytes >= 0)),
    CONSTRAINT student_memory_openai_batch_runs_item_count_check CHECK ((item_count > 0)),
    CONSTRAINT student_memory_openai_batch_runs_provider_check CHECK ((provider = 'openai'::text)),
    CONSTRAINT student_memory_openai_batch_runs_state_check CHECK ((state = ANY (ARRAY['planned'::text, 'submitted'::text, 'in_progress'::text, 'finalizing'::text, 'completed'::text, 'failed'::text, 'expired'::text, 'cancelled'::text, 'reconciled'::text]))),
    CONSTRAINT student_memory_openai_batch_runs_workload_check CHECK ((workload = ANY (ARRAY['lesson_memory'::text, 'homework_memory'::text, 'student_memory_snapshot'::text])))
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

CREATE TABLE public.student_payment_records (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    workspace_id uuid,
    amount_minor integer NOT NULL,
    currency character(3) NOT NULL,
    method text,
    received_at date DEFAULT CURRENT_DATE NOT NULL,
    external_url text,
    note text,
    voided_at timestamp with time zone,
    voided_by uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT student_payment_records_amount_check CHECK ((amount_minor > 0)),
    CONSTRAINT student_payment_records_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text))
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
    source_lesson_id uuid,
    source_lesson_started_at timestamp with time zone,
    source_lesson_title text,
    source_memory_ids uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
    provenance jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedup_decision jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT student_profile_candidates_authority_check CHECK ((authority = ANY (ARRAY['teacher_confirmed'::text, 'student_stated'::text, 'model_inferred'::text]))),
    CONSTRAINT student_profile_candidates_confidence_check CHECK ((confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT student_profile_candidates_review_state_check CHECK ((review_state = ANY (ARRAY['unreviewed'::text, 'deferred'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT student_profile_candidates_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text, 'promoted'::text, 'superseded'::text]))),
    CONSTRAINT student_profile_candidates_target_section_check CHECK ((target_section = ANY (ARRAY['goals_motivation'::text, 'work_communication_context'::text, 'interests_personal_context'::text, 'learning_preferences_study_habits'::text, 'long_running_strengths'::text, 'persistent_challenges_constraints'::text])))
);

CREATE TABLE public.student_reminder_preferences (
    student_id uuid NOT NULL,
    workspace_id uuid,
    preferred_channel text DEFAULT 'manual'::text NOT NULL,
    low_balance_threshold integer DEFAULT 2 NOT NULL,
    enable_upcoming_lesson boolean DEFAULT true NOT NULL,
    enable_low_balance boolean DEFAULT true NOT NULL,
    enable_payment_followup boolean DEFAULT true NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    hidden_lesson_followup_keys text[] DEFAULT ARRAY[]::text[] CONSTRAINT student_reminder_preference_hidden_lesson_followup_key_not_null NOT NULL,
    latest_hidden_lesson_followup_key text,
    latest_hidden_lesson_followup_lesson_id uuid,
    latest_hidden_lesson_followup_at timestamp with time zone,
    CONSTRAINT student_reminder_preferences_channel_check CHECK ((preferred_channel = ANY (ARRAY['manual'::text, 'telegram'::text, 'email'::text]))),
    CONSTRAINT student_reminder_preferences_threshold_check CHECK ((low_balance_threshold >= 0))
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
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    archive_reason text,
    workspace_id uuid
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
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_default boolean DEFAULT false NOT NULL
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
    working_version integer,
    content_hash text,
    CONSTRAINT transcripts_mode_check CHECK ((mode = ANY (ARRAY['timeline'::text, 'stack'::text]))),
    CONSTRAINT transcripts_stt_provider_check CHECK ((stt_provider = ANY (ARRAY['deepgram'::text, 'elevenlabs'::text, 'google'::text, 'manual'::text]))),
    CONSTRAINT transcripts_working_content_pair_check CHECK ((((working_version IS NULL) AND (content_hash IS NULL)) OR ((working_version IS NOT NULL) AND (content_hash IS NOT NULL) AND (working_version > 0) AND (content_hash ~ '^[0-9a-f]{64}$'::text))))
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
    CONSTRAINT user_settings_tts_provider_check CHECK ((tts_provider = ANY (ARRAY['elevenlabs'::text, 'google'::text, 'inworld'::text]))),
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

CREATE TABLE public.workspace_business_settings (
    workspace_id uuid NOT NULL,
    default_currency character(3) DEFAULT 'USD'::bpchar NOT NULL,
    default_lesson_rate_minor integer DEFAULT 0 NOT NULL,
    default_lesson_duration_minutes integer DEFAULT 60 CONSTRAINT workspace_business_settings_default_lesson_duration_mi_not_null NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    forecast_horizon_days integer DEFAULT 45 NOT NULL,
    no_show_rate_basis_points integer DEFAULT 0 NOT NULL,
    cancellation_rate_basis_points integer DEFAULT 0 CONSTRAINT workspace_business_settings_cancellation_rate_basis_po_not_null NOT NULL,
    top_up_threshold integer DEFAULT 2 NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_business_settings_cancellation_rate_check CHECK (((cancellation_rate_basis_points >= 0) AND (cancellation_rate_basis_points <= 10000))),
    CONSTRAINT workspace_business_settings_currency_check CHECK ((default_currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT workspace_business_settings_duration_check CHECK ((default_lesson_duration_minutes > 0)),
    CONSTRAINT workspace_business_settings_horizon_check CHECK (((forecast_horizon_days >= 7) AND (forecast_horizon_days <= 180))),
    CONSTRAINT workspace_business_settings_no_show_rate_check CHECK (((no_show_rate_basis_points >= 0) AND (no_show_rate_basis_points <= 10000))),
    CONSTRAINT workspace_business_settings_rate_check CHECK ((default_lesson_rate_minor >= 0)),
    CONSTRAINT workspace_business_settings_top_up_threshold_check CHECK ((top_up_threshold >= 0))
);

CREATE TABLE public.workspace_memberships (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'owner'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_memberships_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text])))
);

CREATE TABLE public.workspaces (
    id uuid NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.alpha_invites
    ADD CONSTRAINT alpha_invites_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.alpha_invites
    ADD CONSTRAINT alpha_invites_token_hash_key UNIQUE (token_hash);

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_share_job_id_key UNIQUE (share_job_id);

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

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_lesson_plans
    ADD CONSTRAINT student_lesson_plans_pkey PRIMARY KEY (student_id);

ALTER TABLE ONLY public.student_lesson_recurrence_rules
    ADD CONSTRAINT student_lesson_recurrence_rules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_lesson_recurrence_slots
    ADD CONSTRAINT student_lesson_recurrence_slots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_memory_openai_batch_claims
    ADD CONSTRAINT student_memory_openai_batch_claims_item_id_key UNIQUE (item_id);

ALTER TABLE ONLY public.student_memory_openai_batch_claims
    ADD CONSTRAINT student_memory_openai_batch_claims_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_memory_openai_batch_items
    ADD CONSTRAINT student_memory_openai_batch_items_custom_id_key UNIQUE (custom_id);

ALTER TABLE ONLY public.student_memory_openai_batch_items
    ADD CONSTRAINT student_memory_openai_batch_items_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_memory_openai_batch_runs
    ADD CONSTRAINT student_memory_openai_batch_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_memory_snapshots
    ADD CONSTRAINT student_memory_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_payment_records
    ADD CONSTRAINT student_payment_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_profile_bindings
    ADD CONSTRAINT student_profile_bindings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_profile_candidate_draft_revisions
    ADD CONSTRAINT student_profile_candidate_draft_revisions_pkey PRIMARY KEY (candidate_id, revision_id);

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_reminder_preferences
    ADD CONSTRAINT student_reminder_preferences_pkey PRIMARY KEY (student_id);

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

ALTER TABLE ONLY public.workspace_business_settings
    ADD CONSTRAINT workspace_business_settings_pkey PRIMARY KEY (workspace_id);

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_pkey PRIMARY KEY (workspace_id, user_id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX idx_alpha_invites_pending_email_normalized ON public.alpha_invites USING btree (email_normalized) WHERE (status = 'pending'::text);

CREATE INDEX idx_alpha_invites_status_expires_at ON public.alpha_invites USING btree (status, expires_at);

CREATE INDEX idx_assignment_sessions_lesson_updated ON public.assignment_sessions USING btree (lesson_id, updated_at DESC, id DESC) WHERE ((confirmed_step <> 'share'::text) AND (lesson_id IS NOT NULL));

CREATE UNIQUE INDEX idx_assignment_sessions_user_active_recording ON public.assignment_sessions USING btree (user_id, recording_id) WHERE ((confirmed_step <> 'share'::text) AND (recording_id IS NOT NULL));

CREATE INDEX idx_assignment_sessions_user_active_updated ON public.assignment_sessions USING btree (user_id, updated_at DESC, id DESC) WHERE (confirmed_step <> 'share'::text);

CREATE UNIQUE INDEX idx_assignment_sessions_user_creation_request ON public.assignment_sessions USING btree (user_id, creation_request_id) WHERE (creation_request_id IS NOT NULL);

CREATE INDEX idx_assignment_sessions_user_updated ON public.assignment_sessions USING btree (user_id, updated_at DESC, id DESC);

CREATE INDEX idx_drafts_created_by ON public.drafts USING btree (created_by);

CREATE INDEX idx_drafts_lesson_updated ON public.drafts USING btree (lesson_id, updated_at DESC, id DESC) WHERE (lesson_id IS NOT NULL);

CREATE INDEX idx_drafts_prompt_package_id ON public.drafts USING btree (prompt_package_id);

CREATE INDEX idx_drafts_student_id ON public.drafts USING btree (student_id);

CREATE INDEX idx_generation_budget_counters_bucket_start ON public.generation_budget_counters USING btree (bucket_start);

CREATE INDEX idx_generation_budget_counters_provider_model ON public.generation_budget_counters USING btree (provider, model);

CREATE INDEX idx_homework_memory_entries_job_generated_at ON public.homework_memory_entries USING btree (job_id, generated_at DESC, id DESC);

CREATE INDEX idx_homework_memory_entries_lesson_ready_generated ON public.homework_memory_entries USING btree (lesson_id, generated_at DESC, created_at DESC, id DESC) WHERE ((lesson_id IS NOT NULL) AND (status = 'ready'::text));

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

CREATE INDEX idx_jobs_lesson_updated ON public.jobs USING btree (lesson_id, COALESCE(finished_at, updated_at, created_at) DESC, id DESC) WHERE (lesson_id IS NOT NULL);

CREATE INDEX idx_jobs_prompt_package_id ON public.jobs USING btree (prompt_package_id);

CREATE INDEX idx_jobs_publication_sequence ON public.jobs USING btree (publication_sequence) WHERE (publication_sequence > 0);

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

CREATE UNIQUE INDEX idx_lesson_memory_entries_transcript_source_hash ON public.lesson_memory_entries USING btree (transcript_id, source_content_hash) WHERE (source_content_hash IS NOT NULL);

CREATE INDEX idx_ops_actions_operation_id_lookup ON public.ops_actions USING btree (operation_id);

CREATE INDEX idx_ops_actions_retention_scan ON public.ops_actions USING btree (finished_at) WHERE (finished_at IS NOT NULL);

CREATE INDEX idx_ops_actions_state_finished_at ON public.ops_actions USING btree (state, finished_at);

CREATE INDEX idx_profile_revisions_profile_id_created_at ON public.profile_revisions USING btree (profile_id, created_at DESC);

CREATE INDEX idx_profile_revisions_profile_id_hash ON public.profile_revisions USING btree (profile_id, content_hash);

CREATE UNIQUE INDEX idx_profile_revisions_profile_version ON public.profile_revisions USING btree (profile_id, version_number);

CREATE UNIQUE INDEX idx_profile_revisions_single_active ON public.profile_revisions USING btree (profile_id) WHERE (status = 'active'::text);

CREATE INDEX idx_profiles_active_revision_id ON public.profiles USING btree (active_revision_id);

CREATE INDEX idx_profiles_label ON public.profiles USING btree (label);

CREATE INDEX idx_prompt_packages_lesson_updated ON public.prompt_packages USING btree (lesson_id, updated_at DESC, id DESC) WHERE (lesson_id IS NOT NULL);

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

CREATE INDEX idx_student_credit_events_student_active ON public.student_credit_events USING btree (student_id, created_at DESC, id DESC) WHERE (voided_at IS NULL);

CREATE INDEX idx_student_credit_events_student_created_at ON public.student_credit_events USING btree (student_id, created_at DESC, id DESC);

CREATE INDEX idx_student_credit_events_workspace_active ON public.student_credit_events USING btree (workspace_id, student_id, created_at DESC, id DESC) WHERE (voided_at IS NULL);

CREATE UNIQUE INDEX idx_student_lesson_recurrence_rules_primary_active ON public.student_lesson_recurrence_rules USING btree (student_id) WHERE (status <> 'archived'::text);

CREATE INDEX idx_student_lesson_recurrence_rules_student ON public.student_lesson_recurrence_rules USING btree (student_id, status, id);

CREATE INDEX idx_student_lesson_recurrence_slots_rule ON public.student_lesson_recurrence_slots USING btree (rule_id, iso_weekday, local_start_time, id);

CREATE UNIQUE INDEX idx_student_lessons_recurrence_occurrence_active ON public.student_lessons USING btree (recurrence_rule_id, recurrence_occurrence_key) WHERE ((recurrence_rule_id IS NOT NULL) AND (recurrence_occurrence_key IS NOT NULL) AND (recurrence_obsolete_at IS NULL));

CREATE INDEX idx_student_lessons_student_active_schedule ON public.student_lessons USING btree (student_id, starts_at DESC, id DESC) WHERE (recurrence_obsolete_at IS NULL);

CREATE INDEX idx_student_lessons_student_next ON public.student_lessons USING btree (student_id, starts_at, id) WHERE (status = 'scheduled'::text);

CREATE INDEX idx_student_lessons_student_starts_at ON public.student_lessons USING btree (student_id, starts_at DESC, id DESC);

CREATE INDEX idx_student_lessons_workspace_active_schedule ON public.student_lessons USING btree (workspace_id, starts_at, id) WHERE (recurrence_obsolete_at IS NULL);

CREATE INDEX idx_student_lessons_workspace_starts_at ON public.student_lessons USING btree (workspace_id, starts_at, id);

CREATE UNIQUE INDEX idx_student_memory_openai_batch_active_claim ON public.student_memory_openai_batch_claims USING btree (workload, canonical_scope_key, source_version_hash) WHERE (state = 'active'::text);

CREATE INDEX idx_student_memory_openai_batch_items_run ON public.student_memory_openai_batch_items USING btree (run_id, created_at, id);

CREATE INDEX idx_student_memory_openai_batch_items_scope ON public.student_memory_openai_batch_items USING btree (workload, canonical_scope_key, claim_state);

CREATE INDEX idx_student_memory_openai_batch_runs_state ON public.student_memory_openai_batch_runs USING btree (state, planned_at DESC, id DESC);

CREATE INDEX idx_student_memory_snapshots_status_generated_at ON public.student_memory_snapshots USING btree (status, generated_at DESC, id DESC);

CREATE INDEX idx_student_memory_snapshots_student_generated_at ON public.student_memory_snapshots USING btree (student_id, generated_at DESC, id DESC);

CREATE INDEX idx_student_memory_snapshots_student_ready_lookup ON public.student_memory_snapshots USING btree (student_id, generated_at DESC, id DESC) WHERE (status = 'ready'::text);

CREATE INDEX idx_student_payment_records_student_received_at ON public.student_payment_records USING btree (student_id, received_at DESC, created_at DESC, id DESC) WHERE (voided_at IS NULL);

CREATE INDEX idx_student_payment_records_workspace_received_at ON public.student_payment_records USING btree (workspace_id, received_at DESC, created_at DESC, id DESC) WHERE (voided_at IS NULL);

CREATE INDEX idx_student_profile_bindings_effective_from ON public.student_profile_bindings USING btree (effective_from DESC);

CREATE INDEX idx_student_profile_bindings_profile_id ON public.student_profile_bindings USING btree (profile_id);

CREATE UNIQUE INDEX idx_student_profile_bindings_single_active ON public.student_profile_bindings USING btree (student_id) WHERE (effective_to IS NULL);

CREATE INDEX idx_student_profile_bindings_student_id ON public.student_profile_bindings USING btree (student_id);

CREATE INDEX idx_student_profile_candidate_draft_revisions_revision ON public.student_profile_candidate_draft_revisions USING btree (revision_id, candidate_id);

CREATE INDEX idx_student_profile_candidates_dedup_decision ON public.student_profile_candidates USING btree (student_id, status, created_at DESC, id DESC) WHERE (dedup_decision <> '{}'::jsonb);

CREATE INDEX idx_student_profile_candidates_source_lesson ON public.student_profile_candidates USING btree (student_id, source_lesson_id, created_at DESC, id DESC) WHERE (source_lesson_id IS NOT NULL);

CREATE INDEX idx_student_profile_candidates_student_candidate_key ON public.student_profile_candidates USING btree (student_id, candidate_key, created_at DESC, id DESC);

CREATE INDEX idx_student_profile_candidates_student_created_at ON public.student_profile_candidates USING btree (student_id, created_at DESC, id DESC);

CREATE INDEX idx_student_profile_candidates_student_review_state_created_at ON public.student_profile_candidates USING btree (student_id, review_state, created_at DESC, id DESC);

CREATE INDEX idx_student_profile_candidates_student_status_created_at ON public.student_profile_candidates USING btree (student_id, status, created_at DESC, id DESC);

CREATE INDEX idx_student_profile_candidates_student_status_review_created_at ON public.student_profile_candidates USING btree (student_id, status, review_state, created_at DESC, id DESC);

CREATE INDEX idx_students_active_student ON public.students USING btree (student, id) WHERE (archived_at IS NULL);

CREATE INDEX idx_students_archived_at ON public.students USING btree (archived_at DESC, id DESC) WHERE (archived_at IS NOT NULL);

CREATE INDEX idx_students_created_at ON public.students USING btree (created_at);

CREATE INDEX idx_students_profile_id ON public.students USING btree (profile_id);

CREATE INDEX idx_students_workspace_id ON public.students USING btree (workspace_id);

CREATE UNIQUE INDEX idx_students_workspace_student_lower_unique ON public.students USING btree (workspace_id, lower(student));

CREATE UNIQUE INDEX idx_template_revisions_single_active ON public.template_revisions USING btree (template_id) WHERE (status = 'active'::text);

CREATE INDEX idx_template_revisions_template_id_created_at ON public.template_revisions USING btree (template_id, created_at DESC);

CREATE INDEX idx_template_revisions_template_id_hash ON public.template_revisions USING btree (template_id, content_hash);

CREATE UNIQUE INDEX idx_template_revisions_template_version ON public.template_revisions USING btree (template_id, version_number);

CREATE INDEX idx_templates_active_revision_id ON public.templates USING btree (active_revision_id);

CREATE INDEX idx_templates_label ON public.templates USING btree (label);

CREATE UNIQUE INDEX idx_templates_single_default ON public.templates USING btree (is_default) WHERE is_default;

CREATE INDEX idx_transcripts_recording_id ON public.transcripts USING btree (recording_id);

CREATE INDEX idx_uploaded_files_created_at ON public.uploaded_files USING btree (created_at);

CREATE INDEX idx_uploaded_files_storage_key ON public.uploaded_files USING btree (storage_key);

CREATE INDEX idx_uploaded_files_storage_provider ON public.uploaded_files USING btree (storage_provider);

CREATE INDEX idx_uploaded_files_user_id ON public.uploaded_files USING btree (user_id);

CREATE INDEX idx_user_settings_user_id ON public.user_settings USING btree (user_id);

CREATE INDEX idx_users_email ON public.users USING btree (email);

CREATE INDEX idx_users_role ON public.users USING btree (role);

CREATE INDEX idx_workspace_memberships_user_id ON public.workspace_memberships USING btree (user_id);

CREATE TRIGGER set_drafts_updated_at BEFORE UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.set_drafts_updated_at();

CREATE TRIGGER set_homework_memory_entries_updated_at BEFORE UPDATE ON public.homework_memory_entries FOR EACH ROW EXECUTE FUNCTION public.set_homework_memory_entries_updated_at();

CREATE TRIGGER set_jobs_student_id BEFORE INSERT OR UPDATE OF recording_id, prompt_package_id, draft_id, source_job_id, student_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_jobs_student_id();

CREATE TRIGGER set_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_jobs_updated_at();

CREATE TRIGGER set_lesson_memory_entries_updated_at BEFORE UPDATE ON public.lesson_memory_entries FOR EACH ROW EXECUTE FUNCTION public.set_lesson_memory_entries_updated_at();

CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_profiles_updated_at();

CREATE TRIGGER set_prompt_packages_updated_at BEFORE UPDATE ON public.prompt_packages FOR EACH ROW EXECUTE FUNCTION public.set_prompt_packages_updated_at();

CREATE TRIGGER set_recordings_updated_at BEFORE UPDATE ON public.recordings FOR EACH ROW EXECUTE FUNCTION public.set_recordings_updated_at();

CREATE TRIGGER set_student_memory_openai_batch_claims_updated_at BEFORE UPDATE ON public.student_memory_openai_batch_claims FOR EACH ROW EXECUTE FUNCTION public.set_student_memory_openai_batch_claims_updated_at();

CREATE TRIGGER set_student_memory_openai_batch_items_updated_at BEFORE UPDATE ON public.student_memory_openai_batch_items FOR EACH ROW EXECUTE FUNCTION public.set_student_memory_openai_batch_items_updated_at();

CREATE TRIGGER set_student_memory_openai_batch_runs_updated_at BEFORE UPDATE ON public.student_memory_openai_batch_runs FOR EACH ROW EXECUTE FUNCTION public.set_student_memory_openai_batch_runs_updated_at();

CREATE TRIGGER set_student_memory_snapshots_updated_at BEFORE UPDATE ON public.student_memory_snapshots FOR EACH ROW EXECUTE FUNCTION public.set_student_memory_snapshots_updated_at();

CREATE TRIGGER set_student_profile_candidates_updated_at BEFORE UPDATE ON public.student_profile_candidates FOR EACH ROW EXECUTE FUNCTION public.set_student_profile_candidates_updated_at();

CREATE TRIGGER set_students_updated_at BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.set_students_updated_at();

CREATE TRIGGER set_transcripts_updated_at BEFORE UPDATE ON public.transcripts FOR EACH ROW EXECUTE FUNCTION public.set_transcripts_updated_at();

CREATE TRIGGER set_uploaded_files_updated_at BEFORE UPDATE ON public.uploaded_files FOR EACH ROW EXECUTE FUNCTION public.set_uploaded_files_updated_at();

CREATE TRIGGER set_user_settings_updated_at BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.set_user_settings_updated_at();

CREATE TRIGGER set_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.set_users_updated_at();

CREATE TRIGGER trg_set_ops_actions_updated_at BEFORE UPDATE ON public.ops_actions FOR EACH ROW EXECUTE FUNCTION public.set_ops_actions_updated_at();

ALTER TABLE ONLY public.alpha_invites
    ADD CONSTRAINT alpha_invites_accepted_user_id_fkey FOREIGN KEY (accepted_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.alpha_invites
    ADD CONSTRAINT alpha_invites_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.drafts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.student_lessons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_prompt_package_id_fkey FOREIGN KEY (prompt_package_id) REFERENCES public.prompt_packages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES public.recordings(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_selected_profile_revision_id_fkey FOREIGN KEY (selected_profile_revision_id) REFERENCES public.profile_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_share_job_id_fkey FOREIGN KEY (share_job_id) REFERENCES public.jobs(id);

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES public.transcripts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.student_lessons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_prompt_package_id_fkey FOREIGN KEY (prompt_package_id) REFERENCES public.prompt_packages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_assignment_lineage_key_fkey FOREIGN KEY (assignment_lineage_key) REFERENCES public.jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES public.drafts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.student_lessons(id) ON DELETE SET NULL;

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
    ADD CONSTRAINT jobs_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.student_lessons(id) ON DELETE SET NULL;

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
    ADD CONSTRAINT prompt_packages_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.student_lessons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prompt_packages
    ADD CONSTRAINT prompt_packages_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES public.recordings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_packages
    ADD CONSTRAINT prompt_packages_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES public.transcripts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_source_lesson_id_fkey FOREIGN KEY (source_lesson_id) REFERENCES public.student_lessons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_source_payment_id_fkey FOREIGN KEY (source_payment_id) REFERENCES public.student_payment_records(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lesson_plans
    ADD CONSTRAINT student_lesson_plans_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_lesson_plans
    ADD CONSTRAINT student_lesson_plans_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lesson_plans
    ADD CONSTRAINT student_lesson_plans_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lesson_recurrence_rules
    ADD CONSTRAINT student_lesson_recurrence_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lesson_recurrence_rules
    ADD CONSTRAINT student_lesson_recurrence_rules_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_lesson_recurrence_rules
    ADD CONSTRAINT student_lesson_recurrence_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lesson_recurrence_rules
    ADD CONSTRAINT student_lesson_recurrence_rules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lesson_recurrence_slots
    ADD CONSTRAINT student_lesson_recurrence_slots_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.student_lesson_recurrence_rules(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_credit_event_id_fkey FOREIGN KEY (credit_event_id) REFERENCES public.student_credit_events(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_recurrence_obsolete_by_fkey FOREIGN KEY (recurrence_obsolete_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_recurrence_rule_id_fkey FOREIGN KEY (recurrence_rule_id) REFERENCES public.student_lesson_recurrence_rules(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_recurrence_slot_id_fkey FOREIGN KEY (recurrence_slot_id) REFERENCES public.student_lesson_recurrence_slots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_memory_openai_batch_claims
    ADD CONSTRAINT student_memory_openai_batch_claims_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.student_memory_openai_batch_items(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_memory_openai_batch_items
    ADD CONSTRAINT student_memory_openai_batch_items_retry_of_item_id_fkey FOREIGN KEY (retry_of_item_id) REFERENCES public.student_memory_openai_batch_items(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_memory_openai_batch_items
    ADD CONSTRAINT student_memory_openai_batch_items_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.student_memory_openai_batch_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_memory_openai_batch_items
    ADD CONSTRAINT student_memory_openai_batch_items_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_memory_openai_batch_runs
    ADD CONSTRAINT student_memory_openai_batch_runs_parent_retry_run_id_fkey FOREIGN KEY (parent_retry_run_id) REFERENCES public.student_memory_openai_batch_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_memory_snapshots
    ADD CONSTRAINT student_memory_snapshots_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_memory_snapshots
    ADD CONSTRAINT student_memory_snapshots_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.student_memory_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_payment_records
    ADD CONSTRAINT student_payment_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_payment_records
    ADD CONSTRAINT student_payment_records_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_payment_records
    ADD CONSTRAINT student_payment_records_voided_by_fkey FOREIGN KEY (voided_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_payment_records
    ADD CONSTRAINT student_payment_records_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

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
    ADD CONSTRAINT student_profile_candidates_source_lesson_id_fkey FOREIGN KEY (source_lesson_id) REFERENCES public.student_lessons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES public.student_memory_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.student_profile_candidates(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_reminder_preferences
    ADD CONSTRAINT student_reminder_preferences_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_reminder_preferences
    ADD CONSTRAINT student_reminder_preferences_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_reminder_preferences
    ADD CONSTRAINT student_reminder_preferences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

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

ALTER TABLE ONLY public.workspace_business_settings
    ADD CONSTRAINT workspace_business_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.workspace_business_settings
    ADD CONSTRAINT workspace_business_settings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

CREATE POLICY jobs_user_scope_policy ON public.jobs USING ((public.app_rls_bypass() OR (user_id = public.app_current_user_id()))) WITH CHECK ((public.app_rls_bypass() OR (user_id = public.app_current_user_id())));

CREATE POLICY uploaded_files_user_scope_policy ON public.uploaded_files USING ((public.app_rls_bypass() OR (user_id = public.app_current_user_id()))) WITH CHECK ((public.app_rls_bypass() OR (user_id = public.app_current_user_id())));

CREATE POLICY user_settings_user_scope_policy ON public.user_settings USING ((public.app_rls_bypass() OR (user_id = public.app_current_user_id()))) WITH CHECK ((public.app_rls_bypass() OR (user_id = public.app_current_user_id())));

CREATE POLICY users_self_access_policy ON public.users USING ((public.app_rls_bypass() OR (id = public.app_current_user_id()))) WITH CHECK ((public.app_rls_bypass() OR (id = public.app_current_user_id())));

-- Optional pg_stat_statements support retained from migrations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') THEN
    BEGIN
      CREATE EXTENSION pg_stat_statements;
    EXCEPTION
      WHEN insufficient_privilege OR feature_not_supported THEN
        RAISE NOTICE 'Skipping pg_stat_statements extension creation because privileges or server support are insufficient.';
    END;
  END IF;
END $$;

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
  ('0024_student_surface_read_path_indexes', '6c35b4e0f01bfb0f9de0c8161618dfbfdd5904b6eba76f4dae1e34d386576ec6', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0025_student_archive_status', 'db8363e4010fc34933a1f83d619931ebf6cf3287169cb92be0d920ed1f57354b', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0026_schedule_billing_foundations', '503e66dae2e95b23028708636942fce28fce3b0c7e734b1cfb689abeb10ccc49', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0027_teacher_business_dashboard_foundations', 'b82df4ed56daa006bdee71a0a56e1c3f584d89eb467aa7aaf5c68cc764c60d01', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0028_student_lesson_recurrence_core', 'c90dea3bf8cc79162e93d0cbdd167e9142c6d959d2cb743ab164e06c4f658fa0', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0029_assignment_sessions', '81d0ae89a6a5e55f1fba02cac60b703e1a22d31024c5d350a43642fcb53433aa', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0030_lesson_assignment_linkage', '911668bc4cde7c277df35c1be17aaff84067eee9fa0a85da6dbd09545f3f3622', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0031_pg_stat_statements_observability', 'ad512b286919b89eda1c4eb6c2762884ca4e4bac6e7eb56d4655c726f3cce558', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0032_student_reminder_suppression', '881d242f174bea55a6313f064f436ac623937152327d7f6941d508790e995a86', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0033_prompt_template_default', 'dc002e1ad504ac9d4c50426cc097517250c58f6e910151c5a77359a500062d26', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0034_profile_candidate_provenance_audit', 'd49bd4047afe5bac9b0b9a521fc5f74b46a6cc5d550c719e8ba5435b4e48de60', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0035_jobs_mode_monologue', 'b9e84d2b640f6531c6e2aa0963a48909522e3400d5b6fc15286347f613242ba8', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0036_inworld_tts_provider', 'd796cd5efc8c71844fdc1db633d90c50aa6c98980dc5f6b523f11fb797c46b5f', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0037_retire_prompt_voice_capabilities', '8bcbad9b5f2d5d866a42fc99b95c4cf49f2f9e825e87a9ec20bd66f42c3440d6', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0038_alpha_invites_and_signup_workspace', '727507071d99af1e7fcf22d6d17993fa9e9941fd9d2b912244f678cb3daad12b', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0039_prompt_request_envelope', 'ff25a865dffa60f11a72df72fa71e1d93b18f65a331cc8398bae7f00d829614d', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0040_student_memory_openai_batch_replay', '8fe7b93f90e56b0181527c022babd4d0436ac314c89522c84b341a0c638e4116', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0041_profile_revision_refresh_source', '997ca6ddcb3a771a409b8546189d2e7cbf3b0a7e641800deb770413555f25256', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0042_lesson_memory_titles', '11e9eddcb127fcb2386f4f0a10e2240e23746136b5b1380ea09e10a82642b6a8', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0043_manual_transcript_source', '716fee229f067d8daee6eaf423bfc1797080045036afc58aa1e579e9a2631016', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0044_assignment_step_confirmation_contract', 'cdcca1a947c96eddacd8d1bb61dca29b2f06e6366c719401c4b0a8e529483987', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0045_student_memory_snapshot_eligibility_repair', 'c40a212c3fde21f699f31ba07d90fad5da90e0e5cad56934b72a13835daf356f', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0046_jobs_publication_sequence', '9b63588b48faf38aef14df9c9f9dd8f94b9e554f5a1044d081dad9e2e6bf9595', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0047_jobs_published_content_hash', '06508beba68bbd9b5141f76d7a69539385968f382736f53885cb1add81c8428c', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0048_recording_audio_topology', 'a426012df6f20d3a16962e004fef79e1f00e85da70557606b440e906aea4f0be', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1')
ON CONFLICT (id) DO NOTHING;
