import type { JobStatus, RecordingListItem } from '../../utils/api';
import { getRecordingErrorAction } from '../../utils/recording-state';

const TERMINAL_JOB_STATES = new Set<JobStatus['state']>(['succeeded', 'failed']);
const ACTIVE_JOB_STATES = new Set<JobStatus['state']>(['queued', 'running']);

export const INITIAL_FALLBACK_POLL_MS = 3000;
export const MAX_FALLBACK_POLL_MS = 30_000;
export const SSE_STALE_TIMEOUT_MS = 45_000;

export interface RecordingPollingDecision {
  shouldContinuePolling: boolean;
  shouldLoadTranscript: boolean;
  shouldMarkTranscriptFailed: boolean;
  transcriptFailureMessage: string | null;
}

export interface JobPollingDecision {
  shouldContinuePolling: boolean;
  shouldRefreshResumeJobs: boolean;
}

export function isTerminalJobState(state: JobStatus['state'] | null | undefined): boolean {
  return state ? TERMINAL_JOB_STATES.has(state) : false;
}

export function isActivelyProcessingJobState(
  state: JobStatus['state'] | null | undefined,
): boolean {
  return state ? ACTIVE_JOB_STATES.has(state) : false;
}

export function getRecordingPollingDecision(params: {
  recording: Pick<RecordingListItem, 'status' | 'productState' | 'errorCode'>;
  hasTranscriptId: boolean;
}): RecordingPollingDecision {
  const { recording, hasTranscriptId } = params;
  const isFailed = recording.productState === 'attention';
  const isTerminal = isFailed || recording.productState === 'ready';

  return {
    shouldContinuePolling: !isTerminal,
    shouldLoadTranscript: recording.productState === 'ready' && !hasTranscriptId,
    shouldMarkTranscriptFailed: isFailed,
    transcriptFailureMessage: isFailed ? getRecordingErrorAction(recording.errorCode) : null,
  };
}

export function getJobPollingDecision(
  state: JobStatus['state'] | null | undefined,
): JobPollingDecision {
  const shouldContinuePolling = isActivelyProcessingJobState(state);
  return {
    shouldContinuePolling,
    shouldRefreshResumeJobs: Boolean(state) && !shouldContinuePolling,
  };
}

export function getNextFallbackPollingDelay(delayMs: number): number {
  return Math.min(Math.max(delayMs, INITIAL_FALLBACK_POLL_MS) * 2, MAX_FALLBACK_POLL_MS);
}

export function isFallbackPollingPaused(): boolean {
  return globalThis.document?.hidden === true;
}
