import type { TtsStrategy as DomainTtsStrategy, TtsModelId } from '../domain/job-model.js';
import { HistoricalAssignmentReadOnlyError } from './historical-assignment.js';

export type UploadTarget = 'auto' | 's3' | 'none';
export type TtsStrategy = DomainTtsStrategy;
export type TtsProvider = 'elevenlabs' | 'google' | 'inworld';

export interface SubmitJobRequest {
  md: string;
  learningPresetId?: string;
  withTts?: boolean;
  upload?: UploadTarget;
  voiceId?: string;
  voiceAccent?: string;
  forceTts?: boolean;
  publishTarget?: 'html';
  ttsStrategy?: TtsStrategy;
  ttsProvider?: TtsProvider;
  ttsModel?: TtsModelId;
  userId?: string;
  autoPublish?: boolean;
}

export interface SubmitJobResponse {
  jobId: string;
}

export class ValidationError extends Error {
  readonly code: string;

  constructor(message: string, code = 'validation_failed') {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

export async function submitJob(_req: SubmitJobRequest): Promise<SubmitJobResponse> {
  throw new HistoricalAssignmentReadOnlyError();
}
