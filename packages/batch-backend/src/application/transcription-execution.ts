import type { AudioInputTopology } from '@esl-pipeline/contracts';
import type { SttTranscriptionResult } from '@esl-pipeline/stt-core';

export class TranscriptionExecutionLostError extends Error {
  constructor() {
    super('Transcription execution authority was lost before provider dispatch.');
    this.name = 'TranscriptionExecutionLostError';
    Object.assign(this, { code: 'AMBIGUOUS_PROVIDER_OUTCOME' });
  }
}

export interface TranscriptionDispatchGuard {
  readonly signal: AbortSignal;
  readonly fetch: typeof fetch;
  start(): void;
  stop(): void;
  cancel(): void;
}

/**
 * A single SDK request may defer serialization until after application code has
 * returned. This guard is deliberately injected as the SDK fetch implementation,
 * so the durable lease check happens at dispatch rather than before preparation.
 */
export function createTranscriptionDispatchGuard(params: {
  claimTtlMs: number;
  renew: (submissionSlot?: number) => Promise<boolean>;
  submissionSlot: number;
  underlyingFetch?: typeof fetch;
  now?: () => number;
}): TranscriptionDispatchGuard {
  const controller = new AbortController();
  const now = params.now ?? (() => performance.now());
  const underlyingFetch = params.underlyingFetch ?? globalThis.fetch;
  let cancelled = false;
  let dispatched = false;
  let localDeadline = now() + params.claimTtlMs;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    controller.abort();
    if (timer) clearTimeout(timer);
  };
  const renew = async (submissionSlot?: number) => {
    if (cancelled) return false;
    // The deadline is anchored before the DB request. A delayed response can
    // never extend local authority by its own round-trip latency.
    const startedAt = now();
    try {
      const renewed = await params.renew(submissionSlot);
      if (!renewed) {
        cancel();
        return false;
      }
      localDeadline = startedAt + params.claimTtlMs;
      return true;
    } catch {
      cancel();
      return false;
    }
  };
  const scheduleRenewal = () => {
    if (cancelled) return;
    timer = setTimeout(
      async () => {
        if (!(await renew())) return;
        scheduleRenewal();
      },
      Math.max(1, Math.floor(params.claimTtlMs / 3)),
    );
  };

  return {
    signal: controller.signal,
    async fetch(input, init) {
      if (!(await renew(params.submissionSlot))) throw new TranscriptionExecutionLostError();
      if (cancelled || now() >= localDeadline || dispatched) {
        cancel();
        throw new TranscriptionExecutionLostError();
      }
      const composedSignal = composeAbortSignals(controller.signal, init?.signal);
      if (composedSignal.signal.aborted) {
        composedSignal.dispose();
        throw new TranscriptionExecutionLostError();
      }
      // There is no application-controlled await after this point. The permit is
      // consumed synchronously immediately before the underlying transport call.
      dispatched = true;
      try {
        return await underlyingFetch(input, { ...init, signal: composedSignal.signal });
      } finally {
        composedSignal.dispose();
      }
    },
    start() {
      scheduleRenewal();
    },
    stop() {
      if (timer) clearTimeout(timer);
    },
    cancel,
  };
}

/**
 * Keep the SDK's request deadline/cancellation visible to the real HTTP transport
 * without letting it replace the durable execution-authority signal. Listeners
 * exist only while the transport promise is in flight.
 */
function composeAbortSignals(
  authority: AbortSignal,
  incoming?: AbortSignal | null,
): {
  signal: AbortSignal;
  dispose: () => void;
} {
  if (!incoming || incoming === authority) return { signal: authority, dispose: () => undefined };

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (authority.aborted || incoming.aborted) {
    abort();
    return { signal: controller.signal, dispose: () => undefined };
  }
  authority.addEventListener('abort', abort, { once: true });
  incoming.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      authority.removeEventListener('abort', abort);
      incoming.removeEventListener('abort', abort);
    },
  };
}

export type TranscriptionFailureCategory = 'transient' | 'ambiguous' | 'malformed' | 'permanent';

export interface ClassifiedTranscriptionFailure {
  category: TranscriptionFailureCategory;
  errorCode:
    | 'transcription_unavailable_after_retries'
    | 'malformed_provider_result'
    | 'transcription_permanent_failure';
  retryable: boolean;
}

