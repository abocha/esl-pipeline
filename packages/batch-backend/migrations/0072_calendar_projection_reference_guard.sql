-- A browser can submit an old lesson ID after Calendar replaces an unused projection.
-- Serialize new downstream references with projection/completion's lesson lock. An FK
-- alone prevents deletion, but cannot reject a retained, superseded projection.
CREATE FUNCTION guard_calendar_projection_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lesson uuid; hidden boolean;
BEGIN
  lesson := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
  IF lesson IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND to_jsonb(OLD)->>TG_ARGV[0] IS NOT DISTINCT FROM lesson::text THEN
    RETURN NEW;
  END IF;
  PERFORM id FROM student_lessons WHERE id=lesson FOR KEY SHARE;
  -- Separate statement gets the committed state after waiting for a projection lock.
  SELECT schedule_hidden_at IS NOT NULL INTO hidden FROM student_lessons WHERE id=lesson;
  IF hidden THEN
    RAISE EXCEPTION 'Lesson schedule changed; refresh before continuing'
      USING ERRCODE='23514', CONSTRAINT='calendar_projection_reference_visible';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER assignment_sessions_calendar_projection_guard
BEFORE INSERT OR UPDATE OF lesson_id ON assignment_sessions
FOR EACH ROW EXECUTE FUNCTION guard_calendar_projection_reference('lesson_id');
CREATE TRIGGER prompt_packages_calendar_projection_guard
BEFORE INSERT OR UPDATE OF lesson_id ON prompt_packages
FOR EACH ROW EXECUTE FUNCTION guard_calendar_projection_reference('lesson_id');
CREATE TRIGGER drafts_calendar_projection_guard
BEFORE INSERT OR UPDATE OF lesson_id ON drafts
FOR EACH ROW EXECUTE FUNCTION guard_calendar_projection_reference('lesson_id');
CREATE TRIGGER jobs_calendar_projection_guard
BEFORE INSERT OR UPDATE OF lesson_id ON jobs
FOR EACH ROW EXECUTE FUNCTION guard_calendar_projection_reference('lesson_id');
CREATE TRIGGER homework_memory_entries_calendar_projection_guard
BEFORE INSERT OR UPDATE OF lesson_id ON homework_memory_entries
FOR EACH ROW EXECUTE FUNCTION guard_calendar_projection_reference('lesson_id');
CREATE TRIGGER student_profile_candidates_calendar_projection_guard
BEFORE INSERT OR UPDATE OF source_lesson_id ON student_profile_candidates
FOR EACH ROW EXECUTE FUNCTION guard_calendar_projection_reference('source_lesson_id');
CREATE TRIGGER student_credit_events_calendar_projection_guard
BEFORE INSERT OR UPDATE OF source_lesson_id ON student_credit_events
FOR EACH ROW EXECUTE FUNCTION guard_calendar_projection_reference('source_lesson_id');
