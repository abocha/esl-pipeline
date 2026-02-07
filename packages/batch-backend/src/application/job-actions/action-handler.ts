// packages/batch-backend/src/application/job-actions/action-handler.ts
//
// Central dispatcher for job actions
import {
  JobActionType,
  type AnyJobAction,
  type JobActionResult,
} from '../../domain/job-actions.js';
import { insertJobActionHistory } from '../../domain/job-action-history-repository.js';
import { logger } from '../../infrastructure/logger.js';
import { cancelJob } from './cancel-job.js';
import { editMetadata } from './edit-metadata.js';
import { rerunAudio } from './rerun-audio.js';

/**
 * Execute a job action by routing to the appropriate handler
 *
 * @param jobId - ID of the job to perform action on
 * @param action - Action to execute
 * @returns Result of the action execution
 */
export async function executeJobAction(
  jobId: string,
  action: AnyJobAction,
): Promise<JobActionResult> {
  let result: JobActionResult;
  switch (action.type) {
    case JobActionType.RERUN_AUDIO: {
      result = await rerunAudio(jobId, action);
      break;
    }

    case JobActionType.CANCEL: {
      result = await cancelJob(jobId, action);
      break;
    }

    case JobActionType.EDIT_METADATA: {
      result = await editMetadata(jobId, action);
      break;
    }

    default: {
      throw new Error(`Unknown action type: ${(action as unknown as { type?: string }).type}`);
    }
  }

  // Missing jobs are not persisted due to strict FK constraints on job_action_history.job_id.
  if (result.error !== 'not_found') {
    const createdJobId =
      action.type === JobActionType.RERUN_AUDIO && result.success ? result.jobId : null;
    const payload =
      action.payload && typeof action.payload === 'object'
        ? (action.payload as Record<string, unknown>)
        : null;

    try {
      await insertJobActionHistory({
        jobId,
        actionType: action.type,
        payload,
        requestedAt: action.requestedAt,
        requestedBy: action.requestedBy ?? null,
        outcome: result.success ? 'succeeded' : 'failed',
        message: result.message,
        errorCode: result.error ?? null,
        createdJobId,
      });
    } catch (error: unknown) {
      // Action execution succeeded/failed already; audit logging should not mask that outcome.
      logger.warn('Failed to persist job action history', {
        event: 'job_action_history_insert_failed',
        jobId,
        actionType: action.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

/**
 * Action capability metadata for frontend
 */
export interface ActionMetadata {
  label: string;
  description: string;
  requiresFields: string[];
  implemented: boolean;
}

/**
 * Get metadata about available job actions
 * Used by /config/job-options to inform frontend of capabilities
 */
export function getActionMetadata(): Record<JobActionType, ActionMetadata> {
  return {
    [JobActionType.RERUN_AUDIO]: {
      label: 'Rerun Audio Generation',
      description: 'Regenerate TTS audio for this job with optional voice/TTS overrides',
      requiresFields: [],
      implemented: true,
    },
    [JobActionType.CANCEL]: {
      label: 'Cancel Job',
      description: 'Cancel a queued or running job',
      requiresFields: [],
      implemented: true,
    },
    [JobActionType.EDIT_METADATA]: {
      label: 'Edit Job Metadata',
      description: 'Update job configuration without rerunning',
      requiresFields: [],
      implemented: true,
    },
  };
}
