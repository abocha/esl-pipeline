import { ApiError, NetworkError } from '@inworld/tts';
import { describe, expect, it, vi } from 'vitest';

import { TtsSynthesisCancelledError } from '@esl-pipeline/tts-core';

import { classifyInworldFailure, runInworldSynthesisWithRetry } from '../src/synthesis.js';

const request = {
  text: 'PRIVATE LEARNER SENTENCE',
  voiceId: 'Ashley',
  options: { model: 'inworld-tts-2' as const },
};

function apiError(status: number, details: Record<string, unknown> = {}) {
  const error = new ApiError('raw provider body');
  error.code = status;
  error.details = details;
  return error;
}

describe('Inworld failure classification', () => {
  it.each([
    [408, 'timeout', true],
    [429, 'rate_limit', true],
    [500, 'server', true],
    [502, 'server', true],
    [503, 'server', true],
    [504, 'server', true],
    [401, 'auth', false],
    [403, 'permission', false],
    [400, 'invalid_request', false],
    [404, 'invalid_request', false],
  ] as const)('classifies HTTP %i as %s', (status, kind, retryable) => {
    expect(classifyInworldFailure(apiError(status))).toMatchObject({
      kind,
      retryable,
      status,
    });
  });

  it('classifies a typed invalid-voice provider code without treating generic 400 as voice failure', () => {
    expect(classifyInworldFailure(apiError(400, { code: 'VOICE_NOT_FOUND' }))).toMatchObject({
      kind: 'invalid_voice',
      retryable: false,
      providerCode: 'VOICE_NOT_FOUND',
    });
    expect(classifyInworldFailure(apiError(400))).toMatchObject({
      kind: 'invalid_request',
      retryable: false,
    });
  });

  it.each([
    [new NetworkError('raw provider body'), 'transient_network', true],
    [Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' }), 'timeout', true],
    [Object.assign(new Error('socket reset'), { code: 'ECONNRESET' }), 'transient_network', true],
    [new Error('unrecognized failure'), 'unknown', false],
  ] as const)('classifies typed and causal network failures', (error, kind, retryable) => {
    expect(classifyInworldFailure(error)).toMatchObject({ kind, retryable });
  });
});

describe('Inworld application retry owner', () => {
  it('emits safe structured attempt and retry-exhaustion events', async () => {
    const generate = vi.fn().mockRejectedValue(apiError(500));
    const logger = { log: vi.fn() };

    const error = await runInworldSynthesisWithRetry({
      ...request,
      client: { generate, listVoices: vi.fn() },
      maxRetries: 1,
      logger,
      dependencies: { sleep: vi.fn(), random: () => 0.5, now: () => 100 },
    }).catch((caught: unknown) => caught);
    const serialized = JSON.stringify({ calls: logger.log.mock.calls, error });

    expect(serialized).not.toContain('PRIVATE LEARNER SENTENCE');
    expect(serialized).not.toContain('raw provider body');
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        stage: 'tts',
        message: 'Inworld TTS synthesis attempt failed',
        detail: expect.objectContaining({
          provider: 'inworld',
          model: 'inworld-tts-2',
          voiceId: 'Ashley',
          characterCount: 24,
          attempt: 2,
          maxAttempts: 2,
          failureKind: 'server',
          category: 'provider_timeout',
          status: 500,
          outcome: 'exhausted',
        }),
      }),
    );
    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Inworld TTS synthesis retries exhausted',
        detail: expect.objectContaining({ attemptCount: 2, failureKind: 'server' }),
      }),
    );
    expect(serialized).toMatch(/[a-f0-9]{64}/);
  });

  it('emits safe success latency and output-byte telemetry', async () => {
    const logger = { log: vi.fn() };

    await runInworldSynthesisWithRetry({
      ...request,
      client: {
        generate: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
        listVoices: vi.fn(),
      },
      logger,
      dependencies: { now: vi.fn().mockReturnValueOnce(100).mockReturnValue(125) },
    });

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        stage: 'tts',
        message: 'Inworld TTS synthesis attempt succeeded',
        detail: expect.objectContaining({
          attempt: 1,
          elapsedMs: 25,
          outputBytes: 3,
          outcome: 'success',
        }),
      }),
    );
  });

  it.each([
    408, 429, 500, 502, 503, 504,
  ])('retries transient HTTP %i exactly three times with 1/2/4 second bases', async (status) => {
    const generate = vi.fn().mockRejectedValue(apiError(status));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      runInworldSynthesisWithRetry({
        ...request,
        client: { generate, listVoices: vi.fn() },
        dependencies: { sleep, random: () => 0.5, now: () => 0 },
      }),
    ).rejects.toMatchObject({ attempts: 4 });

    expect(generate).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1000, 2000, 4000]);
  });

  it.each([400, 401, 403, 404])('does not retry deterministic HTTP %i', async (status) => {
    const generate = vi.fn().mockRejectedValue(apiError(status));
    const sleep = vi.fn();

    await expect(
      runInworldSynthesisWithRetry({
        ...request,
        client: { generate, listVoices: vi.fn() },
        dependencies: { sleep, random: () => 0.5, now: () => 0 },
      }),
    ).rejects.toMatchObject({ attempts: 1 });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    [0, 800],
    [0.5, 1000],
    [1, 1200],
  ])('applies exact bounded jitter for random sample %s', async (sample, expectedDelay) => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValueOnce(new Uint8Array([1]));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await runInworldSynthesisWithRetry({
      ...request,
      client: { generate, listVoices: vi.fn() },
      maxRetries: 1,
      dependencies: { sleep, random: () => sample, now: () => 0 },
    });

    expect(sleep).toHaveBeenCalledWith(expectedDelay);
  });

  it.each([
    [-1, 800],
    [2, 1200],
  ])('clamps an out-of-range random sample %s', async (sample, expectedDelay) => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValueOnce(new Uint8Array([1]));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await runInworldSynthesisWithRetry({
      ...request,
      client: { generate, listVoices: vi.fn() },
      maxRetries: 1,
      dependencies: { sleep, random: () => sample, now: () => 0 },
    });

    expect(sleep).toHaveBeenCalledWith(expectedDelay);
  });

  it('does not sleep when the jittered delay reaches the deadline boundary', async () => {
    const generate = vi.fn().mockRejectedValue(apiError(429));
    const sleep = vi.fn();

    await expect(
      runInworldSynthesisWithRetry({
        ...request,
        client: { generate, listVoices: vi.fn() },
        deadlineAtMs: 1100,
        dependencies: { sleep, random: () => 0.5, now: () => 100 },
      }),
    ).rejects.toBeInstanceOf(TtsSynthesisCancelledError);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not start the initial SDK call when the caller is already aborted', async () => {
    const controller = new AbortController();
    controller.abort('operator stop');
    const generate = vi.fn();

    await expect(
      runInworldSynthesisWithRetry({
        ...request,
        client: { generate, listVoices: vi.fn() },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      name: 'TtsSynthesisCancelledError',
      code: 'TTS_SYNTHESIS_CANCELLED',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not retry when the caller aborts during backoff', async () => {
    const controller = new AbortController();
    const generate = vi.fn().mockRejectedValue(apiError(429));
    const sleep = vi.fn().mockImplementation(async () => {
      controller.abort('operator stop');
    });

    await expect(
      runInworldSynthesisWithRetry({
        ...request,
        client: { generate, listVoices: vi.fn() },
        signal: controller.signal,
        dependencies: { sleep, random: () => 0.5, now: () => 0 },
      }),
    ).rejects.toBeInstanceOf(TtsSynthesisCancelledError);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('lets an in-flight SDK call settle, then observes caller cancellation without retrying', async () => {
    const controller = new AbortController();
    let resolveGenerate!: (audio: Uint8Array) => void;
    const generate = vi.fn(
      () =>
        new Promise<Uint8Array>((resolve) => {
          resolveGenerate = resolve;
        }),
    );
    const result = runInworldSynthesisWithRetry({
      ...request,
      client: { generate, listVoices: vi.fn() },
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    controller.abort('operator stop');
    resolveGenerate(new Uint8Array([1, 2, 3]));

    await expect(result).rejects.toBeInstanceOf(TtsSynthesisCancelledError);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [-5, 1],
    [0, 1],
    [99, 4],
  ])('clamps configured retries %i to the supported attempt bound', async (maxRetries, attempts) => {
    const generate = vi.fn().mockRejectedValue(apiError(500));

    await expect(
      runInworldSynthesisWithRetry({
        ...request,
        client: { generate, listVoices: vi.fn() },
        maxRetries,
        dependencies: { sleep: vi.fn(), random: () => 0.5, now: () => 0 },
      }),
    ).rejects.toMatchObject({ attempts });

    expect(generate).toHaveBeenCalledTimes(attempts);
  });

  it('returns generated audio after a transient failure', async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError('raw provider body'))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    await expect(
      runInworldSynthesisWithRetry({
        ...request,
        client: { generate, listVoices: vi.fn() },
        dependencies: { sleep: vi.fn(), random: () => 0.5, now: () => 0 },
      }),
    ).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it('throws only safe request metadata after retry exhaustion', async () => {
    const generate = vi.fn().mockRejectedValue(apiError(500));

    const error = await runInworldSynthesisWithRetry({
      ...request,
      language: 'en-US',
      client: { generate, listVoices: vi.fn() },
      maxRetries: 0,
      dependencies: { sleep: vi.fn(), random: () => 0.5, now: () => 0 },
    }).catch((caught: unknown) => caught);
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error as object));

    expect(serialized).not.toContain('PRIVATE LEARNER SENTENCE');
    expect(serialized).not.toContain('raw provider body');
    expect(error).toMatchObject({
      provider: 'inworld',
      model: 'inworld-tts-2',
      voiceId: 'Ashley',
      language: 'en-US',
      characterCount: 24,
      attempts: 1,
      failure: { kind: 'server', status: 500 },
    });
    expect((error as { contentHash: string }).contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
