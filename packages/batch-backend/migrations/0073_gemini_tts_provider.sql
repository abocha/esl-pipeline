-- Add Gemini Cloud TTS without changing existing provider identities, rows or defaults.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_tts_provider_check;
ALTER TABLE jobs
  ADD CONSTRAINT jobs_tts_provider_check
  CHECK (tts_provider IS NULL OR tts_provider IN ('elevenlabs', 'google', 'inworld', 'gemini'));

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
    OR (
      tts_provider = 'gemini'
      AND tts_model IN ('gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts')
    )
  );

ALTER TABLE user_settings DROP CONSTRAINT IF EXISTS user_settings_tts_provider_check;
ALTER TABLE user_settings
  ADD CONSTRAINT user_settings_tts_provider_check
  CHECK (tts_provider IN ('elevenlabs', 'google', 'inworld', 'gemini'));

ALTER TABLE assignment_sessions DROP CONSTRAINT IF EXISTS assignment_sessions_tts_provider_check;
ALTER TABLE assignment_sessions
  ADD CONSTRAINT assignment_sessions_tts_provider_check
  CHECK (selected_tts_provider IS NULL OR selected_tts_provider IN ('elevenlabs', 'google', 'inworld', 'gemini'));
