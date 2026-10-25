-- Identity belongs to the original domain intent, including terminal intents.
-- Canonical results retain replay metadata but have pendingEntryId lineage.
CREATE UNIQUE INDEX homework_memory_replay_key
  ON homework_memory_entries (assignment_lineage_key, (generation_notes ->> 'replayKey'))
  WHERE generation_notes ->> 'replayKey' IS NOT NULL
    AND generation_notes ->> 'pendingEntryId' IS NULL;
CREATE UNIQUE INDEX student_memory_snapshot_replay_key
  ON student_memory_snapshots (student_id, (generation_notes ->> 'replayKey'))
  WHERE generation_notes ->> 'replayKey' IS NOT NULL
    AND generation_notes ->> 'pendingEntryId' IS NULL;

-- Fence both changes to existing sources and phantom ready sources. Snapshot
-- finalization takes this lock before reading, without locking contributing rows.
CREATE FUNCTION lock_canonical_memory_student() RETURNS trigger
LANGUAGE plpgsql AS $$
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
CREATE TRIGGER lesson_memory_canonical_student_lock
  BEFORE INSERT OR UPDATE OR DELETE ON lesson_memory_entries
  FOR EACH ROW EXECUTE FUNCTION lock_canonical_memory_student();
CREATE TRIGGER homework_memory_canonical_student_lock
  BEFORE INSERT OR UPDATE OR DELETE ON homework_memory_entries
  FOR EACH ROW EXECUTE FUNCTION lock_canonical_memory_student();

-- Eligibility also depends on confirmed immutable Source ownership. Serialize
-- its remap/reconfirmation with the rollup guard, without changing Source authority.
CREATE FUNCTION lock_memory_source_student() RETURNS trigger
LANGUAGE plpgsql AS $$
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
CREATE TRIGGER memory_confirmed_source_insert_lock
  BEFORE INSERT ON assignment_source_bindings FOR EACH ROW
  WHEN (NEW.binding_role = 'confirmed') EXECUTE FUNCTION lock_memory_source_student();
CREATE TRIGGER memory_confirmed_source_update_lock
  BEFORE UPDATE ON assignment_source_bindings FOR EACH ROW
  WHEN (OLD.binding_role = 'confirmed' OR NEW.binding_role = 'confirmed')
  EXECUTE FUNCTION lock_memory_source_student();
CREATE TRIGGER memory_confirmed_source_delete_lock
  BEFORE DELETE ON assignment_source_bindings FOR EACH ROW
  WHEN (OLD.binding_role = 'confirmed') EXECUTE FUNCTION lock_memory_source_student();
CREATE TRIGGER memory_confirmed_source_snapshot_lock
  BEFORE UPDATE ON assignment_sessions FOR EACH ROW
  WHEN (OLD.confirmed_snapshot -> 'source' IS DISTINCT FROM NEW.confirmed_snapshot -> 'source'
        OR OLD.student_id IS DISTINCT FROM NEW.student_id)
  EXECUTE FUNCTION lock_memory_source_student();
