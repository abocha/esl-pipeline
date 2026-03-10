UPDATE user_settings
SET tts_provider = 'elevenlabs'
WHERE tts_provider IN ('openai', 'azure');

DO $$
DECLARE
  current_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO current_definition
  FROM pg_constraint
  WHERE conname = 'user_settings_tts_provider_check'
    AND conrelid = 'user_settings'::regclass;

  IF current_definition IS NULL THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_tts_provider_check
      CHECK (tts_provider IN ('elevenlabs', 'google'));
  ELSIF position('openai' IN current_definition) > 0
    OR position('azure' IN current_definition) > 0 THEN
    ALTER TABLE user_settings
      DROP CONSTRAINT user_settings_tts_provider_check;
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_tts_provider_check
      CHECK (tts_provider IN ('elevenlabs', 'google'));
  END IF;
END $$;
