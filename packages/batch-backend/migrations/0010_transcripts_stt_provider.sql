ALTER TABLE transcripts ADD COLUMN IF NOT EXISTS stt_provider TEXT NULL;

UPDATE transcripts
SET stt_provider = COALESCE(
  CASE
    WHEN lower(summary_json->>'provider') IN ('deepgram', 'elevenlabs', 'google')
      THEN lower(summary_json->>'provider')
    ELSE NULL
  END,
  CASE
    WHEN position('scribe' in lower(model)) > 0 OR position('eleven' in lower(model)) > 0 THEN 'elevenlabs'
    WHEN position('google' in lower(model)) > 0 THEN 'google'
    ELSE 'deepgram'
  END,
  'deepgram'
)
WHERE stt_provider IS NULL;

ALTER TABLE transcripts ALTER COLUMN stt_provider SET DEFAULT 'deepgram';
ALTER TABLE transcripts ALTER COLUMN stt_provider SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transcripts_stt_provider_check') THEN
    ALTER TABLE transcripts
      ADD CONSTRAINT transcripts_stt_provider_check
      CHECK (stt_provider IN ('deepgram', 'elevenlabs', 'google'));
  END IF;
END $$;
