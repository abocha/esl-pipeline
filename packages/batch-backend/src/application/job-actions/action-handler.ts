// packages/batch-backend/src/application/job-actions/action-handler.ts
//
// Central dispatcher for job actions
import type { AnyJobAction, JobActionResult, JobActionType } from '../../domain/job-actions.js';
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
  switch (action.type) {
    case 'rerun_audio': {
      return rerunAudio(jobId, action);
    }

    case 'cancel': {
      return cancelJob(jobId, action);
    }

    case 'edit_metadata': {
      return editMetadata(jobId, action);
    }

    default: {
      throw new Error(`Unknown action type: ${(action as unknown as { type?: string }).type}`);
    }
  }
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
    rerun_audio: {
      label: 'Rerun Audio Generation',
      description: 'Regenerate TTS audio for this job with optional voice/TTS overrides',
      requiresFields: [],
      implemented: false, // Stub only
    },
    cancel: {
      label: 'Cancel Job',
      description: 'Cancel a queued or running job',
      requiresFields: [],
      implemented: false, // Stub only
    },
    edit_metadata: {
      label: 'Edit Job Metadata',
      description: 'Update job configuration (preset, Notion database) without rerunning',
      requiresFields: [],
      implemented: false, // Stub only
    },
  };
}