export type TranscriptionStructuralValidationReason =
  | 'missing_top_level_text'
  | 'missing_required_metadata'
  | 'invalid_segments_container'
  | 'invalid_segment_timing'
  | 'invalid_speaker_attribution'
  | 'unexpected_observed_speakers';

export interface TranscriptionStructuralValidationDiagnostics {
  reason: TranscriptionStructuralValidationReason;
  segmentCount?: number;
  lexicalSegmentCount?: number;
  segmentIndex?: number;
  segmentIndexBasis?: 'normalized';
  timingIssue?: TranscriptionTimingIssue;
  elevenLabsPreMergeTiming?: ElevenLabsPreMergeTiming;
  timingOrigin?: 'provider_invalid_present' | 'normalization';
  observedSpeakerCount?: number;
}

interface ElevenLabsPreMergeTiming {
  indexBasis: 'provider_words_zero_based';
  lexicalTokenCount: number;
  invalidTimingTokenCount: number;
  firstInvalidTokenIndex?: number;
  firstInvalidTimingIssue?: TranscriptionTimingIssue;
}

/** Never forward the summary or arbitrary adapter/provider fields to the logger. */
function readElevenLabsPreMergeTiming(value: unknown): ElevenLabsPreMergeTiming | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  const lexicalTokenCount = candidate.lexicalTokenCount;
  const invalidTimingTokenCount = candidate.invalidTimingTokenCount;
  if (
    candidate.indexBasis !== 'provider_words_zero_based' ||
    typeof lexicalTokenCount !== 'number' ||
    !Number.isSafeInteger(lexicalTokenCount) ||
    lexicalTokenCount <= 0 ||
    typeof invalidTimingTokenCount !== 'number' ||
    !Number.isSafeInteger(invalidTimingTokenCount) ||
    invalidTimingTokenCount < 0 ||
    invalidTimingTokenCount > lexicalTokenCount
  )
    return undefined;
  const base = {
    indexBasis: 'provider_words_zero_based' as const,
    lexicalTokenCount,
    invalidTimingTokenCount,
  };
  if (invalidTimingTokenCount === 0) {
    if (
      candidate.firstInvalidTokenIndex !== undefined ||
      candidate.firstInvalidTimingIssue !== undefined
    )
      return undefined;
    return base;
  }
  const firstInvalidTokenIndex = candidate.firstInvalidTokenIndex;
  if (
    typeof firstInvalidTokenIndex !== 'number' ||
    !Number.isSafeInteger(firstInvalidTokenIndex) ||
    firstInvalidTokenIndex < 0 ||
    !isTimingIssue(candidate.firstInvalidTimingIssue)
  )
    return undefined;
  return {
    ...base,
    firstInvalidTokenIndex,
    firstInvalidTimingIssue: candidate.firstInvalidTimingIssue,
  };
}

function timingProvenance(
  value: unknown,
): Pick<TranscriptionStructuralValidationDiagnostics, 'elevenLabsPreMergeTiming' | 'timingOrigin'> {
  const preMerge = readElevenLabsPreMergeTiming(value);
  if (!preMerge) return {};
  return {
    elevenLabsPreMergeTiming: preMerge,
    timingOrigin:
      preMerge.invalidTimingTokenCount > 0 ? 'provider_invalid_present' : 'normalization',
  };
}

type TranscriptionTimingIssue =
  | 'missing_start'
  | 'missing_end'
  | 'non_finite_start'
  | 'non_finite_end'
  | 'negative_start'
  | 'non_positive_duration';

/** First failed check, in this order. Never include provider values in diagnostics. */
function classifySegmentTiming(
  segment: Record<string, unknown>,
): TranscriptionTimingIssue | undefined {
  if (segment.start === undefined || segment.start === null) return 'missing_start';
  if (segment.end === undefined || segment.end === null) return 'missing_end';
  if (!Number.isFinite(segment.start)) return 'non_finite_start';
  if (!Number.isFinite(segment.end)) return 'non_finite_end';
  if ((segment.start as number) < 0) return 'negative_start';
  if ((segment.end as number) <= (segment.start as number)) return 'non_positive_duration';
  return undefined;
}

