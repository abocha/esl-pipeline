ALTER TABLE jobs ADD COLUMN IF NOT EXISTS tts_model TEXT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'jobs'
      AND column_name = 'google_tts_model'
  ) THEN
    EXECUTE $backfill$
      UPDATE jobs
      SET tts_model = google_tts_model
      WHERE tts_model IS NULL
        AND tts_provider = 'google'
        AND google_tts_model IS NOT NULL
    $backfill$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'jobs'
      AND column_name = 'study_text_elevenlabs_model'
  ) THEN
    EXECUTE $backfill$
      UPDATE jobs
      SET tts_model = study_text_elevenlabs_model
      WHERE tts_model IS NULL
        AND tts_provider = 'elevenlabs'
        AND study_text_elevenlabs_model IS NOT NULL
    $backfill$;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'jobs'
      AND column_name = 'inworld_tts_model'
  ) THEN
    EXECUTE $backfill$
      UPDATE jobs
      SET tts_model = inworld_tts_model
      WHERE tts_model IS NULL
        AND tts_provider = 'inworld'
        AND inworld_tts_model IS NOT NULL
    $backfill$;
  END IF;
END $$;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_tts_provider_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_tts_provider_check
  CHECK (tts_provider IS NULL OR tts_provider IN ('elevenlabs', 'google', 'inworld'));

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_study_text_elevenlabs_model_check;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_google_tts_model_check;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_inworld_tts_model_check;
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_tts_model_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_tts_model_check
  CHECK (
    tts_model IS NULL
    OR (
      tts_provider = 'elevenlabs'
      AND tts_model IN ('eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2')
    )
    OR (
      tts_provider = 'google'
      AND tts_model IN ('chirp3_hd', 'studio', 'neural2', 'wavenet')
    )
    OR (
      tts_provider = 'inworld'
      AND tts_model IN ('inworld-tts-2', 'inworld-tts-1.5-max', 'inworld-tts-1.5-mini')
    )
  );

ALTER TABLE jobs DROP COLUMN IF EXISTS study_text_elevenlabs_model;
ALTER TABLE jobs DROP COLUMN IF EXISTS google_tts_model;
ALTER TABLE jobs DROP COLUMN IF EXISTS inworld_tts_model;

ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS user_settings_tts_provider_check;
ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_tts_provider_check
  CHECK (tts_provider IN ('elevenlabs', 'google', 'inworld'));

ALTER TABLE assignment_sessions DROP CONSTRAINT IF EXISTS assignment_sessions_tts_provider_check;
ALTER TABLE assignment_sessions
  ADD CONSTRAINT assignment_sessions_tts_provider_check
  CHECK (selected_tts_provider IS NULL OR selected_tts_provider IN ('elevenlabs', 'google', 'inworld'));
