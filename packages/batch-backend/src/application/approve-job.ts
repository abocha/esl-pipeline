// packages/batch-backend/src/application/approve-job.ts
// Application service for approving a prompt-prep job and re-queuing it.
import { publishJobEvent } from '../domain/job-events.js';
import { approveJob } from '../domain/job-repository.js';
import { createJobQueue } from '../infrastructure/queue-bullmq.js';

export async function approveJobForPipeline(jobId: string, md: string) {
  const approved = await approveJob({
    id: jobId,
    expectedState: 'awaiting_approval',
    md,
  });

  if (!approved) {
    return null;
  }

  publishJobEvent({ type: 'job_state_changed', job: approved });

  const { enqueue } = createJobQueue();
  await enqueue({ jobId: approved.id });

  return approved;
}