export type TranscriptionStructuralValidationResult =
  | { valid: true }
  | {
      valid: false;
      errorCode: 'malformed_provider_result';
      diagnostics: TranscriptionStructuralValidationDiagnostics;
    };

/** Only controlled transport facts are used; provider text is deliberately discarded. */
export function classifyTranscriptionFailure(error: unknown): ClassifiedTranscriptionFailure {
  const code = readCode(error);
  if (code === 'TRANSCRIPTION_STRUCTURAL_VALIDATION_FAILED') {
    return { category: 'malformed', errorCode: 'malformed_provider_result', retryable: false };
  }
  const status = readStatus(error);
  if (status === 408 || status === 429 || (status !== null && status >= 500)) {
    return {
      category: 'transient',
      errorCode: 'transcription_unavailable_after_retries',
      retryable: true,
    };
  }
  if (code === 'MALFORMED_PROVIDER_RESULT' || code === 'PROVIDER_RESPONSE_INVALID') {
    return { category: 'malformed', errorCode: 'malformed_provider_result', retryable: true };
  }
  if (
    code === 'AMBIGUOUS_PROVIDER_OUTCOME' ||
    code === 'PROVIDER_TRANSPORT_ERROR' ||
    code === 'PROVIDER_TIMEOUT'
  ) {
    return {
      category: 'ambiguous',
      errorCode: 'transcription_unavailable_after_retries',
      retryable: true,
    };
  }
  if (code === 'PROVIDER_RETRYABLE_HTTP') {
    return {
      category: 'transient',
      errorCode: 'transcription_unavailable_after_retries',
      retryable: true,
    };
  }
  return { category: 'permanent', errorCode: 'transcription_permanent_failure', retryable: false };
}

export function validateTranscriptionResult(
  result: SttTranscriptionResult,
  topology: AudioInputTopology,
): TranscriptionStructuralValidationResult {
  // This is deliberately structural, rather than an assessment of transcription quality.
  const candidate = result as unknown as Record<string, unknown>;
  const segmentCount = Array.isArray(candidate.segments) ? candidate.segments.length : undefined;
  if (typeof candidate.text !== 'string' || !candidate.text.trim()) {
    return structuralFailure('missing_top_level_text', { segmentCount });
  }
  if (
    typeof candidate.provider !== 'string' ||
    !candidate.provider.trim() ||
    typeof candidate.model !== 'string' ||
    !candidate.model.trim() ||
    typeof candidate.language !== 'string' ||
    !candidate.language.trim()
  ) {
    return structuralFailure('missing_required_metadata', { segmentCount });
  }
  if (!Array.isArray(candidate.segments)) {
    return structuralFailure('invalid_segments_container');
  }
  const lexicalSegments: { segment: Record<string, unknown>; index: number }[] = [];
  for (const [index, rawSegment] of candidate.segments.entries()) {
    if (!rawSegment || typeof rawSegment !== 'object') {
      return structuralFailure('invalid_segments_container', { segmentCount, segmentIndex: index });
    }
    const segment = rawSegment as Record<string, unknown>;
    if (segment.text !== undefined && typeof segment.text !== 'string') {
      return structuralFailure('invalid_segments_container', { segmentCount, segmentIndex: index });
    }
    if (typeof segment.text === 'string' && segment.text.trim()) {
      lexicalSegments.push({ segment, index });
    }
  }
  for (const { segment, index } of lexicalSegments) {
    const timingIssue = classifySegmentTiming(segment);
    if (timingIssue) {
      return structuralFailure('invalid_segment_timing', {
        segmentCount,
        lexicalSegmentCount: lexicalSegments.length,
        segmentIndex: index,
        segmentIndexBasis: 'normalized',
        timingIssue,
        ...(result.provider === 'elevenlabs'
          ? timingProvenance(result.summary?.elevenLabsPreMergeTiming)
          : {}),
      });
    }
    if (!Number.isInteger(segment.speaker)) {
      return structuralFailure('invalid_speaker_attribution', {
        segmentCount,
        lexicalSegmentCount: lexicalSegments.length,
        segmentIndex: index,
      });
    }
  }
  const speakers = new Set(lexicalSegments.map(({ segment }) => segment.speaker as number));
  const expectedSpeakers =
    topology === 'mixed_recording'
      ? speakers.size === 2
      : speakers.size === 2 && speakers.has(0) && speakers.has(1);
  if (!expectedSpeakers) {
    return structuralFailure('unexpected_observed_speakers', {
      segmentCount,
      lexicalSegmentCount: lexicalSegments.length,
      observedSpeakerCount: speakers.size,
    });
  }
  return { valid: true };
}

