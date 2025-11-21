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
}

export interface NewAssignmentFlags {
  md: string;
  student?: string;
  preset?: string;
  presetsPath?: string;
  accentPreference?: string;
  voiceId?: string;
  withTts?: boolean;

  // New TTS mode fields
  ttsMode?: 'auto' | 'dialogue' | 'monologue';
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

  // TTS mode options for rerun
  ttsMode?: 'auto' | 'dialogue' | 'monologue';
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
}
