import type { CancelJobAction, JobActionResult } from '../../domain/job-actions.js';
import { JobActionType } from '../../domain/job-actions.js';
import { publishJobEvent } from '../../domain/job-events.js';
import { getJobById, updateJobStateAndResult } from '../../domain/job-repository.js';
import { abortRunningJob } from '../../infrastructure/job-cancellation.js';
import { createJobLogger } from '../../infrastructure/logger.js';
import { createJobQueue } from '../../infrastructure/queue-bullmq.js';

function buildCancelError(reason: string | undefined): string {
  return reason ? `cancelled: ${reason}` : 'cancelled';
}

export async function cancelJob(jobId: string, action: CancelJobAction): Promise<JobActionResult> {
  const log = createJobLogger(jobId);
  const job = await getJobById(jobId);
  if (!job) {
    return {
      success: false,
      message: 'Job not found',
      jobId,
      actionType: JobActionType.CANCEL,
      timestamp: new Date(),
      error: 'not_found',
    };
  }

  const rawReason = action.payload?.reason;
  if (rawReason !== undefined && (typeof rawReason !== 'string' || rawReason.trim().length === 0)) {
    return {
      success: false,
      message: 'Cancel reason must be a non-empty string when provided',
      jobId,
      actionType: JobActionType.CANCEL,
      timestamp: new Date(),
      error: 'validation_failed',
    };
  }
  const reason = rawReason?.trim();

  if (job.state !== 'queued' && job.state !== 'running') {
    return {
      success: false,
      message: `Only queued or running jobs can be cancelled (current state: ${job.state})`,
      jobId,
      actionType: JobActionType.CANCEL,
      timestamp: new Date(),
      error: 'invalid_state',
    };
  }

  const cancelled = await updateJobStateAndResult({
    id: jobId,
    expectedState: job.state,
    nextState: 'failed',
    error: buildCancelError(reason),
    finishedAt: new Date(),
  });

  if (!cancelled) {
    const latest = await getJobById(jobId);
    if (!latest) {
      return {
        success: false,
        message: 'Job not found',
        jobId,
        actionType: JobActionType.CANCEL,
        timestamp: new Date(),
        error: 'not_found',
      };
    }

    return {
      success: false,
      message: `Job is no longer cancellable (current state: ${latest.state})`,
      jobId,
      actionType: JobActionType.CANCEL,
      timestamp: new Date(),
      error: 'invalid_state',
    };
  }

  publishJobEvent({ type: 'job_state_changed', job: cancelled });

  if (job.state === 'queued') {
    try {
      const { cancelQueuedJob } = createJobQueue();
      const queueResult = await cancelQueuedJob(jobId);
      log.info('Queue cancellation attempted', {
        event: 'job_cancel_queue',
        queueResult,
      });
    } catch (error) {
      log.warn('Failed to remove queued job from queue', {
        event: 'job_cancel_queue_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (job.state === 'running') {
    const aborted = abortRunningJob(jobId, reason);
    log.info('Running-job cancellation signal dispatched', {
      event: 'job_cancel_running_signal',
      aborted,
    });
  }

  return {
    success: true,
    message:
      job.state === 'running'
        ? 'Cancellation requested; job marked cancelled (best-effort for in-flight execution)'
        : 'Job cancelled',
    jobId,
    actionType: JobActionType.CANCEL,
    timestamp: new Date(),
  };
}
