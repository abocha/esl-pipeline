import type {
  ElevenLabsTtsModelId,
  GoogleTtsModel,
  InworldTtsModel,
  TtsModelId,
  TtsProviderId,
} from '@esl-pipeline/contracts';
import { ConfigurationError } from '@esl-pipeline/contracts';

import type { TtsProviderDescriptor, TtsSelection } from './types.js';

export const ELEVENLABS_TTS_MODELS = [
  'eleven_v3',
  'eleven_multilingual_v2',
  'eleven_flash_v2_5',
  'eleven_flash_v2',
] as const satisfies readonly ElevenLabsTtsModelId[];

export const GOOGLE_TTS_MODELS = [
  'chirp3_hd',
  'studio',
  'neural2',
  'wavenet',
] as const satisfies readonly GoogleTtsModel[];

export const INWORLD_TTS_MODELS = [
  'inworld-tts-2',
  'inworld-tts-1.5-max',
  'inworld-tts-1.5-mini',
] as const satisfies readonly InworldTtsModel[];

export const ELEVENLABS_TTS_DESCRIPTOR = {
  id: 'elevenlabs',
  label: 'ElevenLabs',
  models: ELEVENLABS_TTS_MODELS,
  defaultModel: 'eleven_multilingual_v2',
  envModelKey: 'ESL_TTS_PROVIDER_ELEVENLABS_MODEL_ID',
  capabilitySnapshotMode: 'credentialed',
} as const satisfies TtsProviderDescriptor<'elevenlabs', ElevenLabsTtsModelId>;

export const GOOGLE_TTS_DESCRIPTOR = {
  id: 'google',
  label: 'Google TTS',
  models: GOOGLE_TTS_MODELS,
  defaultModel: 'chirp3_hd',
  envModelKey: 'ESL_TTS_PROVIDER_GOOGLE_MODEL',
  capabilitySnapshotMode: 'credentialed',
} as const satisfies TtsProviderDescriptor<'google', GoogleTtsModel>;

export const INWORLD_TTS_DESCRIPTOR = {
  id: 'inworld',
  label: 'Inworld',
  models: INWORLD_TTS_MODELS,
  defaultModel: 'inworld-tts-2',
  envModelKey: 'ESL_TTS_PROVIDER_INWORLD_MODEL',
  defaultVoiceId: 'Ashley',
  capabilitySnapshotMode: 'credentialed',
} as const satisfies TtsProviderDescriptor<'inworld', InworldTtsModel>;

export const TTS_PROVIDER_DESCRIPTORS = [
  ELEVENLABS_TTS_DESCRIPTOR,
  GOOGLE_TTS_DESCRIPTOR,
  INWORLD_TTS_DESCRIPTOR,
] as const satisfies readonly TtsProviderDescriptor[];

const DESCRIPTORS_BY_PROVIDER = new Map<TtsProviderId, TtsProviderDescriptor>(
  TTS_PROVIDER_DESCRIPTORS.map((descriptor) => [descriptor.id, descriptor]),
);

export function getTtsProviderDescriptor(
  provider: TtsProviderId,
): TtsProviderDescriptor | undefined {
  return DESCRIPTORS_BY_PROVIDER.get(provider);
}

export function getTtsProviderDescriptors(): readonly TtsProviderDescriptor[] {
  return TTS_PROVIDER_DESCRIPTORS;
}

export function parseTtsProviderId(value: unknown): TtsProviderId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'elevenlabs' || normalized === 'google' || normalized === 'inworld') {
    return normalized;
  }
  return null;
}

export function parseTtsModelId(value: unknown): TtsModelId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  for (const descriptor of TTS_PROVIDER_DESCRIPTORS) {
    if ((descriptor.models as readonly string[]).includes(normalized)) {
      return normalized as TtsModelId;
    }
  }
  return null;
}

export function isTtsModelForProvider(provider: TtsProviderId, model: string): boolean {
  const descriptor = getTtsProviderDescriptor(provider);
  return Boolean(descriptor && (descriptor.models as readonly string[]).includes(model));
}

export function resolveDefaultTtsModel(provider: TtsProviderId): TtsModelId {
  const descriptor = getRequiredTtsProviderDescriptor(provider);
  const envValue = descriptor.envModelKey ? process.env[descriptor.envModelKey]?.trim() : undefined;
  if (envValue) {
    if (isTtsModelForProvider(provider, envValue)) {
      return envValue as TtsModelId;
    }
    throw new ConfigurationError(
      `Unsupported ${descriptor.envModelKey} "${envValue}". Use one of: ${descriptor.models.join(', ')}`,
    );
  }
  return descriptor.defaultModel;
}

export function validateTtsSelection(selection: {
  provider: TtsProviderId;
  model?: string | null;
}): TtsSelection {
  const model = selection.model?.trim() || resolveDefaultTtsModel(selection.provider);
  if (!isTtsModelForProvider(selection.provider, model)) {
    throw new ConfigurationError(
      `TTS model "${model}" is not supported by provider "${selection.provider}". ` +
        `Use one of: ${getRequiredTtsProviderDescriptor(selection.provider).models.join(', ')}`,
    );
  }
  return { provider: selection.provider, model: model as TtsModelId };
}

export function resolveTtsSelection(input: {
  provider?: TtsProviderId | null;
  model?: string | null;
  fallbackProvider?: TtsProviderId;
}): TtsSelection {
  const provider = input.provider ?? input.fallbackProvider ?? resolveDefaultTtsProvider();
  return validateTtsSelection({ provider, model: input.model });
}

export function resolveDefaultTtsProvider(): TtsProviderId {
  return parseTtsProviderId(process.env.ESL_TTS_DEFAULT_PROVIDER) ?? 'elevenlabs';
}

export function resolveTtsProviderOrder(): TtsProviderId[] {
  const raw = process.env.ESL_TTS_PROVIDER_ORDER?.trim();
  if (!raw) return [];
  const order: TtsProviderId[] = [];
  const seen = new Set<TtsProviderId>();
  for (const token of raw.split(',')) {
    const provider = parseTtsProviderId(token);
    if (!provider || seen.has(provider)) continue;
    seen.add(provider);
    order.push(provider);
  }
  return order;
}

export function buildTtsModelOptionsByProvider(
  providers: readonly TtsProviderId[] = TTS_PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.id),
): Partial<Record<TtsProviderId, string[]>> {
  return Object.fromEntries(
    providers.map((provider) => [provider, [...getRequiredTtsProviderDescriptor(provider).models]]),
  ) as Partial<Record<TtsProviderId, string[]>>;
}

export function buildDefaultTtsModelByProvider(
  providers: readonly TtsProviderId[] = TTS_PROVIDER_DESCRIPTORS.map((descriptor) => descriptor.id),
): Partial<Record<TtsProviderId, string>> {
  return Object.fromEntries(
    providers.map((provider) => [provider, resolveDefaultTtsModel(provider)]),
  );
}

function getRequiredTtsProviderDescriptor(provider: TtsProviderId): TtsProviderDescriptor {
  const descriptor = getTtsProviderDescriptor(provider);
  if (!descriptor) {
    throw new ConfigurationError(`Unsupported TTS provider "${provider}".`);
  }
  return descriptor;
}
