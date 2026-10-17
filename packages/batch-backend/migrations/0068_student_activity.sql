-- A bounded record of otherwise-lost transitions, not an event-sourcing subsystem.
-- Table-specific triggers run inside the domain writer's statement/transaction.
-- No migration-time backfill or coverage-start assertion: old facts remain legacy.
CREATE TABLE student_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'lesson_created','lesson_changed','lesson_completed','lesson_restored','lesson_canceled','lesson_no_show',
    'recurrence_changed','profile_saved','profile_restored','profile_activated',
    'candidate_approved','candidate_rejected','candidate_deferred','candidate_promoted',
    'student_created','student_renamed','student_archived','student_restored',
    'reminder_hidden','reminder_restored','homework_failed','homework_started'
  )),
  category text NOT NULL CHECK (category IN ('lessons','profile','billing','lifecycle','operations')),
  entity_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_id bigint NOT NULL DEFAULT txid_current(),
  actor_kind text NOT NULL DEFAULT 'unknown' CHECK (actor_kind IN ('user','system','unknown')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  payload_version integer NOT NULL DEFAULT 1 CHECK (payload_version = 1),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX idx_student_activity_page ON student_activity (workspace_id, student_id, occurred_at DESC, id DESC);
CREATE INDEX idx_student_activity_entity_transaction ON student_activity (entity_id, transaction_id);

-- Domain retention owns deletion through student/workspace CASCADE. No event updates.
CREATE FUNCTION student_activity_actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN NULLIF(current_setting('app.activity_actor_id',true),'') ~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN current_setting('app.activity_actor_id',true)::uuid ELSE app_current_user_id() END
$$;

CREATE FUNCTION reject_student_activity_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only the user-retention FK may erase a deleted actor reference.
  IF NEW.actor_user_id IS NULL AND OLD.actor_user_id IS NOT NULL
    AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id')
    AND NOT EXISTS (SELECT 1 FROM users WHERE id=OLD.actor_user_id) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Student activity is append-only' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER student_activity_immutable BEFORE UPDATE ON student_activity
FOR EACH ROW EXECUTE FUNCTION reject_student_activity_update();

CREATE FUNCTION reject_student_activity_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students WHERE id=OLD.student_id)
    OR (OLD.workspace_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id=OLD.workspace_id)) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Student activity follows student retention' USING ERRCODE='23514';
END $$;
CREATE TRIGGER student_activity_retention BEFORE DELETE ON student_activity
FOR EACH ROW EXECUTE FUNCTION reject_student_activity_delete();

CREATE FUNCTION set_student_activity_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students s WHERE s.id=NEW.student_id
    AND COALESCE(s.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)=
      COALESCE(NEW.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)) THEN
    RAISE EXCEPTION 'Student activity ownership mismatch' USING ERRCODE='23514';
  END IF;
  NEW.actor_user_id := CASE WHEN NEW.actor_kind = 'user' THEN student_activity_actor_id() ELSE NULL END;
  RETURN NEW;
END $$;
CREATE TRIGGER student_activity_actor BEFORE INSERT ON student_activity
FOR EACH ROW EXECUTE FUNCTION set_student_activity_actor();

CREATE FUNCTION record_student_lifecycle_activity() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER student_lifecycle_activity AFTER INSERT OR UPDATE ON students
FOR EACH ROW EXECUTE FUNCTION record_student_lifecycle_activity();

CREATE FUNCTION record_student_lesson_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_type text; previous jsonb := NULL; current_value jsonb;
BEGIN
  -- Existing child-row readers reject mismatched ownership. Do not make this
  -- recorder a new constraint on legacy/direct writers; never expose such rows.
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
    -- Placeholder titles filled by generation are enrichment, not a teacher edit.
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
    CASE WHEN TG_OP = 'INSERT' AND NEW.recurrence_origin = 'generated' THEN 'system'
      WHEN student_activity_actor_id() IS NOT NULL THEN 'user' ELSE 'unknown' END,
    jsonb_build_object('before',previous,'after',current_value,'recurrenceRuleId',NEW.recurrence_rule_id,
      'generated',NEW.recurrence_origin = 'generated'));
  RETURN NEW;
END $$;
CREATE TRIGGER student_lesson_activity AFTER INSERT OR UPDATE ON student_lessons
FOR EACH ROW EXECUTE FUNCTION record_student_lesson_activity();

CREATE FUNCTION record_student_profile_activity() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER student_profile_activity AFTER INSERT OR UPDATE ON student_profile_revisions
FOR EACH ROW EXECUTE FUNCTION record_student_profile_activity();

CREATE FUNCTION record_student_candidate_activity() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER student_candidate_activity AFTER UPDATE ON student_profile_candidates
FOR EACH ROW EXECUTE FUNCTION record_student_candidate_activity();

CREATE FUNCTION record_student_reminder_activity() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER student_reminder_activity AFTER INSERT OR UPDATE ON student_reminder_preferences
FOR EACH ROW EXECUTE FUNCTION record_student_reminder_activity();

-- Failures are otherwise overwritten on retry. Successful publications already
-- have frozen job evidence and are read from that authority instead of copied.
CREATE FUNCTION record_student_job_failure_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner_workspace uuid;
BEGIN
  IF NEW.state <> 'failed' OR (TG_OP = 'UPDATE' AND OLD.state = 'failed') OR NEW.student_id IS NULL OR NEW.publish_target IS DISTINCT FROM 'html' THEN RETURN NEW; END IF;
  SELECT workspace_id INTO owner_workspace FROM students WHERE id=NEW.student_id;
  INSERT INTO student_activity(student_id,workspace_id,type,category,entity_id,actor_kind,payload)
  VALUES(NEW.student_id,owner_workspace,'homework_failed','lessons',NEW.id,'system',
    jsonb_build_object('lessonId',NEW.lesson_id,'sourceJobId',NEW.source_job_id));
  RETURN NEW;
END $$;
CREATE TRIGGER student_job_failure_activity AFTER INSERT OR UPDATE ON jobs
FOR EACH ROW EXECUTE FUNCTION record_student_job_failure_activity();

CREATE FUNCTION record_student_homework_started_activity() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER student_homework_started_activity AFTER UPDATE ON assignment_sessions
FOR EACH ROW EXECUTE FUNCTION record_student_homework_started_activity();

ALTER TABLE student_credit_events ADD COLUMN activity_id uuid REFERENCES student_activity(id) ON DELETE SET NULL;
ALTER TABLE student_credit_events ADD COLUMN reversal_activity_id uuid REFERENCES student_activity(id) ON DELETE SET NULL;
CREATE FUNCTION link_student_credit_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transition_id uuid;
BEGIN
  -- Retention deletes the domain student and its activity/ledger together.
  -- FK SET NULL actions may run while another retained reference is cascading.
  IF TG_OP='UPDATE' AND NOT EXISTS (SELECT 1 FROM students WHERE id=NEW.student_id) THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.workspace_id IS NOT NULL AND NEW.workspace_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id=OLD.workspace_id) THEN RETURN NEW; END IF;
    -- A cascading activity deletion may null either of two references first.
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
    -- Existing links survive the original lesson FK's ON DELETE SET NULL.
    -- A caller cannot remove a still-existing source or introduce a new link.
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
CREATE TRIGGER student_credit_activity BEFORE INSERT OR UPDATE ON student_credit_events
FOR EACH ROW EXECUTE FUNCTION link_student_credit_activity();
