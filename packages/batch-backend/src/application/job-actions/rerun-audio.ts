// packages/batch-backend/src/application/job-actions/rerun-audio.ts
//
// Handler for audio regeneration action.
import { z } from 'zod';

import type { JobActionResult, RerunAudioAction } from '../../domain/job-actions.js';
import { publishJobEvent } from '../../domain/job-events.js';
import { JobActionType } from '../../domain/job-actions.js';
import { getJobById, insertJob } from '../../domain/job-repository.js';
import { createJobQueue } from '../../infrastructure/queue-bullmq.js';

const rerunAudioSchema = z.object({
  forceTts: z.boolean().optional(),
  voiceId: z.string().min(1).optional(),
  voiceAccent: z.string().min(1).optional(),
  ttsStrategy: z.enum(['auto', 'dialogue', 'tts']).optional(),
  dialogueLanguage: z.string().min(1).optional(),
  dialogueStability: z.number().min(0).max(1).optional(),
  dialogueSeed: z.number().int().optional(),
});

/**
 * Rerun audio generation for a job
 *
 * @param jobId - ID of the job to rerun audio for
 * @param action - Rerun audio action with payload
 * @returns Action result indicating success/failure
 *
 * TODO: Implement actual audio rerun logic:
 * 1. Validate job state (must be completed successfully)
 * 2. Call orchestrator with rerunAssignment
 * 3. Update job state or create new job reference
 * 4. Emit job_state_changed event
 * 5. Return success with updated job data
 */
export async function rerunAudio(jobId: string, action: RerunAudioAction): Promise<JobActionResult> {
  const job = await getJobById(jobId);
  if (!job) {
    return {
      success: false,
      message: 'Job not found',
      jobId,
      actionType: JobActionType.RERUN_AUDIO,
      timestamp: new Date(),
      error: 'not_found',
    };
  }

  if (job.state !== 'succeeded') {
    return {
      success: false,
      message: 'Audio can only be rerun for succeeded jobs',
      jobId,
      actionType: JobActionType.RERUN_AUDIO,
      timestamp: new Date(),
      error: 'invalid_state',
    };
  }

  if (!job.md) {
    return {
      success: false,
      message: 'Job is missing markdown path; cannot rerun audio',
      jobId,
      actionType: JobActionType.RERUN_AUDIO,
      timestamp: new Date(),
      error: 'validation_failed',
    };
  }

  const parsed = rerunAudioSchema.safeParse(action.payload ?? {});
  if (!parsed.success) {
    return {
      success: false,
      message: 'Invalid rerun payload',
      jobId,
      actionType: JobActionType.RERUN_AUDIO,
      timestamp: new Date(),
      error: 'validation_failed',
    };
  }
  const payload = parsed.data;

  const rerunJob = await insertJob({
    md: job.md,
    mdStorageUri: job.mdStorageUri ?? undefined,
    preset: job.preset ?? undefined,
    withTts: true,
    upload: 's3',
    voiceId: payload.voiceId ?? job.voiceId ?? undefined,
    voiceAccent: payload.voiceAccent ?? job.voiceAccent ?? undefined,
    forceTts: payload.forceTts ?? true,
    notionDatabase: job.notionDatabase ?? undefined,
    publishTarget: job.publishTarget ?? undefined,
    ttsStrategy: payload.ttsStrategy ?? job.ttsStrategy ?? undefined,
    userId: job.userId ?? undefined,
    autoPublish: job.autoPublish ?? undefined,
  });

  publishJobEvent({ type: 'job_created', job: rerunJob });

  const { enqueue } = createJobQueue();
  await enqueue({
    jobId: rerunJob.id,
    executionMode: 'rerun_audio',
    sourceJobId: jobId,
    rerun: {
      steps: ['tts', 'upload', 'add-audio'],
      upload: 's3',
      force: payload.forceTts ?? true,
      voiceId: payload.voiceId ?? job.voiceId ?? undefined,
      accentPreference: payload.voiceAccent ?? job.voiceAccent ?? undefined,
      ttsStrategy: payload.ttsStrategy ?? job.ttsStrategy ?? undefined,
      dialogueLanguage: payload.dialogueLanguage,
      dialogueStability: payload.dialogueStability,
      dialogueSeed: payload.dialogueSeed,
    },
  });

  return {
    success: true,
    message: 'Audio rerun queued',
    jobId: rerunJob.id,
    actionType: JobActionType.RERUN_AUDIO,
    timestamp: new Date(),
  };
}
