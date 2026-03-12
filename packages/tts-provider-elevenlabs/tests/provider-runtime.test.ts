import { describe, expect, it, vi } from 'vitest';

import {
  classifyElevenLabsVoiceProviderError,
  formatElevenLabsProviderError,
  isElevenLabsTtsRetryableStatus,
} from '../src/provider-runtime.js';

const mocks = vi.hoisted(() => {
  class HoistedElevenLabsError extends Error {
    statusCode?: number;
    body?: unknown;

    constructor(opts: { message?: string; statusCode?: number; body?: unknown } = {}) {
      super(opts.message ?? 'ElevenLabs error');
      this.name = 'ElevenLabsError';
      this.statusCode = opts.statusCode;
      this.body = opts.body;
    }
  }

  class HoistedElevenLabsTimeoutError extends Error {
    constructor(message = 'Request timed out') {
      super(message);
      this.name = 'ElevenLabsTimeoutError';
    }
  }

  return { HoistedElevenLabsError, HoistedElevenLabsTimeoutError };
});

vi.mock('@elevenlabs/elevenlabs-js', () => ({
  ElevenLabsClient: class {},
  ElevenLabsError: mocks.HoistedElevenLabsError,
  ElevenLabsTimeoutError: mocks.HoistedElevenLabsTimeoutError,
}));

describe('tts provider-runtime adapter', () => {
  it('classifies ElevenLabs timeout errors as provider_timeout', () => {
    expect(
      classifyElevenLabsVoiceProviderError({
        error: new mocks.HoistedElevenLabsTimeoutError('Request timed out'),
      }),
    ).toBe('provider_timeout');
  });

  it('classifies status-driven provider categories consistently', () => {
    expect(
      classifyElevenLabsVoiceProviderError({
        error: Object.assign(new Error('too many requests'), { status: 429 }),
      }),
    ).toBe('provider_rate_limit');

    expect(
      classifyElevenLabsVoiceProviderError({
        error: Object.assign(new Error('internal server error'), { status: 500 }),
      }),
    ).toBe('provider_contract_error');
  });

  it('preserves voice-specific category precedence', () => {
    expect(
      classifyElevenLabsVoiceProviderError({
        error: new mocks.HoistedElevenLabsError({
          message: 'Unprocessable entity',
          statusCode: 422,
          body: { detail: 'Invalid voiceId' },
        }),
        messageForClassification: 'HTTP 422: Unprocessable entity | {"detail":"Invalid voiceId"}',
      }),
    ).toBe('invalid_voice_id');
  });

  it('formats ElevenLabs SDK errors with status and body', () => {
    const formatted = formatElevenLabsProviderError(
      new mocks.HoistedElevenLabsError({
        message: 'Unprocessable entity',
        statusCode: 422,
        body: { detail: 'Invalid voiceId' },
      }),
    );
    expect(formatted).toContain('HTTP 422: Unprocessable entity');
    expect(formatted).toContain('Invalid voiceId');
  });

  it('exposes retryable status policy for ladder retries', () => {
    const missingStatus: number | undefined = undefined;
    expect(isElevenLabsTtsRetryableStatus(429)).toBe(true);
    expect(isElevenLabsTtsRetryableStatus(500)).toBe(true);
    expect(isElevenLabsTtsRetryableStatus(404)).toBe(false);
    expect(isElevenLabsTtsRetryableStatus(missingStatus)).toBe(false);
  });
});
