import { ElevenLabsError, ElevenLabsTimeoutError } from '@elevenlabs/elevenlabs-js';
import type { VoiceProviderErrorCategory } from '@esl-pipeline/contracts';
import {
  classifyProviderRuntimeFailure,
  type ProviderRuntimeClassificationRules,
} from '@esl-pipeline/provider-runtime';

const ELEVENLABS_PROVIDER = 'elevenlabs';

const ELEVENLABS_CLASSIFICATION_RULES: ProviderRuntimeClassificationRules = {
  byProvider: {
    elevenlabs: {
      timeoutStatuses: [408, 504],
    },
  },
};

const RETRYABLE_TTS_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export interface ElevenLabsRuntimeErrorDetails {
  status?: number;
  code?: string;
  message: string;
  name?: string;
}

export function extractElevenLabsRuntimeErrorDetails(error: unknown): ElevenLabsRuntimeErrorDetails {
  const status = extractElevenLabsStatusCode(error);
  const code = extractStringProperty(error, 'code');
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : undefined;
  return { status, code, message, name };
}

export function formatElevenLabsProviderError(error: unknown): string {
  if (error instanceof ElevenLabsTimeoutError) {
    return error.message;
  }

  if (error instanceof ElevenLabsError) {
    const status = typeof error.statusCode === 'number' ? `HTTP ${error.statusCode}: ` : '';
    let body = '';
    if (typeof error.body === 'string') {
      body = error.body;
    } else if (error.body !== undefined) {
      body = JSON.stringify(error.body);
    }
    return `${status}${error.message}${body ? ` | ${body}` : ''}`;
  }

  return error instanceof Error ? error.message : String(error);
}

export function classifyElevenLabsVoiceProviderError(args: {
  error: unknown;
  messageForClassification?: string;
}): VoiceProviderErrorCategory {
  const details = extractElevenLabsRuntimeErrorDetails(args.error);
  const normalizedMessage = (args.messageForClassification ?? details.message).toLowerCase();

  if (details.status === 404 && normalizedMessage.includes('voice')) {
    return 'invalid_voice_id';
  }

  if (details.status === 422 && normalizedMessage.includes('voice')) {
    return normalizedMessage.includes('invalid')
      ? 'invalid_voice_id'
      : 'unsupported_voice_capability';
  }

  if (normalizedMessage.includes('invalid voice')) {
    return 'invalid_voice_id';
  }

  if (
    normalizedMessage.includes('unsupported') &&
    (normalizedMessage.includes('accent') || normalizedMessage.includes('style'))
  ) {
    return 'unsupported_voice_capability';
  }

  if (args.error instanceof ElevenLabsTimeoutError) {
    return 'provider_timeout';
  }

  return classifyProviderRuntimeFailure({
    provider: ELEVENLABS_PROVIDER,
    status: details.status,
    message: '',
    rules: ELEVENLABS_CLASSIFICATION_RULES,
  });
}

export function isElevenLabsTtsRetryableStatus(status: number | undefined): boolean {
  return status !== undefined && RETRYABLE_TTS_STATUSES.has(status);
}

function extractElevenLabsStatusCode(error: unknown): number | undefined {
  if (error instanceof ElevenLabsError && typeof error.statusCode === 'number') {
    return error.statusCode;
  }

  if (typeof error !== 'object' || error === null) return undefined;

  const maybeStatus = (error as { status?: unknown }).status;
  if (typeof maybeStatus === 'number') return maybeStatus;

  const maybeStatusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof maybeStatusCode === 'number') return maybeStatusCode;

  const maybeResponseStatus = (error as { response?: { status?: unknown } }).response?.status;
  if (typeof maybeResponseStatus === 'number') return maybeResponseStatus;

  return undefined;
}

function extractStringProperty(error: unknown, key: 'code'): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}
