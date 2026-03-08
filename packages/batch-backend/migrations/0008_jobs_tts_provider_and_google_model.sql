ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tts_provider TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS google_tts_model TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_tts_provider_check') THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_tts_provider_check
      CHECK (tts_provider IS NULL OR tts_provider IN ('elevenlabs', 'google'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_google_tts_model_check') THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_google_tts_model_check
      CHECK (
        google_tts_model IS NULL OR google_tts_model IN ('chirp3_hd', 'studio', 'neural2', 'wavenet')
      );
  END IF;
END $$;
