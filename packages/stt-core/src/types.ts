import type { Readable } from 'node:stream';

import type { ProviderRuntimeCategory } from '@esl-pipeline/provider-runtime';

export type SttProviderId = 'deepgram' | 'elevenlabs' | 'google';
export type TranscriptMode = 'timeline' | 'stack';
export type TranscriptSegmentKind = 'speech' | 'non_speech';

export interface TranscriptSegment {
  text: string;
  /** Omitted for backward-compatible lexical speech segments. */
  kind?: TranscriptSegmentKind;
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
  /**
   * Attempt-local provider transport. The backend supplies this only after it has
   * reserved a submission slot. Provider SDKs must use it for their actual HTTP
   * dispatch rather than asserting ownership before SDK-side preparation.
   */
  providerTransport?: {
    fetch: typeof fetch;
    signal: AbortSignal;
  };
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
