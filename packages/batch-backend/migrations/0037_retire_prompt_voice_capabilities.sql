ALTER TABLE prompt_packages
  DROP COLUMN IF EXISTS resolved_voice_capabilities_hash,
  DROP COLUMN IF EXISTS resolved_voice_capabilities_generated_at,
  DROP COLUMN IF EXISTS resolved_voice_capabilities_snapshot;
