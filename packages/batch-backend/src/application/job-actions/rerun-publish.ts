// packages/batch-backend/src/application/job-actions/rerun-publish.ts
//
// Handler for publish rerun action (best effort reuse of existing audio).
import { z } from 'zod';

import type { JobActionResult, RerunPublishAction } from '../../domain/job-actions.js';
import { publishJobEvent } from '../../domain/job-events.js';
import { JobActionType } from '../../domain/job-actions.js';
import { getJobById, insertJob } from '../../domain/job-repository.js';
import { createJobQueue } from '../../infrastructure/queue-bullmq.js';

const rerunPublishSchema = z.object({
  upload: z.literal('s3').optional(),
});

/**
 * Rerun publish stage for a succeeded job.
 * Reuses existing manifest artifacts when available; planner may expand dependencies.
 */
export async function rerunPublish(
  jobId: string,
  action: RerunPublishAction,
): Promise<JobActionResult> {
  const job = await getJobById(jobId);
  if (!job) {
    return {
      success: false,
      message: 'Job not found',
      jobId,
      actionType: JobActionType.RERUN_PUBLISH,
      timestamp: new Date(),
      error: 'not_found',
    };
  }

  if (job.state !== 'succeeded') {
    return {
      success: false,
      message: 'Publish can only be rerun for succeeded jobs',
      jobId,
      actionType: JobActionType.RERUN_PUBLISH,
      timestamp: new Date(),
      error: 'invalid_state',
    };
  }

  if (!job.md) {
    return {
      success: false,
      message: 'Job is missing markdown path; cannot rerun publish',
      jobId,
      actionType: JobActionType.RERUN_PUBLISH,
      timestamp: new Date(),
      error: 'validation_failed',
    };
  }

  const parsed = rerunPublishSchema.safeParse(action.payload ?? {});
  if (!parsed.success) {
    return {
      success: false,
      message: 'Invalid rerun publish payload',
      jobId,
      actionType: JobActionType.RERUN_PUBLISH,
      timestamp: new Date(),
      error: 'validation_failed',
    };
  }
  const payload = parsed.data;

  const rerunJob = await insertJob({
    md: job.md,
    mdStorageUri: job.mdStorageUri ?? undefined,
    preset: job.preset ?? undefined,
    withTts: job.withTts ?? true,
    upload: payload.upload ?? 's3',
    voiceId: job.voiceId ?? undefined,
    voiceAccent: job.voiceAccent ?? undefined,
    forceTts: false,
    notionDatabase: job.notionDatabase ?? undefined,
    publishTarget: job.publishTarget ?? undefined,
    ttsStrategy: job.ttsStrategy ?? undefined,
    userId: job.userId ?? undefined,
    autoPublish: job.autoPublish ?? undefined,
    sourceJobId: jobId,
  });

  publishJobEvent({ type: 'job_created', job: rerunJob });

  const { enqueue } = createJobQueue();
  await enqueue({
    jobId: rerunJob.id,
    executionMode: 'rerun_publish',
    sourceJobId: jobId,
    rerun: {
      steps: ['add-audio'],
      manifestMd: job.md,
      upload: payload.upload ?? 's3',
      force: false,
      voiceId: job.voiceId ?? undefined,
      accentPreference: job.voiceAccent ?? undefined,
      ttsStrategy: job.ttsStrategy ?? undefined,
    },
  });

  return {
    success: true,
    message: 'Publish rerun queued',
    jobId: rerunJob.id,
    actionType: JobActionType.RERUN_PUBLISH,
    timestamp: new Date(),
  };
}
