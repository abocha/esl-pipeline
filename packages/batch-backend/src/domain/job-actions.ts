// packages/batch-backend/src/domain/job-actions.ts
//
// Domain model for job actions (rerun, cancel, metadata edit)
// Defines action types, payloads, and result interfaces

/**
 * Supported job action types
 */
export enum JobActionType {
  RERUN_AUDIO = 'rerun_audio',
  CANCEL = 'cancel',
  EDIT_METADATA = 'edit_metadata',
}

/**
 * Base action interface
 */
export interface JobAction {
  type: JobActionType;
  requestedAt: Date;
  requestedBy?: string; // Future: user ID from auth
}

/**
 * Rerun audio generation with optional voice/TTS overrides
 */
export interface RerunAudioAction extends JobAction {
  type: JobActionType.RERUN_AUDIO;
  payload: {
    forceTts?: boolean;
    voiceId?: string;
    voiceAccent?: string;
  };
}

/**
 * Cancel a queued or running job
 */
export interface CancelJobAction extends JobAction {
  type: JobActionType.CANCEL;
  payload: {
    reason?: string;
  };
}

/**
 * Edit job metadata without rerunning
 */
export interface EditMetadataAction extends JobAction {
  type: JobActionType.EDIT_METADATA;
  payload: {
    preset?: string;
    notionDatabase?: string;
  };
}

/**
 * Union type of all possible actions
 */
export type AnyJobAction = RerunAudioAction | CancelJobAction | EditMetadataAction;

/**
 * Result of executing a job action
 */
export interface JobActionResult {
  success: boolean;
  message: string;
  jobId: string;
  actionType: JobActionType;
  timestamp: Date;
  error?: string;
}
