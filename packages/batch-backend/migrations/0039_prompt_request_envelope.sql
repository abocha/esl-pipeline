ALTER TABLE prompt_packages
  ADD COLUMN IF NOT EXISTS request_envelope jsonb NULL;
