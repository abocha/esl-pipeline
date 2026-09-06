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

/** Only controlled transport facts are used; provider text is deliberately discarded. */
export function classifyTranscriptionFailure(error: unknown): ClassifiedTranscriptionFailure {
  const status = readStatus(error);
  if (status === 408 || status === 429 || (status !== null && status >= 500)) {
    return {
      category: 'transient',
      errorCode: 'transcription_unavailable_after_retries',
      retryable: true,
    };
  }
  const code = readCode(error);
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
): { valid: true } | { valid: false; errorCode: 'malformed_provider_result' } {
  // This is deliberately structural, rather than an assessment of transcription quality.
  if (!result.provider || !result.model || !result.language || !result.text.trim()) {
    return { valid: false, errorCode: 'malformed_provider_result' };
  }
  if (!Array.isArray(result.segments)) {
    return { valid: false, errorCode: 'malformed_provider_result' };
  }
  const lexicalSegments = result.segments.filter((segment) => segment.text?.trim());
  if (
    lexicalSegments.some(
      (segment) =>
        !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) ||
        (segment.start as number) < 0 ||
        (segment.end as number) <= (segment.start as number),
    )
  ) {
    return { valid: false, errorCode: 'malformed_provider_result' };
  }
  if (topology === 'mixed_recording') {
    const speakers = new Set<number>();
    for (const segment of lexicalSegments) {
      if (!Number.isInteger(segment.speaker)) {
        return { valid: false, errorCode: 'malformed_provider_result' };
      }
      speakers.add(segment.speaker as number);
    }
    if (speakers.size !== 2) return { valid: false, errorCode: 'malformed_provider_result' };
  } else {
    const speakers = new Set(lexicalSegments.map((segment) => segment.speaker));
    if (!speakers.has(0) || !speakers.has(1) || speakers.size !== 2) {
      return { valid: false, errorCode: 'malformed_provider_result' };
    }
  }
  return { valid: true };
}

export function malformedProviderResultError(): Error & { code: string } {
  const error = new Error('Provider returned a structurally unusable transcription result.');
  return Object.assign(error, { code: 'malformed_provider_result' });
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
