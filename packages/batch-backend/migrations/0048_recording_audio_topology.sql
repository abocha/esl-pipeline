ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS audio_topology TEXT NULL
  CHECK (audio_topology IN ('mixed_recording', 'trusted_split_channels'));
