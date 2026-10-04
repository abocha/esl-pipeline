// packages/batch-backend/src/application/job-actions/edit-metadata.ts
//
// Handler for job metadata editing action
import { z } from 'zod';

import { isTtsModelForProvider } from '@esl-pipeline/tts-core';

import type { EditMetadataAction, JobActionResult } from '../../domain/job-actions.js';
import { JobActionType } from '../../domain/job-actions.js';
import { publishJobEvent } from '../../domain/job-events.js';
import type { JobRecord } from '../../domain/job-model.js';
import { getJobById, updateJobMetadata } from '../../domain/job-repository.js';
import { HistoricalAssignmentReadOnlyError } from '../historical-assignment.js';
import {
  collectPublishStudyTextOverrideIssues,
  publishTtsModelSchema,
  publishTtsProviderSchema,
  publishTtsStrategySchema,
} from '../publish-study-text-overrides.js';

const editMetadataSchema = z.object({
  learningPresetId: z.string().min(1).optional(),
  publishTarget: z.literal('html').optional(),
  withTts: z.boolean().optional(),
  forceTts: z.boolean().optional(),
  ttsStrategy: publishTtsStrategySchema.optional(),
  ttsProvider: publishTtsProviderSchema.optional(),
  ttsModel: publishTtsModelSchema.nullable().optional(),
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
    current: EditMetadataOverrides[K] | null,
  ): void => {
    const next = overrides[key];
    if (next !== undefined && next !== current) {
      effective[key] = next;
    }
  };

  assignIfChanged('learningPresetId', job.learningPresetId ?? null);
  assignIfChanged('publishTarget', job.publishTarget ?? null);
  assignIfChanged('withTts', job.withTts ?? null);
  assignIfChanged('forceTts', job.forceTts ?? null);
  assignIfChanged('ttsStrategy', job.ttsStrategy ?? null);
  assignIfChanged('ttsProvider', job.ttsProvider ?? null);
  assignIfChanged('ttsModel', job.ttsModel ?? null);
  assignIfChanged('upload', job.upload ?? null);
  assignIfChanged('voiceId', job.voiceId ?? null);
  assignIfChanged('voiceAccent', job.voiceAccent ?? null);

  return effective;
}

function getEffectivePublishStudyTextOverrides(
  job: JobRecord,
  overrides: EditMetadataOverrides,
): {
  ttsStrategy?: JobRecord['ttsStrategy'];
  ttsProvider?: JobRecord['ttsProvider'];
  ttsModel?: JobRecord['ttsModel'];
} {
  const ttsStrategy = overrides.ttsStrategy ?? job.ttsStrategy ?? undefined;
  const ttsProvider = overrides.ttsProvider ?? job.ttsProvider ?? undefined;
  const ttsModel =
    overrides.ttsModel !== undefined
      ? overrides.ttsModel
      : ttsProvider && job.ttsModel && !isTtsModelForProvider(ttsProvider, job.ttsModel)
        ? null
        : (job.ttsModel ?? null);

  return {
    ttsStrategy,
    ttsProvider,
    ttsModel,
  };
}

function withImpliedPublishModelClears(
  job: JobRecord,
  overrides: EditMetadataOverrides,
): EditMetadataOverrides {
  const effective = getEffectivePublishStudyTextOverrides(job, overrides);
  const nextOverrides: EditMetadataOverrides = { ...overrides };

  if (
    overrides.ttsModel === undefined &&
    effective.ttsModel === null &&
    job.ttsModel !== null &&
    job.ttsModel !== undefined
  ) {
    nextOverrides.ttsModel = null;
  }

  return nextOverrides;
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

  if (!job.assignmentArtifact) {
    const error = new HistoricalAssignmentReadOnlyError();
    return {
      success: false,
      message: error.message,
      jobId,
      actionType: action.type,
      timestamp: new Date(),
      error: error.code,
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

  const normalizedOverrides = withImpliedPublishModelClears(job, overrides);
  const publishStudyTextIssues = collectPublishStudyTextOverrideIssues(
    getEffectivePublishStudyTextOverrides(job, normalizedOverrides),
  );
  if (publishStudyTextIssues.length > 0) {
    return {
      success: false,
      message: publishStudyTextIssues[0]?.message ?? 'Invalid metadata payload',
      jobId,
      actionType: JobActionType.EDIT_METADATA,
      timestamp: new Date(),
      error: 'validation_failed',
    };
  }

  const updated = await updateJobMetadata({
    id: jobId,
    expectedState: 'awaiting_approval',
    learningPresetId: normalizedOverrides.learningPresetId,
    publishTarget: normalizedOverrides.publishTarget,
    withTts: normalizedOverrides.withTts,
    forceTts: normalizedOverrides.forceTts,
    ttsStrategy: normalizedOverrides.ttsStrategy,
    ttsProvider: normalizedOverrides.ttsProvider,
    ttsModel: normalizedOverrides.ttsModel,
    upload: normalizedOverrides.upload,
    voiceId: normalizedOverrides.voiceId,
    voiceAccent: normalizedOverrides.voiceAccent,
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
