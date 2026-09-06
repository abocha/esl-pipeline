import { describe, expect, it, vi } from 'vitest';

import {
  classifyTranscriptionFailure,
  createTranscriptionDispatchGuard,
  TranscriptionExecutionLostError,
  validateTranscriptionResult,
} from '../src/application/transcription-execution.js';

describe('transcription execution contract', () => {
  it('classifies a provider timeout as retryable without retaining provider text', () => {
    const error = Object.assign(new Error('upstream details must not become durable'), {
      status: 504,
    });

    expect(classifyTranscriptionFailure(error)).toEqual({
      category: 'transient',
      errorCode: 'transcription_unavailable_after_retries',
      retryable: true,
    });
  });

  it('rejects structurally unusable provider results without judging transcript quality', () => {
    expect(
      validateTranscriptionResult(
        {
          provider: 'elevenlabs',
          model: 'scribe_v2',
          language: 'auto',
          text: '   ',
          segments: [],
          rawResponse: null,
          fallbackUsed: false,
        },
        'mixed_recording',
      ),
    ).toEqual({ valid: false, errorCode: 'malformed_provider_result' });
  });

  it('routes malformed successful provider provenance through bounded recovery', () => {
    expect(classifyTranscriptionFailure({ code: 'PROVIDER_RESPONSE_INVALID' })).toEqual({
      category: 'malformed',
      errorCode: 'malformed_provider_result',
      retryable: true,
    });
  });

  it('requires valid timing and exactly two observed speakers for mixed recordings', () => {
    const result = {
      provider: 'elevenlabs' as const,
      model: 'scribe_v2',
      language: 'auto',
      text: 'Teacher Student',
      rawResponse: null,
      fallbackUsed: false,
    };

    expect(
      validateTranscriptionResult(
        {
          ...result,
          segments: [{ text: 'Teacher', speaker: 0, start: 0, end: 1 }],
        },
        'mixed_recording',
      ),
    ).toEqual({ valid: false, errorCode: 'malformed_provider_result' });
    expect(
      validateTranscriptionResult(
        {
          ...result,
          segments: [
            { text: 'Teacher', speaker: 0, start: 1, end: 0 },
            { text: 'Student', speaker: 1, start: 1, end: 2 },
          ],
        },
        'mixed_recording',
      ),
    ).toEqual({ valid: false, errorCode: 'malformed_provider_result' });
    expect(
      validateTranscriptionResult(
        {
          ...result,
          segments: [
            { text: 'Teacher', speaker: 0, start: 0, end: 0.2 },
            { text: 'Unknown', start: 0.3, end: 0.5 },
            { text: 'Student', speaker: 1, start: 0.6, end: 0.8 },
          ],
        },
        'mixed_recording',
      ),
    ).toEqual({ valid: false, errorCode: 'malformed_provider_result' });
  });

  it('latches cancellation at the injected transport boundary when durable authority is lost', async () => {
    const underlyingFetch = vi.fn<typeof fetch>();
    const guard = createTranscriptionDispatchGuard({
      claimTtlMs: 1_000,
      submissionSlot: 1,
      renew: async () => false,
      underlyingFetch,
    });

    await expect(guard.fetch('https://provider.example.test/transcribe')).rejects.toBeInstanceOf(
      TranscriptionExecutionLostError,
    );
    expect(underlyingFetch).not.toHaveBeenCalled();
    expect(guard.signal.aborted).toBe(true);
  });

  it('does not dispatch when the SDK signal was already aborted', async () => {
    const underlyingFetch = vi.fn<typeof fetch>();
    const incoming = new AbortController();
    incoming.abort();
    const guard = createTranscriptionDispatchGuard({
      claimTtlMs: 1_000,
      submissionSlot: 1,
      renew: async () => true,
      underlyingFetch,
    });

    await expect(
      guard.fetch('https://provider.example.test/transcribe', { signal: incoming.signal }),
    ).rejects.toBeInstanceOf(TranscriptionExecutionLostError);
    expect(underlyingFetch).not.toHaveBeenCalled();
  });

  it('passes SDK cancellation through to an in-flight HTTP transport', async () => {
    let receivedSignal: AbortSignal | undefined;
    let resolveFetch: (() => void) | undefined;
    const underlyingFetch = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          receivedSignal = init?.signal ?? undefined;
          resolveFetch = () => resolve(new Response('{}'));
        }),
    );
    const incoming = new AbortController();
    const guard = createTranscriptionDispatchGuard({
      claimTtlMs: 1_000,
      submissionSlot: 1,
      renew: async () => true,
      underlyingFetch,
    });

    const pending = guard.fetch('https://provider.example.test/transcribe', {
      signal: incoming.signal,
    });
    await vi.waitFor(() => expect(receivedSignal).toBeDefined());
    incoming.abort();
    expect(receivedSignal?.aborted).toBe(true);
    resolveFetch?.();
    await pending;
  });

  it('passes durable-authority cancellation through to an in-flight HTTP transport', async () => {
    let receivedSignal: AbortSignal | undefined;
    let resolveFetch: (() => void) | undefined;
    const underlyingFetch = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((resolve) => {
          receivedSignal = init?.signal ?? undefined;
          resolveFetch = () => resolve(new Response('{}'));
        }),
    );
    const guard = createTranscriptionDispatchGuard({
      claimTtlMs: 1_000,
      submissionSlot: 1,
      renew: async () => true,
      underlyingFetch,
    });

    const pending = guard.fetch('https://provider.example.test/transcribe');
    await vi.waitFor(() => expect(receivedSignal).toBeDefined());
    guard.cancel();
    expect(receivedSignal?.aborted).toBe(true);
    resolveFetch?.();
    await pending;
  });

  it('consumes one dispatch permit even if an SDK continuation calls its fetch twice', async () => {
    const underlyingFetch = vi.fn<typeof fetch>(async () => new Response('{}'));
    const guard = createTranscriptionDispatchGuard({
      claimTtlMs: 1_000,
      submissionSlot: 1,
      renew: async () => true,
      underlyingFetch,
    });

    await guard.fetch('https://provider.example.test/transcribe');
    await expect(guard.fetch('https://provider.example.test/transcribe')).rejects.toBeInstanceOf(
      TranscriptionExecutionLostError,
    );
    expect(underlyingFetch).toHaveBeenCalledTimes(1);
  });
});
