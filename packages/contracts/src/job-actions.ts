// packages/contracts/src/job-actions.ts
//
// Shared types for job actions between backend and frontend

/**
 * Supported job action types
 */
export enum JobActionType {
  RERUN_AUDIO = 'rerun_audio',
  CANCEL = 'cancel',
  EDIT_METADATA = 'edit_metadata',
}

/**
 * Request to execute a job action
 */
export interface JobActionRequest {
  type: JobActionType;
  payload?: Record<string, unknown>;
}

/**
 * Response from executing a job action
 */
export interface JobActionResponse {
  success: boolean;
  message: string;
  jobId: string;
  actionType: JobActionType;
  timestamp: string;
  error?: string;
}

/**
 * Action capability metadata
 * Informs frontend which actions are available
 */
export interface ActionCapability {
  type: string;
  label: string;
  description: string;
  implemented: boolean;
  requiresFields?: string[];
}
