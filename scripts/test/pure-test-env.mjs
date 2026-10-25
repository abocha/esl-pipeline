/**
 * Fixed environment names removed from pure lanes. Credential entries mirror names accepted by
 * application/provider configuration or ambient provider SDKs; keep them aligned with .env.example
 * and the owning provider configuration. The poisoned-environment regression test imports this
 * contract so the scrubber and its coverage cannot drift as independent lists.
 */
export const PURE_TEST_SCRUBBED_ENV_NAMES = Object.freeze([
  'BATCH_BACKEND_TEST_PG',
  'BATCH_BACKEND_TEST_REDIS',
  'DOCKER_HOST',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_PROFILE',
  'AWS_DEFAULT_PROFILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'AWS_CONFIG_FILE',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
  'DEEPGRAM_ACCESS_TOKEN',
  'DEEPGRAM_API_KEY',
  'ELEVENLABS_API_KEY',
  'ELEVENLABS_API_TOKEN',
  'ESL_STT_PROVIDER_DEEPGRAM_ACCESS_TOKEN',
  'ESL_STT_PROVIDER_DEEPGRAM_API_KEY',
  'ESL_STT_PROVIDER_ELEVENLABS_API_KEY',
  'ESL_STT_PROVIDER_ELEVENLABS_API_TOKEN',
  'ESL_TTS_PROVIDER_ELEVENLABS_API_KEY',
  'ESL_TTS_PROVIDER_ELEVENLABS_API_TOKEN',
  'ESL_TTS_PROVIDER_INWORLD_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CALENDAR_ENABLED',
  'GOOGLE_CALENDAR_CLIENT_ID',
  'GOOGLE_CALENDAR_CLIENT_SECRET',
  'GOOGLE_CALENDAR_REDIRECT_URI',
  'INTEGRATION_CREDENTIAL_ACTIVE_KEY_ID',
  'INTEGRATION_CREDENTIAL_KEYS',
  'CLOUDSDK_CONFIG',
  'INWORLD_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
]);
const removedNames = new Set(PURE_TEST_SCRUBBED_ENV_NAMES);

export function buildPureTestEnv(sourceEnv) {
  const pureEnv = {};
  for (const [key, value] of Object.entries(sourceEnv)) {
    const normalizedKey = key.toUpperCase();
    if (
      removedNames.has(normalizedKey) ||
      normalizedKey.startsWith('PG_') ||
      normalizedKey.startsWith('REDIS_')
    ) {
      continue;
    }
    pureEnv[key] = value;
  }
  pureEnv.VALIDATION_TEST_CLASS = 'pure';
  return pureEnv;
}
