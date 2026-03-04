import type { ConfigProvider } from './config.js';
import type { AssignmentManifest, ManifestStore } from './manifest.js';
import type { PipelineLogger, PipelineMetrics } from './observability.js';

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

export interface NewAssignmentFlags {
  md: string;
  student?: string;
  preset?: string;
  learningPresetId?: string;
  presetsPath?: string;
  accentPreference?: string;
  voiceId?: string;
  withTts?: boolean;
  publishTarget?: 'notion' | 'anytype' | 'html';
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

  // TTS strategy options for rerun
  ttsStrategy?: 'auto' | 'dialogue' | 'tts';
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
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
