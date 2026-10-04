import { randomUUID } from 'node:crypto';
import { constants as FS } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  assignmentPronunciation,
  FfmpegNotFoundError,
  InfrastructureError,
  ManifestError,
  serializeAssignmentV1,
  ValidationError,
  validateAssignmentV1,
} from '@esl-pipeline/contracts';
import { renderAndPublishAssignmentToS3 } from '@esl-pipeline/html-publisher';
import { deriveS3UploadAddress, uploadFile } from '@esl-pipeline/storage-uploader';
import {
  buildStudyTextMp3,
  hashStudyText,
  isTtsModelForProvider,
  parseTtsModelId,
  prepareStudyTextSynthesis,
  type SpeechPerformancePlan,
  type TtsModelId,
  type VoicePlan,
} from '@esl-pipeline/tts-core';

import {
  createProgressCallbacksFromV2Context,
  failureResultV2,
  type GetAssignmentStatusOperationResultV2,
  type NewAssignmentOperationResultV2,
  type PlanRerunAssignmentOperationResultV2,
  type RerunAssignmentOperationResultV2,
  successResultV2,
} from './api-v2.js';
import { DEFAULT_PRESETS_PATH, DEFAULT_VOICES_PATH, loadPresets } from './config.js';
import {
  type AssignmentManifest,
  CURRENT_MANIFEST_SCHEMA_VERSION,
  createFilesystemManifestStore,
  normalizeManifestPublishTarget,
} from './manifest.js';
import { noopLogger, noopMetrics } from './observability.js';
import { assertExecutableManifest, computeRerunPlan } from './rerun-planner.js';
import {
  type AudioArtifact,
  type AudioArtifactKind,
  deriveS3GlobalUrl,
  emitArtifactReuseMetric,
  type PronunciationAudioArtifact,
  resolveAudioArtifactKey,
  resolveAudioArtifactsFromManifest,
  resolveStudentFacingAudioMetadata,
} from './runtime/audio-artifacts.js';
import { synthesizePronunciationAudio } from './runtime/pronunciation-audio.js';
import { resolveHeadingTheme } from './runtime/publish-utils.js';
import { resolveSpeechPerformancePlan } from './runtime/speech-performance.js';
import { createStageReporter } from './runtime/stage-reporter.js';
import {
  buildTtsSpendSummary,
  categorizeProviderErrorFromMessage,
  emitVoiceSelectionMetrics,
  summarizeVoiceSelections,
} from './runtime/tts-telemetry.js';
import { applyVoicePreferences } from './runtime/voice-preferences.js';
import { ensureTtsProvidersRegistered } from './tts-provider-registry.js';
import type {
  AssignmentProgressCallbacks,
  AssignmentStage,
  AssignmentStatus,
  GetAssignmentStatusRequestV2,
  NewAssignmentFlags,
  NewAssignmentRequestV2,
  NewAssignmentResult,
  OrchestratorDependencies,
  OrchestratorOperation,
  OrchestratorV2ExecutionContext,
  RerunAssignmentRequestV2,
  RerunAssignmentResult,
  RerunFlags,
  RerunPlanRequest,
  RerunPlanRequestV2,
  RerunPlanResult,
  RerunTargetStage,
} from './types.js';

export type {
  AssignmentProgressCallbacks,
  AssignmentProgressEvent,
  AssignmentStage,
  AssignmentStageEventV2,
  AssignmentStageStatus,
  AssignmentStatus,
  GetAssignmentStatusRequestV2,
  NewAssignmentFlags,
  NewAssignmentRequest,
  NewAssignmentRequestV2,
  NewAssignmentResult,
  OrchestratorApiResultV2,
  OrchestratorDependencies,
  OrchestratorErrorCategory,
  OrchestratorErrorV2,
  OrchestratorOperation,
  OrchestratorV2ExecutionContext,
  PublishTarget,
  RerunAssignmentRequest,
  RerunAssignmentRequestV2,
  RerunAssignmentResult,
  RerunFlags,
  RerunPlanRequest,
  RerunPlanRequestV2,
  RerunPlanResult,
  RerunTargetStage,
} from './types.js';

const fallbackManifestStore = createFilesystemManifestStore();
const fallbackLogger = noopLogger;
const fallbackMetrics = noopMetrics;

ensureTtsProvidersRegistered();

async function loadHeadingThemeForPreset(
  presetName: string,
  presetsPath = DEFAULT_PRESETS_PATH,
): Promise<{ h2?: string; h3?: string } | undefined> {
  const presets = await loadPresets(presetsPath);
  const preset = presets[presetName];
  return preset ? resolveHeadingTheme(preset) : undefined;
}

