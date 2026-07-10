import type { SttProviderId } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../../config/env.js';
import type { TranscriptRecord } from '../../domain/transcript-model.js';

function normalizeSttProvider(value: unknown): SttProviderId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'deepgram' || normalized === 'elevenlabs' || normalized === 'google') {
    return normalized;
  }
  return null;
}

export function inferTranscriptSttProvider(
  transcript: Pick<TranscriptRecord, 'model' | 'summaryJson'> &
    Partial<Pick<TranscriptRecord, 'sttProvider'>>,
): SttProviderId | null {
  const directProvider = normalizeSttProvider(transcript.sttProvider);
  if (directProvider) return directProvider;

  const summaryJson = transcript.summaryJson;
  const summaryProvider = normalizeSttProvider(
    summaryJson && typeof summaryJson === 'object'
      ? (summaryJson as { provider?: unknown }).provider
      : null,
  );
  if (summaryProvider) return summaryProvider;

  const normalizedModel = transcript.model.trim().toLowerCase();
  if (!normalizedModel) return null;
  if (normalizedModel.includes('scribe') || normalizedModel.includes('eleven')) {
    return 'elevenlabs';
  }
  if (normalizedModel.includes('google')) {
    return 'google';
  }
  if (
    normalizedModel.includes('nova') ||
    normalizedModel.includes('deepgram') ||
    normalizedModel.includes('enhanced')
  ) {
    return 'deepgram';
  }
  return null;
}

export function resolveExpectedSttModelAndLanguage(
  config: BatchBackendConfig,
  provider: SttProviderId,
): { model: string; language: string } {
  if (provider === 'elevenlabs') {
    return {
      model: config.stt.providers.elevenlabs.model,
      language: 'auto',
    };
  }
  if (provider === 'google') {
    return {
      model: config.stt.providers.google.model,
      language: config.stt.providers.google.languageCodes[0] ?? 'auto',
    };
  }
  return {
    model: config.stt.providers.deepgram.model,
    language: config.stt.providers.deepgram.language,
  };
}

export function shouldReuseCachedTranscriptForFingerprint(args: {
  effectiveProvider: SttProviderId;
  mode: TranscriptRecord['mode'];
  model: string;
  language: string;
  transcript: Pick<TranscriptRecord, 'sttProvider' | 'mode' | 'model' | 'language' | 'summaryJson'>;
}): boolean {
  const inferredProvider = inferTranscriptSttProvider(args.transcript);
  if (inferredProvider === null || inferredProvider !== args.effectiveProvider) {
    return false;
  }
  if (args.transcript.mode !== args.mode) {
    return false;
  }
  if (args.transcript.model.trim().toLowerCase() !== args.model.trim().toLowerCase()) {
    return false;
  }
  if (args.transcript.language.trim().toLowerCase() !== args.language.trim().toLowerCase()) {
    return false;
  }
  return true;
}
