-- Keep legacy intent unknown; do not infer it from existing billing flags or history.
ALTER TABLE student_lessons ADD COLUMN planned_charge boolean;
-- A separate statement preserves NULL for every existing row.
ALTER TABLE student_lessons ALTER COLUMN planned_charge SET DEFAULT true;

-- Explicit charge choices remain tutor-owned occurrence edits in the existing activity guard.
CREATE OR REPLACE FUNCTION record_student_lesson_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_type text; previous jsonb := NULL; current_value jsonb;
BEGIN
  -- Existing child-row readers reject mismatched ownership. Do not make this
  -- recorder a new constraint on legacy/direct writers; never expose such rows.
  IF NOT EXISTS (SELECT 1 FROM students s WHERE s.id=NEW.student_id
    AND COALESCE(s.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)=
      COALESCE(NEW.workspace_id,'00000000-0000-4000-8000-000000000001'::uuid)) THEN RETURN NEW; END IF;
  current_value := jsonb_build_object('startsAt',NEW.starts_at,'timezone',NEW.timezone,
    'durationMinutes',NEW.duration_minutes,'status',NEW.status,'consumesCredit',NEW.consumes_credit,'plannedCharge',NEW.planned_charge,
    'title',NEW.title);
  IF TG_OP = 'INSERT' THEN event_type := 'lesson_created';
  ELSE
    previous := jsonb_build_object('startsAt',OLD.starts_at,'timezone',OLD.timezone,
      'durationMinutes',OLD.duration_minutes,'status',OLD.status,'consumesCredit',OLD.consumes_credit,'plannedCharge',OLD.planned_charge,
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
    CASE WHEN current_setting('app.calendar_sync',true)='on' THEN 'system'
      WHEN student_activity_actor_id() IS NOT NULL THEN 'user' ELSE 'unknown' END,
    jsonb_build_object('before',previous,'after',current_value,'scheduleOriginHistory',NEW.schedule_origin_history,
      'generated',false));
  RETURN NEW;
END $$;
