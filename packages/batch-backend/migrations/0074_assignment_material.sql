-- Recovery-only state is nullable so historical confirmed snapshots and packages stay frozen.
ALTER TABLE assignment_sessions ADD COLUMN material jsonb;
ALTER TABLE assignment_sessions ADD CONSTRAINT assignment_sessions_material_object_check
  CHECK (material IS NULL OR jsonb_typeof(material) = 'object');
