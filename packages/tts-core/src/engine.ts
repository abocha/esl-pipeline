import { ConfigurationError } from '@esl-pipeline/contracts';

import {
  resolveDefaultTtsProvider,
  resolveTtsProviderOrder,
  validateTtsSelection,
} from './descriptors.js';
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
  TtsEngine,
  TtsProviderAdapter,
  TtsProviderId,
  VoiceCatalog,
} from './types.js';

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

  async buildStudyTextMp3(
    input: BuildStudyTextInput,
    options: BuildStudyTextOptions,
  ): Promise<BuildStudyTextResult> {
    const providerId = this.resolveProviderId(options.ttsProvider);
    const selection = validateTtsSelection({ provider: providerId, model: options.ttsModel });
    const provider = this.resolveProviderOrThrow(providerId);
    return provider.synthesizeStudyText(input, {
      ...options,
      ttsProvider: selection.provider,
      ttsModel: selection.model,
    });
  }

  async buildPronunciationShadowSentenceMp3(
    input: BuildPronunciationShadowSentenceInput,
    options: BuildPronunciationShadowSentenceOptions,
  ): Promise<BuildPronunciationShadowSentenceResult> {
    const providerId = this.resolveProviderId(options.ttsProvider);
    const selection = validateTtsSelection({ provider: providerId, model: options.ttsModel });
    const provider = this.resolveProviderOrThrow(providerId);
    return provider.synthesizeShadowSentence(input, {
      ...options,
      ttsProvider: selection.provider,
      ttsModel: selection.model,
    });
  }

  async buildPronunciationTextMp3(
    input: BuildPronunciationTextInput,
    options: BuildPronunciationTextOptions,
  ): Promise<BuildPronunciationTextResult> {
    const providerId = this.resolveProviderId(options.ttsProvider);
    const selection = validateTtsSelection({ provider: providerId, model: options.ttsModel });
    const provider = this.resolveProviderOrThrow(providerId);
    return provider.synthesizePronunciationText(input, {
      ...options,
      ttsProvider: selection.provider,
      ttsModel: selection.model,
    });
  }

  async loadVoicesCatalog(provider?: TtsProviderId): Promise<VoiceCatalog> {
    const providerId = this.resolveProviderId(provider);
    const adapter = this.resolveProviderOrThrow(providerId);
    return adapter.voice.loadCatalog();
  }
}

export function createTtsEngine(providers: TtsProviderAdapter[] = []): TtsEngine {
  const engine = new DefaultTtsEngine();
  engine.registerProviders(providers);
  return engine;
}
