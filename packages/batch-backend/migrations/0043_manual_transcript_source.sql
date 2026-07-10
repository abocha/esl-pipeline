ALTER TABLE recordings DROP CONSTRAINT IF EXISTS recordings_source_check;
ALTER TABLE recordings
  ADD CONSTRAINT recordings_source_check
  CHECK (source IN ('upload', 'manual_transcript'));

ALTER TABLE transcripts DROP CONSTRAINT IF EXISTS transcripts_stt_provider_check;
ALTER TABLE transcripts
  ADD CONSTRAINT transcripts_stt_provider_check
  CHECK (stt_provider IN ('deepgram', 'elevenlabs', 'google', 'manual'));
