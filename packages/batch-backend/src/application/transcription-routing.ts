import type { AudioInputTopology, SttProviderId } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';

export const MIXED_ELEVENLABS_PROFILE = 'mixed-recording-elevenlabs-scribe-v2-v1';
export const TRUSTED_SPLIT_DEEPGRAM_PROFILE = 'trusted-split-deepgram-nova3-v1';

export class TranscriptionRouteError extends Error {
  readonly code = 'trusted_split_provider_incompatible';

  constructor(provider: SttProviderId) {
    super(
      `Trusted split-channel recordings require the Deepgram multichannel route; ${provider} cannot prove the declared channel contract.`,
    );
    this.name = 'TranscriptionRouteError';
  }
}

export function resolveTranscriptionRoute(args: {
  config: BatchBackendConfig;
  topology: AudioInputTopology;
  requestedProvider?: SttProviderId;
}): { provider: SttProviderId; profile: string } {
  const provider =
    args.requestedProvider ??
    args.config.transcription.hardOverride ??
    (args.topology === 'mixed_recording'
      ? args.config.stt.defaultProvider
      : (args.config.stt.trustedSplitProvider ?? 'deepgram'));
  if (args.topology === 'trusted_split_channels' && provider !== 'deepgram') {
    throw new TranscriptionRouteError(provider);
  }
  if (args.topology === 'mixed_recording' && provider === 'elevenlabs') {
    return { provider, profile: MIXED_ELEVENLABS_PROFILE };
  }
  if (args.topology === 'trusted_split_channels' && provider === 'deepgram') {
    return { provider, profile: TRUSTED_SPLIT_DEEPGRAM_PROFILE };
  }
  return { provider, profile: `support-override-${args.topology}-${provider}-v1` };
}
