export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';

export type JobMode = 'auto' | 'dialogue' | 'monologue';

export type JobUploadOption = 'auto' | 's3' | 'none';

export interface JobStatusDto {
  jobId: string;
  md: string;
  preset: string | null;
  withTts: boolean | null;
  voiceId: string | null;
  upload: JobUploadOption | null;
  voiceAccent: string | null;
  forceTts: boolean | null;
  notionDatabase: string | null;
  mode: JobMode | null;
  notionUrl: string | null;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  manifestPath: string | null;
}

export type JobEventType = 'job_created' | 'job_state_changed';

export interface JobEventPayload {
  manifestPath?: string | null;
  error?: string | null;
  finishedAt?: string | null;
  mode?: JobMode | null;
  md?: string | null;
  notionUrl?: string | null;
}

export interface JobEventMessage {
  type: JobEventType;
  jobId: string;
  state: JobState;
  payload?: JobEventPayload;
}

// Job actions exports
// Job actions exports
export * from './job-actions.js';
export * from './errors.js';
