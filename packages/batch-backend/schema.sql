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

CREATE FUNCTION public.enforce_recording_workspace_authority() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  resolved_workspace_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'recording workspace authority is immutable';
  END IF;
  SELECT workspace_id INTO resolved_workspace_id FROM students WHERE id = NEW.student_id;
  IF resolved_workspace_id IS NULL THEN
    RAISE EXCEPTION 'recording student has no workspace authority';
  END IF;
  IF NEW.workspace_id IS NULL THEN
    NEW.workspace_id := resolved_workspace_id;
  ELSIF NEW.workspace_id <> resolved_workspace_id THEN
    RAISE EXCEPTION 'recording workspace does not match student workspace authority';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.fence_calendar_authority_loss() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    IF OLD.is_active AND NOT NEW.is_active THEN
      UPDATE google_oauth_grants SET status='reconnect_required',credential_epoch=credential_epoch+1,refresh_lease_token=NULL,refresh_lease_expires_at=NULL WHERE authorizing_user_id=OLD.id AND status='active';
      UPDATE workspace_calendar_connections c SET status='reconnect_required',generation=generation+1,error_code='permission_changed',lease_token=NULL,lease_expires_at=NULL FROM google_oauth_grants g WHERE c.grant_id=g.id AND g.authorizing_user_id=OLD.id AND c.status='connected';
    END IF;
  ELSIF TG_OP = 'DELETE' OR (OLD.role IN ('owner','admin') AND NEW.role NOT IN ('owner','admin')) THEN
    UPDATE google_oauth_grants SET status='reconnect_required',credential_epoch=credential_epoch+1,refresh_lease_token=NULL,refresh_lease_expires_at=NULL WHERE authorizing_user_id=OLD.user_id AND workspace_id=OLD.workspace_id AND status='active';
    UPDATE workspace_calendar_connections c SET status='reconnect_required',generation=generation+1,error_code='permission_changed',lease_token=NULL,lease_expires_at=NULL FROM google_oauth_grants g WHERE c.grant_id=g.id AND g.authorizing_user_id=OLD.user_id AND c.workspace_id=OLD.workspace_id AND c.status='connected';
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.guard_calendar_projection_reference() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE lesson uuid; hidden boolean;
BEGIN
  lesson := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
  IF lesson IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)->>TG_ARGV[0] IS NOT DISTINCT FROM lesson::text THEN
    RETURN NEW;
  END IF;
  PERFORM id FROM student_lessons WHERE id=lesson FOR KEY SHARE;
  SELECT schedule_hidden_at IS NOT NULL INTO hidden FROM student_lessons WHERE id=lesson;
  IF hidden THEN
    RAISE EXCEPTION 'Lesson schedule changed; refresh before continuing'
      USING ERRCODE='23514', CONSTRAINT='calendar_projection_reference_visible';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.guard_completed_transcript_source() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE source_recording uuid; owner_record record;
BEGIN
  IF TG_TABLE_NAME = 'transcripts' THEN source_recording := NEW.recording_id;
  ELSE source_recording := NEW.id; END IF;
  FOR owner_record IN SELECT s.transcript_completed_at FROM assignment_sessions s
    JOIN assignment_source_bindings b ON b.assignment_session_id = s.id
    WHERE b.recording_id = source_recording ORDER BY s.id FOR UPDATE OF s NOWAIT
  LOOP
    IF owner_record.transcript_completed_at IS NOT NULL THEN RAISE EXCEPTION 'assignment_session_completed'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.guard_session_homework_artifact() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE session_intent text;
