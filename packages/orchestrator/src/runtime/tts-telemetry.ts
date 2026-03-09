import type { BuildStudyTextResult } from '@esl-pipeline/tts-core';

import type { PipelineMetrics } from '../observability.js';

function readUsdNumberFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

function toProviderEnvToken(provider: string): string {
  return provider
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '');
}

function resolveTtsCostPer1kCharsUsd(provider: string): number | undefined {
  const normalized = provider.trim().toLowerCase();
  const providerToken = toProviderEnvToken(normalized);
  const canonicalProviderScoped = providerToken
    ? readUsdNumberFromEnv(`ESL_TTS_PROVIDER_${providerToken}_COST_PER_1K_CHARS_USD`)
    : undefined;
  const legacyProviderScoped = providerToken
    ? readUsdNumberFromEnv(`ESL_TTS_COST_PER_1K_CHARS_USD_${providerToken}`)
    : undefined;

  const legacyProviderSpecific =
    normalized === 'elevenlabs'
      ? readUsdNumberFromEnv('ELEVENLABS_TTS_COST_PER_1K_CHARS_USD')
      : normalized === 'openai'
        ? readUsdNumberFromEnv('OPENAI_TTS_COST_PER_1K_CHARS_USD')
        : normalized === 'google'
          ? readUsdNumberFromEnv('GOOGLE_TTS_COST_PER_1K_CHARS_USD')
          : normalized === 'azure'
            ? readUsdNumberFromEnv('AZURE_TTS_COST_PER_1K_CHARS_USD')
            : undefined;

  return (
    canonicalProviderScoped ??
    legacyProviderScoped ??
    legacyProviderSpecific ??
    readUsdNumberFromEnv('ESL_TTS_COST_PER_1K_CHARS_USD')
  );
}

export function buildTtsSpendSummary(
  ttsResult: Pick<BuildStudyTextResult, 'generatedCharacters' | 'cachedCharacters'> & {
    provider?: string;
  },
): {
  provider: string;
  generatedCharacters: number;
  cachedCharacters: number;
  costPer1kCharsUsd?: number;
  estimatedSpendUsd?: number;
} {
  const provider =
    typeof ttsResult.provider === 'string' && ttsResult.provider.trim().length > 0
      ? ttsResult.provider.trim()
      : 'elevenlabs';
  const generatedCharacters = Math.max(0, ttsResult.generatedCharacters ?? 0);
  const cachedCharacters = Math.max(0, ttsResult.cachedCharacters ?? 0);
  const costPer1kCharsUsd = resolveTtsCostPer1kCharsUsd(provider);
  const estimatedSpendUsd =
    costPer1kCharsUsd === undefined ? undefined : (generatedCharacters / 1000) * costPer1kCharsUsd;

  const summary: {
    provider: string;
    generatedCharacters: number;
    cachedCharacters: number;
    costPer1kCharsUsd?: number;
    estimatedSpendUsd?: number;
  } = {
    provider,
    generatedCharacters,
    cachedCharacters,
  };

  if (costPer1kCharsUsd !== undefined) {
    summary.costPer1kCharsUsd = costPer1kCharsUsd;
  }

  if (estimatedSpendUsd !== undefined) {
    summary.estimatedSpendUsd = estimatedSpendUsd;
  }

  return summary;
}

export function summarizeVoiceSelections(
  voices?: BuildStudyTextResult['voices'],
): string | undefined {
  if (!voices || voices.length === 0) return undefined;
  return voices
    .map((voice) => {
      const name = voice.voiceName ?? voice.voiceId;
      const tags: string[] = [];
      if (voice.gender) tags.push(voice.gender);
      switch (voice.source) {
        case 'profile': {
          tags.push('profile');
          break;
        }
        case 'voiceMap': {
          tags.push('map');
          break;
        }
        case 'auto': {
          tags.push(typeof voice.score === 'number' ? `auto ${Math.round(voice.score)}` : 'auto');
          break;
        }
        case 'default': {
          tags.push('default');
          break;
        }
        case 'fallback': {
          tags.push('fallback');
          break;
        }
        case 'reuse': {
          tags.push('reuse');
          break;
        }
      }
      if (voice.accent && tags.length < 3) tags.push(voice.accent);
      const tagString = tags.length > 0 ? ` (${tags.join(', ')})` : '';
      return `${voice.speaker}→${name}${tagString}`;
    })
    .join(', ');
}

export function categorizeProviderErrorFromMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match =
    /\[(invalid_voice_id|unsupported_voice_capability|provider_rate_limit|provider_timeout|provider_contract_error)\]/i.exec(
      message,
    );
  if (!match?.[1]) return null;
  return match[1].toLowerCase();
}

export function emitVoiceSelectionMetrics(
  metrics: PipelineMetrics | undefined,
  voices?: BuildStudyTextResult['voices'],
): void {
  if (!metrics || !voices || voices.length === 0) return;
  const fallbackSelections = voices.filter((voice) => voice.source === 'fallback').length;
  const reuseSelections = voices.filter((voice) => voice.source === 'reuse').length;
  metrics.increment('esl.voice_alignment.selection_total', voices.length, {});
  if (fallbackSelections > 0) {
    metrics.increment('esl.voice_alignment.fallback_selections', fallbackSelections, {});
  }
  if (reuseSelections > 0) {
    metrics.increment('esl.voice_alignment.reuse_selections', reuseSelections, {});
  }
}
