import { describe, expect, it, vi } from 'vitest';

import {
  classifyTranscriptionFailure,
  createTranscriptionDispatchGuard,
  malformedProviderResultError,
  readStructuralValidationDiagnostics,
  TranscriptionExecutionLostError,
  validateTranscriptionResult,
} from '../src/application/transcription-execution.js';

describe('transcription execution contract', () => {
  it.each([
    undefined,
    {},
    { indexBasis: 'provider_words_zero_based', lexicalTokenCount: 0, invalidTimingTokenCount: 0 },
    { indexBasis: 'provider_words_zero_based', lexicalTokenCount: 2, invalidTimingTokenCount: 3 },
    {
      indexBasis: 'provider_words_zero_based',
      lexicalTokenCount: 2,
      invalidTimingTokenCount: 1,
      firstInvalidTokenIndex: -1,
      firstInvalidTimingIssue: 'missing_start',
    },
    {
      indexBasis: 'provider_words_zero_based',
      lexicalTokenCount: 2,
      invalidTimingTokenCount: 1,
      firstInvalidTokenIndex: Number.MAX_SAFE_INTEGER + 1,
      firstInvalidTimingIssue: 'missing_start',
    },
    {
      indexBasis: 'provider_words_zero_based',
      lexicalTokenCount: 2,
      invalidTimingTokenCount: 1,
      firstInvalidTokenIndex: 0,
      firstInvalidTimingIssue: 'SECRET',
    },
    {
      indexBasis: 'provider_words_zero_based',
      lexicalTokenCount: 2,
      invalidTimingTokenCount: 0,
      firstInvalidTokenIndex: 0,
    },
  ])(
    'does not infer normalization origin from absent or malformed provenance: %j',
    (provenance) => {
      const diagnostics = readStructuralValidationDiagnostics({
        code: 'TRANSCRIPTION_STRUCTURAL_VALIDATION_FAILED',
        structuralDiagnostics: {
          reason: 'invalid_segment_timing',
          timingOrigin: 'normalization',
          elevenLabsPreMergeTiming: provenance,
        },
      });
      expect(diagnostics).toEqual({ reason: 'invalid_segment_timing' });
    },
  );

  it.each([
    [undefined, 2, 'missing_start'],
    [null, 2, 'missing_start'],
    [1, undefined, 'missing_end'],
    [1, null, 'missing_end'],
    [NaN, 2, 'non_finite_start'],
    [Infinity, 2, 'non_finite_start'],
    [1, -Infinity, 'non_finite_end'],
    [1, NaN, 'non_finite_end'],
    [-1, 2, 'negative_start'],
    [2, 1, 'reversed_timing'],
    [undefined, undefined, 'missing_start'],
  ])(
    'classifies normalized timing (%s, %s) as %s without exposing values',
    (start, end, timingIssue) => {
      const validation = validateTranscriptionResult(
        {
          provider: 'elevenlabs',
          model: 'scribe_v2',
          language: 'auto',
          text: 'TRANSCRIPT_SECRET',
          rawResponse: { secret: 'RAW_SECRET' },
          fallbackUsed: false,
          segments: [{ text: 'TRANSCRIPT_SECRET', speaker: 0, start, end }] as never,
        },
        'mixed_recording',
      );
      expect(validation.valid).toBe(false);
      if (validation.valid) throw new Error('Expected rejection');
      const diagnostics = {
        reason: 'invalid_segment_timing',
        segmentCount: 1,
        lexicalSegmentCount: 1,
        segmentIndex: 0,
        segmentIndexBasis: 'normalized',
        timingIssue,
      };
      expect(validation.diagnostics).toEqual(diagnostics);
      expect(
        readStructuralValidationDiagnostics(malformedProviderResultError(validation.diagnostics)),
      ).toEqual(diagnostics);
    },
  );

  it('drops arbitrary diagnostic fields and unrecognized timing classifications', () => {
    expect(
      readStructuralValidationDiagnostics({
        code: 'TRANSCRIPTION_STRUCTURAL_VALIDATION_FAILED',
        structuralDiagnostics: {
          reason: 'invalid_segment_timing',
          segmentIndex: 3,
          segmentIndexBasis: 'SECRET',
          timingIssue: 'SECRET',
          text: 'SECRET',
          start: 'SECRET',
          rawResponse: { secret: 'SECRET' },
        },
      }),
    ).toEqual({ reason: 'invalid_segment_timing', segmentIndex: 3 });
  });

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
    for (const text of ['   ', undefined]) {
      expect(
        validateTranscriptionResult(
          {
            provider: 'elevenlabs',
            model: 'scribe_v2',
            language: 'auto',
            text: text as string,
            segments: [],
            rawResponse: null,
            fallbackUsed: false,
          },
          'mixed_recording',
        ),
      ).toEqual({
        valid: false,
        errorCode: 'malformed_provider_result',
        diagnostics: { reason: 'missing_top_level_text', segmentCount: 0 },
      });
    }
  });

  it('routes malformed successful provider provenance through bounded recovery', () => {
    expect(classifyTranscriptionFailure({ code: 'PROVIDER_RESPONSE_INVALID' })).toEqual({
      category: 'malformed',
      errorCode: 'malformed_provider_result',
      retryable: true,
    });
  });

  it('terminalizes deterministic structural validation without changing adapter-originated malformed retries', () => {
    expect(
      classifyTranscriptionFailure({ code: 'TRANSCRIPTION_STRUCTURAL_VALIDATION_FAILED' }),
    ).toEqual({
      category: 'malformed',
      errorCode: 'malformed_provider_result',
      retryable: false,
    });
  });

  it('identifies invalid segment containers, timing, and speaker attribution', () => {
    const result = {
      provider: 'elevenlabs' as const,
      model: 'scribe_v2',
      language: 'auto',
      text: 'Teacher Student',
      rawResponse: null,
      fallbackUsed: false,
    };

    for (const segments of [undefined, {}]) {
      expect(
        validateTranscriptionResult(
          { ...result, segments: segments as unknown as [] },
          'mixed_recording',
        ),
      ).toMatchObject({ diagnostics: { reason: 'invalid_segments_container' } });
    }

    for (const segment of [
      { text: 'Reversed', speaker: 0, start: 1, end: 0 },
      { text: 'Missing', speaker: 0, start: 0, end: undefined },
    ]) {
      expect(
        validateTranscriptionResult(
          {
            ...result,
            segments: [segment, { text: 'Student', speaker: 1, start: 1, end: 2 }],
          },
          'mixed_recording',
        ),
      ).toMatchObject({ diagnostics: { reason: 'invalid_segment_timing', segmentIndex: 0 } });
    }

    expect(
      validateTranscriptionResult(
        {
          ...result,
          segments: [
            { text: 'Point teacher', speaker: 0, start: 5, end: 5 },
            { text: 'Point student', speaker: 1, start: 5, end: 5 },
          ],
        },
        'mixed_recording',
      ),
    ).toEqual({ valid: true });

    for (const speaker of [undefined, 1.5]) {
      expect(
        validateTranscriptionResult(
          {
            ...result,
            segments: [
              { text: 'Teacher', speaker: 0, start: 0, end: 0.2 },
              { text: 'Unknown', speaker, start: 0.3, end: 0.5 },
              { text: 'Student', speaker: 1, start: 0.6, end: 0.8 },
            ],
          },
          'mixed_recording',
        ),
      ).toMatchObject({ diagnostics: { reason: 'invalid_speaker_attribution', segmentIndex: 1 } });
    }
  });

  it('requires exactly two observed speakers for mixed recordings', () => {
    const result = {
      provider: 'elevenlabs' as const,
      model: 'scribe_v2',
      language: 'auto',
      text: 'Teacher Student',
      rawResponse: null,
      fallbackUsed: false,
    };
    const segment = (text: string, speaker: number, start: number, end: number) => ({
      text,
      speaker,
      start,
      end,
    });

    expect(
      validateTranscriptionResult(
        { ...result, segments: [segment('Teacher', 0, 0, 0.5), segment('Student', 1, 1, 1.5)] },
        'mixed_recording',
      ),
    ).toEqual({ valid: true });

    for (const segments of [
      [segment('Teacher', 0, 0, 0.5)],
      [segment('Teacher', 0, 0, 0.5), segment('Student', 1, 1, 1.5), segment('Third', 2, 2, 2.5)],
    ]) {
      expect(validateTranscriptionResult({ ...result, segments }, 'mixed_recording')).toMatchObject(
        {
          diagnostics: { reason: 'unexpected_observed_speakers' },
        },
      );
    }

    expect(
      validateTranscriptionResult(
        {
          ...result,
          segments: [
            { text: 'Teacher', speaker: 1, start: 0, end: 0.5 },
            { text: 'Student', speaker: 2, start: 1, end: 1.5 },
          ],
        },
        'trusted_split_channels',
      ),
    ).toMatchObject({ diagnostics: { reason: 'unexpected_observed_speakers' } });
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
