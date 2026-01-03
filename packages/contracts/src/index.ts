export type JobState = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed';

export type TtsStrategy = 'auto' | 'dialogue' | 'tts';

export type JobUploadOption = 'auto' | 's3' | 'none';

export type RecordingStatus = 'ingested' | 'queued' | 'transcribing' | 'transcribed' | 'failed';

export interface JobStatusDto {
  jobId: string;
  md: string | null;
  recordingId: string | null;
  transcriptId: string | null;
  promptPackageId: string | null;
  draftId: string | null;
  preset: string | null;
  withTts: boolean | null;
  voiceId: string | null;
  upload: JobUploadOption | null;
  voiceAccent: string | null;
  forceTts: boolean | null;
  notionDatabase: string | null;
  ttsStrategy: TtsStrategy | null;
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
  ttsStrategy?: TtsStrategy | null;
  md?: string | null;
  notionUrl?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
}

export interface JobEventMessage {
  type: JobEventType;
  jobId: string;
  state: JobState;
  payload?: JobEventPayload;
}

export type RecordingEventType = 'recording_state_changed';

export interface RecordingEventMessage {
  type: RecordingEventType;
  recordingId: string;
  status: RecordingStatus;
  transcriptId?: string | null;
  error?: string | null;
  studentId?: string | null;
  source?: 'scan' | 'upload';
  displayName?: string | null;
  durationSec?: number | null;
  channels?: number | null;
  bytes?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type StreamEventMessage = JobEventMessage | RecordingEventMessage;

// Job actions exports
// Job actions exports
export * from './job-actions.js';
export * from './errors.js';
