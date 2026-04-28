import { describe, expect, it } from 'vitest';

import {
  getJobPollingDecision,
  getNextFallbackPollingDelay,
  getRecordingPollingDecision,
  INITIAL_FALLBACK_POLL_MS,
  isActivelyProcessingJobState,
  isTerminalJobState,
  MAX_FALLBACK_POLL_MS,
} from './MinimalAssignment.polling';

describe('MinimalAssignment polling helpers', () => {
  it('loads transcript and stops polling when recording becomes transcribed without transcript id', () => {
    const decision = getRecordingPollingDecision({
      status: 'transcribed',
      error: null,
      hasTranscriptId: false,
    });

    expect(decision.shouldContinuePolling).toBe(false);
    expect(decision.shouldLoadTranscript).toBe(true);
    expect(decision.shouldMarkTranscriptFailed).toBe(false);
    expect(decision.transcriptFailureMessage).toBeNull();
  });

  it('marks transcript failed with default error message for failed recordings', () => {
    const decision = getRecordingPollingDecision({
      status: 'failed',
      error: null,
      hasTranscriptId: false,
    });

    expect(decision.shouldContinuePolling).toBe(false);
    expect(decision.shouldLoadTranscript).toBe(false);
    expect(decision.shouldMarkTranscriptFailed).toBe(true);
    expect(decision.transcriptFailureMessage).toBe('Transcription failed.');
  });

  it('continues polling while recording is still processing', () => {
    const decision = getRecordingPollingDecision({
      status: 'transcribing',
      error: null,
      hasTranscriptId: false,
    });

    expect(decision.shouldContinuePolling).toBe(true);
    expect(decision.shouldLoadTranscript).toBe(false);
    expect(decision.shouldMarkTranscriptFailed).toBe(false);
    expect(decision.transcriptFailureMessage).toBeNull();
  });

  it('keeps polling for queued/running jobs and stops+refreshes on terminal jobs', () => {
    expect(getJobPollingDecision('queued')).toEqual({
      shouldContinuePolling: true,
      shouldRefreshResumeJobs: false,
    });
    expect(getJobPollingDecision('running')).toEqual({
      shouldContinuePolling: true,
      shouldRefreshResumeJobs: false,
    });
    expect(getJobPollingDecision('succeeded')).toEqual({
      shouldContinuePolling: false,
      shouldRefreshResumeJobs: true,
    });
    expect(getJobPollingDecision('failed')).toEqual({
      shouldContinuePolling: false,
      shouldRefreshResumeJobs: true,
    });
  });

  it('does not refresh resume jobs when job state is missing', () => {
    expect(getJobPollingDecision(null)).toEqual({
      shouldContinuePolling: false,
      shouldRefreshResumeJobs: false,
    });
  });

  it('classifies active and terminal job states', () => {
    expect(isActivelyProcessingJobState('queued')).toBe(true);
    expect(isActivelyProcessingJobState('running')).toBe(true);
    expect(isActivelyProcessingJobState('succeeded')).toBe(false);
    expect(isTerminalJobState('failed')).toBe(true);
    expect(isTerminalJobState('running')).toBe(false);
  });

  it('backs fallback polling off and caps it at the maximum delay', () => {
    expect(getNextFallbackPollingDelay(0)).toBe(INITIAL_FALLBACK_POLL_MS * 2);
    expect(getNextFallbackPollingDelay(INITIAL_FALLBACK_POLL_MS)).toBe(
      INITIAL_FALLBACK_POLL_MS * 2,
    );
    expect(getNextFallbackPollingDelay(MAX_FALLBACK_POLL_MS)).toBe(MAX_FALLBACK_POLL_MS);
  });
});
