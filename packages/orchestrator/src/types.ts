import type { PronunciationChunkTtsProviderId, TtsModelId } from '@esl-pipeline/contracts';
import type { PronunciationAudioMode } from '@esl-pipeline/shared-infrastructure';
import type {
  SpeechPerformancePlanner,
  SpeechPerformancePlannerFallbackReason,
  TtsProviderId as TtsProvider,
  VoicePlanRanker,
} from '@esl-pipeline/tts-core';

import type { ConfigProvider } from './config.js';
import type { AssignmentManifest, AudioArtifactManifest, ManifestStore } from './manifest.js';
import type { PipelineLogger, PipelineMetrics } from './observability.js';

export type AssignmentStage =
  | 'validate'
  | 'import'
  | 'colorize'
  | 'voice-plan'
  | 'speech-plan'
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

export type OrchestratorOperation =
  | 'new_assignment'
  | 'rerun'
  | 'get_assignment_status'
  | 'plan_rerun';

export type OrchestratorErrorCategory =
  | 'cancelled'
  | 'validation'
  | 'configuration'
  | 'manifest'
  | 'infrastructure'
  | 'unknown';

export interface AssignmentStageEventV2 {
  schemaVersion: 'v2';
  source: 'orchestrator';
  operation: OrchestratorOperation;
  emittedAt: string;
  runId?: string;
  stage: AssignmentStage;
  status: AssignmentStageStatus;
  detail?: Record<string, unknown>;
}

export interface OrchestratorErrorV2 {
  schemaVersion: 'v2';
  operation: OrchestratorOperation;
  category: OrchestratorErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  stage?: AssignmentStage;
  causeName?: string;
}

export type OrchestratorApiResultV2<TData> =
  | {
      ok: true;
      schemaVersion: 'v2';
      operation: OrchestratorOperation;
      data: TData;
    }
  | {
      ok: false;
      schemaVersion: 'v2';
      operation: OrchestratorOperation;
      error: OrchestratorErrorV2;
    };

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
  speechPlanner?: SpeechPerformancePlanner;
  speechPlannerUnavailableReason?: SpeechPerformancePlannerFallbackReason;
  speechPlannerDebugLogPlan?: boolean;
  voiceRanker?: VoicePlanRanker;
}

export interface OrchestratorV2ExecutionContext {
  dependencies?: OrchestratorDependencies;
  onStageEvent?: (event: AssignmentStageEventV2) => void;
}

export type PublishTarget = 'html';

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
  ttsModel?: TtsModelId;
  publishTarget?: PublishTarget;

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

export type NewAssignmentRequest = NewAssignmentFlags;

export interface NewAssignmentRequestV2 {
  assignment: NewAssignmentRequest;
}

export interface NewAssignmentResult {
  htmlUrl?: string;
  publishTarget?: PublishTarget;
  audio?: AudioArtifactManifest;
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

export interface GetAssignmentStatusRequestV2 {
  mdPath: string;
}

export interface RerunFlags {
  md: string;
  manifestMd?: string;
  voices?: string;
  out?: string;
  dryRun?: boolean;
  upload?: 's3';
  prefix?: string;
  publicRead?: boolean;
  presign?: number;
  republishOnly?: boolean;
  regenerateStudyTextAudio?: boolean;
  regeneratePronunciationMainAudio?: boolean;
  regeneratePronunciationChunkAudio?: boolean;
  studyTextVoiceAccent?: string;
  studyTextVoiceId?: string;
  studyTextTtsProvider?: TtsProvider;
  studyTextTtsModel?: TtsModelId;
  studyTextTtsStrategy?: 'auto' | 'dialogue' | 'tts';
  studyTextDialogueLanguage?: string;
  studyTextDialogueStability?: number;
  studyTextDialogueSeed?: number;
  pronunciationMainVoiceAccent?: string;
  pronunciationMainVoiceId?: string;
  pronunciationMainTtsProvider?: TtsProvider;
  pronunciationMainTtsModel?: TtsModelId;
  pronunciationChunkVoiceAccent?: string;
  pronunciationChunkVoiceId?: string;
  pronunciationChunkTtsProvider?: PronunciationChunkTtsProviderId;
  pronunciationChunkTtsModel?: TtsModelId;
}

export type RerunAssignmentRequest = RerunFlags;

export interface RerunAssignmentRequestV2 {
  assignment: RerunAssignmentRequest;
}

export interface RerunAssignmentResult {
  steps: string[];
  audio?: AudioArtifactManifest;
  htmlUrl?: string;
  publishTarget?: PublishTarget;
  manifestPath: string;
}

export type RerunTargetStage = 'tts' | 'upload' | 'add-audio';

export interface RerunPlanSkip {
  stage: RerunTargetStage;
  reason: string;
}

export interface RerunPlanRequest {
  md: string;
  republishOnly?: boolean;
  regenerateStudyTextAudio?: boolean;
  regeneratePronunciationMainAudio?: boolean;
  regeneratePronunciationChunkAudio?: boolean;
}

export interface RerunPlanRequestV2 {
  rerunPlan: RerunPlanRequest;
}

export interface RerunPlanResult {
  requested: {
    republishOnly: boolean;
    regenerateStudyTextAudio: boolean;
    regeneratePronunciationMainAudio: boolean;
    regeneratePronunciationChunkAudio: boolean;
  };
  executable: RerunTargetStage[];
  skipped: RerunPlanSkip[];
  willReuse: {
    studyTextAudio: boolean;
    pronunciationMainAudio: boolean;
    pronunciationChunkAudio: boolean;
  };
  detectedPronunciationMode?: PronunciationAudioMode | null;
  requires: {
    missingManifestFields: string[];
  };
  errors: string[];
}
