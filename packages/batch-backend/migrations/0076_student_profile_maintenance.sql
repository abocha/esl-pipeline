ALTER TABLE student_profile_revisions
  ADD COLUMN base_active_revision_id uuid,
  ADD COLUMN base_active_revision_known boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT student_profile_revision_base_owner_fkey
    FOREIGN KEY (student_id, base_active_revision_id)
    REFERENCES student_profile_revisions(student_id, id) ON DELETE RESTRICT;

ALTER TABLE student_profile_revisions DROP CONSTRAINT student_profile_revisions_source_check;
ALTER TABLE student_profile_revisions ADD CONSTRAINT student_profile_revisions_source_check
  CHECK (source IN ('create','update','restore','starter_profile_form','candidate_promotion',
    'legacy_normalization','lesson_population','profile_revision_refresh',
    'automatic_maintenance','maintenance_undo'));

CREATE TABLE student_profile_maintenance_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  application_key text NOT NULL,
  policy_version text NOT NULL CHECK (policy_version = 'deterministic_v1'),
  fact_key text NOT NULL,
  field text NOT NULL CHECK (field IN
    ('communicationContexts','interestsAndUsefulThemes','studyPreferences','stableStrengths')),
  added_value text NOT NULL CHECK (length(btrim(added_value)) > 0),
  before_value jsonb NOT NULL CHECK (jsonb_typeof(before_value) = 'array'),
  after_value jsonb NOT NULL CHECK (jsonb_typeof(after_value) = 'array'),
  undo_expected_value jsonb CHECK (undo_expected_value IS NULL OR jsonb_typeof(undo_expected_value)='array'),
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array'),
  source_snapshot_id uuid REFERENCES student_memory_snapshots(id) ON DELETE RESTRICT,
  initial_operation_id uuid REFERENCES profile_initial_enrichment_operations(id) ON DELETE RESTRICT,
  source_lesson_memory_ids uuid[] NOT NULL,
  source_lesson_ids uuid[] NOT NULL DEFAULT '{}',
  source_latest_lesson_at timestamptz,
  source_revision_id uuid NOT NULL,
  result_revision_id uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  undo_blocked_at timestamptz,
  undo_blocked_reason text,
  undo_revision_id uuid,
  undone_at timestamptz,
  undone_by uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (student_id,id),
  UNIQUE (student_id,application_key),
  FOREIGN KEY (student_id,source_revision_id) REFERENCES student_profile_revisions(student_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (student_id,result_revision_id) REFERENCES student_profile_revisions(student_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (student_id,undo_revision_id) REFERENCES student_profile_revisions(student_id,id) ON DELETE RESTRICT,
  CHECK ((undone_at IS NULL) = (undo_revision_id IS NULL))
);
CREATE INDEX student_profile_maintenance_changes_page
  ON student_profile_maintenance_changes(student_id,applied_at DESC,id DESC);

CREATE FUNCTION protect_profile_maintenance_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['undo_expected_value','undo_blocked_at','undo_blocked_reason','undo_revision_id','undone_at','undone_by'])
      IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['undo_expected_value','undo_blocked_at','undo_blocked_reason','undo_revision_id','undone_at','undone_by'])
      OR (OLD.undo_blocked_at IS NOT NULL AND NEW.undo_blocked_at IS DISTINCT FROM OLD.undo_blocked_at)
      OR (OLD.undone_at IS NOT NULL AND NEW.undone_at IS DISTINCT FROM OLD.undone_at) THEN
      RAISE EXCEPTION 'Profile maintenance evidence is immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    IF (NEW.source_snapshot_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM student_memory_snapshots WHERE id=NEW.source_snapshot_id AND student_id=NEW.student_id))
      OR (NEW.initial_operation_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM profile_initial_enrichment_operations WHERE id=NEW.initial_operation_id AND student_id=NEW.student_id))
      OR cardinality(NEW.source_lesson_memory_ids)=0
      OR EXISTS(SELECT 1 FROM unnest(NEW.source_lesson_memory_ids) source(id)
        WHERE NOT EXISTS(SELECT 1 FROM lesson_memory_entries l WHERE l.id=source.id AND l.student_id=NEW.student_id)) THEN
      RAISE EXCEPTION 'Profile maintenance evidence ownership mismatch' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER student_profile_maintenance_evidence BEFORE INSERT OR UPDATE
  ON student_profile_maintenance_changes FOR EACH ROW EXECUTE FUNCTION protect_profile_maintenance_evidence();

CREATE TABLE student_profile_fact_suppressions (
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fact_key text NOT NULL,
  change_id uuid,
  field text CHECK (field IN ('communicationContexts','interestsAndUsefulThemes','studyPreferences','stableStrengths')),
  removed_value text,
  source_latest_lesson_at timestamptz,
  source_lesson_ids uuid[] NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  suppressed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reconsideration_evidence jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(reconsideration_evidence) = 'array'),
  PRIMARY KEY (student_id,fact_key),
  FOREIGN KEY (student_id,change_id) REFERENCES student_profile_maintenance_changes(student_id,id) ON DELETE CASCADE
);

