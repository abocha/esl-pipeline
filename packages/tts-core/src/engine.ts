import { ConfigurationError } from '@esl-pipeline/contracts';

import type {
  BuildPronunciationShadowSentenceInput,
  BuildPronunciationShadowSentenceOptions,
  BuildPronunciationShadowSentenceResult,
  BuildStudyTextInput,
  BuildStudyTextOptions,
  BuildStudyTextResult,
  TtsEngine,
  TtsProviderAdapter,
  TtsProviderId,
  VoiceCatalog,
} from './types.js';

function resolveDefaultProvider(): TtsProviderId {
  const raw = process.env.ESL_TTS_DEFAULT_PROVIDER?.trim().toLowerCase();
  if (raw === 'google') return 'google';
  return 'elevenlabs';
}

function parseProviderId(raw: string): TtsProviderId | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'elevenlabs') return 'elevenlabs';
  if (normalized === 'google') return 'google';
  return null;
}

function resolveProviderOrder(): TtsProviderId[] {
  const raw = process.env.ESL_TTS_PROVIDER_ORDER?.trim();
  if (!raw) return [];
  const order: TtsProviderId[] = [];
  const seen = new Set<TtsProviderId>();
  for (const token of raw.split(',')) {
    const parsed = parseProviderId(token);
    if (!parsed || seen.has(parsed)) continue;
    seen.add(parsed);
    order.push(parsed);
  }
  return order;
}

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
    for (const providerId of [resolveDefaultProvider(), ...resolveProviderOrder()]) {
      if (seen.has(providerId)) continue;
      seen.add(providerId);
      preferred.push(providerId);
    }

    for (const providerId of preferred) {
      if (this.providers.has(providerId)) return providerId;
    }

    const firstRegistered = this.providers.keys().next().value as TtsProviderId | undefined;
    if (firstRegistered) return firstRegistered;
    return resolveDefaultProvider();
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
    const provider = this.resolveProviderOrThrow(providerId);
    return provider.synthesizeStudyText(input, { ...options, ttsProvider: providerId });
  }

  async buildPronunciationShadowSentenceMp3(
    input: BuildPronunciationShadowSentenceInput,
    options: BuildPronunciationShadowSentenceOptions,
  ): Promise<BuildPronunciationShadowSentenceResult> {
    const providerId = this.resolveProviderId(options.ttsProvider);
    const provider = this.resolveProviderOrThrow(providerId);
    return provider.synthesizeShadowSentence(input, { ...options, ttsProvider: providerId });
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