BEGIN
  IF NEW.assignment_session_id IS NOT NULL THEN
    SELECT homework_intent INTO session_intent FROM assignment_sessions
      WHERE id = NEW.assignment_session_id FOR UPDATE;
    IF session_intent IS DISTINCT FROM 'create' THEN RAISE EXCEPTION 'assignment_homework_intent_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

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
    homework_intent text DEFAULT 'create'::text NOT NULL,
    transcript_completed_at timestamp with time zone,
    transcript_completion_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    homework_started_from_revision integer,
    material jsonb,
    CONSTRAINT assignment_sessions_completed_share_job_check CHECK (((confirmed_step <> 'share'::text) OR (share_job_id IS NOT NULL))),
    CONSTRAINT assignment_sessions_confirmed_snapshot_check CHECK (((jsonb_typeof(confirmed_snapshot) = 'object'::text) AND (confirmed_snapshot ?& ARRAY['student'::text, 'source'::text, 'context'::text, 'create'::text]) AND (jsonb_typeof((confirmed_snapshot -> 'student'::text)) = 'object'::text) AND (NULLIF((confirmed_snapshot #>> '{student,studentId}'::text[]), ''::text) IS NOT NULL) AND (((confirmed_snapshot #>> '{student,studentId}'::text[]))::uuid = student_id) AND (((confirmed_snapshot -> 'source'::text) = 'null'::jsonb) OR (jsonb_typeof((confirmed_snapshot -> 'source'::text)) = 'object'::text)) AND (((confirmed_snapshot -> 'context'::text) = 'null'::jsonb) OR (jsonb_typeof((confirmed_snapshot -> 'context'::text)) = 'object'::text)) AND (((confirmed_snapshot -> 'create'::text) = 'null'::jsonb) OR (jsonb_typeof((confirmed_snapshot -> 'create'::text)) = 'object'::text)))),
    CONSTRAINT assignment_sessions_confirmed_step_check CHECK ((confirmed_step = ANY (ARRAY['student'::text, 'source'::text, 'context'::text, 'create'::text, 'share'::text]))),
    CONSTRAINT assignment_sessions_creation_request_id_check CHECK (((creation_request_id IS NULL) OR (btrim(creation_request_id) <> ''::text))),
    CONSTRAINT assignment_sessions_generation_provider_check CHECK (((selected_generation_provider IS NULL) OR (selected_generation_provider = ANY (ARRAY['openai'::text, 'google_ai_studio'::text, 'openrouter'::text])))),
    CONSTRAINT assignment_sessions_homework_intent CHECK ((homework_intent = ANY (ARRAY['create'::text, 'none'::text]))),
    CONSTRAINT assignment_sessions_material_object_check CHECK (((material IS NULL) OR (jsonb_typeof(material) = 'object'::text))),
    CONSTRAINT assignment_sessions_no_homework_downstream CHECK (((homework_intent <> 'none'::text) OR ((confirmed_step = ANY (ARRAY['student'::text, 'source'::text])) AND ((confirmed_snapshot -> 'context'::text) = 'null'::jsonb) AND ((confirmed_snapshot -> 'create'::text) = 'null'::jsonb) AND (prompt_package_id IS NULL) AND (draft_id IS NULL) AND (share_job_id IS NULL)))),
    CONSTRAINT assignment_sessions_publish_target_check CHECK (((publish_target IS NULL) OR (publish_target = 'html'::text))),
    CONSTRAINT assignment_sessions_revision_check CHECK ((revision > 0)),
    CONSTRAINT assignment_sessions_selected_profile_revision_hash_check CHECK (((selected_profile_revision_hash IS NULL) OR (selected_profile_revision_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT assignment_sessions_transcript_completion CHECK (((transcript_completed_at IS NULL) OR COALESCE(((homework_intent = 'none'::text) AND (confirmed_step = 'source'::text) AND ((confirmed_snapshot -> 'source'::text) <> 'null'::jsonb) AND (jsonb_array_length(transcript_completion_history) > 0) AND (((transcript_completion_history -> '-1'::integer) -> 'source'::text) = (confirmed_snapshot -> 'source'::text)) AND ((((transcript_completion_history -> '-1'::integer) ->> 'resultingRevision'::text))::integer = revision) AND ((((transcript_completion_history -> '-1'::integer) ->> 'completedAt'::text))::timestamp with time zone = transcript_completed_at) AND (((transcript_completion_history -> '-1'::integer) ->> 'studentId'::text) = (student_id)::text) AND (COALESCE(to_jsonb(lesson_id), 'null'::jsonb) = (confirmed_snapshot #> '{source,lessonId}'::text[])) AND ((recording_id)::text = (confirmed_snapshot #>> '{source,recordingId}'::text[])) AND ((transcript_id)::text = (confirmed_snapshot #>> '{source,transcriptId}'::text[]))), false))),
    CONSTRAINT assignment_sessions_transcript_history_array CHECK ((jsonb_typeof(transcript_completion_history) = 'array'::text)),
    CONSTRAINT assignment_sessions_tts_provider_check CHECK (((selected_tts_provider IS NULL) OR (selected_tts_provider = ANY (ARRAY['elevenlabs'::text, 'google'::text, 'inworld'::text, 'gemini'::text])))),
    CONSTRAINT assignment_sessions_tts_strategy_check CHECK (((selected_tts_strategy IS NULL) OR (selected_tts_strategy = ANY (ARRAY['auto'::text, 'dialogue'::text, 'tts'::text]))))
);

CREATE FUNCTION public.historical_assignment_session(s public.assignment_sessions) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN (s.confirmed_snapshot -> 'create' IS NOT NULL
    AND s.confirmed_snapshot -> 'create' <> 'null'::jsonb
    AND (s.confirmed_snapshot #>> '{create,artifact,format}') IS DISTINCT FROM 'assignment_v1')
    OR EXISTS (SELECT 1 FROM drafts d WHERE d.id = s.draft_id AND d.format <> 'assignment_v1')
    OR EXISTS (SELECT 1 FROM prompt_packages p WHERE p.id = s.prompt_package_id
      AND (p.request_envelope ->> 'promptVersion') IS DISTINCT FROM 'assignment_v1');
END;
$$;

CREATE FUNCTION public.link_student_credit_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE transition_id uuid;
BEGIN
  IF TG_OP='UPDATE' AND NOT EXISTS (SELECT 1 FROM students WHERE id=NEW.student_id) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.workspace_id IS NOT NULL AND NEW.workspace_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id=OLD.workspace_id) THEN RETURN NEW; END IF;
    IF ((NEW.activity_id IS NULL AND OLD.activity_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM student_activity WHERE id=OLD.activity_id))
      OR (NEW.reversal_activity_id IS NULL AND OLD.reversal_activity_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM student_activity WHERE id=OLD.reversal_activity_id)))
      AND NEW.student_id=OLD.student_id AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id
      AND NEW.source_lesson_id IS NOT DISTINCT FROM OLD.source_lesson_id
      THEN RETURN NEW; END IF;
  END IF;

  IF NEW.source_lesson_id IS NULL THEN
    IF NEW.activity_id IS NULL AND NEW.reversal_activity_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP='INSERT' THEN
      RAISE EXCEPTION 'Credit activity requires a lesson' USING ERRCODE='23514';
    END IF;
    IF (OLD.source_lesson_id IS NOT NULL AND EXISTS (SELECT 1 FROM student_lessons WHERE id=OLD.source_lesson_id))
      OR NEW.activity_id IS DISTINCT FROM OLD.activity_id
      OR NEW.reversal_activity_id IS DISTINCT FROM OLD.reversal_activity_id THEN
      RAISE EXCEPTION 'Credit activity source is retained' USING ERRCODE='23514';
    END IF;
  END IF;
  SELECT id INTO transition_id FROM student_activity
    WHERE student_id=NEW.student_id AND COALESCE(workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)=COALESCE(NEW.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)
      AND entity_id=NEW.source_lesson_id AND transaction_id=txid_current()
      AND type IN ('lesson_created','lesson_changed','lesson_completed','lesson_restored','lesson_canceled','lesson_no_show')
    ORDER BY occurred_at DESC,id DESC LIMIT 1;
  IF TG_OP = 'INSERT' THEN NEW.activity_id := transition_id;
  ELSIF OLD.voided_at IS NULL AND NEW.voided_at IS NOT NULL THEN NEW.reversal_activity_id := transition_id;
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY[NEW.activity_id,NEW.reversal_activity_id]) linked(id)
    WHERE linked.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM student_activity a
      WHERE a.id=linked.id AND a.student_id=NEW.student_id
      AND COALESCE(a.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)=COALESCE(NEW.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)
      AND (NEW.source_lesson_id IS NULL OR a.entity_id=NEW.source_lesson_id) AND a.category='lessons')) THEN
    RAISE EXCEPTION 'Credit activity ownership mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.lock_canonical_memory_student() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'ready' THEN
      PERFORM id FROM students WHERE id = NEW.student_id FOR UPDATE;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'ready' THEN
      PERFORM id FROM students WHERE id = OLD.student_id FOR UPDATE;
    END IF;
    RETURN OLD;
  ELSE
    IF OLD.status = 'ready' OR NEW.status = 'ready' THEN
      PERFORM id FROM students WHERE id IN (OLD.student_id, NEW.student_id) ORDER BY id FOR UPDATE;
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

CREATE FUNCTION public.lock_memory_source_student() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM id FROM students WHERE id = NEW.student_id FOR UPDATE;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM id FROM students WHERE id = OLD.student_id FOR UPDATE;
    RETURN OLD;
  ELSE
    PERFORM id FROM students WHERE id IN (OLD.student_id, NEW.student_id) ORDER BY id FOR UPDATE;
    RETURN NEW;
  END IF;
END;
$$;

CREATE FUNCTION public.preserve_assignment_artifact_identity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.assignment_artifact IS DISTINCT FROM OLD.assignment_artifact
     OR NEW.assignment_renderer_version IS DISTINCT FROM OLD.assignment_renderer_version THEN
    RAISE EXCEPTION 'Frozen assignment artifact identity cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.preserve_assignment_draft_format() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.format IS DISTINCT FROM OLD.format THEN
    RAISE EXCEPTION 'Assignment draft authority format cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.preserve_transcript_completion_history() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.homework_intent = 'none' AND EXISTS (SELECT 1 FROM prompt_packages WHERE assignment_session_id = NEW.id) THEN
    RAISE EXCEPTION 'assignment_homework_intent_conflict';
  END IF;
  IF jsonb_array_length(NEW.transcript_completion_history) < jsonb_array_length(OLD.transcript_completion_history)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(OLD.transcript_completion_history) WITH ORDINALITY e(value, n)
      WHERE NEW.transcript_completion_history->(e.n::integer - 1) IS DISTINCT FROM e.value) THEN
    RAISE EXCEPTION 'transcript_completion_history_immutable';
  END IF;
  IF NEW.transcript_completion_history IS DISTINCT FROM OLD.transcript_completion_history AND
    (jsonb_array_length(NEW.transcript_completion_history) <> jsonb_array_length(OLD.transcript_completion_history) + 1
      OR OLD.transcript_completed_at IS NOT NULL OR NEW.transcript_completed_at IS NULL) THEN
    RAISE EXCEPTION 'transcript_completion_history_invalid_append';
  END IF;
  IF OLD.transcript_completed_at IS NOT NULL AND
    NOT (NEW.homework_intent = 'create' AND NEW.transcript_completed_at IS NULL
      AND NEW.homework_started_from_revision = OLD.revision AND NEW.revision = OLD.revision + 1
      AND NEW.confirmed_snapshot = OLD.confirmed_snapshot AND NEW.lesson_id IS NOT DISTINCT FROM OLD.lesson_id
      AND NEW.recording_id = OLD.recording_id AND NEW.transcript_id = OLD.transcript_id) THEN
    RAISE EXCEPTION 'assignment_session_completed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.record_student_candidate_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE event_type text; owner_workspace uuid;
BEGIN
  IF (NEW.status,NEW.review_state,NEW.approved_fact,NEW.reviewer_note,NEW.promoted_revision_id)
    IS NOT DISTINCT FROM (OLD.status,OLD.review_state,OLD.approved_fact,OLD.reviewer_note,OLD.promoted_revision_id)
    THEN RETURN NEW; END IF;
  IF NEW.status = 'superseded' OR (NEW.status='promoted' AND OLD.status='promoted'
    AND NEW.promoted_revision_id IS NOT DISTINCT FROM OLD.promoted_revision_id) THEN RETURN NEW; END IF;
  event_type := CASE WHEN NEW.status = 'promoted' THEN 'candidate_promoted'
    WHEN NEW.review_state = 'approved' THEN 'candidate_approved'
    WHEN NEW.review_state = 'rejected' THEN 'candidate_rejected'
    WHEN NEW.review_state = 'deferred' THEN 'candidate_deferred' ELSE NULL END;
  IF event_type IS NULL THEN RETURN NEW; END IF;
  SELECT workspace_id INTO owner_workspace FROM students WHERE id=NEW.student_id;
  INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
  VALUES(NEW.student_id,owner_workspace,event_type,'profile',NEW.id,
    CASE WHEN student_activity_actor_id() IS NOT NULL THEN 'user' ELSE 'unknown' END,
    jsonb_build_object('section',NEW.target_section,'fact',COALESCE(NEW.approved_fact,NEW.fact),
      'previousDecision',OLD.review_state,'decision',NEW.review_state,'note',NEW.reviewer_note,
      'promotedRevisionId',NEW.promoted_revision_id));
  RETURN NEW;
END $$;

CREATE FUNCTION public.record_student_homework_started_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE owner_workspace uuid;
BEGIN
  IF OLD.homework_intent = 'none' AND NEW.homework_intent = 'create' AND
    NEW.homework_started_from_revision IS DISTINCT FROM OLD.homework_started_from_revision THEN
    SELECT workspace_id INTO owner_workspace FROM students WHERE id=NEW.student_id;
    INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
    VALUES(NEW.student_id,owner_workspace,'homework_started','lessons',NEW.id,
      CASE WHEN student_activity_actor_id() IS NOT NULL THEN 'user' ELSE 'unknown' END,
      jsonb_build_object('lessonId',NEW.lesson_id,'fromRevision',NEW.homework_started_from_revision));
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.record_student_job_failure_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE owner_workspace uuid;
BEGIN
  IF NEW.state <> 'failed' OR (TG_OP = 'UPDATE' AND OLD.state = 'failed') OR NEW.student_id IS NULL OR NEW.publish_target IS DISTINCT FROM 'html' THEN RETURN NEW; END IF;
  SELECT workspace_id INTO owner_workspace FROM students WHERE id=NEW.student_id;
  INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
  VALUES(NEW.student_id,owner_workspace,'homework_failed','lessons',NEW.id,'system',
    jsonb_build_object('lessonId',NEW.lesson_id,'sourceJobId',NEW.source_job_id));
  RETURN NEW;
END $$;

CREATE FUNCTION public.record_student_lesson_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE event_type text; previous jsonb := NULL; current_value jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students s WHERE s.id=NEW.student_id
    AND COALESCE(s.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)=
      COALESCE(NEW.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)) THEN RETURN NEW; END IF;
  current_value := jsonb_build_object('startsAt',NEW.starts_at,'timezone',NEW.timezone,
    'durationMinutes',NEW.duration_minutes,'status',NEW.status,'consumesCredit',NEW.consumes_credit,
    'title',NEW.title);
  IF TG_OP = 'INSERT' THEN event_type := 'lesson_created';
  ELSE
    previous := jsonb_build_object('startsAt',OLD.starts_at,'timezone',OLD.timezone,
      'durationMinutes',OLD.duration_minutes,'status',OLD.status,'consumesCredit',OLD.consumes_credit,
      'title',OLD.title);
    IF previous = current_value THEN RETURN NEW; END IF;
    IF (previous - 'title') = (current_value - 'title') AND
      (OLD.title IS NULL OR btrim(OLD.title) = '' OR OLD.title = 'Untitled lesson')
      AND current_setting('app.student_activity_origin',true)='generated_title' THEN RETURN NEW; END IF;
    event_type := CASE WHEN OLD.status IS DISTINCT FROM NEW.status THEN
      CASE NEW.status WHEN 'completed' THEN 'lesson_completed' WHEN 'scheduled' THEN 'lesson_restored'
        WHEN 'canceled' THEN 'lesson_canceled' WHEN 'no_show' THEN 'lesson_no_show' END
      ELSE 'lesson_changed' END;
  END IF;
  INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
  VALUES(NEW.student_id,COALESCE(NEW.workspace_id,(SELECT workspace_id FROM students WHERE id=NEW.student_id)),event_type,'lessons',NEW.id,
    CASE WHEN current_setting('app.calendar_sync',true)='on' THEN 'system'
      WHEN student_activity_actor_id() IS NOT NULL THEN 'user' ELSE 'unknown' END,
    jsonb_build_object('before',previous,'after',current_value,'scheduleOriginHistory',NEW.schedule_origin_history,
      'generated',false));
  RETURN NEW;
END $$;

CREATE FUNCTION public.record_student_lifecycle_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE event_type text; changes jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN event_type := 'student_created'; changes := jsonb_build_object('name',NEW.student);
  ELSE
    IF OLD.student IS DISTINCT FROM NEW.student THEN
      INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
      VALUES(NEW.id,NEW.workspace_id,'student_renamed','lifecycle',NEW.id,
        CASE WHEN student_activity_actor_id() IS NOT NULL THEN 'user' ELSE 'unknown' END,
        jsonb_build_object('beforeName',OLD.student,'name',NEW.student));
    END IF;
    IF OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL THEN event_type := 'student_archived';
    ELSIF OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL THEN event_type := 'student_restored';
    ELSE RETURN NEW; END IF;
    changes := jsonb_build_object('name',NEW.student,'reason',NEW.archive_reason);
  END IF;
  INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
  VALUES(NEW.id,NEW.workspace_id,event_type,'lifecycle',NEW.id,
    CASE WHEN student_activity_actor_id() IS NOT NULL THEN 'user' ELSE 'unknown' END,changes);
  RETURN NEW;
END $$;

CREATE FUNCTION public.record_student_profile_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE event_type text; sections jsonb; owner_workspace uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_type := CASE WHEN NEW.restored_from_revision_id IS NOT NULL THEN 'profile_restored' ELSE 'profile_saved' END;
    SELECT COALESCE(jsonb_agg(key ORDER BY key),'[]'::jsonb) INTO sections
    FROM jsonb_object_keys(CASE WHEN jsonb_typeof(NEW.structured_content)='object'
      THEN NEW.structured_content ELSE '{}'::jsonb END) key
    WHERE key<>'schemaVersion' AND NEW.structured_content->key IS DISTINCT FROM (
      SELECT r.structured_content->key FROM student_profile_revisions r
      WHERE r.student_id=NEW.student_id AND r.version_number<NEW.version_number
      ORDER BY r.version_number DESC LIMIT 1);
  ELSIF NEW.status = 'active' AND OLD.status IS DISTINCT FROM NEW.status THEN
    event_type := 'profile_activated'; sections := '[]'::jsonb;
  ELSE RETURN NEW; END IF;
  SELECT workspace_id INTO owner_workspace FROM students WHERE id=NEW.student_id;
  INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
  VALUES(NEW.student_id,owner_workspace,event_type,'profile',NEW.id,
    CASE WHEN student_activity_actor_id() IS NOT NULL THEN 'user'
      WHEN NEW.source='lesson_population' AND TG_OP='INSERT' THEN 'system' ELSE 'unknown' END,
    jsonb_build_object('version',NEW.version_label,'source',NEW.source,'status',NEW.status,
      'sections',sections,'restoredFromRevisionId',NEW.restored_from_revision_id));
  RETURN NEW;
END $$;

CREATE FUNCTION public.record_student_reminder_activity() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE previous_keys text[] := ARRAY[]::text[]; hidden_key text; lesson uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students s WHERE s.id=NEW.student_id
    AND COALESCE(s.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)=
      COALESCE(NEW.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN previous_keys := OLD.hidden_lesson_followup_keys; END IF;
  FOR hidden_key IN SELECT unnest(NEW.hidden_lesson_followup_keys) EXCEPT SELECT unnest(previous_keys) LOOP
    INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
    VALUES(NEW.student_id,COALESCE(NEW.workspace_id,(SELECT workspace_id FROM students WHERE id=NEW.student_id)),'reminder_hidden','operations',NEW.student_id,
      CASE WHEN student_activity_actor_id() IS NOT NULL THEN 'user' ELSE 'unknown' END,
      jsonb_build_object('lessonId',NEW.latest_hidden_lesson_followup_lesson_id));
  END LOOP;
  FOR hidden_key IN SELECT unnest(previous_keys) EXCEPT SELECT unnest(NEW.hidden_lesson_followup_keys) LOOP
    lesson := OLD.latest_hidden_lesson_followup_lesson_id;
    INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
    VALUES(NEW.student_id,COALESCE(NEW.workspace_id,(SELECT workspace_id FROM students WHERE id=NEW.student_id)),'reminder_restored','operations',NEW.student_id,
      CASE WHEN student_activity_actor_id() IS NOT NULL THEN 'user' ELSE 'unknown' END,jsonb_build_object('lessonId',lesson));
  END LOOP;
  RETURN NEW;
END $$;

CREATE FUNCTION public.reject_historical_assignment_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_TABLE_NAME = 'drafts' THEN
    IF NEW.format <> 'assignment_v1' THEN RAISE EXCEPTION 'legacy_assignment_read_only'; END IF;
  ELSIF TG_TABLE_NAME = 'jobs' THEN
    IF NEW.assignment_artifact IS NULL THEN RAISE EXCEPTION 'legacy_assignment_read_only'; END IF;
  ELSIF TG_TABLE_NAME = 'assignment_sessions' THEN
    IF historical_assignment_session(NEW)
      OR (TG_OP = 'UPDATE' AND historical_assignment_session(OLD)) THEN
      RAISE EXCEPTION 'legacy_assignment_read_only';
    END IF;
  ELSIF TG_TABLE_NAME = 'homework_memory_entries' THEN
    IF EXISTS (SELECT 1 FROM jobs WHERE id = NEW.job_id AND assignment_artifact IS NULL) THEN
      RAISE EXCEPTION 'legacy_assignment_read_only';
    END IF;
  ELSIF TG_TABLE_NAME = 'profile_initial_enrichment_operations' THEN
    IF NEW.state IN ('waiting_evidence', 'queued', 'submitting', 'result_ready', 'uncertain', 'succeeded')
      AND EXISTS (SELECT 1 FROM assignment_sessions s WHERE s.id = NEW.assignment_session_id
        AND historical_assignment_session(s)) THEN
      RAISE EXCEPTION 'legacy_assignment_read_only';
    END IF;
  ELSIF TG_TABLE_NAME = 'student_memory_openai_batch_items' THEN
    IF NEW.workload = 'homework_memory'
      AND (NEW.source_refs ->> 'sourceFormat') IS DISTINCT FROM 'assignment_v1'
      AND NEW.state IN ('planned', 'submitted', 'completed', 'imported', 'retryable_failure') THEN
      RAISE EXCEPTION 'legacy_assignment_read_only';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.reject_legacy_profile_write() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'Legacy profile storage is frozen; reconcile ABO-12 before removal';
END;
$$;

CREATE FUNCTION public.reject_mcp_profile_identity_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'MCP profile identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION public.reject_student_activity_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students WHERE id=OLD.student_id)
    OR (OLD.workspace_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id=OLD.workspace_id)) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Student activity follows student retention' USING ERRCODE='23514';
END $$;

CREATE FUNCTION public.reject_student_activity_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
    AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id')
    AND NOT EXISTS (SELECT 1 FROM users WHERE id=OLD.actor_user_id) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Student activity is append-only' USING ERRCODE = '23514';
END $$;

CREATE FUNCTION public.request_confirmed_source_audio_deletion() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE recordings r SET audio_lifecycle = 'pending',
      audio_deletion_requested_at = COALESCE(r.audio_deletion_requested_at, NOW()),
      updated_at = NOW()
  WHERE r.id = NEW.recording_id
    AND r.student_id = NEW.student_id
    AND r.id::text = NEW.confirmed_snapshot #>> '{source,recordingId}'
    AND r.audio_lifecycle = 'retained';
  RETURN NEW;
END $$;

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
  IF OLD.provenance = 'unknown'
     AND NEW.provenance = 'evidence_enriched'
     AND OLD.initial_enrichment_completed_at IS NULL
     AND NEW.initial_enrichment_completed_at IS NOT NULL
     AND (to_jsonb(NEW) - 'provenance' - 'initial_enrichment_completed_at') =
         (to_jsonb(OLD) - 'provenance' - 'initial_enrichment_completed_at') THEN
    RETURN NEW;
  END IF;

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

CREATE FUNCTION public.set_student_activity_actor() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students s WHERE s.id=NEW.student_id
    AND COALESCE(s.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)=
      COALESCE(NEW.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)) THEN
    RAISE EXCEPTION 'Student activity ownership mismatch' USING ERRCODE='23514';
  END IF;
  NEW.actor_user_id := CASE WHEN NEW.actor_kind = 'user' THEN student_activity_actor_id() ELSE NULL END;
  RETURN NEW;
END $$;

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

CREATE FUNCTION public.student_activity_actor_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $_$
  SELECT CASE WHEN NULLIF(current_setting('app.activity_actor_id',true),'') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('app.activity_actor_id',true)::uuid ELSE app_current_user_id() END
$_$;

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

CREATE TABLE public.assignment_source_binding_audit (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    student_id uuid NOT NULL,
    source_identity_kind text NOT NULL,
    source_fingerprint_scheme text CONSTRAINT assignment_source_binding_au_source_fingerprint_scheme_not_null NOT NULL,
    source_fingerprint text NOT NULL,
    prior_assignment_session_id uuid,
    canonical_assignment_session_id uuid CONSTRAINT assignment_source_binding_a_canonical_assignment_sessi_not_null NOT NULL,
    action text NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assignment_source_binding_audit_action_check CHECK ((action = ANY (ARRAY['migration_conflict_resolution'::text, 'operator_remap'::text])))
);

CREATE TABLE public.assignment_source_bindings (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    student_id uuid NOT NULL,
    assignment_session_id uuid NOT NULL,
    source_identity_kind text NOT NULL,
    source_fingerprint_scheme text NOT NULL,
    source_fingerprint text NOT NULL,
    binding_role text NOT NULL,
    recording_id uuid NOT NULL,
    transcript_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT assignment_source_bindings_fingerprint_check CHECK ((source_fingerprint ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT assignment_source_bindings_identity_kind_check CHECK ((source_identity_kind = ANY (ARRAY['audio'::text, 'manual_transcript'::text]))),
    CONSTRAINT assignment_source_bindings_role_check CHECK ((binding_role = ANY (ARRAY['confirmed'::text, 'working'::text])))
);

CREATE TABLE public.calendar_lesson_bindings (
    lesson_id uuid NOT NULL,
    schedule_binding_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    provider_event_id text NOT NULL,
    recurring_event_id text,
    original_start_time text,
    source_version text,
    provider_updated_at timestamp with time zone,
    provider_status text NOT NULL,
    canceled_by_calendar boolean DEFAULT false NOT NULL,
    event_url text,
    attention_code text
);

CREATE TABLE public.calendar_operations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    connection_generation bigint NOT NULL,
    student_id uuid,
    initiating_user_id uuid,
    adopted_by uuid,
    authority_policy text NOT NULL,
    parent_id uuid,
    kind text NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    request_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    provider_event_id text,
    association_marker text,
    slot_index integer,
    state text DEFAULT 'pending'::text NOT NULL,
    write_attempted_at timestamp with time zone,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    due_at timestamp with time zone DEFAULT now() NOT NULL,
    error_code text,
    event_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_operations_authority_policy_check CHECK ((authority_policy = ANY (ARRAY['initiator'::text, 'workspace_service'::text]))),
    CONSTRAINT calendar_operations_kind_check CHECK ((kind = ANY (ARRAY['setup'::text, 'create'::text, 'bind'::text, 'sync'::text, 'refresh'::text]))),
    CONSTRAINT calendar_operations_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'running'::text, 'retry_wait'::text, 'succeeded'::text, 'needs_review'::text, 'superseded'::text])))
);

CREATE TABLE public.calendar_schedule_bindings (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    student_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    provider_event_id text NOT NULL,
    kind text NOT NULL,
    association_marker text NOT NULL,
    source_version text,
    setup_operation_id uuid,
    projected_until timestamp with time zone,
    next_projection_at timestamp with time zone DEFAULT now() NOT NULL,
    attention_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT calendar_schedule_bindings_kind_check CHECK ((kind = ANY (ARRAY['one_off'::text, 'series'::text])))
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
    format text DEFAULT 'markdown'::text NOT NULL,
    CONSTRAINT drafts_assignment_v1_identity CHECK (((format = 'markdown'::text) OR ((working_version IS NOT NULL) AND (content_hash IS NOT NULL) AND (storage_uri ~~ (('%/content/'::text || content_hash) || '.json'::text))))),
    CONSTRAINT drafts_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT drafts_format_check CHECK ((format = ANY (ARRAY['markdown'::text, 'assignment_v1'::text]))),
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

CREATE TABLE public.google_oauth_attempts (
    id uuid NOT NULL,
    state_hash text NOT NULL,
    browser_binding_hash text NOT NULL,
    requesting_user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    purpose text NOT NULL,
    verifier_encrypted text NOT NULL,
    nonce text NOT NULL,
    connection_id uuid,
    connection_generation integer,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT google_oauth_attempts_purpose_check CHECK ((purpose = 'connect-calendar'::text)),
    CONSTRAINT google_oauth_attempts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'invalidated'::text, 'completed'::text])))
);

