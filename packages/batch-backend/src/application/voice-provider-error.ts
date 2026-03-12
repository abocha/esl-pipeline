import type {
  VoiceProviderErrorCategory,
  VoiceProviderErrorDetails,
} from '@esl-pipeline/contracts';

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
const PROVIDER_CONTEXT_PATTERN = /\b(provider|tts|text-to-dialogue|dialogue|elevenlabs)\b/i;

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

  const providerStatus = parseProviderStatus(error);
  const categoryMatch = CATEGORY_PATTERN.exec(error);
  const category =
    (categoryMatch?.[1] && normalizeCategory(categoryMatch[1])) ||
    inferCategoryFromMessage(error.toLowerCase(), providerStatus);
  if (!category) return null;

  return {
    category,
    message: error,
    providerStatus: Number.isFinite(providerStatus) ? providerStatus : undefined,
    actionableHint: ACTIONABLE_HINTS[category],
  };
}

export function parseVoiceProviderErrors(
  errors: readonly (string | null | undefined)[],
): VoiceProviderErrorDetails[] {
  const parsed: VoiceProviderErrorDetails[] = [];
  for (const error of errors) {
    const detail = parseVoiceProviderError(error);
    if (detail) {
      parsed.push(detail);
    }
  }
  return parsed;
}

export function countVoiceProviderErrors(details: readonly VoiceProviderErrorDetails[]): number {
  return details.length;
}

export function buildVoiceProviderErrorBreakdown(
  details: readonly VoiceProviderErrorDetails[],
): Partial<Record<VoiceProviderErrorCategory, number>> {
  const breakdown: Partial<Record<VoiceProviderErrorCategory, number>> = {};
  for (const detail of details) {
    breakdown[detail.category] = (breakdown[detail.category] ?? 0) + 1;
  }
  return breakdown;
}

function parseProviderStatus(error: string): number | undefined {
  const statusMatch = /\b(?:http\s*)?(\d{3})\b/i.exec(error);
  const providerStatus = statusMatch ? Number.parseInt(statusMatch[1] ?? '', 10) : undefined;
  return Number.isFinite(providerStatus) ? providerStatus : undefined;
}

function inferCategoryFromMessage(
  message: string,
  providerStatus?: number,
): VoiceProviderErrorCategory | null {
  const hasProviderContext =
    PROVIDER_CONTEXT_PATTERN.test(message) || message.includes('voice generation');

  if (message.includes('invalid voice')) return 'invalid_voice_id';
  if (
    message.includes('unsupported') &&
    (message.includes('accent') || message.includes('style'))
  ) {
    return 'unsupported_voice_capability';
  }
  if (hasProviderContext && providerStatus === 429) return 'provider_rate_limit';
  if (
    hasProviderContext &&
    (message.includes('rate limit') || message.includes('too many requests'))
  ) {
    return 'provider_rate_limit';
  }
  if (
    hasProviderContext &&
    (providerStatus === 408 ||
      providerStatus === 504 ||
      (providerStatus !== undefined && providerStatus >= 500))
  ) {
    return 'provider_timeout';
  }
  if (hasProviderContext && (message.includes('timeout') || message.includes('timed out'))) {
    return 'provider_timeout';
  }
  if (
    hasProviderContext &&
    (providerStatus === 400 ||
      providerStatus === 401 ||
      providerStatus === 402 ||
      providerStatus === 403 ||
      providerStatus === 404 ||
      providerStatus === 413 ||
      providerStatus === 422)
  ) {
    return 'provider_contract_error';
  }
  if (
    message.includes('provider') ||
    message.includes('text-to-dialogue') ||
    message.includes('tts')
  ) {
    return 'provider_contract_error';
  }
  return null;
}
