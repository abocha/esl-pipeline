import type { VoiceProviderErrorCategory, VoiceProviderErrorDetails } from '@esl-pipeline/contracts';

const CATEGORY_PATTERN =
  /\[(invalid_voice_id|unsupported_voice_capability|provider_rate_limit|provider_timeout|provider_contract_error)\]/i;

const ACTIONABLE_HINTS: Record<VoiceProviderErrorCategory, string> = {
  invalid_voice_id:
    'Check speaker_profiles.voice overrides and the synced ElevenLabs voice catalog.',
  unsupported_voice_capability:
    'Adjust requested accent/style metadata to values available in the current voice catalog.',
  provider_rate_limit: 'Retry later or reduce request concurrency/chunk size.',
  provider_timeout: 'Retry with smaller chunks or increased provider timeout settings.',
  provider_contract_error: 'Check request payload shape and provider SDK compatibility.',
};

function normalizeCategory(value: string): VoiceProviderErrorCategory | null {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'invalid_voice_id' ||
    normalized === 'unsupported_voice_capability' ||
    normalized === 'provider_rate_limit' ||
    normalized === 'provider_timeout' ||
    normalized === 'provider_contract_error'
  ) {
    return normalized;
  }
  return null;
}

export function parseVoiceProviderError(
  error: string | null | undefined,
): VoiceProviderErrorDetails | null {
  if (!error || error.trim().length === 0) return null;

  const categoryMatch = CATEGORY_PATTERN.exec(error);
  const category =
    (categoryMatch?.[1] && normalizeCategory(categoryMatch[1])) ||
    inferCategoryFromMessage(error.toLowerCase());
  if (!category) return null;

  const statusMatch = /\b(?:http\s*)?(\d{3})\b/i.exec(error);
  const providerStatus = statusMatch ? Number.parseInt(statusMatch[1] ?? '', 10) : undefined;

  return {
    category,
    message: error,
    providerStatus: Number.isFinite(providerStatus) ? providerStatus : undefined,
    actionableHint: ACTIONABLE_HINTS[category],
  };
}

function inferCategoryFromMessage(message: string): VoiceProviderErrorCategory | null {
  if (message.includes('invalid voice')) return 'invalid_voice_id';
  if (message.includes('unsupported') && (message.includes('accent') || message.includes('style'))) {
    return 'unsupported_voice_capability';
  }
  if (message.includes('rate limit') || message.includes('too many requests')) {
    return 'provider_rate_limit';
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return 'provider_timeout';
  }
  if (message.includes('provider') || message.includes('text-to-dialogue') || message.includes('tts')) {
    return 'provider_contract_error';
  }
  return null;
}

