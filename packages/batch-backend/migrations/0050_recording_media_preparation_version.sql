ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS media_preparation_version TEXT NULL;
