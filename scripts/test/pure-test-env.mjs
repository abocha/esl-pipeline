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
