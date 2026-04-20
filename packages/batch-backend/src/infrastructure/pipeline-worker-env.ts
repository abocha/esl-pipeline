export interface WorkerUserSettingsOverride {
  elevenLabsApiKey?: string | null;
  ttsProvider?: 'elevenlabs' | 'google' | null;
}

export function resolveEffectiveElevenLabsApiKey(input: {
  settings?: Pick<WorkerUserSettingsOverride, 'elevenLabsApiKey'>;
  configuredElevenLabsApiKey?: string;
}): string | undefined {
  if (input.settings?.elevenLabsApiKey?.trim()) {
    return input.settings.elevenLabsApiKey.trim();
  }
  return input.configuredElevenLabsApiKey?.trim() || undefined;
}

export function applyUserSettingsToEnv(
  settings: WorkerUserSettingsOverride | undefined,
  configuredElevenLabsApiKey?: string,
) {
  const effectiveElevenLabsApiKey = resolveEffectiveElevenLabsApiKey({
    settings,
    configuredElevenLabsApiKey,
  });

  if (effectiveElevenLabsApiKey) {
    process.env.ESL_TTS_PROVIDER_ELEVENLABS_API_KEY = effectiveElevenLabsApiKey;
  }

  if (!settings) return;

  if (settings.ttsProvider === 'google') {
    process.env.ESL_TTS_DEFAULT_PROVIDER = 'google';
  } else if (settings.ttsProvider === 'elevenlabs') {
    process.env.ESL_TTS_DEFAULT_PROVIDER = 'elevenlabs';
  }
}