CREATE TABLE public.google_oauth_grants (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    authorizing_user_id uuid NOT NULL,
    issuer text NOT NULL,
    subject text NOT NULL,
    client_id text NOT NULL,
    google_email text NOT NULL,
    granted_scopes text[] NOT NULL,
    refresh_credential text NOT NULL,
    access_credential text,
    access_expires_at timestamp with time zone,
    credential_epoch integer DEFAULT 1 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    refresh_lease_token uuid,
    refresh_lease_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT google_oauth_grants_credential_epoch_check CHECK ((credential_epoch > 0)),
    CONSTRAINT google_oauth_grants_status_check CHECK ((status = ANY (ARRAY['active'::text, 'reconnect_required'::text, 'disconnected'::text])))
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
    assignment_artifact jsonb,
    assignment_renderer_version integer,
    CONSTRAINT jobs_assignment_artifact_identity CHECK ((((assignment_artifact IS NULL) AND (assignment_renderer_version IS NULL)) OR (((assignment_artifact IS NOT NULL) AND (assignment_renderer_version = ANY (ARRAY[1, 2, 3])) AND (prompt_package_id IS NOT NULL) AND (draft_id IS NOT NULL) AND ((assignment_artifact ->> 'format'::text) = 'assignment_v1'::text) AND ((assignment_artifact ->> 'schemaVersion'::text) = '1'::text) AND ((assignment_artifact ->> 'serializationVersion'::text) = '1'::text) AND ((assignment_artifact ->> 'workingVersion'::text) ~ '^[1-9][0-9]*$'::text) AND ((assignment_artifact ->> 'contentHash'::text) ~ '^[0-9a-f]{64}$'::text) AND ((assignment_artifact ->> 'storageUri'::text) ~~ (('%/content/'::text || (assignment_artifact ->> 'contentHash'::text)) || '.json'::text)) AND (jsonb_typeof((assignment_artifact -> 'schemaVersion'::text)) = 'number'::text) AND (jsonb_typeof((assignment_artifact -> 'serializationVersion'::text)) = 'number'::text) AND (jsonb_typeof((assignment_artifact -> 'workingVersion'::text)) = 'number'::text) AND (assignment_artifact ?& ARRAY['format'::text, 'schemaVersion'::text, 'serializationVersion'::text, 'workingVersion'::text, 'contentHash'::text, 'storageUri'::text])) IS TRUE))),
    CONSTRAINT jobs_mode_check CHECK (((mode IS NULL) OR (mode = ANY (ARRAY['auto'::text, 'dialogue'::text, 'monologue'::text, 'tts'::text])))),
    CONSTRAINT jobs_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'awaiting_approval'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT jobs_tts_model_check CHECK (((tts_model IS NULL) OR ((tts_provider = 'elevenlabs'::text) AND (tts_model = ANY (ARRAY['eleven_v3'::text, 'eleven_multilingual_v2'::text, 'eleven_flash_v2_5'::text, 'eleven_flash_v2'::text]))) OR ((tts_provider = 'google'::text) AND (tts_model = ANY (ARRAY['chirp3_hd'::text, 'studio'::text, 'neural2'::text, 'wavenet'::text]))) OR ((tts_provider = 'inworld'::text) AND (tts_model = ANY (ARRAY['inworld-tts-2'::text, 'inworld-tts-1.5-max'::text, 'inworld-tts-1.5-mini'::text]))) OR ((tts_provider = 'gemini'::text) AND (tts_model = ANY (ARRAY['gemini-3.8-flash-lite-tts'::text, 'gemini-3.8-flash-tts'::text]))))),
    CONSTRAINT jobs_tts_provider_check CHECK (((tts_provider IS NULL) OR (tts_provider = ANY (ARRAY['elevenlabs'::text, 'google'::text, 'inworld'::text, 'gemini'::text]))))
);

