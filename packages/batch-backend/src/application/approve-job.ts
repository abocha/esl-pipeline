// packages/batch-backend/src/application/approve-job.ts
// Application service for approving a prompt-prep job and re-queuing it.
import { publishJobEvent } from '../domain/job-events.js';
import { approveJob, getJobById } from '../domain/job-repository.js';
import { createJobQueue } from '../infrastructure/queue-bullmq.js';

export interface ApproveJobForPipelineDependencies {
  jobs: { approve: typeof approveJob; getById: typeof getJobById };
  queue: { reconcile: ReturnType<typeof createJobQueue>['reconcile'] };
  publishEvent: typeof publishJobEvent;
}

export async function approveJobForPipeline(
  jobId: string,
  source?: { md?: string; mdStorageUri?: string },
  overrides?: Partial<ApproveJobForPipelineDependencies>,
) {
  const jobs = overrides?.jobs ?? { approve: approveJob, getById: getJobById };
  const queue = overrides?.queue ?? createJobQueue();
  const publishEvent = overrides?.publishEvent ?? publishJobEvent;
  let approved = await jobs.approve({
    id: jobId,
    expectedState: 'awaiting_approval',
    md: source?.md ?? null,
    mdStorageUri: source?.mdStorageUri ?? null,
  });

  if (!approved) {
    const current = await jobs.getById(jobId);
    if (!current || current.state !== 'queued') return null;
    approved = current;
  } else {
    publishEvent({ type: 'job_state_changed', job: approved });
  }

  await queue.reconcile({ jobId: approved.id });

  return approved;
}
