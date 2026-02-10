// packages/batch-backend/src/domain/job-actions.ts
//
// Domain model for job actions (rerun, cancel, metadata edit)
// Defines action types, payloads, and result interfaces
import {
  type JobActionRequest,
  type JobActionResponse,
  JobActionType,
  type JobConfigOverrides,
} from '@esl-pipeline/contracts';

export { JobActionType } from '@esl-pipeline/contracts';

type RerunAudioPayload = NonNullable<
  Extract<JobActionRequest, { type: JobActionType.RERUN_AUDIO }>['payload']
>;
type RerunPublishPayload = NonNullable<
  Extract<JobActionRequest, { type: JobActionType.RERUN_PUBLISH }>['payload']
>;
type CancelPayload = NonNullable<
  Extract<JobActionRequest, { type: JobActionType.CANCEL }>['payload']
>;

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
  payload: RerunAudioPayload;
}

/**
 * Rerun publish stage (best effort to reuse existing audio artifacts)
 */
export interface RerunPublishAction extends JobAction {
  type: JobActionType.RERUN_PUBLISH;
  payload: RerunPublishPayload;
}

/**
 * Cancel a queued or running job
 */
export interface CancelJobAction extends JobAction {
  type: JobActionType.CANCEL;
  payload: CancelPayload;
}

/**
 * Edit job metadata without rerunning
 */
export interface EditMetadataAction extends JobAction {
  type: JobActionType.EDIT_METADATA;
  payload: JobConfigOverrides;
}

/**
 * Union type of all possible actions
 */
export type AnyJobAction =
  | RerunAudioAction
  | RerunPublishAction
  | CancelJobAction
  | EditMetadataAction;

/**
 * Result of executing a job action
 */
export interface JobActionResult {
  success: JobActionResponse['success'];
  message: JobActionResponse['message'];
  jobId: JobActionResponse['jobId'];
  actionType: JobActionType;
  timestamp: Date;
  error?: JobActionResponse['error'];
}