function structuralFailure(
  reason: TranscriptionStructuralValidationReason,
  details: Omit<TranscriptionStructuralValidationDiagnostics, 'reason'> = {},
): Extract<TranscriptionStructuralValidationResult, { valid: false }> {
  return {
    valid: false,
    errorCode: 'malformed_provider_result',
    diagnostics: { reason, ...details },
  };
}

export function malformedProviderResultError(
  diagnostics: TranscriptionStructuralValidationDiagnostics,
): Error & {
  code: 'TRANSCRIPTION_STRUCTURAL_VALIDATION_FAILED';
  structuralDiagnostics: TranscriptionStructuralValidationDiagnostics;
} {
  const error = new Error('Provider returned a structurally unusable transcription result.');
  return Object.assign(error, {
    code: 'TRANSCRIPTION_STRUCTURAL_VALIDATION_FAILED' as const,
    structuralDiagnostics: diagnostics,
  });
}

export function readStructuralValidationDiagnostics(
  error: unknown,
): TranscriptionStructuralValidationDiagnostics | null {
  if (readCode(error) !== 'TRANSCRIPTION_STRUCTURAL_VALIDATION_FAILED') return null;
  const diagnostics =
    error && typeof error === 'object'
      ? (error as { structuralDiagnostics?: unknown }).structuralDiagnostics
      : undefined;
  if (!diagnostics || typeof diagnostics !== 'object') return null;
  const candidate = diagnostics as Record<string, unknown>;
  if (!isStructuralValidationReason(candidate.reason)) return null;

  const allowed = {
    reason: candidate.reason,
    ...(candidate.reason === 'invalid_segment_timing'
      ? timingProvenance(candidate.elevenLabsPreMergeTiming)
      : {}),
    ...(candidate.segmentIndexBasis === 'normalized'
      ? { segmentIndexBasis: 'normalized' as const }
      : {}),
    ...(isTimingIssue(candidate.timingIssue) ? { timingIssue: candidate.timingIssue } : {}),
    ...(asNonNegativeInteger(candidate.segmentCount) === undefined
      ? {}
      : { segmentCount: asNonNegativeInteger(candidate.segmentCount) }),
    ...(asNonNegativeInteger(candidate.lexicalSegmentCount) === undefined
      ? {}
      : { lexicalSegmentCount: asNonNegativeInteger(candidate.lexicalSegmentCount) }),
    ...(asNonNegativeInteger(candidate.segmentIndex) === undefined
      ? {}
      : { segmentIndex: asNonNegativeInteger(candidate.segmentIndex) }),
    ...(asNonNegativeInteger(candidate.observedSpeakerCount) === undefined
      ? {}
      : { observedSpeakerCount: asNonNegativeInteger(candidate.observedSpeakerCount) }),
  };
  return allowed;
}

function isTimingIssue(value: unknown): value is TranscriptionTimingIssue {
  return (
    value === 'missing_start' ||
    value === 'missing_end' ||
    value === 'non_finite_start' ||
    value === 'non_finite_end' ||
    value === 'negative_start' ||
    value === 'non_positive_duration'
  );
}

function isStructuralValidationReason(
  value: unknown,
): value is TranscriptionStructuralValidationReason {
  return (
    value === 'missing_top_level_text' ||
    value === 'missing_required_metadata' ||
    value === 'invalid_segments_container' ||
    value === 'invalid_segment_timing' ||
    value === 'invalid_speaker_attribution' ||
    value === 'unexpected_observed_speakers'
  );
}

function asNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value =
    (error as { status?: unknown; statusCode?: unknown }).status ??
    (error as { statusCode?: unknown }).statusCode;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function readCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { code?: unknown }).code;
  return typeof value === 'string' ? value.toUpperCase() : null;
}
