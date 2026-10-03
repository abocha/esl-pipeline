-- Additive cutover: historical drafts/jobs stay explicitly Markdown.
ALTER TABLE drafts ADD COLUMN format text NOT NULL DEFAULT 'markdown'
  CHECK (format IN ('markdown', 'assignment_v1'));
ALTER TABLE drafts ADD CONSTRAINT drafts_assignment_v1_identity CHECK (
  format = 'markdown' OR
  (working_version IS NOT NULL AND content_hash IS NOT NULL
   AND storage_uri LIKE '%/content/' || content_hash || '.json')
);

-- Immutable canonical identity, separate from md_storage_uri/published_content_hash.
ALTER TABLE jobs ADD COLUMN assignment_artifact jsonb;
ALTER TABLE jobs ADD COLUMN assignment_renderer_version integer;
ALTER TABLE jobs ADD CONSTRAINT jobs_assignment_artifact_identity CHECK (
  (assignment_artifact IS NULL AND assignment_renderer_version IS NULL) OR
  ((assignment_artifact IS NOT NULL AND assignment_renderer_version = 1
   AND prompt_package_id IS NOT NULL AND draft_id IS NOT NULL
   AND assignment_artifact ->> 'format' = 'assignment_v1'
   AND assignment_artifact ->> 'schemaVersion' = '1'
   AND assignment_artifact ->> 'serializationVersion' = '1'
   AND assignment_artifact ->> 'workingVersion' ~ '^[1-9][0-9]*$'
   AND assignment_artifact ->> 'contentHash' ~ '^[0-9a-f]{64}$'
   AND assignment_artifact ->> 'storageUri' LIKE
     '%/content/' || (assignment_artifact ->> 'contentHash') || '.json'
   AND jsonb_typeof(assignment_artifact -> 'schemaVersion') = 'number'
   AND jsonb_typeof(assignment_artifact -> 'serializationVersion') = 'number'
   AND jsonb_typeof(assignment_artifact -> 'workingVersion') = 'number'
   AND assignment_artifact ?& ARRAY['format','schemaVersion','serializationVersion','workingVersion','contentHash','storageUri']) IS TRUE)
);

CREATE FUNCTION preserve_assignment_draft_format() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.format IS DISTINCT FROM OLD.format THEN
    RAISE EXCEPTION 'Assignment draft authority format cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_assignment_draft_format BEFORE UPDATE ON drafts
  FOR EACH ROW EXECUTE FUNCTION preserve_assignment_draft_format();

CREATE FUNCTION preserve_assignment_artifact_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assignment_artifact IS DISTINCT FROM OLD.assignment_artifact
     OR NEW.assignment_renderer_version IS DISTINCT FROM OLD.assignment_renderer_version THEN
    RAISE EXCEPTION 'Frozen assignment artifact identity cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_assignment_artifact_identity BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION preserve_assignment_artifact_identity();

-- Rollback boundary: retain this additive schema and use a reader that understands
-- typed references. Pre-Slice-2 code must not edit or execute typed records.
