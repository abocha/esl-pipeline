import type { ProviderId } from '../schema';
import { providerIds } from '../schema';
import { deepgramAdapter } from './deepgram';
import { elevenLabsAdapter } from './elevenlabs';
import { mistralAdapter } from './mistral';
import { sonioxAdapter } from './soniox';
import { speechmaticsAdapter } from './speechmatics';
import type { ProviderAdapter } from './types';

const adapters: Record<ProviderId, ProviderAdapter> = {
  'soniox-v5-async': sonioxAdapter,
  'speechmatics-melia-1-batch': speechmaticsAdapter,
  'mistral-voxtral-mini-transcribe-2': mistralAdapter,
  'deepgram-nova-3': deepgramAdapter,
  'elevenlabs-scribe-v2': elevenLabsAdapter,
};

export * from './types';
export { providerIds };

export function getProviderAdapter(providerId: ProviderId): ProviderAdapter {
  return adapters[providerId];
}
