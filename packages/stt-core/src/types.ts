import type { Readable } from 'node:stream';

import type { ProviderRuntimeCategory } from '@esl-pipeline/provider-runtime';

export type SttProviderId = 'deepgram' | 'elevenlabs' | 'google';
export type TranscriptMode = 'timeline' | 'stack';

export interface TranscriptSegment {
  text: string;
  speaker?: number;
  start?: number;
  end?: number;
}

export type SttSubmissionSource =
  | {
      kind: 'url';
      url: string;
    }
  | {
      kind: 'file';
      path: string;
      filename: string;
      contentType: string;
      contentLength: number;
    };

export interface SttTranscribeContext {
  recordingId: string;
  storageUri: string;
  getStream: () => Promise<Readable>;
  /** Provider-specific submission source, prepared only when a provider attempt is submitted. */
  getSubmissionSource?: () => Promise<SttSubmissionSource>;
}

export interface SttTranscriptionResult {
  provider: SttProviderId;
  model: string;
  language: string;
  text: string;
  segments: TranscriptSegment[];
  rawResponse: unknown;
  fallbackUsed: boolean;
  summary?: Record<string, unknown> | null;
}

export interface SttProviderAdapter<TConfig = unknown> {
  id: SttProviderId;
  providerMetadata?(config: TConfig): {
    provider: SttProviderId;
    model?: string;
    language?: string;
  };
  classifyProviderError?(error: unknown): ProviderRuntimeCategory | null;
  validateConfig?(config: TConfig): void | Promise<void>;
  transcribe(args: {
    context: SttTranscribeContext;
    config: TConfig;
  }): Promise<SttTranscriptionResult>;
}

export interface SttEngine {
  registerProvider(provider: SttProviderAdapter): void;
  registerProviders(providers: SttProviderAdapter[]): void;
  getProvider(id: SttProviderId): SttProviderAdapter | undefined;
  transcribe(args: {
    provider?: SttProviderId;
    context: SttTranscribeContext;
    configByProvider: Partial<Record<SttProviderId, unknown>>;
  }): Promise<SttTranscriptionResult>;
  validateProviderConfig(args: {
    provider?: SttProviderId;
    configByProvider: Partial<Record<SttProviderId, unknown>>;
  }): Promise<void>;
}
