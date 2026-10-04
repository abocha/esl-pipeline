-- Admit native AssignmentV1 execution without rewriting historical renderer-1 jobs.
-- The frozen artifact/renderer trigger from 0062 remains unchanged.
ALTER TABLE jobs DROP CONSTRAINT jobs_assignment_artifact_identity;
ALTER TABLE jobs ADD CONSTRAINT jobs_assignment_artifact_identity CHECK (
  (assignment_artifact IS NULL AND assignment_renderer_version IS NULL) OR
  ((assignment_artifact IS NOT NULL AND assignment_renderer_version IN (1, 2)
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
