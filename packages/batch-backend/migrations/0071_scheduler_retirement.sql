-- Irreversible scheduler cutover. Quiesce old API/workers before migrating.
-- Retain every rule/slot as historical JSON; this is never executable recurrence.
ALTER TABLE students ADD COLUMN email text;
ALTER TABLE students ADD CONSTRAINT students_email_length CHECK (email IS NULL OR (length(email) <= 320 AND email = btrim(email) AND email <> ''));

ALTER TABLE student_lesson_plans ADD COLUMN retired_schedule_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;
INSERT INTO student_lesson_plans (student_id, workspace_id, timezone, default_duration_minutes)
SELECT DISTINCT ON (student_id) student_id, workspace_id, timezone, 60
FROM student_lesson_recurrence_rules ORDER BY student_id, created_at, id
ON CONFLICT (student_id) DO NOTHING;
UPDATE student_lesson_plans p SET retired_schedule_preferences = jsonb_build_object(
  'cadence',p.cadence,'preferredTimes',p.preferred_times,
  'rules',COALESCE((SELECT jsonb_agg(to_jsonb(r) || jsonb_build_object('slots',
    COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order,s.id)
      FROM student_lesson_recurrence_slots s WHERE s.rule_id=r.id),'[]'::jsonb)) ORDER BY r.id)
    FROM student_lesson_recurrence_rules r WHERE r.student_id=p.student_id),'[]'::jsonb));

ALTER TABLE student_lessons ADD COLUMN schedule_origin_history jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE student_lessons l SET schedule_origin_history=jsonb_build_object(
  'ruleId',l.recurrence_rule_id,'slotId',l.recurrence_slot_id,
  'occurrenceKey',l.recurrence_occurrence_key,'origin',l.recurrence_origin,
  'overrideKind',l.recurrence_override_kind,
  'rule',(SELECT to_jsonb(r) FROM student_lesson_recurrence_rules r WHERE r.id=l.recurrence_rule_id),
  'slot',(SELECT to_jsonb(s) FROM student_lesson_recurrence_slots s WHERE s.id=l.recurrence_slot_id));
ALTER TABLE student_lessons RENAME COLUMN recurrence_obsolete_at TO schedule_hidden_at;
ALTER TABLE student_lessons RENAME COLUMN recurrence_obsolete_by TO schedule_hidden_by;
ALTER TABLE student_lessons RENAME COLUMN recurrence_obsolete_reason TO schedule_hidden_reason;

-- Replace before dropping columns: historical activity payloads remain unchanged.
CREATE OR REPLACE FUNCTION record_student_lesson_activity() RETURNS trigger LANGUAGE plpgsql AS $$
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
    CASE WHEN current_setting('app.calendar_sync',true)='on' THEN 'system'
      WHEN student_activity_actor_id() IS NOT NULL THEN 'user' ELSE 'unknown' END,
    jsonb_build_object('before',previous,'after',current_value,'scheduleOriginHistory',NEW.schedule_origin_history,
      'generated',false));
  RETURN NEW;
END $$;

ALTER TABLE student_lessons
  DROP COLUMN recurrence_rule_id,
  DROP COLUMN recurrence_slot_id,
  DROP COLUMN recurrence_occurrence_key,
  DROP COLUMN recurrence_origin,
  DROP COLUMN recurrence_override_kind;
DROP TABLE student_lesson_recurrence_slots;
DROP TABLE student_lesson_recurrence_rules;
ALTER TABLE student_lesson_plans DROP COLUMN cadence, DROP COLUMN preferred_times;
-- No lesson deletion/hiding happens here. Reviewed workspace-scoped cleanup owns it.
