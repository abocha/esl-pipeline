import type { JobStatus, RecordingStatus } from '../../utils/api';

const TERMINAL_JOB_STATES = new Set<JobStatus['state']>(['succeeded', 'failed']);
const ACTIVE_JOB_STATES = new Set<JobStatus['state']>(['queued', 'running']);
const TERMINAL_RECORDING_STATUSES = new Set<RecordingStatus>(['transcribed', 'failed']);

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

export function isActivelyProcessingJobState(state: JobStatus['state'] | null | undefined): boolean {
  return state ? ACTIVE_JOB_STATES.has(state) : false;
}

export function getRecordingPollingDecision(params: {
  status: RecordingStatus;
  error: string | null | undefined;
  hasTranscriptId: boolean;
}): RecordingPollingDecision {
  const { status, error, hasTranscriptId } = params;
  const isTerminal = TERMINAL_RECORDING_STATUSES.has(status);
  const isFailed = status === 'failed';

  return {
    shouldContinuePolling: !isTerminal,
    shouldLoadTranscript: status === 'transcribed' && !hasTranscriptId,
    shouldMarkTranscriptFailed: isFailed,
    transcriptFailureMessage: isFailed ? error ?? 'Transcription failed.' : null,
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
