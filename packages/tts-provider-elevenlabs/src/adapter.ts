import type {
  BuildPronunciationShadowSentenceInput,
  BuildPronunciationShadowSentenceOptions,
  BuildPronunciationTextInput,
  BuildPronunciationTextOptions,
  BuildStudyTextInput,
  BuildStudyTextOptions,
  SpeakerVoiceAssignment,
  TtsProviderAdapter,
} from '@esl-pipeline/tts-core';

import {
  buildPronunciationShadowSentenceMp3,
  buildPronunciationTextMp3,
  buildStudyTextMp3,
  loadVoicesCatalog,
} from './index.js';
import { classifyElevenLabsVoiceProviderError } from './provider-runtime.js';

export function createElevenLabsTtsProvider(): TtsProviderAdapter {
  return {
    id: 'elevenlabs',
    providerMetadata() {
      return {
        provider: 'elevenlabs',
        modelFamily: process.env.ESL_TTS_PROVIDER_ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2',
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
          ...args.options,
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
      return buildStudyTextMp3(input, { ...options, ttsProvider: 'elevenlabs' });
    },
    async synthesizeShadowSentence(
      input: BuildPronunciationShadowSentenceInput,
      options: BuildPronunciationShadowSentenceOptions,
    ) {
      return buildPronunciationShadowSentenceMp3(input, { ...options, ttsProvider: 'elevenlabs' });
    },
    async synthesizePronunciationText(
      input: BuildPronunciationTextInput,
      options: BuildPronunciationTextOptions,
    ) {
      return buildPronunciationTextMp3(input, { ...options, ttsProvider: 'elevenlabs' });
    },
  };
}