CREATE TABLE public.legacy_profile_revisions (
    id uuid CONSTRAINT profile_revisions_id_not_null NOT NULL,
    profile_id text CONSTRAINT profile_revisions_profile_id_not_null NOT NULL,
    content text CONSTRAINT profile_revisions_content_not_null NOT NULL,
    content_hash text CONSTRAINT profile_revisions_content_hash_not_null NOT NULL,
    source text DEFAULT 'update'::text CONSTRAINT profile_revisions_source_not_null NOT NULL,
    status text DEFAULT 'active'::text CONSTRAINT profile_revisions_status_not_null NOT NULL,
    version_number integer DEFAULT 1 CONSTRAINT profile_revisions_version_number_not_null NOT NULL,
    version_label text DEFAULT 'v1'::text CONSTRAINT profile_revisions_version_label_not_null NOT NULL,
    activated_at timestamp with time zone,
    deprecated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT profile_revisions_created_at_not_null NOT NULL,
    created_by uuid,
    restored_from_revision_id uuid,
    structured_content jsonb,
    CONSTRAINT profile_revisions_source_check CHECK ((source = ANY (ARRAY['create'::text, 'update'::text, 'restore'::text, 'starter_profile_form'::text, 'candidate_promotion'::text, 'legacy_normalization'::text, 'lesson_population'::text, 'profile_revision_refresh'::text]))),
    CONSTRAINT profile_revisions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'deprecated'::text]))),
    CONSTRAINT profile_revisions_version_number_check CHECK (((version_number IS NULL) OR (version_number > 0)))
);

CREATE TABLE public.legacy_profiles (
    id text CONSTRAINT profiles_id_not_null NOT NULL,
    label text CONSTRAINT profiles_label_not_null NOT NULL,
    active_revision_id uuid,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT profiles_created_at_not_null NOT NULL,
    updated_at timestamp with time zone DEFAULT now() CONSTRAINT profiles_updated_at_not_null NOT NULL,
    provenance text DEFAULT 'unknown'::text CONSTRAINT profiles_provenance_not_null NOT NULL,
    initial_enrichment_completed_at timestamp with time zone,
    CONSTRAINT profiles_enrichment_completion_check CHECK (((provenance = 'evidence_enriched'::text) = (initial_enrichment_completed_at IS NOT NULL))),
    CONSTRAINT profiles_provenance_check CHECK ((provenance = ANY (ARRAY['unknown'::text, 'tutor_only'::text, 'evidence_enriched'::text])))
);

CREATE TABLE public.legacy_student_profile_bindings (
    id uuid CONSTRAINT student_profile_bindings_id_not_null NOT NULL,
    student_id uuid CONSTRAINT student_profile_bindings_student_id_not_null NOT NULL,
    profile_id text CONSTRAINT student_profile_bindings_profile_id_not_null NOT NULL,
    effective_from timestamp with time zone CONSTRAINT student_profile_bindings_effective_from_not_null NOT NULL,
    effective_to timestamp with time zone,
    reason text,
    changed_by uuid,
    created_at timestamp with time zone DEFAULT now() CONSTRAINT student_profile_bindings_created_at_not_null NOT NULL,
    CONSTRAINT student_profile_bindings_effective_window_check CHECK (((effective_to IS NULL) OR (effective_to > effective_from)))
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
    assignment_session_id uuid,
    CONSTRAINT lesson_memory_entries_confirmed_source_pair_check CHECK ((((source_storage_uri IS NULL) AND (source_content_hash IS NULL)) OR ((source_storage_uri IS NOT NULL) AND (source_content_hash IS NOT NULL) AND (NULLIF(btrim(source_storage_uri), ''::text) IS NOT NULL) AND (source_content_hash ~ '^[0-9a-f]{64}$'::text)))),
    CONSTRAINT lesson_memory_entries_source_kind_check CHECK ((source_kind = 'lesson_transcript'::text)),
    CONSTRAINT lesson_memory_entries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'failed'::text, 'superseded'::text])))
);

CREATE TABLE public.mcp_oauth_artifacts (
    kind text NOT NULL,
    id_hash text NOT NULL,
    payload jsonb NOT NULL,
    grant_id text,
    uid text,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone
);

CREATE TABLE public.mcp_oauth_grants (
    id text NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    client_id text NOT NULL,
    resource text NOT NULL,
    scope text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mcp_oauth_grants_scope_check CHECK ((scope = 'teaching_context.read'::text))
);

CREATE TABLE public.mcp_profile_identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    workspace_id uuid NOT NULL
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

CREATE TABLE public.profile_initial_enrichment_operations (
    id uuid NOT NULL,
    legacy_profile_id text,
    student_id uuid NOT NULL,
    assignment_session_id uuid CONSTRAINT profile_initial_enrichment_opera_assignment_session_id_not_null NOT NULL,
    recording_id uuid NOT NULL,
    transcript_id uuid NOT NULL,
    transcript_storage_uri text CONSTRAINT profile_initial_enrichment_oper_transcript_storage_uri_not_null NOT NULL,
    transcript_hash text NOT NULL,
    source_identity_kind text CONSTRAINT profile_initial_enrichment_operat_source_identity_kind_not_null NOT NULL,
    source_fingerprint_scheme text CONSTRAINT profile_initial_enrichment_o_source_fingerprint_scheme_not_null NOT NULL,
    source_fingerprint text CONSTRAINT profile_initial_enrichment_operatio_source_fingerprint_not_null NOT NULL,
    lesson_memory_entry_id uuid,
    seed_revision_id uuid,
    seed_revision_hash text,
    generation_input jsonb,
    generation_provider text,
    generation_model text,
    state text DEFAULT 'waiting_evidence'::text NOT NULL,
    submission_id uuid,
    submission_reserved_at timestamp with time zone,
    validated_result jsonb,
    result_hash text,
    result_revision_id uuid,
    failure_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profile_initial_enrichment_result_check CHECK (((validated_result IS NULL) = (result_hash IS NULL))),
    CONSTRAINT profile_initial_enrichment_seed_pair_check CHECK (((seed_revision_id IS NULL) = (seed_revision_hash IS NULL))),
    CONSTRAINT profile_initial_enrichment_source_hash_check CHECK ((transcript_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT profile_initial_enrichment_state_check CHECK ((state = ANY (ARRAY['waiting_evidence'::text, 'queued'::text, 'submitting'::text, 'result_ready'::text, 'succeeded'::text, 'failed'::text, 'uncertain'::text, 'superseded'::text]))),
    CONSTRAINT profile_initial_enrichment_submission_check CHECK (((submission_id IS NULL) = (submission_reserved_at IS NULL))),
    CONSTRAINT profile_initial_enrichment_success_check CHECK (((state <> 'succeeded'::text) OR (result_revision_id IS NOT NULL)))
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
    request_envelope jsonb,
    assignment_session_id uuid
);

CREATE TABLE public.recording_upload_operation_attempts (
    operation_id uuid NOT NULL,
    attempt_token uuid NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    candidate_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    cleanup_next_attempt_at timestamp with time zone DEFAULT now() CONSTRAINT recording_upload_operation_att_cleanup_next_attempt_at_not_null NOT NULL,
    CONSTRAINT recording_upload_operation_attempts_state_check CHECK ((state = ANY (ARRAY['active'::text, 'obsolete'::text, 'adopted'::text])))
);

CREATE TABLE public.recording_upload_operations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    operation_uuid uuid NOT NULL,
    recording_id uuid NOT NULL,
    student_id uuid NOT NULL,
    audio_topology text NOT NULL,
    requested_provider text,
    request_profile text NOT NULL,
    state text DEFAULT 'processing'::text NOT NULL,
    attempt_token uuid,
    attempt_expires_at timestamp with time zone,
    final_recording_id uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome_kind text,
    canonical_assignment_session_id uuid,
    CONSTRAINT recording_upload_operations_completed_check CHECK ((((state = 'processing'::text) AND (final_recording_id IS NULL) AND (canonical_assignment_session_id IS NULL) AND (outcome_kind IS NULL) AND (completed_at IS NULL)) OR ((state = 'completed'::text) AND (completed_at IS NOT NULL) AND (((outcome_kind = 'source_candidate'::text) AND (final_recording_id IS NOT NULL) AND (canonical_assignment_session_id IS NULL)) OR ((outcome_kind = 'existing_assignment_resumed'::text) AND (final_recording_id IS NULL) AND (canonical_assignment_session_id IS NOT NULL)))))),
    CONSTRAINT recording_upload_operations_outcome_kind_check CHECK (((outcome_kind IS NULL) OR (outcome_kind = ANY (ARRAY['source_candidate'::text, 'existing_assignment_resumed'::text])))),
    CONSTRAINT recording_upload_operations_state_check CHECK ((state = ANY (ARRAY['processing'::text, 'completed'::text])))
);

CREATE TABLE public.recordings (
    id uuid NOT NULL,
    source text NOT NULL,
    student_id uuid,
    source_path text,
    storage_uri text,
    sha256 text,
    bytes bigint NOT NULL,
    duration_sec integer,
    channels integer,
    status text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    audio_topology text,
    workspace_id uuid NOT NULL,
    audio_lifecycle text DEFAULT 'retained'::text NOT NULL,
    audio_deletion_requested_at timestamp with time zone,
    audio_deleted_at timestamp with time zone,
    audio_deletion_attempt_count integer DEFAULT 0 NOT NULL,
    audio_deletion_error_code text,
    audio_deletion_next_attempt_at timestamp with time zone,
    media_preparation_version text,
    source_identity_kind text,
    source_fingerprint_scheme text,
    source_fingerprint text,
    CONSTRAINT recordings_audio_deletion_attempt_count_check CHECK ((audio_deletion_attempt_count >= 0)),
    CONSTRAINT recordings_audio_lifecycle_check CHECK ((audio_lifecycle = ANY (ARRAY['not_retained'::text, 'retained'::text, 'pending'::text, 'deleting'::text, 'deleted'::text, 'delete_failed'::text]))),
    CONSTRAINT recordings_audio_lifecycle_uri_check CHECK ((((audio_lifecycle = ANY (ARRAY['not_retained'::text, 'deleted'::text])) AND (storage_uri IS NULL)) OR ((audio_lifecycle = ANY (ARRAY['retained'::text, 'pending'::text, 'deleting'::text, 'delete_failed'::text])) AND (storage_uri IS NOT NULL)))),
    CONSTRAINT recordings_audio_topology_check CHECK ((audio_topology = ANY (ARRAY['mixed_recording'::text, 'trusted_split_channels'::text]))),
    CONSTRAINT recordings_source_check CHECK ((source = ANY (ARRAY['upload'::text, 'manual_transcript'::text]))),
    CONSTRAINT recordings_source_identity_complete_check CHECK ((((source_identity_kind IS NULL) AND (source_fingerprint_scheme IS NULL) AND (source_fingerprint IS NULL)) OR ((source_identity_kind = ANY (ARRAY['audio'::text, 'manual_transcript'::text])) AND (NULLIF(btrim(source_fingerprint_scheme), ''::text) IS NOT NULL) AND (source_fingerprint ~ '^[0-9a-f]{64}$'::text)))),
    CONSTRAINT recordings_source_identity_kind_matches_source_check CHECK (((source_identity_kind IS NULL) OR ((source = 'upload'::text) AND (source_identity_kind = 'audio'::text)) OR ((source = 'manual_transcript'::text) AND (source_identity_kind = 'manual_transcript'::text)))),
    CONSTRAINT recordings_status_check CHECK ((status = ANY (ARRAY['ingested'::text, 'queued'::text, 'transcribing'::text, 'transcribed'::text, 'failed'::text])))
);

CREATE TABLE public.schema_migrations (
    id text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    execution_ms integer NOT NULL,
    tool_version text NOT NULL
);

CREATE TABLE public.student_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    student_id uuid NOT NULL,
    workspace_id uuid,
    type text NOT NULL,
    category text NOT NULL,
    entity_id uuid NOT NULL,
    occurred_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    recorded_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    transaction_id bigint DEFAULT txid_current() NOT NULL,
    actor_kind text DEFAULT 'unknown'::text NOT NULL,
    actor_user_id uuid,
    payload_version integer DEFAULT 1 NOT NULL,
    payload jsonb NOT NULL,
    CONSTRAINT student_activity_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['user'::text, 'system'::text, 'unknown'::text]))),
    CONSTRAINT student_activity_category_check CHECK ((category = ANY (ARRAY['lessons'::text, 'profile'::text, 'billing'::text, 'lifecycle'::text, 'operations'::text]))),
    CONSTRAINT student_activity_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT student_activity_payload_version_check CHECK ((payload_version = 1)),
    CONSTRAINT student_activity_type_check CHECK ((type = ANY (ARRAY['lesson_created'::text, 'lesson_changed'::text, 'lesson_completed'::text, 'lesson_restored'::text, 'lesson_canceled'::text, 'lesson_no_show'::text, 'recurrence_changed'::text, 'profile_saved'::text, 'profile_restored'::text, 'profile_activated'::text, 'candidate_approved'::text, 'candidate_rejected'::text, 'candidate_deferred'::text, 'candidate_promoted'::text, 'student_created'::text, 'student_renamed'::text, 'student_archived'::text, 'student_restored'::text, 'reminder_hidden'::text, 'reminder_restored'::text, 'homework_failed'::text, 'homework_started'::text])))
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
    activity_id uuid,
    reversal_activity_id uuid,
    CONSTRAINT student_credit_events_nonzero_check CHECK ((quantity_delta <> 0)),
    CONSTRAINT student_credit_events_type_check CHECK ((event_type = ANY (ARRAY['credit_added'::text, 'credit_consumed'::text, 'credit_adjusted'::text])))
);

