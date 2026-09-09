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
      recording: { status: 'transcribed', productState: 'ready', errorCode: null },
      hasTranscriptId: false,
    });

    expect(decision.shouldContinuePolling).toBe(false);
    expect(decision.shouldLoadTranscript).toBe(true);
    expect(decision.shouldMarkTranscriptFailed).toBe(false);
    expect(decision.transcriptFailureMessage).toBeNull();
  });

  it('marks terminal recording failure with an actionable safe fallback', () => {
    const decision = getRecordingPollingDecision({
      recording: { status: 'failed', productState: 'attention', errorCode: null },
      hasTranscriptId: false,
    });

    expect(decision.shouldContinuePolling).toBe(false);
    expect(decision.shouldLoadTranscript).toBe(false);
    expect(decision.shouldMarkTranscriptFailed).toBe(true);
    expect(decision.transcriptFailureMessage).toMatch(/Replace the recording or upload it again/i);
  });

  it('continues polling while recording is still processing', () => {
    const decision = getRecordingPollingDecision({
      recording: {
        status: 'transcribing',
        productState: 'retrying',
        errorCode: null,
      },
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
