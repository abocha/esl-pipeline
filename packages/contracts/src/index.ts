export type JobState = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed';

export type TtsStrategy = 'auto' | 'dialogue' | 'tts';
export type TtsStrategyOption = TtsStrategy;

export type JobUploadOption = 'auto' | 's3' | 'none';
export type UploadOption = JobUploadOption;
export type PublishTarget = 'notion' | 'anytype';

export type RecordingStatus = 'ingested' | 'queued' | 'transcribing' | 'transcribed' | 'failed';

export interface NotionDatabaseOption {
  id: string;
  name: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  accent?: string | null;
  gender?: string | null;
  category?: string | null;
}

export interface JobOptionsPayload {
  presets: string[];
  voiceAccents: string[];
  voices: VoiceOption[];
  notionDatabases: NotionDatabaseOption[];
  uploadOptions: UploadOption[];
  ttsStrategies: TtsStrategyOption[];
}

export interface SubmitJobRequest {
  md: string;
  preset?: string;
  withTts?: boolean;
  forceTts?: boolean;
  notionDatabase?: string;
  publishTarget?: PublishTarget;
  upload?: JobUploadOption;
  ttsStrategy?: TtsStrategy;
  voiceId?: string;
  voiceAccent?: string;
  autoPublish?: boolean;
}

export interface JobConfigOverrides {
  preset?: string;
  notionDatabase?: string;
  publishTarget?: PublishTarget;
  withTts?: boolean;
  forceTts?: boolean;
  ttsStrategy?: TtsStrategy;
  upload?: JobUploadOption;
  voiceId?: string;
  voiceAccent?: string;
  autoPublish?: boolean;
}

export interface JobStatusDto {
  jobId: string;
  md: string | null;
  mdStorageUri?: string | null;
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
  publishTarget: PublishTarget | null;
  ttsStrategy: TtsStrategy | null;
  autoPublish: boolean | null;
  notionUrl: string | null;
  anytypeUrl: string | null;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  manifestPath: string | null;
}

export interface JobListResponse {
  jobs: JobStatusDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface JobSummaryResponse {
  total: number;
  byState: Record<JobState, number>;
  pendingApprovals: number;
  last7Days: {
    total: number;
    succeeded: number;
    failed: number;
  };
  tts: {
    enabled: number;
    succeeded: number;
  };
}

export interface StudentSummaryResponse {
  items: {
    id: string;
    name: string;
    lastLessonAt: string | null;
    pendingDrafts: number;
  }[];
  total: number;
  limit: number;
  offset: number;
}

export interface MarkdownValidationResponse {
  ok: boolean;
  errors: string[];
  warnings: string[];
  meta?: {
    title: string;
    student: string;
    level: string;
    topic: string | string[];
    input_type: string;
    speaker_labels?: string[];
  };
}

export type JobEventType = 'job_created' | 'job_state_changed';

export interface JobEventPayload {
  manifestPath?: string | null;
  error?: string | null;
  finishedAt?: string | null;
  ttsStrategy?: TtsStrategy | null;
  md?: string | null;
  mdStorageUri?: string | null;
  notionUrl?: string | null;
  anytypeUrl?: string | null;
  publishTarget?: PublishTarget | null;
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
  source?: 'upload';
  displayName?: string | null;
  durationSec?: number | null;
  channels?: number | null;
  bytes?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type StreamEventMessage = JobEventMessage | RecordingEventMessage;

// Job actions exports
export * from './job-actions.js';
export * from './errors.js';
export * from './observability.js';
