import { ConfigurationError } from '@esl-pipeline/contracts';

import {
  resolveDefaultTtsProvider,
  resolveTtsProviderOrder,
  validateTtsSelection,
} from './descriptors.js';
import { createPreparedStudyTextSynthesis, normalizeStudyTextSpeakerToken } from './speech-plan.js';
import type {
  BuildPronunciationShadowSentenceInput,
  BuildPronunciationShadowSentenceOptions,
  BuildPronunciationShadowSentenceResult,
  BuildPronunciationTextInput,
  BuildPronunciationTextOptions,
  BuildPronunciationTextResult,
  BuildStudyTextInput,
  BuildStudyTextOptions,
  BuildStudyTextResult,
  PreparedStudyTextSynthesis,
  SpeakerVoiceAssignment,
  TtsEngine,
  TtsModelId,
  TtsProviderAdapter,
  TtsProviderId,
  VoiceCatalog,
} from './types.js';
import { createResolvedVoicePlan, withVoicePlan } from './voice-plan.js';

const IDENTITY_VOICE_CAPABILITIES = {
  supportsMetadataInstructions: false,
  supportsNonVerbals: false,
  supportsUppercaseEmphasis: false,
  supportsFreeFormDirection: false,
} as const;

export class DefaultTtsEngine implements TtsEngine {
  private readonly providers = new Map<TtsProviderId, TtsProviderAdapter>();

  registerProvider(provider: TtsProviderAdapter): void {
    this.providers.set(provider.id, provider);
  }

  registerProviders(providers: TtsProviderAdapter[]): void {
    for (const provider of providers) {
      this.registerProvider(provider);
    }
  }

  getProvider(id: TtsProviderId): TtsProviderAdapter | undefined {
    return this.providers.get(id);
  }

  private resolveProviderId(explicit?: TtsProviderId): TtsProviderId {
    if (explicit) return explicit;
    const preferred: TtsProviderId[] = [];
    const seen = new Set<TtsProviderId>();
    for (const providerId of [resolveDefaultTtsProvider(), ...resolveTtsProviderOrder()]) {
      if (seen.has(providerId)) continue;
      seen.add(providerId);
      preferred.push(providerId);
    }

    for (const providerId of preferred) {
      if (this.providers.has(providerId)) return providerId;
    }

    const firstRegistered = this.providers.keys().next().value as TtsProviderId | undefined;
    if (firstRegistered) return firstRegistered;
    return resolveDefaultTtsProvider();
  }

  private resolveProviderOrThrow(id: TtsProviderId): TtsProviderAdapter {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new ConfigurationError(
        `TTS provider "${id}" is not registered. Registered providers: ${[...this.providers.keys()].join(', ') || '(none)'}`,
      );
    }
    return provider;
  }

  private validateExplicitModel(providerId: TtsProviderId, model?: string): TtsModelId | undefined {
    if (!model) return undefined;
    return validateTtsSelection({ provider: providerId, model }).model;
  }

  async buildStudyTextMp3(
    input: BuildStudyTextInput,
    options: BuildStudyTextOptions,
  ): Promise<BuildStudyTextResult> {
    const providerId = this.resolveProviderId(options.ttsProvider);
    const ttsModel = this.validateExplicitModel(providerId, options.ttsModel);
    const provider = this.resolveProviderOrThrow(providerId);
    return provider.synthesizeStudyText(input, {
      ...options,
      ttsProvider: providerId,
      ttsModel,
    });
  }

  async prepareStudyTextSynthesis(
    input: BuildStudyTextInput,
    options: BuildStudyTextOptions,
  ): Promise<PreparedStudyTextSynthesis> {
    const providerId = this.resolveProviderId(options.ttsProvider);
    const ttsModel = this.validateExplicitModel(providerId, options.ttsModel);
    const provider = this.resolveProviderOrThrow(providerId);
    const resolvedOptions = { ...options, ttsProvider: providerId, ttsModel };
    const prepared = createPreparedStudyTextSynthesis(input, resolvedOptions);
    const assignments = await provider.voice.resolveSpeakerAssignments({
      input,
      options: resolvedOptions,
    });
    return withVoicePlan(
      prepared,
      createResolvedVoicePlan(
        prepared,
        normalizeVoiceAssignments(assignments),
        options.voiceRanker ? { ranker: options.voiceRanker.metadata } : {},
      ),
    );
  }

  async buildPronunciationShadowSentenceMp3(
    input: BuildPronunciationShadowSentenceInput,
    options: BuildPronunciationShadowSentenceOptions,
  ): Promise<BuildPronunciationShadowSentenceResult> {
    const providerId = this.resolveProviderId(options.ttsProvider);
    const ttsModel = this.validateExplicitModel(providerId, options.ttsModel);
    const provider = this.resolveProviderOrThrow(providerId);
    return provider.synthesizeShadowSentence(input, {
      ...options,
      ttsProvider: providerId,
      ttsModel,
    });
  }

  async buildPronunciationTextMp3(
    input: BuildPronunciationTextInput,
    options: BuildPronunciationTextOptions,
  ): Promise<BuildPronunciationTextResult> {
    const providerId = this.resolveProviderId(options.ttsProvider);
    const ttsModel = this.validateExplicitModel(providerId, options.ttsModel);
    const provider = this.resolveProviderOrThrow(providerId);
    return provider.synthesizePronunciationText(input, {
      ...options,
      ttsProvider: providerId,
      ttsModel,
    });
  }

  async loadVoicesCatalog(provider?: TtsProviderId): Promise<VoiceCatalog> {
    const providerId = this.resolveProviderId(provider);
    const adapter = this.resolveProviderOrThrow(providerId);
    return adapter.voice.loadCatalog();
  }
}

function normalizeVoiceAssignments(assignments: SpeakerVoiceAssignment[]) {
  const normalized = new Map<string, SpeakerVoiceAssignment>();
  for (const assignment of assignments) {
    const speaker = normalizeStudyTextSpeakerToken(assignment.speaker) ?? assignment.speaker;
    if (normalized.has(speaker)) continue;
    normalized.set(speaker, {
      ...assignment,
      speaker,
      capabilities: assignment.capabilities ?? IDENTITY_VOICE_CAPABILITIES,
    });
  }
  return [...normalized.values()].map((assignment) => ({
    ...assignment,
    capabilities: assignment.capabilities ?? IDENTITY_VOICE_CAPABILITIES,
  }));
}

export function createTtsEngine(providers: TtsProviderAdapter[] = []): TtsEngine {
  const engine = new DefaultTtsEngine();
  engine.registerProviders(providers);
  return engine;
}