function normalizeCancellationReason(reason: unknown): string | undefined {
  if (typeof reason === 'string') {
    const trimmed = reason.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (reason instanceof Error) {
    const trimmed = reason.message.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
}

function normalizePronunciationProviderFromManifest(
  provider?: string | null,
): 'elevenlabs' | 'google' | 'inworld' | undefined {
  if (!provider) return undefined;
  if (provider === 'elevenlabs' || provider === 'google' || provider === 'inworld') return provider;
  return undefined;
}

function normalizePrimaryPronunciationProviderFromManifest(
  provider?: string | null,
): 'elevenlabs' | 'google' | 'inworld' | undefined {
  if (provider === 'elevenlabs' || provider === 'google' || provider === 'inworld') {
    return provider;
  }
  return undefined;
}

function resolvePronunciationTtsModelFromManifest(args: {
  provider?: 'elevenlabs' | 'google' | 'inworld';
  modelId?: string | null;
}): TtsModelId | undefined {
  if (!args.provider || !args.modelId || !isTtsModelForProvider(args.provider, args.modelId)) {
    return undefined;
  }
  return parseTtsModelId(args.modelId) ?? undefined;
}

function resolveProviderCompatibleVoiceId(args: {
  explicitVoiceId?: string;
  effectiveProvider?: 'elevenlabs' | 'google' | 'inworld';
  previousVoiceId?: string;
  previousProvider?: 'elevenlabs' | 'google' | 'inworld';
  fallbackCandidates?: Array<{
    voiceId?: string;
    provider?: string | null;
  }>;
}): string | undefined {
  if (args.explicitVoiceId !== undefined) {
    return args.explicitVoiceId;
  }

  if (
    args.effectiveProvider !== undefined &&
    args.previousProvider === args.effectiveProvider &&
    args.previousVoiceId
  ) {
    return args.previousVoiceId;
  }

  if (args.effectiveProvider === undefined) {
    return args.fallbackCandidates?.find((candidate) => candidate.voiceId)?.voiceId;
  }

  return args.fallbackCandidates?.find(
    (candidate) => candidate.voiceId && candidate.provider === args.effectiveProvider,
  )?.voiceId;
}

interface RerunTtsWarning {
  code: string;
  message: string;
}

function pushRerunTtsWarning(
  warnings: RerunTtsWarning[],
  logger: typeof fallbackLogger,
  warning: RerunTtsWarning,
  detail?: Record<string, unknown>,
): void {
  warnings.push(warning);
  logger.log({
    level: 'warn',
    stage: 'tts',
    message: warning.message,
    detail: {
      code: warning.code,
      ...detail,
    },
  });
}

export class PipelineCancelledError extends Error {
  readonly stage: AssignmentStage;
  readonly code = 'PIPELINE_CANCELLED';

  constructor(stage: AssignmentStage, reason?: unknown) {
    const normalizedReason = normalizeCancellationReason(reason);
    super(normalizedReason ? `cancelled: ${normalizedReason}` : 'cancelled');
    this.name = 'PipelineCancelledError';
    this.stage = stage;
  }
}

export function isPipelineCancelledError(error: unknown): error is PipelineCancelledError {
  return (
    error instanceof PipelineCancelledError ||
    (error instanceof Error &&
      (error.name === 'PipelineCancelledError' ||
        (error as { code?: string }).code === 'PIPELINE_CANCELLED'))
  );
}

function normalizePipelineCancellation(error: unknown): PipelineCancelledError | undefined {
  if (isPipelineCancelledError(error)) return error;
  if (
    error instanceof Error &&
    (error.name === 'TtsSynthesisCancelledError' ||
      (error as { code?: string }).code === 'TTS_SYNTHESIS_CANCELLED')
  ) {
    return new PipelineCancelledError(
      'tts',
      'reason' in error ? (error as Error & { reason?: unknown }).reason : undefined,
    );
  }
  return undefined;
}

function throwIfCancelled(signal: AbortSignal | undefined, stage: AssignmentStage): void {
  if (!signal?.aborted) return;
  throw new PipelineCancelledError(stage, signal.reason);
}

function emitPronunciationProviderCharacterMetrics(
  metrics: typeof fallbackMetrics,
  pronunciation: PronunciationAudioArtifact | undefined,
): void {
  if (!pronunciation) return;

  let generatedCharacters = 0;
  let cachedCharacters = 0;
  const clips = [
    ...(pronunciation.primaryClip ? [pronunciation.primaryClip] : []),
    ...(pronunciation.itemClips ?? []),
  ];

  for (const clip of clips) {
    if (clip.engine !== 'provider') continue;
    generatedCharacters += Math.max(0, clip.tts?.generatedCharacters ?? 0);
    cachedCharacters += Math.max(0, clip.tts?.cachedCharacters ?? 0);
  }

  if (generatedCharacters > 0) {
    metrics.increment('esl.tts.provider_characters', generatedCharacters, {
      type: 'generated',
    });
  }
  if (cachedCharacters > 0) {
    metrics.increment('esl.tts.provider_characters', cachedCharacters, {
      type: 'cached',
    });
  }
}

type PronunciationArtifactClip = NonNullable<PronunciationAudioArtifact['primaryClip']>;

function findPreviousPronunciationClip(
  previousAudio: PronunciationAudioArtifact | undefined,
  clip: PronunciationArtifactClip | undefined,
): PronunciationArtifactClip | undefined {
  if (!clip) return undefined;
  const previousClips = [
    ...(previousAudio?.primaryClip ? [previousAudio.primaryClip] : []),
    ...(previousAudio?.itemClips ?? []),
  ];
  return previousClips.find(
    (candidate) =>
      candidate.id === clip.id &&
      candidate.kind === clip.kind &&
      candidate.itemIndex === clip.itemIndex,
  );
}

function pronunciationClipAudioIdentityMatches(
  current: PronunciationArtifactClip,
  previous: PronunciationArtifactClip | undefined,
): boolean {
  return Boolean(
    previous &&
      current.engine === previous.engine &&
      current.kind === previous.kind &&
      current.itemIndex === previous.itemIndex &&
      current.text === previous.text &&
      current.voiceId === previous.voiceId &&
      current.tts?.provider === previous.tts?.provider &&
      current.tts?.modelId === previous.tts?.modelId &&
      (previous.url === undefined || current.url === previous.url),
  );
}

function wasPronunciationClipRegenerated(
  clip: PronunciationArtifactClip | undefined,
  previousAudio: PronunciationAudioArtifact | undefined,
): boolean {
  if (!clip) return false;
  return !pronunciationClipAudioIdentityMatches(
    clip,
    findPreviousPronunciationClip(previousAudio, clip),
  );
}

async function applyRerunVoicePreferences(flags: RerunFlags): Promise<void> {
  const studyTextPreferences = {
    voiceId: flags.studyTextVoiceId,
    accentPreference: flags.studyTextVoiceAccent,
    provider: flags.studyTextTtsProvider,
  };
  await applyVoicePreferences(studyTextPreferences, { resolveAccentToVoiceId: false });
  flags.studyTextVoiceId = studyTextPreferences.voiceId;
  flags.studyTextVoiceAccent = studyTextPreferences.accentPreference;

  const pronunciationMainPreferences = {
    voiceId: flags.pronunciationMainVoiceId,
    accentPreference: flags.pronunciationMainVoiceAccent,
    provider: flags.pronunciationMainTtsProvider,
  };
  await applyVoicePreferences(pronunciationMainPreferences);
  flags.pronunciationMainVoiceId = pronunciationMainPreferences.voiceId;
  flags.pronunciationMainVoiceAccent = pronunciationMainPreferences.accentPreference;

  const pronunciationChunkPreferences = {
    voiceId: flags.pronunciationChunkVoiceId,
    accentPreference: flags.pronunciationChunkVoiceAccent,
    provider:
      flags.pronunciationChunkTtsProvider === 'elevenlabs' ||
      flags.pronunciationChunkTtsProvider === 'google' ||
      flags.pronunciationChunkTtsProvider === 'inworld'
        ? flags.pronunciationChunkTtsProvider
        : undefined,
  };
  await applyVoicePreferences(pronunciationChunkPreferences);
  flags.pronunciationChunkVoiceId = pronunciationChunkPreferences.voiceId;
  flags.pronunciationChunkVoiceAccent = pronunciationChunkPreferences.accentPreference;
}

function resolveDefaultChunkProvider(_mode?: string | null): 'elevenlabs' | 'google' {
  return 'google';
}

export {
  RemoteConfigProvider,
  type RemoteConfigProviderOptions,
} from './adapters/config/remote.js';
export { S3ManifestStore, type S3ManifestStoreOptions } from './adapters/manifest/s3.js';
export {
  categorizeOrchestratorError,
  type GetAssignmentStatusOperationResultV2,
  type NewAssignmentOperationResultV2,
  type PlanRerunAssignmentOperationResultV2,
  type RerunAssignmentOperationResultV2,
  toStageEventV2,
} from './api-v2.js';
export type { ConfigProvider, StudentProfile } from './config.js';
export { createFilesystemConfigProvider } from './config.js';
export type { AssignmentManifest, ManifestStore } from './manifest.js';
export {
  createFilesystemManifestStore,
  manifestPathFor,
  readManifest,
  writeManifest,
} from './manifest.js';
export {
  type JobOptionsPayload,
  resolveJobOptions,
  type VoiceOption as JobVoiceOption,
} from './metadata/job-options.js';
export type {
  PipelineLogEvent,
  PipelineLogger,
  PipelineLogLevel,
  PipelineMetrics,
} from './observability.js';
export { noopLogger, noopMetrics } from './observability.js';
export type {
  CreatePipelineOptions,
  LoadEnvOptions,
  LoadEnvSummary,
  OrchestratorPipeline,
  PipelineNewAssignmentOptions,
  PipelineRerunOptions,
  ResolvedConfigPaths,
} from './pipeline.js';
export {
  createPipeline,
  loadEnvFiles,
  loadEnvFilesWithSummary,
  resolveConfigPaths,
  resolveManifestPath,
} from './pipeline.js';
export { computeRerunPlan } from './rerun-planner.js';
export { summarizeVoiceSelections } from './runtime/tts-telemetry.js';

export async function planRerunAssignment(
  request: RerunPlanRequest,
  dependencies: OrchestratorDependencies = {},
): Promise<RerunPlanResult> {
  const manifestStore = dependencies.manifestStore ?? fallbackManifestStore;
  const manifest = await manifestStore.readManifest(request.md);
  return computeRerunPlan({
    ...request,
    manifest,
  });
}

export async function executeNewAssignmentV2(
  request: NewAssignmentRequestV2,
  context: OrchestratorV2ExecutionContext = {},
): Promise<NewAssignmentOperationResultV2> {
  const operation: OrchestratorOperation = 'new_assignment';
  try {
    const callbacks = createProgressCallbacksFromV2Context(operation, context);
    const data = await newAssignment(request.assignment, callbacks, context.dependencies ?? {});
    return successResultV2(operation, data);
  } catch (error) {
    return failureResultV2<NewAssignmentResult>(operation, error);
  }
}

export async function executeRerunAssignmentV2(
  request: RerunAssignmentRequestV2,
  context: OrchestratorV2ExecutionContext = {},
): Promise<RerunAssignmentOperationResultV2> {
  const operation: OrchestratorOperation = 'rerun';
  try {
    const data = await rerunAssignment(request.assignment, context.dependencies ?? {});
    return successResultV2(operation, data);
  } catch (error) {
    return failureResultV2<RerunAssignmentResult>(operation, error);
  }
}

export async function executeGetAssignmentStatusV2(
  request: GetAssignmentStatusRequestV2,
  context: OrchestratorV2ExecutionContext = {},
): Promise<GetAssignmentStatusOperationResultV2> {
  const operation: OrchestratorOperation = 'get_assignment_status';
  try {
    const data = await getAssignmentStatus(request.mdPath, context.dependencies ?? {});
    return successResultV2(operation, data);
  } catch (error) {
    return failureResultV2<AssignmentStatus>(operation, error);
  }
}

export async function executePlanRerunAssignmentV2(
  request: RerunPlanRequestV2,
  context: OrchestratorV2ExecutionContext = {},
): Promise<PlanRerunAssignmentOperationResultV2> {
  const operation: OrchestratorOperation = 'plan_rerun';
  try {
    const data = await planRerunAssignment(request.rerunPlan, context.dependencies ?? {});
    return successResultV2(operation, data);
  } catch (error) {
    return failureResultV2<RerunPlanResult>(operation, error);
  }
}

function requireExecutableAssignment(flags: NewAssignmentFlags | RerunFlags) {
  if (!flags.assignment) {
    throw new ValidationError(
      'Historical Markdown assignments are read-only; AssignmentV1 is required for execution.',
    );
  }
  return validateAssignmentV1(flags.assignment, flags.validationContext);
}

export async function newAssignment(
  flags: NewAssignmentFlags,
  callbacks: AssignmentProgressCallbacks = {},
  dependencies: OrchestratorDependencies = {},
): Promise<NewAssignmentResult> {
  const assignment = requireExecutableAssignment(flags);
  const manifestStore = dependencies.manifestStore ?? fallbackManifestStore;
  const logger = dependencies.logger ?? fallbackLogger;
  const metrics = dependencies.metrics ?? fallbackMetrics;
  const runId = dependencies.runId ?? randomUUID();
  const signal = dependencies.signal;
  const pipelineStartedAt = Date.now();
  throwIfCancelled(signal, 'validate');
  const previousManifest = await manifestStore.readManifest(flags.md);
  if (previousManifest) assertExecutableManifest(previousManifest);
  await applyVoicePreferences(flags, { resolveAccentToVoiceId: false });
  throwIfCancelled(signal, 'validate');
  const { emitStage, recordSkip } = createStageReporter({
    callbacks,
    logger,
    metrics,
    runId,
  });

  const steps: string[] = [];
  const assignmentContents = serializeAssignmentV1(assignment);
  const assignmentHash = hashStudyText(assignmentContents);
  const publishTarget = normalizeManifestPublishTarget(
    flags.publishTarget ?? previousManifest?.publishTarget,
  );
  let htmlUrl = previousManifest?.htmlUrl;
  let htmlHash = previousManifest?.htmlHash;
  let htmlKey = previousManifest?.htmlKey;
  let htmlEtag = previousManifest?.htmlEtag;
  let htmlReused = previousManifest?.htmlReused;

  const colorized = false;

  logger.log({
    level: 'info',
    message: 'pipeline.newAssignment.start',
    runId,
    stage: 'pipeline',
    detail: { md: flags.md, preset: flags.preset, student: flags.student, publishTarget },
  });

  try {
    // Validation stage always runs, even when skipping import
    throwIfCancelled(signal, 'validate');
    emitStage('validate', 'start');
    steps.push('validate');
    const executionInput = { assignment };
    emitStage('validate', 'success');

    if (flags.skipImport) {
      recordSkip('import', 'skip-import flag set');
      steps.push('skip:import');
    } else {
      emitStage('import', 'start');
      steps.push('import');
      emitStage('import', 'success', { publishTarget: 'html', remoteImport: false });
    }

    if (flags.preset) {
      recordSkip('colorize', `${publishTarget} uses static HTML theming`);
    } else {
      recordSkip('colorize', 'no preset selected');
    }

    let audioArtifacts = resolveAudioArtifactsFromManifest(previousManifest);
    let studyTextVoicePlan: VoicePlan | undefined = previousManifest?.voicePlans?.studyText;
    let studyTextVoicePlanHash = audioArtifacts.studyText?.voicePlanHash;
    let studyTextSpeechPlan: SpeechPerformancePlan | undefined =
      previousManifest?.speechPlans?.studyText;
    let studyTextSpeechPlanHash = audioArtifacts.studyText?.speechPlanHash;
    if (flags.withTts) {
      if (flags.skipTts) {
        recordSkip('voice-plan', 'skip-tts flag set');
        recordSkip('speech-plan', 'skip-tts flag set');
        recordSkip('tts', 'skip-tts flag set');
        steps.push('skip:tts');
        if (!audioArtifacts.studyText?.path && !flags.dryRun) {
          throw new ManifestError(
            'Cannot skip TTS because manifest has no audio.path. Run TTS at least once first.',
          );
        }
      } else {
        emitStage('voice-plan', 'start');
        steps.push('voice-plan');
        throwIfCancelled(signal, 'voice-plan');
        const prepared = await prepareStudyTextSynthesis(
          { ...executionInput, mdPath: flags.md },
          {
            voiceMapPath: flags.voices ?? DEFAULT_VOICES_PATH,
            outPath: flags.out ?? dirname(flags.md),
            defaultAccent: flags.accentPreference,
            defaultVoiceId: flags.voiceId,
            ttsProvider: flags.ttsProvider,
            ttsModel: flags.ttsModel,
            logger,
            voiceRanker: dependencies.voiceRanker,
            signal,
            deadlineAtMs: dependencies.deadlineAtMs,
          },
        );
        studyTextVoicePlan = prepared.voicePlan;
        studyTextVoicePlanHash = studyTextVoicePlan
          ? hashStudyText(JSON.stringify(studyTextVoicePlan))
          : undefined;
        emitStage('voice-plan', 'success', {
          provider: prepared.selection.provider,
          model: prepared.selection.model,
          assignmentCount: studyTextVoicePlan?.assignments.length ?? 0,
        });

        emitStage('speech-plan', 'start');
        steps.push('speech-plan');
        throwIfCancelled(signal, 'speech-plan');
        const resolvedSpeechPlan = await resolveSpeechPerformancePlan({
          prepared,
          planner: dependencies.speechPlanner,
          plannerUnavailableReason: dependencies.speechPlannerUnavailableReason,
          logger,
          debugLogPlan: dependencies.speechPlannerDebugLogPlan,
        });
        studyTextSpeechPlan = resolvedSpeechPlan.plan;
        studyTextSpeechPlanHash = resolvedSpeechPlan.hash;
        throwIfCancelled(signal, 'speech-plan');
        emitStage('speech-plan', 'success', {
          mode: studyTextSpeechPlan.mode,
          provider: studyTextSpeechPlan.provider,
          model: studyTextSpeechPlan.model,
          ...(studyTextSpeechPlan.schemaVersion === 1
            ? { fallbackReason: studyTextSpeechPlan.fallbackReason }
            : {}),
          segmentCount: studyTextSpeechPlan.segments.length,
        });

        emitStage('tts', 'start');
        steps.push('tts');
        throwIfCancelled(signal, 'tts');

        // TTS strategy debug logging
        if (flags.ttsStrategy) {
          logger.log({
            level: 'info',
            message: `Using TTS strategy: ${flags.ttsStrategy}`,
            detail: {
              ttsStrategy: flags.ttsStrategy,
              dialogueLanguage: flags.dialogueLanguage,
              dialogueStability: flags.dialogueStability,
              dialogueSeed: flags.dialogueSeed,
            },
          });
        }

        let ttsResult: Awaited<ReturnType<typeof buildStudyTextMp3>>;
        try {
          ttsResult = await buildStudyTextMp3(
            {
              ...executionInput,
              mdPath: flags.md,
            },
            {
              voiceMapPath: flags.voices ?? DEFAULT_VOICES_PATH,
              outPath: flags.out ?? dirname(flags.md),
              preview: flags.dryRun,
              force: flags.force || flags.redoTts,
              defaultAccent: flags.accentPreference,
              defaultVoiceId: flags.voiceId,
              ttsProvider: flags.ttsProvider,
              ttsModel: flags.ttsModel,

              // Pass TTS strategy options to TTS package
              ttsStrategy: flags.ttsStrategy,
              dialogueLanguage: flags.dialogueLanguage,
              dialogueStability: flags.dialogueStability,
              dialogueSeed: flags.dialogueSeed,
              logger,
              voicePlan: studyTextVoicePlan,
              speechPlan: studyTextSpeechPlan,
              signal,
              deadlineAtMs: dependencies.deadlineAtMs,
            },
          );
          throwIfCancelled(signal, 'tts');
        } catch (error: unknown) {
          const category = categorizeProviderErrorFromMessage(error);
          if (category) {
            metrics.increment('esl.voice_alignment.provider_error', 1, { category });
          }
          if (error instanceof FfmpegNotFoundError) {
            throw new Error(`TTS requires FFmpeg.\n\n${error.message}`, { cause: error });
          }

          // Enhanced TTS mode error handling
          if (error instanceof Error) {
            if (error.message.includes('voice mapping') && flags.ttsStrategy === 'dialogue') {
              throw new Error(
                `Dialogue mode requires voice mappings for all speakers. ` +
                  `Check your voices.yml file. ${error.message}`,
              );
            }
            if (error.message.includes('text-to-dialogue') && flags.ttsStrategy === 'dialogue') {
              throw new Error(
                `Dialogue mode failed: ${error.message}\n` +
                  'Try switching to TTS strategy with --tts-strategy tts',
              );
            }
          }
          throw error;
        }
        const ttsSummary = buildTtsSpendSummary(ttsResult);
        audioArtifacts.studyText = {
          path: ttsResult.path,
          hash: ttsResult.hash,
          voices: ttsResult.voices,
          tts: ttsSummary,
          voicePlanHash: studyTextVoicePlanHash,
          speechPlanHash: studyTextSpeechPlanHash,
        };
        emitVoiceSelectionMetrics(metrics, ttsResult.voices);
        const voiceSummary = summarizeVoiceSelections(ttsResult.voices);

        if (ttsResult.generatedCharacters !== undefined && ttsResult.generatedCharacters > 0) {
          metrics.increment('esl.tts.provider_characters', ttsResult.generatedCharacters, {
            type: 'generated',
          });
        }
        if (ttsResult.cachedCharacters !== undefined && ttsResult.cachedCharacters > 0) {
          metrics.increment('esl.tts.provider_characters', ttsResult.cachedCharacters, {
            type: 'cached',
          });
        }

        emitStage('tts', 'success', {
          path: ttsResult.path,
          preview: flags.dryRun,
          voices: ttsResult.voices,
          voiceSummary,
          generatedCharacters: ttsResult.generatedCharacters,
          cachedCharacters: ttsResult.cachedCharacters,
          ttsProvider: ttsSummary.provider,
          estimatedSpendUsd: ttsSummary.estimatedSpendUsd,
        });

        if (!flags.dryRun && audioArtifacts.studyText?.path) {
          const audioPath = audioArtifacts.studyText.path;
          throwIfCancelled(signal, 'tts');
          await access(audioPath, FS.F_OK).catch(() => {
            throw new InfrastructureError(
              `No audio file produced at ${audioPath}. ` +
                `Check that the assignment study text has lines and voices.yml has 'default' or 'auto: true'.`,
            );
          });
        }

        const narratorVoiceId = ttsResult.voiceAssignments?.Narrator;
        const fallbackVoiceId = narratorVoiceId ?? ttsResult.voices[0]?.voiceId;
        const detectedPronunciationFocus = assignmentPronunciation(assignment);
        const defaultChunkProvider = resolveDefaultChunkProvider(detectedPronunciationFocus?.mode);
        audioArtifacts.pronunciation = await synthesizePronunciationAudio({
          ...executionInput,
          mdPath: flags.md,
          outPath: flags.out ?? dirname(flags.md),
          title: assignment.metadata.title,
          preview: flags.dryRun,
          force: flags.force || flags.redoTts,
          primaryTtsProvider: flags.ttsProvider,
          primaryTtsModel: flags.ttsModel,
          logger,
          primaryVoiceId: fallbackVoiceId,
          chunkTtsProvider: defaultChunkProvider,
          chunkTtsModel: defaultChunkProvider === flags.ttsProvider ? flags.ttsModel : undefined,
          signal,
          deadlineAtMs: dependencies.deadlineAtMs,
        });
        emitPronunciationProviderCharacterMetrics(metrics, audioArtifacts.pronunciation);
      }
    } else {
      recordSkip('voice-plan', 'tts disabled');
      recordSkip('speech-plan', 'tts disabled');
      recordSkip('tts', 'tts disabled');
      audioArtifacts = {};
    }

    const artifactEntries: { kind: AudioArtifactKind; artifact: AudioArtifact | undefined }[] = [
      { kind: 'study_text', artifact: audioArtifacts.studyText },
      {
        kind: 'pronunciation_primary',
        artifact: audioArtifacts.pronunciation?.primaryClip ?? undefined,
      },
      ...(audioArtifacts.pronunciation?.itemClips ?? []).map((artifact) => ({
        kind: 'pronunciation_item' as const,
        artifact,
      })),
    ];
    const studentFacingAudioTitle = assignment.metadata.title;
    const uploadableArtifacts = artifactEntries.filter((entry) => entry.artifact?.path);
    if (flags.upload === 's3' && uploadableArtifacts.length > 0) {
      if (flags.skipUpload) {
        recordSkip('upload', 'skip-upload flag set');
        steps.push('skip:upload');
        if (!flags.dryRun && uploadableArtifacts.some((entry) => !entry.artifact?.url)) {
          throw new ManifestError(
            'Cannot skip upload because manifest has no existing audio.url for one or more audio artifacts. Upload once before skipping.',
          );
        }
      } else {
        emitStage('upload', 'start');
        steps.push('upload');
        throwIfCancelled(signal, 'upload');
        const bucket = process.env.S3_BUCKET ?? 'stub-bucket';
        const keyPrefix = flags.prefix ?? process.env.S3_PREFIX ?? '';
        for (const entry of uploadableArtifacts) {
          const artifact = entry.artifact;
          if (!artifact?.path) continue;
          const audioKey = artifact.hash
            ? resolveAudioArtifactKey(artifact.hash, keyPrefix, entry.kind, studentFacingAudioTitle)
            : undefined;
          if (flags.dryRun) {
            if (audioKey) {
              artifact.url = deriveS3GlobalUrl(bucket, audioKey);
              artifact.key = audioKey;
            } else {
              const { url, key } = deriveS3UploadAddress({
                bucket,
                keyPrefix,
                filePath: artifact.path,
                urlStyle: 'global',
              });
              artifact.url = url;
              artifact.key = key;
            }
            artifact.reused = false;
          } else {
            const upload = await uploadFile(artifact.path, {
              backend: 's3',
              key: audioKey,
              sha256: artifact.hash,
              skipIfExists: true,
              prefix: flags.prefix,
              public: flags.publicRead,
              presignExpiresIn: flags.presign,
              logger,
              mp3Metadata: resolveStudentFacingAudioMetadata(studentFacingAudioTitle, entry.kind),
            });
            artifact.url = upload.url;
            artifact.key = upload.key;
            artifact.etag = upload.etag;
            artifact.sizeBytes = upload.sizeBytes;
            artifact.reused = upload.reused;
            emitArtifactReuseMetric(metrics, 'audio', entry.kind, upload.reused);
          }
        }
        throwIfCancelled(signal, 'upload');
        emitStage('upload', 'success', {
          studyTextUrl: audioArtifacts.studyText?.url,
          pronunciationUrl: audioArtifacts.pronunciation?.primaryClip?.url,
          dryRun: flags.dryRun,
        });
      }
    } else {
      recordSkip('upload', flags.upload === 's3' ? 'no audio path available' : 'upload disabled');
    }

    const studyTextAudioUrl = audioArtifacts.studyText?.url;
    const pronunciationAudioUrl = audioArtifacts.pronunciation?.primaryClip?.url;

    if (publishTarget === 'html') {
      emitStage('add-audio', 'start');
      steps.push('add-audio');
      throwIfCancelled(signal, 'add-audio');
      if (!flags.dryRun) {
        let headingTheme: { h2?: string; h3?: string } | undefined;
        if (flags.preset) {
          headingTheme = await loadHeadingThemeForPreset(
            flags.preset,
            flags.presetsPath ?? DEFAULT_PRESETS_PATH,
          );
        }

        const publishResult = await renderAndPublishAssignmentToS3({
          assignment,
          headingTheme,
          studyTextAudioUrl,
          pronunciationAudioUrl,
          pronunciationAudio: audioArtifacts.pronunciation,
        });
        throwIfCancelled(signal, 'add-audio');
        htmlUrl = publishResult.url;
        htmlHash = publishResult.renderHash;
        htmlKey = publishResult.key;
        htmlEtag = publishResult.etag;
        htmlReused = publishResult.reused;
        emitArtifactReuseMetric(metrics, 'html', undefined, publishResult.reused);
      }
      emitStage('add-audio', 'success', {
        studyTextUrl: studyTextAudioUrl,
        pronunciationUrl: pronunciationAudioUrl,
        publishUrl: htmlUrl,
        publishKey: htmlKey,
        publishHash: htmlHash,
        publishReused: htmlReused,
        dryRun: flags.dryRun,
      });
    }

    const manifest: AssignmentManifest = {
      schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,

      assignmentHash: hashStudyText(serializeAssignmentV1(assignment)),
      publication: {
        schemaVersion: 1 as const,
        rendererVersion: 2 as const,
        title: assignment.metadata.title,
        icon: '🎧',
        studyTextAudioUrl: audioArtifacts.studyText?.url ?? null,
        pronunciationAudioUrl: assignment.pronunciation
          ? (audioArtifacts.pronunciation?.primaryClip?.url ?? null)
          : null,
      },
      mdHash: assignmentHash,
      publishTarget,
      htmlUrl,
      htmlHash,
      htmlKey,
      htmlEtag,
      htmlReused,
      audioArtifacts: {
        studyText: audioArtifacts.studyText,
        pronunciation: audioArtifacts.pronunciation,
      },
      speechPlans: studyTextSpeechPlan ? { studyText: studyTextSpeechPlan } : undefined,
      voicePlans: studyTextVoicePlan ? { studyText: studyTextVoicePlan } : undefined,
      preset: flags.preset,

      // Preserve TTS metadata from previous runs when flags are omitted
      ttsStrategy: flags.ttsStrategy ?? previousManifest?.ttsStrategy,
      dialogueLanguage: flags.dialogueLanguage ?? previousManifest?.dialogueLanguage,
      dialogueStability: flags.dialogueStability ?? previousManifest?.dialogueStability,
      dialogueSeed: flags.dialogueSeed ?? previousManifest?.dialogueSeed,

      timestamp: new Date().toISOString(),
    };

    emitStage('manifest', 'start');
    throwIfCancelled(signal, 'manifest');
    const manifestPath = await manifestStore.writeManifest(flags.md, manifest);
    steps.push('manifest');
    throwIfCancelled(signal, 'manifest');
    emitStage('manifest', 'success', { manifestPath });

    const durationMs = Math.max(Date.now() - pipelineStartedAt, 0);
    logger.log({
      level: 'info',
      message: 'pipeline.newAssignment.success',
      runId,
      stage: 'pipeline',
      detail: { durationMs, steps },
    });
    metrics.timing('esl.pipeline.new_assignment.duration_ms', durationMs, { result: 'success' });
    metrics.increment('esl.pipeline.new_assignment.success', 1, {});

    return {
      htmlUrl,
      publishTarget,
      audio: audioArtifacts.studyText,
      colorized,
      manifestPath,
      steps,
    };
  } catch (error) {
    const durationMs = Math.max(Date.now() - pipelineStartedAt, 0);
    const cancellation = normalizePipelineCancellation(error);
    if (cancellation) {
      logger.log({
        level: 'warn',
        message: 'pipeline.newAssignment.cancelled',
        runId,
        stage: 'pipeline',
        detail: {
          durationMs,
          error: cancellation.message,
          cancelledStage: cancellation.stage,
        },
      });
      metrics.timing('esl.pipeline.new_assignment.duration_ms', durationMs, {
        result: 'cancelled',
      });
      metrics.increment('esl.pipeline.new_assignment.cancelled', 1, {});
      throw cancellation;
    }

    logger.log({
      level: 'error',
      message: 'pipeline.newAssignment.failure',
      runId,
      stage: 'pipeline',
      detail: {
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    metrics.timing('esl.pipeline.new_assignment.duration_ms', durationMs, { result: 'failure' });
    metrics.increment('esl.pipeline.new_assignment.failure', 1, {});
    throw error;
  }
}

export async function getAssignmentStatus(
  mdPath: string,
  dependencies: OrchestratorDependencies = {},
): Promise<AssignmentStatus> {
  const manifestStore = dependencies.manifestStore ?? fallbackManifestStore;
  const logger = dependencies.logger ?? fallbackLogger;
  const metrics = dependencies.metrics ?? fallbackMetrics;
  const runId = dependencies.runId ?? randomUUID();
  const startedAt = Date.now();

  logger.log({
    level: 'info',
    message: 'pipeline.getAssignmentStatus.start',
    runId,
    stage: 'pipeline',
    detail: { md: mdPath },
  });

  try {
    const manifestPath = manifestStore.manifestPathFor(mdPath);
    const manifest = await manifestStore.readManifest(mdPath);

    let currentHash: string | null = null;
    try {
      currentHash = hashStudyText(await readFile(mdPath, 'utf8'));
    } catch {
      currentHash = null;
    }

    let audioFileExists = false;
    const studyAudioPath = manifest?.audioArtifacts?.studyText?.path;
    if (studyAudioPath) {
      try {
        await access(studyAudioPath, FS.F_OK);
        audioFileExists = true;
      } catch {
        audioFileExists = false;
      }
    }

    const mdHashMatches = !!manifest && !!currentHash && manifest.mdHash === currentHash;

    const result = {
      manifestPath,
      manifest,
      mdHashMatches,
      audioFileExists,
    };

    const durationMs = Math.max(Date.now() - startedAt, 0);
    logger.log({
      level: 'info',
      message: 'pipeline.getAssignmentStatus.success',
      runId,
      stage: 'pipeline',
      detail: { durationMs, mdHashMatches, audioFileExists },
    });
    metrics.timing('esl.pipeline.get_assignment_status.duration_ms', durationMs, {
      result: 'success',
    });
    metrics.increment('esl.pipeline.get_assignment_status.success', 1, {});

    return result;
  } catch (error) {
    const durationMs = Math.max(Date.now() - startedAt, 0);
    logger.log({
      level: 'error',
      message: 'pipeline.getAssignmentStatus.failure',
      runId,
      stage: 'pipeline',
      detail: {
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    metrics.timing('esl.pipeline.get_assignment_status.duration_ms', durationMs, {
      result: 'failure',
    });
    metrics.increment('esl.pipeline.get_assignment_status.failure', 1, {});
    throw error;
  }
}

export async function rerunAssignment(
  flags: RerunFlags,
  dependencies: OrchestratorDependencies = {},
): Promise<RerunAssignmentResult> {
  const assignment = requireExecutableAssignment(flags);
  const manifestStore = dependencies.manifestStore ?? fallbackManifestStore;
  const logger = dependencies.logger ?? fallbackLogger;
  const metrics = dependencies.metrics ?? fallbackMetrics;
  const runId = dependencies.runId ?? randomUUID();
  const signal = dependencies.signal;
  const manifestMd = flags.manifestMd?.trim() || flags.md;
  const pipelineStartedAt = Date.now();
  throwIfCancelled(signal, 'tts');
  const { emitStage } = createStageReporter({
    logger,
    metrics,
    runId,
  });

  logger.log({
    level: 'info',
    message: 'pipeline.rerunAssignment.start',
    runId,
    stage: 'pipeline',
    detail: {
      md: flags.md,
      manifestMd,
      requested: {
        republishOnly: flags.republishOnly ?? false,
        regenerateStudyTextAudio: flags.regenerateStudyTextAudio ?? false,
        regeneratePronunciationMainAudio: flags.regeneratePronunciationMainAudio ?? false,
        regeneratePronunciationChunkAudio: flags.regeneratePronunciationChunkAudio ?? false,
      },
    },
  });

  try {
    throwIfCancelled(signal, 'tts');
    const manifest = await manifestStore.readManifest(manifestMd);
    const rerunPlan = computeRerunPlan({
      md: manifestMd,
      republishOnly: flags.republishOnly,
      regenerateStudyTextAudio: flags.regenerateStudyTextAudio,
      regeneratePronunciationMainAudio: flags.regeneratePronunciationMainAudio,
      regeneratePronunciationChunkAudio: flags.regeneratePronunciationChunkAudio,
      manifest,
    });
    if (rerunPlan.errors.length > 0) {
      throw new ValidationError(rerunPlan.errors.join('\n'));
    }
    await applyRerunVoicePreferences(flags);
    throwIfCancelled(signal, 'tts');

    const stepsToRun = new Set(rerunPlan.executable);
    const skipReasonByStage = new Map<RerunTargetStage, string>(
      rerunPlan.skipped.map((item) => [item.stage, item.reason]),
    );
    const executed: string[] = [];

    // Planner guarantees manifest presence when no errors are reported.
    if (!manifest) {
      throw new ValidationError(`No manifest found for ${manifestMd}. Run the pipeline first.`);
    }

    const assignmentContents = serializeAssignmentV1(assignment);
    const executionInput = { assignment };
    const detectedPronunciationMode = assignment.pronunciation?.mode ?? null;
    const audioArtifacts = resolveAudioArtifactsFromManifest(manifest);
    const previousPronunciationAudio = audioArtifacts.pronunciation;
    const previousPrimaryClip = audioArtifacts.pronunciation?.primaryClip;
    const previousChunkClip = audioArtifacts.pronunciation?.itemClips?.[0];
    const effectiveStudyTextTtsStrategy = flags.studyTextTtsStrategy ?? manifest.ttsStrategy;
    const effectiveStudyTextDialogueLanguage =
      flags.studyTextDialogueLanguage ?? manifest.dialogueLanguage;
    const effectiveStudyTextDialogueStability =
      flags.studyTextDialogueStability ?? manifest.dialogueStability;
    const effectiveStudyTextDialogueSeed = flags.studyTextDialogueSeed ?? manifest.dialogueSeed;
    const effectivePreset = flags.preset ?? manifest.preset;
    const studentFacingAudioTitle = assignment.metadata.title;
    const previousPrimaryProvider = normalizePrimaryPronunciationProviderFromManifest(
      previousPrimaryClip?.tts?.provider,
    );
    const previousChunkProvider = normalizePronunciationProviderFromManifest(
      previousChunkClip?.tts?.provider,
    );
    const previousPrimaryModelId = previousPrimaryClip?.tts?.modelId;
    const previousChunkModelId = previousChunkClip?.tts?.modelId;
    let audioPath = audioArtifacts.studyText?.path;
    let audioUrl = audioArtifacts.studyText?.url;
    let audioHash = audioArtifacts.studyText?.hash;
    let audioKey = audioArtifacts.studyText?.key;
    let audioEtag = audioArtifacts.studyText?.etag;
    let audioSizeBytes = audioArtifacts.studyText?.sizeBytes;
    let audioReused = audioArtifacts.studyText?.reused;
    let audioVoices = audioArtifacts.studyText?.voices;
    let audioTts = audioArtifacts.studyText?.tts;
    let studyTextVoicePlan = manifest.voicePlans?.studyText;
    let studyTextVoicePlanHash = audioArtifacts.studyText?.voicePlanHash;
    let studyTextSpeechPlan = manifest.speechPlans?.studyText;
    let studyTextSpeechPlanHash = audioArtifacts.studyText?.speechPlanHash;
    const publishTarget = normalizeManifestPublishTarget(manifest.publishTarget);
    let htmlUrl = manifest.htmlUrl;
    let htmlHash = manifest.htmlHash;
    let htmlKey = manifest.htmlKey;
    let htmlEtag = manifest.htmlEtag;
    let htmlReused = manifest.htmlReused;

    if (stepsToRun.has('tts')) {
      if (flags.regenerateStudyTextAudio) {
        emitStage('voice-plan', 'start');
        throwIfCancelled(signal, 'voice-plan');
        const prepared = await prepareStudyTextSynthesis(
          { ...executionInput, mdPath: flags.md },
          {
            voiceMapPath: flags.voices ?? DEFAULT_VOICES_PATH,
            outPath: flags.out ?? dirname(flags.md),
            defaultAccent: flags.studyTextVoiceAccent,
            defaultVoiceId: flags.studyTextVoiceId,
            ttsProvider: flags.studyTextTtsProvider,
            ttsModel: flags.studyTextTtsModel,
            logger,
            voiceRanker: dependencies.voiceRanker,
            signal,
            deadlineAtMs: dependencies.deadlineAtMs,
          },
        );
        studyTextVoicePlan = prepared.voicePlan;
        studyTextVoicePlanHash = studyTextVoicePlan
          ? hashStudyText(JSON.stringify(studyTextVoicePlan))
          : undefined;
        emitStage('voice-plan', 'success', {
          provider: prepared.selection.provider,
          model: prepared.selection.model,
          assignmentCount: studyTextVoicePlan?.assignments.length ?? 0,
        });

        emitStage('speech-plan', 'start');
        throwIfCancelled(signal, 'speech-plan');
        const resolvedSpeechPlan = await resolveSpeechPerformancePlan({
          prepared,
          planner: dependencies.speechPlanner,
          plannerUnavailableReason: dependencies.speechPlannerUnavailableReason,
          logger,
          debugLogPlan: dependencies.speechPlannerDebugLogPlan,
        });
        studyTextSpeechPlan = resolvedSpeechPlan.plan;
        studyTextSpeechPlanHash = resolvedSpeechPlan.hash;
        throwIfCancelled(signal, 'speech-plan');
        emitStage('speech-plan', 'success', {
          mode: studyTextSpeechPlan.mode,
          provider: studyTextSpeechPlan.provider,
          model: studyTextSpeechPlan.model,
          ...(studyTextSpeechPlan.schemaVersion === 1
            ? { fallbackReason: studyTextSpeechPlan.fallbackReason }
            : {}),
          segmentCount: studyTextSpeechPlan.segments.length,
        });
      } else {
        emitStage('voice-plan', 'skipped', { reason: 'study-text audio not requested' });
        emitStage('speech-plan', 'skipped', { reason: 'study-text audio not requested' });
      }

      emitStage('tts', 'start');
      throwIfCancelled(signal, 'tts');

      // TTS mode debug logging for rerun
      if (flags.studyTextTtsStrategy) {
        logger.log({
          level: 'info',
          message: `Using TTS strategy: ${flags.studyTextTtsStrategy}`,
          detail: {
            ttsStrategy: effectiveStudyTextTtsStrategy,
            dialogueLanguage: effectiveStudyTextDialogueLanguage,
            dialogueStability: effectiveStudyTextDialogueStability,
            dialogueSeed: effectiveStudyTextDialogueSeed,
          },
        });
      }

      let ttsResult: Awaited<ReturnType<typeof buildStudyTextMp3>> | null = null;
      if (flags.regenerateStudyTextAudio) {
        try {
          ttsResult = await buildStudyTextMp3(
            {
              ...executionInput,
              mdPath: flags.md,
            },
            {
              voiceMapPath: flags.voices ?? DEFAULT_VOICES_PATH,
              outPath: flags.out ?? dirname(flags.md),
              preview: flags.dryRun,
              force: true,
              defaultAccent: flags.studyTextVoiceAccent,
              defaultVoiceId: flags.studyTextVoiceId,
              ttsProvider: flags.studyTextTtsProvider,
              ttsModel: flags.studyTextTtsModel,
              ttsStrategy: effectiveStudyTextTtsStrategy,
              dialogueLanguage: effectiveStudyTextDialogueLanguage,
              dialogueStability: effectiveStudyTextDialogueStability,
              dialogueSeed: effectiveStudyTextDialogueSeed,
              logger,
              voicePlan: studyTextVoicePlan,
              speechPlan: studyTextSpeechPlan,
              signal,
              deadlineAtMs: dependencies.deadlineAtMs,
            },
          );
          throwIfCancelled(signal, 'tts');
        } catch (error: unknown) {
          const category = categorizeProviderErrorFromMessage(error);
          if (category) {
            metrics.increment('esl.voice_alignment.provider_error', 1, { category });
          }
          if (error instanceof FfmpegNotFoundError) {
            throw new Error(`TTS requires FFmpeg.\n\n${error.message}`, { cause: error });
          }

          if (error instanceof Error) {
            if (
              error.message.includes('voice mapping') &&
              flags.studyTextTtsStrategy === 'dialogue'
            ) {
              throw new Error(
                `Dialogue mode requires voice mappings for all speakers. ` +
                  `Check your voices.yml file. ${error.message}`,
              );
            }
            if (
              error.message.includes('text-to-dialogue') &&
              flags.studyTextTtsStrategy === 'dialogue'
            ) {
              throw new Error(
                `Dialogue mode failed: ${error.message}\n` +
                  'Try switching the study-text TTS strategy to standard TTS.',
              );
            }
          }
          throw error;
        }

        audioPath = ttsResult.path;
        audioHash = ttsResult.hash;
        audioUrl = undefined;
        audioKey = undefined;
        audioEtag = undefined;
        audioSizeBytes = undefined;
        audioReused = undefined;
        audioVoices = ttsResult.voices;
        audioTts = buildTtsSpendSummary(ttsResult);
        audioArtifacts.studyText = {
          path: audioPath,
          url: audioUrl,
          hash: audioHash,
          key: audioKey,
          etag: audioEtag,
          sizeBytes: audioSizeBytes,
          reused: audioReused,
          voices: audioVoices,
          tts: audioTts,
          voicePlanHash: studyTextVoicePlanHash,
          speechPlanHash: studyTextSpeechPlanHash,
        };
        emitVoiceSelectionMetrics(metrics, ttsResult.voices);

        if (ttsResult.generatedCharacters !== undefined && ttsResult.generatedCharacters > 0) {
          metrics.increment('esl.tts.provider_characters', ttsResult.generatedCharacters, {
            type: 'generated',
          });
        }
        if (ttsResult.cachedCharacters !== undefined && ttsResult.cachedCharacters > 0) {
          metrics.increment('esl.tts.provider_characters', ttsResult.cachedCharacters, {
            type: 'cached',
          });
        }
      }

      if (flags.regeneratePronunciationMainAudio || flags.regeneratePronunciationChunkAudio) {
        const narratorVoiceId = ttsResult?.voiceAssignments?.Narrator;
        const fallbackVoiceCandidates = [
          { voiceId: narratorVoiceId, provider: ttsResult?.provider },
          { voiceId: ttsResult?.voices[0]?.voiceId, provider: ttsResult?.provider },
          {
            voiceId: audioArtifacts.studyText?.voices?.[0]?.voiceId,
            provider: audioArtifacts.studyText?.tts?.provider,
          },
          {
            voiceId: audioArtifacts.pronunciation?.primaryClip?.voiceId,
            provider: audioArtifacts.pronunciation?.primaryClip?.tts?.provider,
          },
        ];
        const pronunciationTitle = assignment.metadata.title;
        const effectivePrimaryProvider =
          flags.pronunciationMainTtsProvider ?? previousPrimaryProvider;
        const effectiveChunkProvider =
          flags.pronunciationChunkTtsProvider ??
          previousChunkProvider ??
          resolveDefaultChunkProvider(detectedPronunciationMode);
        const rerunTtsWarnings: RerunTtsWarning[] = [];
        const resolvedPrimaryVoiceId = resolveProviderCompatibleVoiceId({
          explicitVoiceId: flags.pronunciationMainVoiceId,
          effectiveProvider: effectivePrimaryProvider,
          previousVoiceId: previousPrimaryClip?.voiceId,
          previousProvider: previousPrimaryProvider,
          fallbackCandidates: fallbackVoiceCandidates,
        });
        const resolvedChunkVoiceId = resolveProviderCompatibleVoiceId({
          explicitVoiceId: flags.pronunciationChunkVoiceId,
          effectiveProvider: effectiveChunkProvider,
          previousVoiceId: previousChunkClip?.voiceId,
          previousProvider:
            previousChunkProvider === 'elevenlabs' || previousChunkProvider === 'google'
              ? previousChunkProvider
              : undefined,
          fallbackCandidates: fallbackVoiceCandidates,
        });

        if (
          flags.regeneratePronunciationMainAudio &&
          previousPrimaryClip?.voiceId &&
          !previousPrimaryProvider &&
          flags.pronunciationMainVoiceId === undefined
        ) {
          pushRerunTtsWarning(rerunTtsWarnings, logger, {
            code: 'rerun_pronunciation_main_unknown_previous_provider',
            message:
              'Pronunciation main rerun could not confirm the previous clip provider; using provider-scoped fallback resolution instead.',
          });
        }
        if (
          flags.regeneratePronunciationChunkAudio &&
          previousChunkClip?.voiceId &&
          !previousChunkProvider &&
          flags.pronunciationChunkVoiceId === undefined
        ) {
          pushRerunTtsWarning(rerunTtsWarnings, logger, {
            code: 'rerun_pronunciation_chunk_unknown_previous_provider',
            message:
              'Pronunciation chunk rerun could not confirm the previous clip provider; using provider-scoped fallback resolution instead.',
          });
        }
        if (
          flags.regeneratePronunciationMainAudio &&
          effectivePrimaryProvider !== undefined &&
          resolvedPrimaryVoiceId === undefined
        ) {
          pushRerunTtsWarning(
            rerunTtsWarnings,
            logger,
            {
              code: 'rerun_pronunciation_main_voice_unresolved',
              message:
                'Pronunciation main rerun could not resolve a provider-compatible voice and may produce no regenerated primary clip.',
            },
            { provider: effectivePrimaryProvider },
          );
        }
        if (
          flags.regeneratePronunciationChunkAudio &&
          effectiveChunkProvider !== null &&
          resolvedChunkVoiceId === undefined
        ) {
          pushRerunTtsWarning(
            rerunTtsWarnings,
            logger,
            {
              code: 'rerun_pronunciation_chunk_voice_unresolved',
              message:
                'Pronunciation chunk rerun could not resolve a provider-compatible voice and may produce no regenerated chunk clips.',
            },
            { provider: effectiveChunkProvider },
          );
        }
        const generatedPronunciation = await synthesizePronunciationAudio({
          ...executionInput,
          mdPath: flags.md,
          outPath: flags.out ?? dirname(flags.md),
          title: pronunciationTitle,
          preview: flags.dryRun,
          force: true,
          regeneratePrimary: flags.regeneratePronunciationMainAudio,
          regenerateItems: flags.regeneratePronunciationChunkAudio,
          primaryTtsProvider: effectivePrimaryProvider,
          primaryTtsModel:
            flags.pronunciationMainTtsModel ??
            resolvePronunciationTtsModelFromManifest({
              provider: previousPrimaryProvider,
              modelId: previousPrimaryModelId,
            }),
          primaryVoiceId: resolvedPrimaryVoiceId,
          chunkTtsProvider: effectiveChunkProvider,
          chunkTtsModel:
            flags.pronunciationChunkTtsModel ??
            resolvePronunciationTtsModelFromManifest({
              provider:
                previousChunkProvider === 'elevenlabs' ||
                previousChunkProvider === 'google' ||
                previousChunkProvider === 'inworld'
                  ? previousChunkProvider
                  : undefined,
              modelId: previousChunkModelId,
            }),
          chunkVoiceId: resolvedChunkVoiceId,
          previousAudio: previousPronunciationAudio,
          logger,
          signal,
          deadlineAtMs: dependencies.deadlineAtMs,
        });
        audioArtifacts.pronunciation = generatedPronunciation
          ? {
              ...(audioArtifacts.pronunciation ?? { mode: generatedPronunciation.mode }),
              mode: generatedPronunciation.mode,
              primaryClip: flags.regeneratePronunciationMainAudio
                ? (generatedPronunciation.primaryClip ?? undefined)
                : audioArtifacts.pronunciation?.primaryClip,
              itemClips: flags.regeneratePronunciationChunkAudio
                ? generatedPronunciation.itemClips
                : audioArtifacts.pronunciation?.itemClips,
              warnings: generatedPronunciation.warnings,
            }
          : audioArtifacts.pronunciation;
        emitPronunciationProviderCharacterMetrics(metrics, generatedPronunciation);
        if (rerunTtsWarnings.length > 0) {
          const existingWarnings = audioArtifacts.pronunciation?.warnings ?? [];
          audioArtifacts.pronunciation = audioArtifacts.pronunciation
            ? {
                ...audioArtifacts.pronunciation,
                warnings: [...existingWarnings, ...rerunTtsWarnings],
              }
            : audioArtifacts.pronunciation;
        }
      }

      emitStage('tts', 'success', {
        preview: flags.dryRun,
        detectedPronunciationMode,
        regeneratedStudyTextAudio: flags.regenerateStudyTextAudio ?? false,
        regeneratedPronunciationMainAudio: flags.regeneratePronunciationMainAudio ?? false,
        regeneratedPronunciationChunkAudio: flags.regeneratePronunciationChunkAudio ?? false,
        voices: ttsResult?.voices,
        generatedCharacters: ttsResult?.generatedCharacters,
        cachedCharacters: ttsResult?.cachedCharacters,
        ttsProvider: audioTts?.provider,
        estimatedSpendUsd: audioTts?.estimatedSpendUsd,
        rerunWarnings: audioArtifacts.pronunciation?.warnings,
      });
      executed.push('tts');
    } else {
      emitStage('voice-plan', 'skipped', {
        reason: 'study-text audio not requested',
      });
      emitStage('speech-plan', 'skipped', {
        reason: flags.republishOnly ? 'republish-only rerun' : 'not requested',
      });
      emitStage('tts', 'skipped', { reason: skipReasonByStage.get('tts') ?? 'not requested' });
    }

    if (stepsToRun.has('upload')) {
      emitStage('upload', 'start');
      throwIfCancelled(signal, 'upload');
      const rerunArtifactEntries: {
        kind: AudioArtifactKind;
        artifact: AudioArtifact | undefined;
        regenerated: boolean;
      }[] = [
        {
          kind: 'study_text',
          artifact: audioArtifacts.studyText,
          regenerated: flags.regenerateStudyTextAudio === true,
        },
        {
          kind: 'pronunciation_primary',
          artifact: audioArtifacts.pronunciation?.primaryClip ?? undefined,
          regenerated:
            flags.regeneratePronunciationMainAudio === true &&
            wasPronunciationClipRegenerated(
              audioArtifacts.pronunciation?.primaryClip ?? undefined,
              previousPronunciationAudio,
            ),
        },
        ...(audioArtifacts.pronunciation?.itemClips ?? []).map((artifact) => ({
          kind: 'pronunciation_item' as const,
          artifact,
          regenerated:
            flags.regeneratePronunciationChunkAudio === true &&
            wasPronunciationClipRegenerated(artifact, previousPronunciationAudio),
        })),
      ];
      const uploadable = rerunArtifactEntries.filter((entry) => {
        const artifact = entry.artifact;
        if (!artifact?.path) {
          return false;
        }

        return entry.regenerated || !artifact.url;
      });
      if (uploadable.length === 0) {
        throw new Error(
          'Cannot upload audio: no audio path found. Re-run TTS or provide a manifest with audio.path.',
        );
      }

      if (flags.upload !== 's3') {
        throw new Error('Only S3 uploads are supported in rerun mode. Pass --upload s3.');
      }

      const bucket = process.env.S3_BUCKET ?? 'stub-bucket';
      const keyPrefix = flags.prefix ?? process.env.S3_PREFIX ?? '';
      for (const entry of uploadable) {
        const artifact = entry.artifact;
        if (!artifact?.path) continue;
        const deterministicKey = artifact.hash
          ? resolveAudioArtifactKey(artifact.hash, keyPrefix, entry.kind, studentFacingAudioTitle)
          : undefined;
        if (flags.dryRun) {
          if (deterministicKey) {
            artifact.url = deriveS3GlobalUrl(bucket, deterministicKey);
            artifact.key = deterministicKey;
          } else {
            const preview = deriveS3UploadAddress({
              bucket,
              keyPrefix,
              filePath: artifact.path,
              urlStyle: 'global',
            });
            artifact.url = preview.url;
            artifact.key = preview.key;
          }
          artifact.reused = false;
        } else {
          const upload = await uploadFile(artifact.path, {
            backend: 's3',
            key: deterministicKey,
            sha256: artifact.hash,
            // Regenerated artifacts must overwrite the published object even if the
            // semantic artifact hash/key is unchanged. Unchecked artifacts keep reuse semantics.
            skipIfExists: entry.regenerated ? false : true,
            prefix: flags.prefix,
            public: flags.publicRead,
            presignExpiresIn: flags.presign,
            logger,
            mp3Metadata: resolveStudentFacingAudioMetadata(studentFacingAudioTitle, entry.kind),
          });
          artifact.url = upload.url;
          artifact.key = upload.key;
          artifact.etag = upload.etag;
          artifact.sizeBytes = upload.sizeBytes;
          artifact.reused = upload.reused;
          emitArtifactReuseMetric(metrics, 'audio', entry.kind, upload.reused);
        }
      }
      audioPath = audioArtifacts.studyText?.path;
      audioUrl = audioArtifacts.studyText?.url;
      audioHash = audioArtifacts.studyText?.hash;
      audioKey = audioArtifacts.studyText?.key;
      audioEtag = audioArtifacts.studyText?.etag;
      audioSizeBytes = audioArtifacts.studyText?.sizeBytes;
      audioReused = audioArtifacts.studyText?.reused;
      audioVoices = audioArtifacts.studyText?.voices;
      audioTts = audioArtifacts.studyText?.tts;
      throwIfCancelled(signal, 'upload');

      emitStage('upload', 'success', {
        studyTextUrl: audioArtifacts.studyText?.url,
        pronunciationUrl: audioArtifacts.pronunciation?.primaryClip?.url,
        dryRun: flags.dryRun,
      });
      executed.push('upload');
    } else {
      emitStage('upload', 'skipped', {
        reason: skipReasonByStage.get('upload') ?? 'not requested',
      });
    }

    if (stepsToRun.has('add-audio')) {
      emitStage('add-audio', 'start');
      throwIfCancelled(signal, 'add-audio');
      const studyTextAudioUrl = audioArtifacts.studyText?.url;
      const pronunciationAudioUrl = audioArtifacts.pronunciation?.primaryClip?.url;
      if (!flags.dryRun) {
        let headingTheme: { h2?: string; h3?: string } | undefined;
        if (effectivePreset) {
          headingTheme = await loadHeadingThemeForPreset(effectivePreset, DEFAULT_PRESETS_PATH);
        }

        const publishResult = await renderAndPublishAssignmentToS3({
          assignment,
          headingTheme,
          studyTextAudioUrl,
          pronunciationAudioUrl,
          pronunciationAudio: audioArtifacts.pronunciation,
        });
        throwIfCancelled(signal, 'add-audio');
        htmlUrl = publishResult.url;
        htmlHash = publishResult.renderHash;
        htmlKey = publishResult.key;
        htmlEtag = publishResult.etag;
        htmlReused = publishResult.reused;
        emitArtifactReuseMetric(metrics, 'html', undefined, publishResult.reused);
      }
      emitStage('add-audio', 'success', {
        studyTextUrl: studyTextAudioUrl,
        pronunciationUrl: pronunciationAudioUrl,
        publishUrl: htmlUrl,
        publishKey: htmlKey,
        publishHash: htmlHash,
        publishReused: htmlReused,
        dryRun: flags.dryRun,
      });

      executed.push('add-audio');
    } else {
      emitStage('add-audio', 'skipped', {
        reason: skipReasonByStage.get('add-audio') ?? 'not requested',
      });
    }

    const { audio: _legacyAudio, ...manifestWithoutLegacyAudio } =
      manifest as AssignmentManifest & {
        audio?: unknown;
      };
    const updatedManifest: AssignmentManifest = {
      ...manifestWithoutLegacyAudio,
      schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,

      assignmentHash: hashStudyText(serializeAssignmentV1(assignment)),
      publication: {
        schemaVersion: 1 as const,
        rendererVersion: 2 as const,
        title: assignment.metadata.title,
        icon: '🎧',
        studyTextAudioUrl: audioArtifacts.studyText?.url ?? null,
        pronunciationAudioUrl: assignment.pronunciation
          ? (audioArtifacts.pronunciation?.primaryClip?.url ?? null)
          : null,
      },
      mdHash: hashStudyText(assignmentContents),
      publishTarget,
      htmlUrl,
      htmlHash,
      htmlKey,
      htmlEtag,
      htmlReused,
      preset: effectivePreset ?? manifest.preset,
      audioArtifacts: {
        studyText: audioArtifacts.studyText,
        pronunciation: audioArtifacts.pronunciation,
      },
      speechPlans: studyTextSpeechPlan ? { studyText: studyTextSpeechPlan } : undefined,
      voicePlans: studyTextVoicePlan ? { studyText: studyTextVoicePlan } : undefined,

      // Preserve prior TTS metadata unless explicitly overridden
      ttsStrategy: effectiveStudyTextTtsStrategy,
      dialogueLanguage: effectiveStudyTextDialogueLanguage,
      dialogueStability: effectiveStudyTextDialogueStability,
      dialogueSeed: effectiveStudyTextDialogueSeed,

      timestamp: new Date().toISOString(),
    };

    emitStage('manifest', 'start');
    throwIfCancelled(signal, 'manifest');
    const manifestPath = await manifestStore.writeManifest(manifestMd, updatedManifest);
    throwIfCancelled(signal, 'manifest');
    emitStage('manifest', 'success', { manifestPath });

    const durationMs = Math.max(Date.now() - pipelineStartedAt, 0);
    logger.log({
      level: 'info',
      message: 'pipeline.rerunAssignment.success',
      runId,
      stage: 'pipeline',
      detail: { durationMs, steps: executed },
    });
    metrics.timing('esl.pipeline.rerun.duration_ms', durationMs, { result: 'success' });
    metrics.increment('esl.pipeline.rerun.success', 1, {});

    return {
      steps: executed,
      audio: updatedManifest.audioArtifacts?.studyText,
      htmlUrl: updatedManifest.htmlUrl,
      publishTarget: updatedManifest.publishTarget,
      manifestPath,
    };
  } catch (error) {
    const durationMs = Math.max(Date.now() - pipelineStartedAt, 0);
    const cancellation = normalizePipelineCancellation(error);
    if (cancellation) {
      logger.log({
        level: 'warn',
        message: 'pipeline.rerunAssignment.cancelled',
        runId,
        stage: 'pipeline',
        detail: {
          durationMs,
          error: cancellation.message,
          cancelledStage: cancellation.stage,
        },
      });
      metrics.timing('esl.pipeline.rerun.duration_ms', durationMs, {
        result: 'cancelled',
      });
      metrics.increment('esl.pipeline.rerun.cancelled', 1, {});
      throw cancellation;
    }

    logger.log({
      level: 'error',
      message: 'pipeline.rerunAssignment.failure',
      runId,
      stage: 'pipeline',
      detail: {
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    metrics.timing('esl.pipeline.rerun.duration_ms', durationMs, { result: 'failure' });
    metrics.increment('esl.pipeline.rerun.failure', 1, {});
    throw error;
  }
}
