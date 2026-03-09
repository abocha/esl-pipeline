import type { ConfigProvider } from './config.js';
import type { AssignmentManifest, ManifestStore } from './manifest.js';
import type { PipelineLogger, PipelineMetrics } from './observability.js';
import type { GoogleTtsModel, TtsProviderId as TtsProvider } from '@esl-pipeline/tts-core';

export type AssignmentStage =
  | 'validate'
  | 'import'
  | 'colorize'
  | 'tts'
  | 'upload'
  | 'add-audio'
  | 'manifest';

export type AssignmentStageStatus = 'start' | 'success' | 'skipped';

export interface AssignmentProgressEvent {
  stage: AssignmentStage;
  status: AssignmentStageStatus;
  detail?: Record<string, unknown>;
}

export interface AssignmentProgressCallbacks {
  onStage?: (event: AssignmentProgressEvent) => void;
}

export interface OrchestratorDependencies {
  manifestStore?: ManifestStore;
  configProvider?: ConfigProvider;
  logger?: PipelineLogger;
  metrics?: PipelineMetrics;
  runId?: string;
  signal?: AbortSignal;
}

export type PublishTarget = 'notion' | 'anytype' | 'html';

export interface NewAssignmentFlags {
  md: string;
  student?: string;
  preset?: string;
  learningPresetId?: string;
  presetsPath?: string;
  accentPreference?: string;
  voiceId?: string;
  withTts?: boolean;
  ttsProvider?: TtsProvider;
  googleTtsModel?: GoogleTtsModel;
  publishTarget?: PublishTarget;
  anytypeSpaceId?: string;

  // TTS strategy fields
  ttsStrategy?: 'auto' | 'dialogue' | 'tts';
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;

  upload?: 's3';
  presign?: number;
  publicRead?: boolean;
  prefix?: string;
  dryRun?: boolean;
  force?: boolean;
  skipImport?: boolean;
  skipTts?: boolean;
  skipUpload?: boolean;
  redoTts?: boolean;
  voices?: string;
  out?: string;
  dbId?: string;
  db?: string;
  dataSourceId?: string;
  dataSource?: string;
}

export interface NewAssignmentRequest extends NewAssignmentFlags {}

export interface NewAssignmentResult {
  pageId?: string;
  pageUrl?: string;
  anytypeUrl?: string;
  htmlUrl?: string;
  publishTarget?: PublishTarget;
  audio?: AssignmentManifest['audio'];
  colorized?: boolean;
  manifestPath?: string;
  steps: string[];
}

export interface AssignmentStatus {
  manifestPath: string;
  manifest: AssignmentManifest | null;
  mdHashMatches: boolean;
  audioFileExists: boolean;
}

export interface RerunFlags {
  md: string;
  manifestMd?: string;
  steps?: ('tts' | 'upload' | 'add-audio')[];
  voices?: string;
  out?: string;
  force?: boolean;
  dryRun?: boolean;
  upload?: 's3';
  prefix?: string;
  publicRead?: boolean;
  presign?: number;
  accentPreference?: string;
  voiceId?: string;
  ttsProvider?: TtsProvider;
  googleTtsModel?: GoogleTtsModel;

  // TTS strategy options for rerun
  ttsStrategy?: 'auto' | 'dialogue' | 'tts';
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
}

export interface RerunAssignmentRequest extends RerunFlags {}

export interface RerunAssignmentResult {
  steps: string[];
  audio?: AssignmentManifest['audio'];
  pageId?: string;
  pageUrl?: string;
  anytypeUrl?: string;
  htmlUrl?: string;
  publishTarget?: PublishTarget;
  manifestPath: string;
}

export type RerunTargetStage = NonNullable<RerunFlags['steps']>[number];

export interface RerunPlanSkip {
  stage: RerunTargetStage;
  reason: string;
}

export interface RerunPlanRequest {
  md: string;
  steps?: RerunTargetStage[];
  audio?: boolean;
  from?: RerunTargetStage;
  to?: RerunTargetStage;
}

export interface RerunPlanResult {
  requested: RerunTargetStage[];
  executable: RerunTargetStage[];
  skipped: RerunPlanSkip[];
  requires: {
    missingManifestFields: string[];
  };
  errors: string[];
}
