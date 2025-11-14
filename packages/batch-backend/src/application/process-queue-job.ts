// packages/batch-backend/src/application/process-queue-job.ts

// Application service executed by the BullMQ worker.
// Flow:
// 1. Load job from DB.
// 2. If not found or already terminal -> no-op.
// 3. Transition queued -> running.
// 4. Call ESL pipeline via runAssignmentJob.
// 5. On success, transition running -> succeeded with manifestPath.
// 6. On failure, transition running -> failed with error and rethrow so BullMQ can retry.

import { getJobById, updateJobStateAndResult } from '../domain/job-repository';
import { runAssignmentJob } from '../infrastructure/orchestrator-service';
import { createJobLogger } from '../infrastructure/logger';
import type { QueueJobPayload } from '../infrastructure/queue-bullmq';
import { publishJobEvent } from '../domain/job-events';

// processQueueJob.declaration()
export async function processQueueJob(payload: QueueJobPayload): Promise<void> {
  const { jobId } = payload;
  const log = createJobLogger(jobId);

  const job = await getJobById(jobId);
  if (!job) {
    log.warn('Job not found; skipping', { event: 'job_missing' });
    return;
  }

  if (job.state === 'succeeded' || job.state === 'failed') {
    log.info('Job already terminal; skipping', { state: job.state });
    return;
  }

  const running = await updateJobStateAndResult({
    id: jobId,
    expectedState: 'queued',
    nextState: 'running',
    startedAt: new Date(),
  });

  if (!running) {
    log.warn('Failed to mark job running; likely race; skipping', {
      event: 'state_conflict',
    });
    return;
  }

  publishJobEvent({ type: 'job_state_changed', job: running });

  const runId = jobId;

  try {
    const result = await runAssignmentJob(
      {
        jobId,
        md: running.md,
        preset: running.preset ?? undefined,
        withTts: running.withTts ?? undefined,
        // Only forward upload flag values supported by orchestrator.
        // Any other persisted value (e.g. 'none' or null) is treated as "no override".
        upload: running.upload === 's3' ? 's3' : undefined,
      },
      runId
    );

    const succeeded = await updateJobStateAndResult({
      id: jobId,
      expectedState: 'running',
      nextState: 'succeeded',
      manifestPath: result.manifestPath ?? null,
      finishedAt: new Date(),
    });

    if (succeeded) {
      publishJobEvent({ type: 'job_state_changed', job: succeeded });
    }

    log.info('Job processed successfully', {
      manifestPath: result.manifestPath,
    });
  } catch (err) {
    log.error(err instanceof Error ? err : String(err), {
      event: 'job_failed',
    });

    const failed = await updateJobStateAndResult({
      id: jobId,
      expectedState: 'running',
      nextState: 'failed',
      error: err instanceof Error ? err.message : String(err),
      finishedAt: new Date(),
    });

    if (failed) {
      publishJobEvent({ type: 'job_state_changed', job: failed });
    }

    // Propagate so BullMQ can apply retry/backoff policy.
    throw err;
  }
}
