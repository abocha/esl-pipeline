import { z } from 'zod';

import type { TtsModelId, TtsProviderId, TtsStrategy } from '@esl-pipeline/contracts';
import { isTtsModelForProvider } from '@esl-pipeline/tts-core';

export const publishTtsStrategySchema = z.enum(['auto', 'dialogue', 'tts']);
export const publishTtsProviderSchema = z.enum(['elevenlabs', 'google', 'inworld']);
export const publishTtsModelSchema = z.enum([
  'eleven_v3',
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_flash_v2',
  'chirp3_hd',
  'studio',
  'neural2',
  'wavenet',
  'inworld-tts-2',
  'inworld-tts-1.5-max',
  'inworld-tts-1.5-mini',
]);

export interface PublishStudyTextOverrides {
  ttsStrategy?: TtsStrategy | null;
  ttsProvider?: TtsProviderId | null;
  ttsModel?: TtsModelId | null;
}

export interface PublishStudyTextOverrideIssue {
  code: 'invalid_tts_model' | 'invalid_tts_model_for_strategy' | 'invalid_tts_model_for_provider';
  message: string;
  path: ['ttsModel'];
}

export function collectPublishStudyTextOverrideIssues(
  input: PublishStudyTextOverrides,
): PublishStudyTextOverrideIssue[] {
  const issues: PublishStudyTextOverrideIssue[] = [];
  const provider = input.ttsProvider ?? undefined;
  const strategy = input.ttsStrategy ?? undefined;
  const ttsModel = input.ttsModel ?? undefined;

  if (provider && ttsModel !== undefined && !isTtsModelForProvider(provider, ttsModel)) {
    issues.push({
      code: 'invalid_tts_model_for_provider',
      path: ['ttsModel'],
      message: `TTS model ${ttsModel} is not supported by ttsProvider=${provider}.`,
    });
  }

  if (provider === 'elevenlabs' && strategy === 'auto' && ttsModel !== undefined) {
    issues.push({
      code: 'invalid_tts_model_for_strategy',
      path: ['ttsModel'],
      message: 'Automatic ElevenLabs publish jobs must use strategy-default model selection.',
    });
  }

  if (provider === 'elevenlabs' && ttsModel === 'eleven_v3' && strategy !== 'dialogue') {
    issues.push({
      code: 'invalid_tts_model_for_strategy',
      path: ['ttsModel'],
      message: 'eleven_v3 is only valid for ElevenLabs dialogue study-text publishing.',
    });
  }

  if (
    provider === 'elevenlabs' &&
    strategy === 'dialogue' &&
    ttsModel !== undefined &&
    ttsModel !== 'eleven_v3'
  ) {
    issues.push({
      code: 'invalid_tts_model',
      path: ['ttsModel'],
      message: 'Dialogue study-text publishing only supports eleven_v3.',
    });
  }

  return issues;
}