-- All active revision writers, including initial enrichment and old-revision activation,
-- fence undo in the same transaction. The marker deliberately survives A -> B -> A.
CREATE FUNCTION fence_student_profile_maintenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected record;
  baseline jsonb; remaining jsonb; undo_id text; validated_undo boolean := false;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' THEN RETURN NEW; END IF;
  undo_id:=current_setting('app.profile_maintenance_undo_change_id',true);
  IF undo_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO selected FROM student_profile_maintenance_changes
      WHERE id=undo_id::uuid AND student_id=NEW.student_id AND undone_at IS NULL AND undo_blocked_at IS NULL;
    SELECT structured_content INTO baseline FROM student_profile_revisions
      WHERE id=NEW.base_active_revision_id AND student_id=NEW.student_id;
    IF selected.id IS NOT NULL AND baseline->selected.field = COALESCE(selected.undo_expected_value,selected.after_value) THEN
      SELECT COALESCE(jsonb_agg(value ORDER BY ordinal),'[]'::jsonb) INTO remaining
        FROM jsonb_array_elements(baseline->selected.field) WITH ORDINALITY entry(value,ordinal)
        WHERE value <> to_jsonb(selected.added_value);
      validated_undo := jsonb_array_length(remaining)+1=jsonb_array_length(baseline->selected.field)
        AND NEW.structured_content=jsonb_set(baseline,ARRAY[selected.field],remaining);
    END IF;
  END IF;
  -- Only a proven removal of exactly the ledger-selected item can advance sibling
  -- undo expectations. The public revision source string never grants this exemption.
  IF validated_undo THEN
    UPDATE student_profile_maintenance_changes c SET undo_expected_value=remaining
      WHERE c.student_id=NEW.student_id AND c.field=selected.field AND c.id<>selected.id
        AND c.undone_at IS NULL AND c.undo_blocked_at IS NULL
        AND COALESCE(c.undo_expected_value,c.after_value)=baseline->selected.field;
  END IF;
  INSERT INTO student_profile_fact_suppressions(student_id,fact_key,change_id,reason)
    SELECT c.student_id,c.fact_key,c.id,'profile_value_removed'
    FROM student_profile_maintenance_changes c
    WHERE c.student_id=NEW.student_id AND c.undone_at IS NULL
      AND NOT COALESCE(NEW.structured_content->c.field @> jsonb_build_array(c.added_value),false)
    ON CONFLICT (student_id,fact_key) DO NOTHING;
  UPDATE student_profile_maintenance_changes c
    SET undo_blocked_at=clock_timestamp(),undo_blocked_reason='field_changed'
    WHERE c.student_id=NEW.student_id AND c.undone_at IS NULL AND c.undo_blocked_at IS NULL
      AND NEW.structured_content->c.field IS DISTINCT FROM COALESCE(c.undo_expected_value,c.after_value);
  RETURN NEW;
END $$;
CREATE TRIGGER student_profile_maintenance_fence AFTER INSERT OR UPDATE OF status
  ON student_profile_revisions FOR EACH ROW EXECUTE FUNCTION fence_student_profile_maintenance();

CREATE FUNCTION attribute_profile_maintenance_activity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type='profile_saved' AND NEW.payload->>'source'='automatic_maintenance' THEN
    NEW.actor_kind:='system'; NEW.actor_user_id:=NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profile_maintenance_activity_origin BEFORE INSERT ON student_activity
  FOR EACH ROW EXECUTE FUNCTION attribute_profile_maintenance_activity();

-- Match the existing RLS readiness stage: policies exist; application authorization
-- stays mandatory and RLS is not enabled by this migration.
CREATE POLICY student_profile_maintenance_workspace_policy ON student_profile_maintenance_changes
  USING (app_rls_bypass() OR EXISTS (SELECT 1 FROM students s
    JOIN workspace_memberships m ON m.workspace_id=s.workspace_id
    WHERE s.id=student_id AND m.user_id=app_current_user_id()))
  WITH CHECK (app_rls_bypass() OR EXISTS (SELECT 1 FROM students s
    JOIN workspace_memberships m ON m.workspace_id=s.workspace_id
    WHERE s.id=student_id AND m.user_id=app_current_user_id()));
CREATE POLICY student_profile_suppression_workspace_policy ON student_profile_fact_suppressions
  USING (app_rls_bypass() OR EXISTS (SELECT 1 FROM students s
    JOIN workspace_memberships m ON m.workspace_id=s.workspace_id
    WHERE s.id=student_id AND m.user_id=app_current_user_id()))
  WITH CHECK (app_rls_bypass() OR EXISTS (SELECT 1 FROM students s
    JOIN workspace_memberships m ON m.workspace_id=s.workspace_id
    WHERE s.id=student_id AND m.user_id=app_current_user_id()));