CREATE TABLE public.student_lesson_plans (
    student_id uuid NOT NULL,
    workspace_id uuid,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    default_duration_minutes integer DEFAULT 60 NOT NULL,
    scheduling_notes text,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_schedule_preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT student_lesson_plans_duration_check CHECK ((default_duration_minutes > 0))
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
    schedule_hidden_at timestamp with time zone,
    schedule_hidden_by uuid,
    schedule_hidden_reason text,
    schedule_origin_history jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT student_lessons_duration_check CHECK ((duration_minutes > 0)),
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

CREATE TABLE public.student_profile_candidate_draft_revisions (
    candidate_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    student_id uuid NOT NULL
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

CREATE TABLE public.student_profile_revisions (
    id uuid NOT NULL,
    student_id uuid NOT NULL,
    content text NOT NULL,
    structured_content jsonb,
    content_hash text NOT NULL,
    source text NOT NULL,
    status text NOT NULL,
    version_number integer NOT NULL,
    version_label text NOT NULL,
    activated_at timestamp with time zone,
    deprecated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    restored_from_revision_id uuid,
    legacy_profile_id text,
    legacy_revision_id uuid,
    legacy_version_label text,
    CONSTRAINT student_profile_revisions_source_check CHECK ((source = ANY (ARRAY['create'::text, 'update'::text, 'restore'::text, 'starter_profile_form'::text, 'candidate_promotion'::text, 'legacy_normalization'::text, 'lesson_population'::text, 'profile_revision_refresh'::text]))),
    CONSTRAINT student_profile_revisions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'deprecated'::text]))),
    CONSTRAINT student_profile_revisions_version_number_check CHECK ((version_number > 0))
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
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    archived_by uuid,
    archive_reason text,
    workspace_id uuid,
    profile_provenance text DEFAULT 'tutor_only'::text NOT NULL,
    profile_initial_enrichment_completed_at timestamp with time zone,
    email text,
    CONSTRAINT students_check CHECK (((profile_provenance = 'evidence_enriched'::text) = (profile_initial_enrichment_completed_at IS NOT NULL))),
    CONSTRAINT students_email_length CHECK (((email IS NULL) OR ((length(email) <= 320) AND (email = btrim(email)) AND (email <> ''::text)))),
    CONSTRAINT students_profile_provenance_check CHECK ((profile_provenance = ANY (ARRAY['unknown'::text, 'tutor_only'::text, 'evidence_enriched'::text])))
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

CREATE TABLE public.transcription_runs (
    id uuid NOT NULL,
    recording_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    provider text NOT NULL,
    request_profile text NOT NULL,
    state text DEFAULT 'queued'::text NOT NULL,
    claim_token uuid,
    claimed_at timestamp with time zone,
    claim_expires_at timestamp with time zone,
    submission_slots_reserved integer DEFAULT 0 NOT NULL,
    submission_slot_limit integer DEFAULT 3 NOT NULL,
    current_submission_slot integer,
    last_submission_outcome text,
    provider_request_id text,
    error_code text,
    error_detail text,
    provider_latency_ms integer,
    total_latency_ms integer,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT transcription_runs_current_slot_check CHECK (((current_submission_slot IS NULL) OR ((current_submission_slot >= 1) AND (current_submission_slot <= submission_slot_limit)))),
    CONSTRAINT transcription_runs_outcome_check CHECK (((last_submission_outcome IS NULL) OR (last_submission_outcome = ANY (ARRAY['known_success'::text, 'known_failure'::text, 'ambiguous'::text])))),
    CONSTRAINT transcription_runs_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'claimed'::text, 'submitting'::text, 'retry_wait'::text, 'succeeded'::text, 'failed'::text]))),
    CONSTRAINT transcription_runs_submission_slot_limit_check CHECK ((submission_slot_limit = 3)),
    CONSTRAINT transcription_runs_submission_slots_check CHECK (((submission_slots_reserved >= 0) AND (submission_slots_reserved <= submission_slot_limit)))
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
    user_id uuid NOT NULL,
    elevenlabs_key_encrypted text,
    tts_provider text DEFAULT 'elevenlabs'::text NOT NULL,
    default_preset text DEFAULT 'b1-default'::text NOT NULL,
    default_voice_accent text DEFAULT 'american'::text NOT NULL,
    default_tts_strategy text DEFAULT 'auto'::text NOT NULL,
    enable_notifications boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_settings_tts_provider_check CHECK ((tts_provider = ANY (ARRAY['elevenlabs'::text, 'google'::text, 'inworld'::text, 'gemini'::text]))),
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

