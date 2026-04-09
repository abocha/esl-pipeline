ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS study_text_elevenlabs_model TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_study_text_elevenlabs_model_check'
  ) THEN
    ALTER TABLE jobs
      ADD CONSTRAINT jobs_study_text_elevenlabs_model_check
      CHECK (
        study_text_elevenlabs_model IS NULL OR study_text_elevenlabs_model IN (
          'eleven_v3',
          'eleven_multilingual_v2',
          'eleven_flash_v2_5',
          'eleven_flash_v2'
        )
      );
  END IF;
END $$;
