import { ConfigurationError } from '@esl-pipeline/contracts';

import type {
  SttEngine,
  SttProviderAdapter,
  SttProviderId,
  SttTranscribeContext,
  SttTranscriptionResult,
} from './types.js';

function parseProviderId(raw: string): SttProviderId | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'deepgram' || normalized === 'elevenlabs' || normalized === 'google') {
    return normalized;
  }
  return null;
}

function resolveDefaultProvider(): SttProviderId {
  const env = process.env.ESL_STT_DEFAULT_PROVIDER?.trim().toLowerCase();
  const parsed = env ? parseProviderId(env) : null;
  return parsed ?? 'deepgram';
}

function resolveProviderOrder(): SttProviderId[] {
  const raw = process.env.ESL_STT_PROVIDER_ORDER?.trim();
  if (!raw) return [];
  const order: SttProviderId[] = [];
  const seen = new Set<SttProviderId>();
  for (const token of raw.split(',')) {
    const parsed = parseProviderId(token);
    if (!parsed || seen.has(parsed)) continue;
    seen.add(parsed);
    order.push(parsed);
  }
  return order;
}

export class DefaultSttEngine implements SttEngine {
  private readonly providers = new Map<SttProviderId, SttProviderAdapter>();

  registerProvider(provider: SttProviderAdapter): void {
    this.providers.set(provider.id, provider);
  }

  registerProviders(providers: SttProviderAdapter[]): void {
    for (const provider of providers) {
      this.registerProvider(provider);
    }
  }

  getProvider(id: SttProviderId): SttProviderAdapter | undefined {
    return this.providers.get(id);
  }

  private resolveProviderId(explicit?: SttProviderId): SttProviderId {
    if (explicit) return explicit;

    const preferred: SttProviderId[] = [];
    const seen = new Set<SttProviderId>();
    for (const providerId of [resolveDefaultProvider(), ...resolveProviderOrder()]) {
      if (seen.has(providerId)) continue;
      seen.add(providerId);
      preferred.push(providerId);
    }

    for (const providerId of preferred) {
      if (this.providers.has(providerId)) return providerId;
    }

    const firstRegistered = this.providers.keys().next().value as SttProviderId | undefined;
    if (firstRegistered) return firstRegistered;
    return resolveDefaultProvider();
  }

  private resolveProviderOrThrow(id: SttProviderId): SttProviderAdapter {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new ConfigurationError(
        `STT provider "${id}" is not registered. Registered providers: ${[...this.providers.keys()].join(', ') || '(none)'}`,
      );
    }
    return provider;
  }

  async transcribe(args: {
    provider?: SttProviderId;
    context: SttTranscribeContext;
    configByProvider: Partial<Record<SttProviderId, unknown>>;
  }): Promise<SttTranscriptionResult> {
    const providerId = this.resolveProviderId(args.provider);
    const provider = this.resolveProviderOrThrow(providerId);
    const config = args.configByProvider[providerId];
    return provider.transcribe({
      context: args.context,
      config,
    });
  }

  async validateProviderConfig(args: {
    provider?: SttProviderId;
    configByProvider: Partial<Record<SttProviderId, unknown>>;
  }): Promise<void> {
    const providerId = this.resolveProviderId(args.provider);
    const provider = this.resolveProviderOrThrow(providerId);
    if (!provider.validateConfig) return;
    await provider.validateConfig(args.configByProvider[providerId]);
  }
}

export function createSttEngine(providers: SttProviderAdapter[] = []): SttEngine {
  const engine = new DefaultSttEngine();
  engine.registerProviders(providers);
  return engine;
}
