const removedNames = new Set([
  'BATCH_BACKEND_TEST_PG',
  'BATCH_BACKEND_TEST_REDIS',
  'DOCKER_HOST',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'INWORLD_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
]);
const pureLaneIds = new Set([
  'turbo:test:unit:prebuilt',
  'test:unit:prebuilt:fast',
  'agent:test:unit',
]);

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

export function resolveValidationLaneEnv({ laneId, sourceEnv, backendDbEnv = false }) {
  if (backendDbEnv || !pureLaneIds.has(laneId)) {
    return { ...sourceEnv };
  }
  return buildPureTestEnv(sourceEnv);
}
