// packages/batch-backend/src/application/job-actions/edit-metadata.ts
//
// Handler for job metadata editing action
import { z } from 'zod';

import type { EditMetadataAction, JobActionResult } from '../../domain/job-actions.js';
import { JobActionType } from '../../domain/job-actions.js';
import { publishJobEvent } from '../../domain/job-events.js';
import type { JobRecord } from '../../domain/job-model.js';
import { getJobById, updateJobMetadata } from '../../domain/job-repository.js';

const editMetadataSchema = z.object({
  learningPresetId: z.string().min(1).optional(),
  notionDatabase: z.string().min(1).optional(),
  publishTarget: z.enum(['notion', 'anytype', 'html']).optional(),
  withTts: z.boolean().optional(),
  forceTts: z.boolean().optional(),
  ttsStrategy: z.enum(['auto', 'dialogue', 'tts']).optional(),
  ttsProvider: z.enum(['elevenlabs', 'google']).optional(),
  googleTtsModel: z.enum(['chirp3_hd', 'studio', 'neural2', 'wavenet']).optional(),
  upload: z.enum(['auto', 's3', 'none']).optional(),
  voiceId: z.string().min(1).optional(),
  voiceAccent: z.string().min(1).optional(),
});
type EditMetadataOverrides = z.infer<typeof editMetadataSchema>;

function getEffectiveMetadataOverrides(
  job: JobRecord,
  overrides: EditMetadataOverrides,
): EditMetadataOverrides {
  const effective: EditMetadataOverrides = {};
  const assignIfChanged = <K extends keyof EditMetadataOverrides>(
    key: K,
    current: EditMetadataOverrides[K],
  ): void => {
    const next = overrides[key];
    if (next !== undefined && next !== current) {
      effective[key] = next;
    }
  };

  assignIfChanged('learningPresetId', job.learningPresetId ?? undefined);
  assignIfChanged('notionDatabase', job.notionDatabase ?? undefined);
  assignIfChanged('publishTarget', job.publishTarget ?? undefined);
  assignIfChanged('withTts', job.withTts ?? undefined);
  assignIfChanged('forceTts', job.forceTts ?? undefined);
  assignIfChanged('ttsStrategy', job.ttsStrategy ?? undefined);
  assignIfChanged('ttsProvider', job.ttsProvider ?? undefined);
  assignIfChanged('googleTtsModel', job.googleTtsModel ?? undefined);
  assignIfChanged('upload', job.upload ?? undefined);
  assignIfChanged('voiceId', job.voiceId ?? undefined);
  assignIfChanged('voiceAccent', job.voiceAccent ?? undefined);

  return effective;
}

/**
 * Edit job metadata without rerunning the job
 *
 * @param jobId - ID of the job to edit
 * @param action - Edit metadata action with new values
 * @returns Action result indicating success/failure
 *
 * Side-effect contract:
 * 1. Persist effective metadata overrides in `jobs` while the job is `awaiting_approval`.
 * 2. Emit `job_state_changed` with the updated record so subscribers refresh approval screens.
 * 3. Treat empty payloads and unchanged overrides as successful no-op requests.
 * 4. Do not mutate manifest artifacts here; approval/rerun flow handles manifest regeneration.
 */
export async function editMetadata(
  jobId: string,
  action: EditMetadataAction,
): Promise<JobActionResult> {
  // Verify job exists
  const job = await getJobById(jobId);
  if (!job) {
    return {
      success: false,
      message: 'Job not found',
      jobId,
      actionType: JobActionType.EDIT_METADATA,
      timestamp: new Date(),
      error: 'not_found',
    };
  }

  if (job.state !== 'awaiting_approval') {
    return {
      success: false,
      message: 'Metadata can only be edited while job is awaiting approval',
      jobId,
      actionType: JobActionType.EDIT_METADATA,
      timestamp: new Date(),
      error: 'invalid_state',
    };
  }

  const parsed = editMetadataSchema.safeParse(action.payload ?? {});
  if (!parsed.success) {
    return {
      success: false,
      message: 'Invalid metadata payload',
      jobId,
      actionType: JobActionType.EDIT_METADATA,
      timestamp: new Date(),
      error: 'validation_failed',
    };
  }

  const requestedOverrides = parsed.data;
  if (Object.keys(requestedOverrides).length === 0) {
    return {
      success: true,
      message: 'No metadata changes requested',
      jobId,
      actionType: JobActionType.EDIT_METADATA,
      timestamp: new Date(),
    };
  }

  const overrides = getEffectiveMetadataOverrides(job, requestedOverrides);
  if (Object.keys(overrides).length === 0) {
    return {
      success: true,
      message: 'No metadata changes detected',
      jobId,
      actionType: JobActionType.EDIT_METADATA,
      timestamp: new Date(),
    };
  }

  const updated = await updateJobMetadata({
    id: jobId,
    expectedState: 'awaiting_approval',
    learningPresetId: overrides.learningPresetId,
    notionDatabase: overrides.notionDatabase,
    publishTarget: overrides.publishTarget,
    withTts: overrides.withTts,
    forceTts: overrides.forceTts,
    ttsStrategy: overrides.ttsStrategy,
    ttsProvider: overrides.ttsProvider,
    googleTtsModel: overrides.googleTtsModel,
    upload: overrides.upload,
    voiceId: overrides.voiceId,
    voiceAccent: overrides.voiceAccent,
  });

  if (!updated) {
    return {
      success: false,
      message: 'Job metadata could not be updated',
      jobId,
      actionType: JobActionType.EDIT_METADATA,
      timestamp: new Date(),
      error: 'not_found',
    };
  }

  publishJobEvent({ type: 'job_state_changed', job: updated });

  return {
    success: true,
    message: 'Job metadata updated',
    jobId,
    actionType: JobActionType.EDIT_METADATA,
    timestamp: new Date(),
  };
}
