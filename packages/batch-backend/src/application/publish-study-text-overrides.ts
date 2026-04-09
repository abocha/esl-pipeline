import { z } from 'zod';

import type {
  ElevenLabsTtsModelId,
  GoogleTtsModel,
  TtsProviderId,
  TtsStrategy,
} from '@esl-pipeline/contracts';

export const publishTtsStrategySchema = z.enum(['auto', 'dialogue', 'tts']);
export const publishTtsProviderSchema = z.enum(['elevenlabs', 'google']);
export const publishGoogleTtsModelSchema = z.enum(['chirp3_hd', 'studio', 'neural2', 'wavenet']);
export const publishElevenLabsModelSchema = z.enum([
  'eleven_v3',
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_flash_v2',
]);

export interface PublishStudyTextOverrides {
  ttsStrategy?: TtsStrategy | null;
  ttsProvider?: TtsProviderId | null;
  studyTextElevenlabsModel?: ElevenLabsTtsModelId | null;
  googleTtsModel?: GoogleTtsModel | null;
}

export interface PublishStudyTextOverrideIssue {
  code:
    | 'invalid_study_text_elevenlabs_model'
    | 'invalid_study_text_elevenlabs_model_for_strategy'
    | 'invalid_study_text_elevenlabs_model_for_provider';
  message: string;
  path: ['studyTextElevenlabsModel'];
}

export function collectPublishStudyTextOverrideIssues(
  input: PublishStudyTextOverrides,
): PublishStudyTextOverrideIssue[] {
  const issues: PublishStudyTextOverrideIssue[] = [];
  const provider = input.ttsProvider ?? undefined;
  const strategy = input.ttsStrategy ?? undefined;
  const studyTextElevenlabsModel = input.studyTextElevenlabsModel ?? undefined;

  if (provider === 'google' && studyTextElevenlabsModel !== undefined) {
    issues.push({
      code: 'invalid_study_text_elevenlabs_model_for_provider',
      path: ['studyTextElevenlabsModel'],
      message:
        'Google study-text publishing uses googleTtsModel; studyTextElevenlabsModel must be omitted.',
    });
  }

  if (provider === 'elevenlabs' && strategy === 'auto' && studyTextElevenlabsModel !== undefined) {
    issues.push({
      code: 'invalid_study_text_elevenlabs_model_for_strategy',
      path: ['studyTextElevenlabsModel'],
      message: 'Automatic ElevenLabs publish jobs must use strategy-default model selection.',
    });
  }

  if (
    provider === 'elevenlabs' &&
    studyTextElevenlabsModel === 'eleven_v3' &&
    strategy !== 'dialogue'
  ) {
    issues.push({
      code: 'invalid_study_text_elevenlabs_model_for_strategy',
      path: ['studyTextElevenlabsModel'],
      message: 'eleven_v3 is only valid for ElevenLabs dialogue study-text publishing.',
    });
  }

  if (
    provider === 'elevenlabs' &&
    strategy === 'dialogue' &&
    studyTextElevenlabsModel !== undefined &&
    studyTextElevenlabsModel !== 'eleven_v3'
  ) {
    issues.push({
      code: 'invalid_study_text_elevenlabs_model',
      path: ['studyTextElevenlabsModel'],
      message: 'Dialogue study-text publishing only supports eleven_v3.',
    });
  }

  return issues;
}