CREATE TABLE public.workspace_calendar_connections (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    grant_id uuid NOT NULL,
    calendar_id text NOT NULL,
    calendar_name text NOT NULL,
    calendar_timezone text NOT NULL,
    generation integer DEFAULT 1 NOT NULL,
    status text NOT NULL,
    sync_token text,
    sync_page_token text,
    sync_query jsonb DEFAULT '{"showDeleted": true, "singleEvents": false}'::jsonb NOT NULL,
    last_synced_at timestamp with time zone,
    next_sync_at timestamp with time zone DEFAULT now() NOT NULL,
    lease_token uuid,
    lease_expires_at timestamp with time zone,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_calendar_connections_generation_check CHECK ((generation > 0)),
    CONSTRAINT workspace_calendar_connections_status_check CHECK ((status = ANY (ARRAY['connected'::text, 'reconnect_required'::text, 'disconnected'::text])))
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

ALTER TABLE ONLY public.assignment_source_binding_audit
    ADD CONSTRAINT assignment_source_binding_audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.assignment_source_bindings
    ADD CONSTRAINT assignment_source_bindings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_lesson_bindings
    ADD CONSTRAINT calendar_lesson_bindings_connection_id_provider_event_id_key UNIQUE (connection_id, provider_event_id);

ALTER TABLE ONLY public.calendar_lesson_bindings
    ADD CONSTRAINT calendar_lesson_bindings_pkey PRIMARY KEY (lesson_id);

ALTER TABLE ONLY public.calendar_lesson_bindings
    ADD CONSTRAINT calendar_lesson_bindings_schedule_binding_id_original_start_key UNIQUE (schedule_binding_id, original_start_time);

ALTER TABLE ONLY public.calendar_operations
    ADD CONSTRAINT calendar_operations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.calendar_operations
    ADD CONSTRAINT calendar_operations_workspace_id_kind_idempotency_key_key UNIQUE (workspace_id, kind, idempotency_key);

ALTER TABLE ONLY public.calendar_schedule_bindings
    ADD CONSTRAINT calendar_schedule_bindings_connection_id_association_marker_key UNIQUE (connection_id, association_marker);

ALTER TABLE ONLY public.calendar_schedule_bindings
    ADD CONSTRAINT calendar_schedule_bindings_connection_id_provider_event_id_key UNIQUE (connection_id, provider_event_id);

ALTER TABLE ONLY public.calendar_schedule_bindings
    ADD CONSTRAINT calendar_schedule_bindings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.generation_budget_counters
    ADD CONSTRAINT generation_budget_counters_pkey PRIMARY KEY (bucket_type, bucket_start, provider, model);

ALTER TABLE ONLY public.google_oauth_attempts
    ADD CONSTRAINT google_oauth_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.google_oauth_attempts
    ADD CONSTRAINT google_oauth_attempts_state_hash_key UNIQUE (state_hash);

ALTER TABLE ONLY public.google_oauth_grants
    ADD CONSTRAINT google_oauth_grants_id_workspace_id_key UNIQUE (id, workspace_id);

ALTER TABLE ONLY public.google_oauth_grants
    ADD CONSTRAINT google_oauth_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.google_oauth_grants
    ADD CONSTRAINT google_oauth_grants_workspace_id_authorizing_user_id_issuer_key UNIQUE (workspace_id, authorizing_user_id, issuer, subject, client_id);

ALTER TABLE ONLY public.homework_memory_entries
    ADD CONSTRAINT homework_memory_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.job_action_history
    ADD CONSTRAINT job_action_history_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.jobs
    ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.lesson_memory_entries
    ADD CONSTRAINT lesson_memory_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mcp_oauth_artifacts
    ADD CONSTRAINT mcp_oauth_artifacts_pkey PRIMARY KEY (kind, id_hash);

ALTER TABLE ONLY public.mcp_oauth_grants
    ADD CONSTRAINT mcp_oauth_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mcp_profile_identities
    ADD CONSTRAINT mcp_profile_identities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mcp_profile_identities
    ADD CONSTRAINT mcp_profile_identities_user_id_workspace_id_key UNIQUE (user_id, workspace_id);

ALTER TABLE ONLY public.ops_actions
    ADD CONSTRAINT ops_actions_pkey PRIMARY KEY (operation_id);

ALTER TABLE ONLY public.profile_initial_enrichment_operations
    ADD CONSTRAINT profile_initial_enrichment_operations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.legacy_profile_revisions
    ADD CONSTRAINT profile_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.legacy_profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompt_packages
    ADD CONSTRAINT prompt_packages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.recording_upload_operation_attempts
    ADD CONSTRAINT recording_upload_operation_attempts_pkey PRIMARY KEY (operation_id, attempt_token);

ALTER TABLE ONLY public.recording_upload_operations
    ADD CONSTRAINT recording_upload_operations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.recording_upload_operations
    ADD CONSTRAINT recording_upload_operations_workspace_operation_unique UNIQUE (workspace_id, operation_uuid);

ALTER TABLE ONLY public.recordings
    ADD CONSTRAINT recordings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_activity
    ADD CONSTRAINT student_activity_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_lesson_plans
    ADD CONSTRAINT student_lesson_plans_pkey PRIMARY KEY (student_id);

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

ALTER TABLE ONLY public.legacy_student_profile_bindings
    ADD CONSTRAINT student_profile_bindings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_profile_candidate_draft_revisions
    ADD CONSTRAINT student_profile_candidate_draft_revisions_pkey PRIMARY KEY (candidate_id, revision_id);

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_student_id_id_key UNIQUE (student_id, id);

ALTER TABLE ONLY public.student_profile_revisions
    ADD CONSTRAINT student_profile_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.student_profile_revisions
    ADD CONSTRAINT student_profile_revisions_student_id_id_key UNIQUE (student_id, id);

ALTER TABLE ONLY public.student_profile_revisions
    ADD CONSTRAINT student_profile_revisions_student_id_legacy_revision_id_key UNIQUE (student_id, legacy_revision_id);

ALTER TABLE ONLY public.student_profile_revisions
    ADD CONSTRAINT student_profile_revisions_student_id_version_number_key UNIQUE (student_id, version_number);

ALTER TABLE ONLY public.student_reminder_preferences
    ADD CONSTRAINT student_reminder_preferences_pkey PRIMARY KEY (student_id);

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_id_workspace_unique UNIQUE (id, workspace_id);

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.template_revisions
    ADD CONSTRAINT template_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.templates
    ADD CONSTRAINT templates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transcription_runs
    ADD CONSTRAINT transcription_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.transcripts
    ADD CONSTRAINT transcripts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_user_id_storage_key_key UNIQUE (user_id, storage_key);

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_business_settings
    ADD CONSTRAINT workspace_business_settings_pkey PRIMARY KEY (workspace_id);

ALTER TABLE ONLY public.workspace_calendar_connections
    ADD CONSTRAINT workspace_calendar_connections_id_workspace_id_key UNIQUE (id, workspace_id);

ALTER TABLE ONLY public.workspace_calendar_connections
    ADD CONSTRAINT workspace_calendar_connections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_memberships
    ADD CONSTRAINT workspace_memberships_pkey PRIMARY KEY (workspace_id, user_id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);

CREATE INDEX calendar_operations_dispatch ON public.calendar_operations USING btree (due_at) WHERE (state = ANY (ARRAY['pending'::text, 'running'::text, 'retry_wait'::text]));

CREATE INDEX google_oauth_attempts_browser_pending ON public.google_oauth_attempts USING btree (browser_binding_hash) WHERE (status = ANY (ARRAY['pending'::text, 'claimed'::text]));

CREATE UNIQUE INDEX homework_memory_replay_key ON public.homework_memory_entries USING btree (assignment_lineage_key, ((generation_notes ->> 'replayKey'::text))) WHERE (((generation_notes ->> 'replayKey'::text) IS NOT NULL) AND ((generation_notes ->> 'pendingEntryId'::text) IS NULL));

CREATE UNIQUE INDEX idx_alpha_invites_pending_email_normalized ON public.alpha_invites USING btree (email_normalized) WHERE (status = 'pending'::text);

CREATE INDEX idx_alpha_invites_status_expires_at ON public.alpha_invites USING btree (status, expires_at);

CREATE INDEX idx_assignment_sessions_lesson_updated ON public.assignment_sessions USING btree (lesson_id, updated_at DESC, id DESC) WHERE ((confirmed_step <> 'share'::text) AND (transcript_completed_at IS NULL) AND (lesson_id IS NOT NULL));

CREATE INDEX idx_assignment_sessions_user_active_updated ON public.assignment_sessions USING btree (user_id, updated_at DESC, id DESC) WHERE ((confirmed_step <> 'share'::text) AND (transcript_completed_at IS NULL));

CREATE UNIQUE INDEX idx_assignment_sessions_user_creation_request ON public.assignment_sessions USING btree (user_id, creation_request_id) WHERE (creation_request_id IS NOT NULL);

CREATE INDEX idx_assignment_sessions_user_updated ON public.assignment_sessions USING btree (user_id, updated_at DESC, id DESC);

CREATE INDEX idx_assignment_source_binding_audit_source ON public.assignment_source_binding_audit USING btree (user_id, student_id, source_identity_kind, source_fingerprint_scheme, source_fingerprint, created_at DESC);

CREATE UNIQUE INDEX idx_assignment_source_bindings_scoped_source ON public.assignment_source_bindings USING btree (user_id, student_id, source_identity_kind, source_fingerprint_scheme, source_fingerprint);

CREATE INDEX idx_assignment_source_bindings_session ON public.assignment_source_bindings USING btree (assignment_session_id);

CREATE UNIQUE INDEX idx_assignment_source_bindings_session_role ON public.assignment_source_bindings USING btree (assignment_session_id, binding_role);

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

CREATE INDEX idx_lesson_memory_entries_assignment_session ON public.lesson_memory_entries USING btree (assignment_session_id, generated_at DESC, id DESC);

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

CREATE INDEX idx_profile_revisions_profile_id_created_at ON public.legacy_profile_revisions USING btree (profile_id, created_at DESC);

CREATE INDEX idx_profile_revisions_profile_id_hash ON public.legacy_profile_revisions USING btree (profile_id, content_hash);

CREATE UNIQUE INDEX idx_profile_revisions_profile_version ON public.legacy_profile_revisions USING btree (profile_id, version_number);

CREATE UNIQUE INDEX idx_profile_revisions_single_active ON public.legacy_profile_revisions USING btree (profile_id) WHERE (status = 'active'::text);

CREATE INDEX idx_profiles_active_revision_id ON public.legacy_profiles USING btree (active_revision_id);

CREATE INDEX idx_profiles_label ON public.legacy_profiles USING btree (label);

CREATE INDEX idx_prompt_packages_lesson_updated ON public.prompt_packages USING btree (lesson_id, updated_at DESC, id DESC) WHERE (lesson_id IS NOT NULL);

CREATE INDEX idx_prompt_packages_recording_id ON public.prompt_packages USING btree (recording_id);

CREATE INDEX idx_prompt_packages_resolved_profile_id ON public.prompt_packages USING btree (resolved_profile_id);

CREATE INDEX idx_prompt_packages_resolved_template_id ON public.prompt_packages USING btree (resolved_template_id);

CREATE INDEX idx_prompt_packages_student_id ON public.prompt_packages USING btree (student_id);

CREATE INDEX idx_prompt_packages_student_memory_snapshot_id ON public.prompt_packages USING btree (student_memory_snapshot_id);

CREATE INDEX idx_prompt_packages_transcript_id ON public.prompt_packages USING btree (transcript_id);

CREATE INDEX idx_recording_upload_operation_attempts_obsolete ON public.recording_upload_operation_attempts USING btree (state, cleanup_next_attempt_at, retired_at) WHERE (state = 'obsolete'::text);

CREATE INDEX idx_recordings_created_at ON public.recordings USING btree (created_at);

CREATE UNIQUE INDEX idx_recordings_id_workspace_unique ON public.recordings USING btree (id, workspace_id);

CREATE INDEX idx_recordings_source ON public.recordings USING btree (source);

CREATE INDEX idx_recordings_status ON public.recordings USING btree (status);

CREATE INDEX idx_recordings_student_id ON public.recordings USING btree (student_id);

CREATE INDEX idx_recordings_workspace_id ON public.recordings USING btree (workspace_id);

CREATE INDEX idx_recordings_workspace_sha256 ON public.recordings USING btree (workspace_id, sha256, created_at DESC) WHERE (sha256 IS NOT NULL);

CREATE INDEX idx_schema_migrations_applied_at ON public.schema_migrations USING btree (applied_at DESC);

CREATE INDEX idx_student_activity_entity_transaction ON public.student_activity USING btree (entity_id, transaction_id);

CREATE INDEX idx_student_activity_page ON public.student_activity USING btree (workspace_id, student_id, occurred_at DESC, id DESC);

CREATE INDEX idx_student_credit_events_student_active ON public.student_credit_events USING btree (student_id, created_at DESC, id DESC) WHERE (voided_at IS NULL);

CREATE INDEX idx_student_credit_events_student_created_at ON public.student_credit_events USING btree (student_id, created_at DESC, id DESC);

CREATE INDEX idx_student_credit_events_workspace_active ON public.student_credit_events USING btree (workspace_id, student_id, created_at DESC, id DESC) WHERE (voided_at IS NULL);

CREATE INDEX idx_student_lessons_student_active_schedule ON public.student_lessons USING btree (student_id, starts_at DESC, id DESC) WHERE (schedule_hidden_at IS NULL);

CREATE INDEX idx_student_lessons_student_next ON public.student_lessons USING btree (student_id, starts_at, id) WHERE (status = 'scheduled'::text);

CREATE INDEX idx_student_lessons_student_starts_at ON public.student_lessons USING btree (student_id, starts_at DESC, id DESC);

CREATE INDEX idx_student_lessons_workspace_active_schedule ON public.student_lessons USING btree (workspace_id, starts_at, id) WHERE (schedule_hidden_at IS NULL);

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

CREATE INDEX idx_student_profile_bindings_effective_from ON public.legacy_student_profile_bindings USING btree (effective_from DESC);

CREATE INDEX idx_student_profile_bindings_profile_id ON public.legacy_student_profile_bindings USING btree (profile_id);

CREATE UNIQUE INDEX idx_student_profile_bindings_single_active ON public.legacy_student_profile_bindings USING btree (student_id) WHERE (effective_to IS NULL);

CREATE INDEX idx_student_profile_bindings_student_id ON public.legacy_student_profile_bindings USING btree (student_id);

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

CREATE INDEX idx_students_workspace_id ON public.students USING btree (workspace_id);

CREATE UNIQUE INDEX idx_students_workspace_student_lower_unique ON public.students USING btree (workspace_id, lower(student));

CREATE UNIQUE INDEX idx_template_revisions_single_active ON public.template_revisions USING btree (template_id) WHERE (status = 'active'::text);

CREATE INDEX idx_template_revisions_template_id_created_at ON public.template_revisions USING btree (template_id, created_at DESC);

CREATE INDEX idx_template_revisions_template_id_hash ON public.template_revisions USING btree (template_id, content_hash);

CREATE UNIQUE INDEX idx_template_revisions_template_version ON public.template_revisions USING btree (template_id, version_number);

CREATE INDEX idx_templates_active_revision_id ON public.templates USING btree (active_revision_id);

CREATE INDEX idx_templates_label ON public.templates USING btree (label);

CREATE UNIQUE INDEX idx_templates_single_default ON public.templates USING btree (is_default) WHERE is_default;

CREATE UNIQUE INDEX idx_transcription_runs_one_active_per_recording ON public.transcription_runs USING btree (recording_id) WHERE (state = ANY (ARRAY['queued'::text, 'claimed'::text, 'submitting'::text, 'retry_wait'::text]));

CREATE INDEX idx_transcription_runs_workspace_recording ON public.transcription_runs USING btree (workspace_id, recording_id, created_at DESC);

CREATE UNIQUE INDEX idx_transcripts_one_winner_per_recording ON public.transcripts USING btree (recording_id);

CREATE INDEX idx_transcripts_recording_id ON public.transcripts USING btree (recording_id);

CREATE INDEX idx_uploaded_files_created_at ON public.uploaded_files USING btree (created_at);

CREATE INDEX idx_uploaded_files_storage_key ON public.uploaded_files USING btree (storage_key);

CREATE INDEX idx_uploaded_files_storage_provider ON public.uploaded_files USING btree (storage_provider);

CREATE INDEX idx_uploaded_files_user_id ON public.uploaded_files USING btree (user_id);

CREATE INDEX idx_user_settings_user_id ON public.user_settings USING btree (user_id);

CREATE INDEX idx_users_email ON public.users USING btree (email);

CREATE INDEX idx_users_role ON public.users USING btree (role);

CREATE INDEX idx_workspace_memberships_user_id ON public.workspace_memberships USING btree (user_id);

CREATE INDEX mcp_oauth_artifacts_expiry_idx ON public.mcp_oauth_artifacts USING btree (expires_at);

CREATE INDEX mcp_oauth_artifacts_grant_idx ON public.mcp_oauth_artifacts USING btree (kind, grant_id);

CREATE INDEX mcp_oauth_artifacts_uid_idx ON public.mcp_oauth_artifacts USING btree (kind, uid) WHERE (uid IS NOT NULL);

CREATE INDEX mcp_oauth_grants_user_idx ON public.mcp_oauth_grants USING btree (user_id);

CREATE INDEX profile_initial_enrichment_exact_source_idx ON public.profile_initial_enrichment_operations USING btree (student_id, assignment_session_id, transcript_id, transcript_hash);

CREATE UNIQUE INDEX profile_initial_enrichment_live_student_idx ON public.profile_initial_enrichment_operations USING btree (student_id) WHERE (state = ANY (ARRAY['waiting_evidence'::text, 'queued'::text, 'submitting'::text, 'result_ready'::text, 'uncertain'::text]));

CREATE INDEX profile_initial_enrichment_reconcile_idx ON public.profile_initial_enrichment_operations USING btree (state, updated_at) WHERE (state = ANY (ARRAY['waiting_evidence'::text, 'queued'::text, 'submitting'::text, 'result_ready'::text]));

CREATE INDEX profile_initial_enrichment_success_student_idx ON public.profile_initial_enrichment_operations USING btree (student_id) WHERE (state = 'succeeded'::text);

CREATE UNIQUE INDEX student_memory_snapshot_replay_key ON public.student_memory_snapshots USING btree (student_id, ((generation_notes ->> 'replayKey'::text))) WHERE (((generation_notes ->> 'replayKey'::text) IS NOT NULL) AND ((generation_notes ->> 'pendingEntryId'::text) IS NULL));

CREATE UNIQUE INDEX student_profile_revisions_single_active ON public.student_profile_revisions USING btree (student_id) WHERE (status = 'active'::text);

CREATE INDEX student_profile_revisions_student_created ON public.student_profile_revisions USING btree (student_id, created_at DESC);

CREATE INDEX student_profile_revisions_student_hash ON public.student_profile_revisions USING btree (student_id, content_hash);

CREATE UNIQUE INDEX workspace_calendar_connections_remote_active ON public.workspace_calendar_connections USING btree (calendar_id) WHERE (status <> 'disconnected'::text);

CREATE UNIQUE INDEX workspace_calendar_connections_workspace_active ON public.workspace_calendar_connections USING btree (workspace_id) WHERE (status <> 'disconnected'::text);

CREATE TRIGGER assignment_sessions_calendar_projection_guard BEFORE INSERT OR UPDATE OF lesson_id ON public.assignment_sessions FOR EACH ROW EXECUTE FUNCTION public.guard_calendar_projection_reference('lesson_id');

CREATE TRIGGER assignment_sessions_confirmed_source_audio_deletion AFTER INSERT OR UPDATE OF confirmed_snapshot, recording_id, student_id ON public.assignment_sessions FOR EACH ROW EXECUTE FUNCTION public.request_confirmed_source_audio_deletion();

CREATE TRIGGER calendar_membership_authority_loss AFTER DELETE OR UPDATE OF role ON public.workspace_memberships FOR EACH ROW EXECUTE FUNCTION public.fence_calendar_authority_loss();

CREATE TRIGGER calendar_user_authority_loss AFTER UPDATE OF is_active ON public.users FOR EACH ROW EXECUTE FUNCTION public.fence_calendar_authority_loss();

CREATE TRIGGER drafts_calendar_projection_guard BEFORE INSERT OR UPDATE OF lesson_id ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.guard_calendar_projection_reference('lesson_id');

CREATE TRIGGER freeze_legacy_profile_bindings BEFORE INSERT OR DELETE OR UPDATE ON public.legacy_student_profile_bindings FOR EACH ROW EXECUTE FUNCTION public.reject_legacy_profile_write();

CREATE TRIGGER freeze_legacy_profile_revisions BEFORE INSERT OR DELETE OR UPDATE ON public.legacy_profile_revisions FOR EACH ROW EXECUTE FUNCTION public.reject_legacy_profile_write();

CREATE TRIGGER freeze_legacy_profiles BEFORE INSERT OR DELETE OR UPDATE ON public.legacy_profiles FOR EACH ROW EXECUTE FUNCTION public.reject_legacy_profile_write();

CREATE TRIGGER guard_completed_recording_source BEFORE UPDATE OF student_id, audio_topology, source_identity_kind, source_fingerprint_scheme, source_fingerprint ON public.recordings FOR EACH ROW EXECUTE FUNCTION public.guard_completed_transcript_source();

CREATE TRIGGER guard_completed_transcript_insert BEFORE INSERT ON public.transcripts FOR EACH ROW EXECUTE FUNCTION public.guard_completed_transcript_source();

CREATE TRIGGER guard_completed_transcript_update BEFORE UPDATE OF storage_uri, content_hash, working_version, summary_json, recording_id ON public.transcripts FOR EACH ROW EXECUTE FUNCTION public.guard_completed_transcript_source();

CREATE TRIGGER guard_session_homework_prompt BEFORE INSERT OR UPDATE ON public.prompt_packages FOR EACH ROW EXECUTE FUNCTION public.guard_session_homework_artifact();

CREATE TRIGGER historical_drafts_read_only BEFORE INSERT OR UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.reject_historical_assignment_write();

CREATE TRIGGER historical_homework_batch_read_only BEFORE INSERT OR UPDATE ON public.student_memory_openai_batch_items FOR EACH ROW EXECUTE FUNCTION public.reject_historical_assignment_write();

CREATE TRIGGER historical_homework_memory_read_only BEFORE INSERT OR UPDATE ON public.homework_memory_entries FOR EACH ROW EXECUTE FUNCTION public.reject_historical_assignment_write();

CREATE TRIGGER historical_jobs_read_only BEFORE INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.reject_historical_assignment_write();

CREATE TRIGGER historical_profile_enrichment_read_only BEFORE INSERT OR UPDATE ON public.profile_initial_enrichment_operations FOR EACH ROW EXECUTE FUNCTION public.reject_historical_assignment_write();

CREATE TRIGGER historical_sessions_read_only BEFORE INSERT OR UPDATE ON public.assignment_sessions FOR EACH ROW EXECUTE FUNCTION public.reject_historical_assignment_write();

CREATE TRIGGER homework_memory_canonical_student_lock BEFORE INSERT OR DELETE OR UPDATE ON public.homework_memory_entries FOR EACH ROW EXECUTE FUNCTION public.lock_canonical_memory_student();

CREATE TRIGGER homework_memory_entries_calendar_projection_guard BEFORE INSERT OR UPDATE OF lesson_id ON public.homework_memory_entries FOR EACH ROW EXECUTE FUNCTION public.guard_calendar_projection_reference('lesson_id');

CREATE TRIGGER jobs_calendar_projection_guard BEFORE INSERT OR UPDATE OF lesson_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.guard_calendar_projection_reference('lesson_id');

CREATE TRIGGER lesson_memory_canonical_student_lock BEFORE INSERT OR DELETE OR UPDATE ON public.lesson_memory_entries FOR EACH ROW EXECUTE FUNCTION public.lock_canonical_memory_student();

CREATE TRIGGER mcp_profile_identity_immutable BEFORE UPDATE ON public.mcp_profile_identities FOR EACH ROW EXECUTE FUNCTION public.reject_mcp_profile_identity_update();

CREATE TRIGGER memory_confirmed_source_delete_lock BEFORE DELETE ON public.assignment_source_bindings FOR EACH ROW WHEN ((old.binding_role = 'confirmed'::text)) EXECUTE FUNCTION public.lock_memory_source_student();

CREATE TRIGGER memory_confirmed_source_insert_lock BEFORE INSERT ON public.assignment_source_bindings FOR EACH ROW WHEN ((new.binding_role = 'confirmed'::text)) EXECUTE FUNCTION public.lock_memory_source_student();

CREATE TRIGGER memory_confirmed_source_snapshot_lock BEFORE UPDATE ON public.assignment_sessions FOR EACH ROW WHEN ((((old.confirmed_snapshot -> 'source'::text) IS DISTINCT FROM (new.confirmed_snapshot -> 'source'::text)) OR (old.student_id IS DISTINCT FROM new.student_id))) EXECUTE FUNCTION public.lock_memory_source_student();

CREATE TRIGGER memory_confirmed_source_update_lock BEFORE UPDATE ON public.assignment_source_bindings FOR EACH ROW WHEN (((old.binding_role = 'confirmed'::text) OR (new.binding_role = 'confirmed'::text))) EXECUTE FUNCTION public.lock_memory_source_student();

CREATE TRIGGER preserve_assignment_artifact_identity BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.preserve_assignment_artifact_identity();

CREATE TRIGGER preserve_assignment_draft_format BEFORE UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.preserve_assignment_draft_format();

CREATE TRIGGER preserve_transcript_completion_history BEFORE UPDATE ON public.assignment_sessions FOR EACH ROW EXECUTE FUNCTION public.preserve_transcript_completion_history();

CREATE TRIGGER prompt_packages_calendar_projection_guard BEFORE INSERT OR UPDATE OF lesson_id ON public.prompt_packages FOR EACH ROW EXECUTE FUNCTION public.guard_calendar_projection_reference('lesson_id');

CREATE TRIGGER recordings_workspace_authority_trigger BEFORE INSERT OR UPDATE OF student_id, workspace_id ON public.recordings FOR EACH ROW EXECUTE FUNCTION public.enforce_recording_workspace_authority();

CREATE TRIGGER set_drafts_updated_at BEFORE UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.set_drafts_updated_at();

CREATE TRIGGER set_homework_memory_entries_updated_at BEFORE UPDATE ON public.homework_memory_entries FOR EACH ROW EXECUTE FUNCTION public.set_homework_memory_entries_updated_at();

CREATE TRIGGER set_jobs_student_id BEFORE INSERT OR UPDATE OF recording_id, prompt_package_id, draft_id, source_job_id, student_id ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_jobs_student_id();

CREATE TRIGGER set_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.set_jobs_updated_at();

CREATE TRIGGER set_lesson_memory_entries_updated_at BEFORE UPDATE ON public.lesson_memory_entries FOR EACH ROW EXECUTE FUNCTION public.set_lesson_memory_entries_updated_at();

CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.legacy_profiles FOR EACH ROW EXECUTE FUNCTION public.set_profiles_updated_at();

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

CREATE TRIGGER student_activity_actor BEFORE INSERT ON public.student_activity FOR EACH ROW EXECUTE FUNCTION public.set_student_activity_actor();

CREATE TRIGGER student_activity_immutable BEFORE UPDATE ON public.student_activity FOR EACH ROW EXECUTE FUNCTION public.reject_student_activity_update();

CREATE TRIGGER student_activity_retention BEFORE DELETE ON public.student_activity FOR EACH ROW EXECUTE FUNCTION public.reject_student_activity_delete();

CREATE TRIGGER student_candidate_activity AFTER UPDATE ON public.student_profile_candidates FOR EACH ROW EXECUTE FUNCTION public.record_student_candidate_activity();

CREATE TRIGGER student_credit_activity BEFORE INSERT OR UPDATE ON public.student_credit_events FOR EACH ROW EXECUTE FUNCTION public.link_student_credit_activity();

CREATE TRIGGER student_credit_events_calendar_projection_guard BEFORE INSERT OR UPDATE OF source_lesson_id ON public.student_credit_events FOR EACH ROW EXECUTE FUNCTION public.guard_calendar_projection_reference('source_lesson_id');

CREATE TRIGGER student_homework_started_activity AFTER UPDATE ON public.assignment_sessions FOR EACH ROW EXECUTE FUNCTION public.record_student_homework_started_activity();

CREATE TRIGGER student_job_failure_activity AFTER INSERT OR UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.record_student_job_failure_activity();

CREATE TRIGGER student_lesson_activity AFTER INSERT OR UPDATE ON public.student_lessons FOR EACH ROW EXECUTE FUNCTION public.record_student_lesson_activity();

CREATE TRIGGER student_lifecycle_activity AFTER INSERT OR UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.record_student_lifecycle_activity();

CREATE TRIGGER student_profile_activity AFTER INSERT OR UPDATE ON public.student_profile_revisions FOR EACH ROW EXECUTE FUNCTION public.record_student_profile_activity();

CREATE TRIGGER student_profile_candidates_calendar_projection_guard BEFORE INSERT OR UPDATE OF source_lesson_id ON public.student_profile_candidates FOR EACH ROW EXECUTE FUNCTION public.guard_calendar_projection_reference('source_lesson_id');

CREATE TRIGGER student_reminder_activity AFTER INSERT OR UPDATE ON public.student_reminder_preferences FOR EACH ROW EXECUTE FUNCTION public.record_student_reminder_activity();

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
    ADD CONSTRAINT assignment_sessions_share_job_id_fkey FOREIGN KEY (share_job_id) REFERENCES public.jobs(id);

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES public.transcripts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.assignment_sessions
    ADD CONSTRAINT assignment_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assignment_source_bindings
    ADD CONSTRAINT assignment_source_bindings_assignment_session_id_fkey FOREIGN KEY (assignment_session_id) REFERENCES public.assignment_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assignment_source_bindings
    ADD CONSTRAINT assignment_source_bindings_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES public.recordings(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.assignment_source_bindings
    ADD CONSTRAINT assignment_source_bindings_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.assignment_source_bindings
    ADD CONSTRAINT assignment_source_bindings_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES public.transcripts(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.assignment_source_bindings
    ADD CONSTRAINT assignment_source_bindings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.assignment_source_bindings
    ADD CONSTRAINT assignment_source_bindings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.calendar_lesson_bindings
    ADD CONSTRAINT calendar_lesson_bindings_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.workspace_calendar_connections(id);

ALTER TABLE ONLY public.calendar_lesson_bindings
    ADD CONSTRAINT calendar_lesson_bindings_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.student_lessons(id);

ALTER TABLE ONLY public.calendar_lesson_bindings
    ADD CONSTRAINT calendar_lesson_bindings_schedule_binding_id_fkey FOREIGN KEY (schedule_binding_id) REFERENCES public.calendar_schedule_bindings(id);

ALTER TABLE ONLY public.calendar_operations
    ADD CONSTRAINT calendar_operations_adopted_by_fkey FOREIGN KEY (adopted_by) REFERENCES public.users(id);

ALTER TABLE ONLY public.calendar_operations
    ADD CONSTRAINT calendar_operations_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.workspace_calendar_connections(id);

ALTER TABLE ONLY public.calendar_operations
    ADD CONSTRAINT calendar_operations_initiating_user_id_fkey FOREIGN KEY (initiating_user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.calendar_operations
    ADD CONSTRAINT calendar_operations_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.calendar_operations(id);

ALTER TABLE ONLY public.calendar_operations
    ADD CONSTRAINT calendar_operations_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);

ALTER TABLE ONLY public.calendar_operations
    ADD CONSTRAINT calendar_operations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

ALTER TABLE ONLY public.calendar_schedule_bindings
    ADD CONSTRAINT calendar_schedule_bindings_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.workspace_calendar_connections(id);

ALTER TABLE ONLY public.calendar_schedule_bindings
    ADD CONSTRAINT calendar_schedule_bindings_setup_operation_id_fkey FOREIGN KEY (setup_operation_id) REFERENCES public.calendar_operations(id);

ALTER TABLE ONLY public.calendar_schedule_bindings
    ADD CONSTRAINT calendar_schedule_bindings_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id);

ALTER TABLE ONLY public.calendar_schedule_bindings
    ADD CONSTRAINT calendar_schedule_bindings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.student_lessons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_prompt_package_id_fkey FOREIGN KEY (prompt_package_id) REFERENCES public.prompt_packages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.google_oauth_attempts
    ADD CONSTRAINT google_oauth_attempts_connection_fkey FOREIGN KEY (connection_id, workspace_id) REFERENCES public.workspace_calendar_connections(id, workspace_id);

ALTER TABLE ONLY public.google_oauth_attempts
    ADD CONSTRAINT google_oauth_attempts_requesting_user_id_fkey FOREIGN KEY (requesting_user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.google_oauth_attempts
    ADD CONSTRAINT google_oauth_attempts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

ALTER TABLE ONLY public.google_oauth_grants
    ADD CONSTRAINT google_oauth_grants_authorizing_user_id_fkey FOREIGN KEY (authorizing_user_id) REFERENCES public.users(id);

ALTER TABLE ONLY public.google_oauth_grants
    ADD CONSTRAINT google_oauth_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

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
    ADD CONSTRAINT lesson_memory_entries_assignment_session_id_fkey FOREIGN KEY (assignment_session_id) REFERENCES public.assignment_sessions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.lesson_memory_entries
    ADD CONSTRAINT lesson_memory_entries_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES public.recordings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lesson_memory_entries
    ADD CONSTRAINT lesson_memory_entries_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.lesson_memory_entries
    ADD CONSTRAINT lesson_memory_entries_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.lesson_memory_entries(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.lesson_memory_entries
    ADD CONSTRAINT lesson_memory_entries_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES public.transcripts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_oauth_grants
    ADD CONSTRAINT mcp_oauth_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_oauth_grants
    ADD CONSTRAINT mcp_oauth_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_profile_identities
    ADD CONSTRAINT mcp_profile_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_profile_identities
    ADD CONSTRAINT mcp_profile_identities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profile_initial_enrichment_operations
    ADD CONSTRAINT profile_initial_enrichment_op_student_id_result_revision_i_fkey FOREIGN KEY (student_id, result_revision_id) REFERENCES public.student_profile_revisions(student_id, id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.profile_initial_enrichment_operations
    ADD CONSTRAINT profile_initial_enrichment_ope_student_id_seed_revision_id_fkey FOREIGN KEY (student_id, seed_revision_id) REFERENCES public.student_profile_revisions(student_id, id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.profile_initial_enrichment_operations
    ADD CONSTRAINT profile_initial_enrichment_operatio_lesson_memory_entry_id_fkey FOREIGN KEY (lesson_memory_entry_id) REFERENCES public.lesson_memory_entries(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.profile_initial_enrichment_operations
    ADD CONSTRAINT profile_initial_enrichment_operation_assignment_session_id_fkey FOREIGN KEY (assignment_session_id) REFERENCES public.assignment_sessions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profile_initial_enrichment_operations
    ADD CONSTRAINT profile_initial_enrichment_operations_profile_id_fkey FOREIGN KEY (legacy_profile_id) REFERENCES public.legacy_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profile_initial_enrichment_operations
    ADD CONSTRAINT profile_initial_enrichment_operations_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES public.recordings(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.profile_initial_enrichment_operations
    ADD CONSTRAINT profile_initial_enrichment_operations_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.profile_initial_enrichment_operations
    ADD CONSTRAINT profile_initial_enrichment_operations_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES public.transcripts(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.legacy_profile_revisions
    ADD CONSTRAINT profile_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.legacy_profile_revisions
    ADD CONSTRAINT profile_revisions_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.legacy_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.legacy_profile_revisions
    ADD CONSTRAINT profile_revisions_restored_from_revision_id_fkey FOREIGN KEY (restored_from_revision_id) REFERENCES public.legacy_profile_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.legacy_profiles
    ADD CONSTRAINT profiles_active_revision_id_fkey FOREIGN KEY (active_revision_id) REFERENCES public.legacy_profile_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prompt_packages
    ADD CONSTRAINT prompt_packages_assignment_session_id_fkey FOREIGN KEY (assignment_session_id) REFERENCES public.assignment_sessions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.prompt_packages
    ADD CONSTRAINT prompt_packages_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.student_lessons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prompt_packages
    ADD CONSTRAINT prompt_packages_recording_id_fkey FOREIGN KEY (recording_id) REFERENCES public.recordings(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_packages
    ADD CONSTRAINT prompt_packages_transcript_id_fkey FOREIGN KEY (transcript_id) REFERENCES public.transcripts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.recording_upload_operation_attempts
    ADD CONSTRAINT recording_upload_operation_attempts_operation_id_fkey FOREIGN KEY (operation_id) REFERENCES public.recording_upload_operations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.recording_upload_operations
    ADD CONSTRAINT recording_upload_operations_canonical_assignment_session_i_fkey FOREIGN KEY (canonical_assignment_session_id) REFERENCES public.assignment_sessions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.recording_upload_operations
    ADD CONSTRAINT recording_upload_operations_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.recording_upload_operations
    ADD CONSTRAINT recording_upload_operations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.recordings
    ADD CONSTRAINT recordings_student_workspace_fkey FOREIGN KEY (student_id, workspace_id) REFERENCES public.students(id, workspace_id) ON UPDATE RESTRICT ON DELETE RESTRICT;

ALTER TABLE ONLY public.recordings
    ADD CONSTRAINT recordings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.student_activity
    ADD CONSTRAINT student_activity_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_activity
    ADD CONSTRAINT student_activity_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_activity
    ADD CONSTRAINT student_activity_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_activity_id_fkey FOREIGN KEY (activity_id) REFERENCES public.student_activity(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_credit_events
    ADD CONSTRAINT student_credit_events_reversal_activity_id_fkey FOREIGN KEY (reversal_activity_id) REFERENCES public.student_activity(id) ON DELETE SET NULL;

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

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_credit_event_id_fkey FOREIGN KEY (credit_event_id) REFERENCES public.student_credit_events(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_lessons
    ADD CONSTRAINT student_lessons_recurrence_obsolete_by_fkey FOREIGN KEY (schedule_hidden_by) REFERENCES public.users(id) ON DELETE SET NULL;

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

ALTER TABLE ONLY public.legacy_student_profile_bindings
    ADD CONSTRAINT student_profile_bindings_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.legacy_student_profile_bindings
    ADD CONSTRAINT student_profile_bindings_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.legacy_profiles(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.legacy_student_profile_bindings
    ADD CONSTRAINT student_profile_bindings_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_profile_candidate_draft_revisions
    ADD CONSTRAINT student_profile_candidate_draft_re_student_id_candidate_id_fkey FOREIGN KEY (student_id, candidate_id) REFERENCES public.student_profile_candidates(student_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_profile_candidate_draft_revisions
    ADD CONSTRAINT student_profile_candidate_draft_rev_student_id_revision_id_fkey FOREIGN KEY (student_id, revision_id) REFERENCES public.student_profile_revisions(student_id, id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.student_profile_candidate_draft_revisions
    ADD CONSTRAINT student_profile_candidate_draft_revisions_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.student_profile_candidates(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_profile_candidate_draft_revisions
    ADD CONSTRAINT student_profile_candidate_draft_revisions_revision_id_fkey FOREIGN KEY (revision_id) REFERENCES public.student_profile_revisions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_source_lesson_id_fkey FOREIGN KEY (source_lesson_id) REFERENCES public.student_lessons(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES public.student_memory_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_student_id_promoted_revision_id_fkey FOREIGN KEY (student_id, promoted_revision_id) REFERENCES public.student_profile_revisions(student_id, id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.student_profile_candidates
    ADD CONSTRAINT student_profile_candidates_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.student_profile_candidates(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_revisions
    ADD CONSTRAINT student_profile_revision_restore_owner_fkey FOREIGN KEY (student_id, restored_from_revision_id) REFERENCES public.student_profile_revisions(student_id, id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.student_profile_revisions
    ADD CONSTRAINT student_profile_revisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_profile_revisions
    ADD CONSTRAINT student_profile_revisions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_reminder_preferences
    ADD CONSTRAINT student_reminder_preferences_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.student_reminder_preferences
    ADD CONSTRAINT student_reminder_preferences_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.student_reminder_preferences
    ADD CONSTRAINT student_reminder_preferences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.students
    ADD CONSTRAINT students_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES public.users(id) ON DELETE SET NULL;

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

ALTER TABLE ONLY public.transcription_runs
    ADD CONSTRAINT transcription_runs_recording_workspace_fkey FOREIGN KEY (recording_id, workspace_id) REFERENCES public.recordings(id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.transcription_runs
    ADD CONSTRAINT transcription_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;

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

ALTER TABLE ONLY public.workspace_calendar_connections
    ADD CONSTRAINT workspace_calendar_connections_grant_id_workspace_id_fkey FOREIGN KEY (grant_id, workspace_id) REFERENCES public.google_oauth_grants(id, workspace_id);

ALTER TABLE ONLY public.workspace_calendar_connections
    ADD CONSTRAINT workspace_calendar_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);

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
  ('0048_recording_audio_topology', 'a426012df6f20d3a16962e004fef79e1f00e85da70557606b440e906aea4f0be', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0049_recording_ingest_readiness', '46c6544bd299ace4c46445761788b8d1acaa5e5d64bbbd7a1e943f2306d8636d', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0050_recording_media_preparation_version', 'ddfcb6bfbc7fc740b6642361ef15fdd96fcb868ce358dcdee7cc2d5ce2dc5c15', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0051_recording_upload_operations', '7353b778b5e973f4dc05774676ff0657062f31eb9966f1459e84dbc3edce03cb', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0052_recording_upload_candidate_cleanup_schedule', '34891f5ed3494026d41d58a9d901f2f31e5ce7802dcf706cb2f5468175080890', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0053_recording_audio_cleanup_backfill', '7d4e11f27d14a035f15d9b629ec00bdfcc641882dbb7eaf0ad16d87692f2440f', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0054_canonical_assignment_source_ownership', '4d4f6b8b4a79148e23a0aca45a91b4d6496927f6a9adf41f5eaa0148bdccdc16', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0055_prompt_package_assignment_provenance', '36c5acb4a15ffaca1880066070ad624b73f1f390891b3d51d732d66b5a9ecd81', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0056_first_profile_onboarding', '2c0fbc74c1f9ea8d6e2cf65d48e0a3e15177f9f3af7d5b581b2a0e04fa61f3ea', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0057_historical_profile_provenance_timestamp', 'e203033eb30c1456a4df56bbf1b784d0d842cf28a4dcc1a510fd87217e7a7e09', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0058_mcp_oauth_foundation', '4c4d181b4f150b453c447f3d2fb652b990f479dcd5ddb5ab2a89089f0cfb1cc0', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0059_student_owned_profile_revisions', '60b283fa0b95c8afe46b3233c3e7c50f38d8a3d81fdc98394a414846df6ceb01', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0060_user_settings_owner_key', '80e6ba7ab7e15f5e8049a6114dc2bc6cee6fe43bf16121cec137d4af51f760c3', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0061_ordinary_memory_replay', '0f5da854ddd4ea23025e5f9d78938f5d4e4454c63e5fd9314ac887c4110565ff', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0062_assignment_v1_authority', 'df1b835d96032ecf9afb0d3fe034ee3cfe605dfecdb1dc578d7fb2f2f20c5b4d', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0063_assignment_native_renderer', 'e58336ba97dc05926e652b786b370743061f8e4702029bb79fd84ffa7bb88492', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0064_historical_markdown_read_only', '9a74cf33697ccc187b1674e03d06a1f5b41b79a555e19918d9465fc5f00dd292', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0065_assignment_react_renderer', '2e37a9fd1fb5f1c3efa8807e985eb254c63bc4b972de2d544e9b8372233c40dc', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0066_no_homework_lesson', '47c8dc8f633f5d2ff07282d3ff393886245c477dd3854204c5970147bdfe2104', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0067_mcp_profile_identities', '430f6083475887792ed256290751ac5f4bff9ecf4cc8a84bf7f1402d2ef50f22', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0068_student_activity', '004e9d9a1b05415f9ab850ec241f34fa1ef68dbe7fc5843ec4dd35c53985af05', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0069_google_calendar_connection', 'e588c33b65438b42d6df0919cd4763221df195cdb35fd26c906906da3a009f3a', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0070_calendar_scheduling', 'c30cbc331b6f884ff7a732fe28d582b74e2bf1ef54bb0588dca063ddfeb2c759', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0071_scheduler_retirement', '45ee490d0893537325b299c0e6ee161ec72f139fe2c260aa95d3a5a4abf1eb7c', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0072_calendar_projection_reference_guard', '50cf12476c3fd513fa328777a12ca2260d2c6a1b99b15b4b8c623a9093b3ef06', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0073_gemini_tts_provider', 'cdaee92f0b9f19241844d93ed34db298c4cf0f6d852de4c21bca555dcd33a169', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1'),
  ('0074_assignment_material', '355e87270ed685ba9cdf82ef8e0a192dc47724fcf8bbe71c4c49de830c7d104c', '2000-01-01T00:00:00Z'::timestamptz, 0, 'batch-backend-schema-baseline-v1')
ON CONFLICT (id) DO NOTHING;
