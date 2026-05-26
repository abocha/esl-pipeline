import type {
  BuildPronunciationShadowSentenceInput,
  BuildPronunciationShadowSentenceOptions,
  BuildPronunciationTextInput,
  BuildPronunciationTextOptions,
  BuildStudyTextInput,
  BuildStudyTextOptions,
  ElevenLabsTtsModelId,
  SpeakerVoiceAssignment,
  TtsProviderAdapter,
} from '@esl-pipeline/tts-core';
import { resolveTtsSelection } from '@esl-pipeline/tts-core';

import {
  buildPronunciationShadowSentenceMp3,
  buildPronunciationTextMp3,
  buildStudyTextMp3,
  loadVoicesCatalog,
} from './index.js';
import { classifyElevenLabsVoiceProviderError } from './provider-runtime.js';

function resolveAdapterOptions<T extends { ttsModel?: string }>(
  options: T,
): Omit<T, 'ttsModel'> & { ttsModel?: ElevenLabsTtsModelId } {
  const selection = options.ttsModel
    ? resolveTtsSelection({ provider: 'elevenlabs', model: options.ttsModel })
    : undefined;
  return {
    ...options,
    ttsModel: selection?.model as ElevenLabsTtsModelId | undefined,
  };
}

export function createElevenLabsTtsProvider(): TtsProviderAdapter {
  return {
    id: 'elevenlabs',
    providerMetadata(args) {
      return {
        provider: 'elevenlabs',
        modelFamily: resolveTtsSelection({
          provider: 'elevenlabs',
          model: args.studyTextOptions?.ttsModel ?? args.shadowOptions?.ttsModel,
        }).model,
        pricingToken: 'ELEVENLABS',
      };
    },
    classifyProviderError(error: unknown) {
      return classifyElevenLabsVoiceProviderError({ error });
    },
    voice: {
      async loadCatalog() {
        return loadVoicesCatalog();
      },
      async resolveSpeakerAssignments(args: {
        input: BuildStudyTextInput;
        options: BuildStudyTextOptions;
      }): Promise<SpeakerVoiceAssignment[]> {
        const result = await buildStudyTextMp3(args.input, {
          ...resolveAdapterOptions(args.options),
          preview: true,
          ttsProvider: 'elevenlabs',
        });
        return result.voices.map((voice) => ({
          speaker: voice.speaker,
          voiceId: voice.voiceId,
          source: (voice.source as SpeakerVoiceAssignment['source']) ?? 'auto',
          score: voice.score,
          selectionReason: voice.selectionReason,
          capabilityMatches: voice.capabilityMatches,
          capabilityMismatches: voice.capabilityMismatches,
        }));
      },
    },
    async synthesizeStudyText(input: BuildStudyTextInput, options: BuildStudyTextOptions) {
      return buildStudyTextMp3(input, {
        ...resolveAdapterOptions(options),
        ttsProvider: 'elevenlabs',
      });
    },
    async synthesizeShadowSentence(
      input: BuildPronunciationShadowSentenceInput,
      options: BuildPronunciationShadowSentenceOptions,
    ) {
      return buildPronunciationShadowSentenceMp3(input, {
        ...resolveAdapterOptions(options),
        ttsProvider: 'elevenlabs',
      });
    },
    async synthesizePronunciationText(
      input: BuildPronunciationTextInput,
      options: BuildPronunciationTextOptions,
    ) {
      return buildPronunciationTextMp3(input, {
        ...resolveAdapterOptions(options),
        ttsProvider: 'elevenlabs',
      });
    },
  };
}
