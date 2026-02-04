// packages/batch-backend/src/application/job-actions/edit-metadata.ts
//
// Handler for job metadata editing action
import { z } from 'zod';

import type { EditMetadataAction, JobActionResult } from '../../domain/job-actions.js';
import { JobActionType } from '../../domain/job-actions.js';
import { getJobById, updateJobMetadata } from '../../domain/job-repository.js';

const editMetadataSchema = z.object({
  preset: z.string().min(1).optional(),
  notionDatabase: z.string().min(1).optional(),
  publishTarget: z.enum(['notion', 'anytype']).optional(),
  withTts: z.boolean().optional(),
  forceTts: z.boolean().optional(),
  ttsStrategy: z.enum(['auto', 'dialogue', 'tts']).optional(),
  upload: z.enum(['auto', 's3', 'none']).optional(),
  voiceId: z.string().min(1).optional(),
  voiceAccent: z.string().min(1).optional(),
});

/**
 * Edit job metadata without rerunning the job
 *
 * @param jobId - ID of the job to edit
 * @param action - Edit metadata action with new values
 * @returns Action result indicating success/failure
 *
 * TODO: Implement actual metadata editing:
 * 1. Validate new metadata values
 * 2. Update job record in database
 * 3. Optionally update manifest file if it exists
 * 4. Emit job_state_changed event
 * 5. Return success with updated job data
 */
export async function editMetadata(jobId: string, action: EditMetadataAction): Promise<JobActionResult> {
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

  const overrides = parsed.data;
  if (Object.keys(overrides).length === 0) {
    return {
      success: true,
      message: 'No metadata changes requested',
      jobId,
      actionType: JobActionType.EDIT_METADATA,
      timestamp: new Date(),
    };
  }

  const updated = await updateJobMetadata({
    id: jobId,
    expectedState: 'awaiting_approval',
    preset: overrides.preset,
    notionDatabase: overrides.notionDatabase,
    publishTarget: overrides.publishTarget,
    withTts: overrides.withTts,
    forceTts: overrides.forceTts,
    ttsStrategy: overrides.ttsStrategy,
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

  return {
    success: true,
    message: 'Job metadata updated',
    jobId,
    actionType: JobActionType.EDIT_METADATA,
    timestamp: new Date(),
  };
}
