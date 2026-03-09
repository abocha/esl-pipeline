import { randomUUID } from 'node:crypto';
import { constants as FS } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { createAnytypeClient, sharePageToS3 } from '@esl-pipeline/anytype-adapter';
import {
  FfmpegNotFoundError,
  InfrastructureError,
  ManifestError,
  ValidationError,
} from '@esl-pipeline/contracts';
import { renderAndPublishMarkdownToS3 } from '@esl-pipeline/html-publisher';
import { validateMarkdown } from '@esl-pipeline/md-validator';
import {
  addOrReplaceAudio,
  applyHeadingPreset,
  hashColorPreset,
  loadPreset,
  runImport,
} from '@esl-pipeline/notion-adapter';
import { extractPronunciationShadowFocus, parseMarkdownContext } from '@esl-pipeline/pmd';
import {
  deriveS3UploadAddress,
  uploadFile,
} from '@esl-pipeline/storage-uploader';
import {
  buildPronunciationShadowSentenceMp3,
  type BuildStudyTextResult,
  buildStudyTextMp3,
  hashStudyText,
} from '@esl-pipeline/tts-core';

import {
  createProgressCallbacksFromV2Context,
  failureResultV2,
  successResultV2,
  type GetAssignmentStatusOperationResultV2,
  type NewAssignmentOperationResultV2,
  type PlanRerunAssignmentOperationResultV2,
  type RerunAssignmentOperationResultV2,
} from './api-v2.js';
import { DEFAULT_PRESETS_PATH, DEFAULT_VOICES_PATH } from './config.js';
import {
  type AssignmentManifest,
  CURRENT_MANIFEST_SCHEMA_VERSION,
  createFilesystemManifestStore,
} from './manifest.js';
import { type PipelineLogger, noopLogger, noopMetrics } from './observability.js';
import { computeRerunPlan } from './rerun-planner.js';
import {
  type AudioArtifact,
  type AudioArtifactKind,
  deriveS3GlobalUrl,
  emitArtifactReuseMetric,
  resolveAudioArtifactKey,
  resolveAudioArtifactsFromManifest,
} from './runtime/audio-artifacts.js';
import { readMarkdownCached } from './runtime/markdown-cache.js';
import {
  insertGeneratedAudioLinks,
  resolveHeadingTheme,
  resolveMarkdownTitle,
} from './runtime/publish-utils.js';
import {
  addAnytypePageToCollection,
  resolveAnytypeObjectId,
  resolveAnytypeSpaceId,
} from './runtime/publish-target-anytype.js';
import { createStageReporter } from './runtime/stage-reporter.js';
import {
  buildTtsSpendSummary,
  categorizeProviderErrorFromMessage,
  emitVoiceSelectionMetrics,
  summarizeVoiceSelections,
} from './runtime/tts-telemetry.js';
import { applyVoicePreferences } from './runtime/voice-preferences.js';
import type {
  AssignmentProgressCallbacks,
  GetAssignmentStatusRequestV2,
  AssignmentStage,
  AssignmentStatus,
  NewAssignmentFlags,
  NewAssignmentRequestV2,
  NewAssignmentResult,
  OrchestratorDependencies,
  OrchestratorOperation,
  OrchestratorV2ExecutionContext,
  RerunAssignmentRequestV2,
  RerunAssignmentResult,
  RerunPlanRequestV2,
  RerunPlanRequest,
  RerunPlanResult,
  RerunTargetStage,
  RerunFlags,
} from './types.js';
import { ensureTtsProvidersRegistered } from './tts-provider-registry.js';

export type {
  AssignmentStage,
  AssignmentStageStatus,
  AssignmentProgressEvent,
  AssignmentProgressCallbacks,
  AssignmentStageEventV2,
  RerunPlanRequest,
  RerunPlanRequestV2,
  RerunPlanResult,
  RerunTargetStage,
  OrchestratorDependencies,
  OrchestratorApiResultV2,
  OrchestratorErrorCategory,
  OrchestratorErrorV2,
  OrchestratorOperation,
  OrchestratorV2ExecutionContext,
  NewAssignmentFlags,
  NewAssignmentRequest,
  NewAssignmentRequestV2,
  NewAssignmentResult,
  AssignmentStatus,
  GetAssignmentStatusRequestV2,
  RerunFlags,
  RerunAssignmentRequest,
  RerunAssignmentRequestV2,
  RerunAssignmentResult,
  PublishTarget,
} from './types.js';

const fallbackManifestStore = createFilesystemManifestStore();
const fallbackLogger = noopLogger;
const fallbackMetrics = noopMetrics;

ensureTtsProvidersRegistered();

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

function throwIfCancelled(signal: AbortSignal | undefined, stage: AssignmentStage): void {
  if (!signal?.aborted) return;
  throw new PipelineCancelledError(stage, signal.reason);
}

export {
  manifestPathFor,
  readManifest,
  writeManifest,
  createFilesystemManifestStore,
} from './manifest.js';
export { createFilesystemConfigProvider } from './config.js';
export type { StudentProfile } from './config.js';
export { S3ManifestStore, type S3ManifestStoreOptions } from './adapters/manifest/s3.js';
export {
  RemoteConfigProvider,
  type RemoteConfigProviderOptions,
} from './adapters/config/remote.js';
export type { AssignmentManifest, ManifestStore } from './manifest.js';
export type { ConfigProvider } from './config.js';
export { noopLogger, noopMetrics } from './observability.js';
export type {
  PipelineLogger,
  PipelineMetrics,
  PipelineLogEvent,
  PipelineLogLevel,
} from './observability.js';
export {
  createPipeline,
  resolveConfigPaths,
  loadEnvFiles,
  loadEnvFilesWithSummary,
  resolveManifestPath,
} from './pipeline.js';
export type {
  CreatePipelineOptions,
  OrchestratorPipeline,
  ResolvedConfigPaths,
  PipelineNewAssignmentOptions,
  PipelineRerunOptions,
  LoadEnvOptions,
  LoadEnvSummary,
} from './pipeline.js';
export {
  categorizeOrchestratorError,
  toStageEventV2,
  type GetAssignmentStatusOperationResultV2,
  type NewAssignmentOperationResultV2,
  type PlanRerunAssignmentOperationResultV2,
  type RerunAssignmentOperationResultV2,
} from './api-v2.js';
export {
  resolveJobOptions,
  type JobOptionsPayload,
  type VoiceOption as JobVoiceOption,
  type NotionDatabaseOption as JobNotionDatabaseOption,
} from './metadata/job-options.js';
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
    const data = await newAssignment(
      request.assignment,
      callbacks,
      context.dependencies ?? {},
    );
    return successResultV2(operation, data);
  } catch (error) {
    return failureResultV2<NewAssignmentResult>(operation, error);
  }
}

export async function executeRerunAssignmentV2(
  request: RerunAssignmentRequestV2,
  context: OrchestratorV2ExecutionContext = {},
): Promise<RerunAssignmentOperationResultV2> {
  const operation: OrchestratorOperation = 'rerun_assignment';
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
  const operation: OrchestratorOperation = 'plan_rerun_assignment';
  try {
    const data = await planRerunAssignment(request.rerunPlan, context.dependencies ?? {});
    return successResultV2(operation, data);
  } catch (error) {
    return failureResultV2<RerunPlanResult>(operation, error);
  }
}

export async function newAssignment(
  flags: NewAssignmentFlags,
  callbacks: AssignmentProgressCallbacks = {},
  dependencies: OrchestratorDependencies = {},
): Promise<NewAssignmentResult> {
  const manifestStore = dependencies.manifestStore ?? fallbackManifestStore;
  const logger = dependencies.logger ?? fallbackLogger;
  const metrics = dependencies.metrics ?? fallbackMetrics;
  const runId = dependencies.runId ?? randomUUID();
  const signal = dependencies.signal;
  const pipelineStartedAt = Date.now();
  throwIfCancelled(signal, 'validate');
  await applyVoicePreferences(flags);
  throwIfCancelled(signal, 'validate');
  const { emitStage, recordSkip } = createStageReporter({
    callbacks,
    logger,
    metrics,
    runId,
  });

  const steps: string[] = [];
  const mdContents = await readMarkdownCached(flags.md);
  const markdownHash = hashStudyText(mdContents);
  const previousManifest = await manifestStore.readManifest(flags.md);
  let notionColorization = previousManifest?.notionColorization;

  const publishTarget = flags.publishTarget ?? previousManifest?.publishTarget ?? 'notion';
  let pageId = previousManifest?.pageId;
  let pageUrl = previousManifest?.pageUrl;
  let anytypePageId = previousManifest?.anytypePageId;
  let anytypeSpaceId = flags.anytypeSpaceId ?? previousManifest?.anytypeSpaceId;
  let anytypeUrl = previousManifest?.anytypeUrl;
  let htmlUrl = previousManifest?.htmlUrl;
  let htmlHash = previousManifest?.htmlHash;
  let htmlKey = previousManifest?.htmlKey;
  let htmlEtag = previousManifest?.htmlEtag;
  let htmlReused = previousManifest?.htmlReused;

  let colorized = false;

  if (publishTarget === 'anytype') {
    pageId = undefined;
    pageUrl = undefined;
  } else if (publishTarget === 'notion') {
    anytypePageId = undefined;
    anytypeSpaceId = undefined;
    anytypeUrl = undefined;
    htmlUrl = undefined;
    htmlHash = undefined;
    htmlKey = undefined;
    htmlEtag = undefined;
    htmlReused = undefined;
  } else {
    pageId = undefined;
    pageUrl = undefined;
    anytypePageId = undefined;
    anytypeSpaceId = undefined;
    anytypeUrl = undefined;
  }

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
    const markdownContext = parseMarkdownContext(mdContents);
    const validation = await validateMarkdown({
      context: markdownContext,
      path: flags.md,
      strict: false,
      learningPresetId: flags.learningPresetId,
      preset: flags.preset,
    });
    throwIfCancelled(signal, 'validate');
    if (!validation.ok) {
      const msg = ['Validation failed:', ...validation.errors.map((e) => `- ${e}`)].join('\n');
      throw new ValidationError(msg);
    }
    if (validation.warnings.length > 0) {
      logger.log({
        level: 'warn',
        message: 'validation.warnings',
        runId,
        stage: 'validate',
        detail: { warnings: validation.warnings },
      });
    }
    emitStage('validate', 'success');

    if (flags.skipImport) {
      recordSkip('import', 'skip-import flag set');
      steps.push('skip:import');
      if (publishTarget === 'notion' && !pageId && !flags.dryRun) {
        throw new ValidationError(
          'Cannot skip import because no existing Notion pageId was found. Run a full pipeline first.',
        );
      }
      if (publishTarget === 'anytype' && !anytypePageId && !flags.dryRun) {
        throw new ValidationError(
          'Cannot skip import because no existing Anytype pageId was found. Run a full pipeline first.',
        );
      }
    } else {
      emitStage('import', 'start');
      steps.push('import');
      if (publishTarget === 'notion') {
        throwIfCancelled(signal, 'import');
        const importResult = await runImport({
          context: markdownContext,
          mdPath: flags.md,
          dbId: flags.dbId,
          dbName: flags.db,
          dataSourceId: flags.dataSourceId,
          dataSourceName: flags.dataSource,
          student: flags.student,
          dryRun: flags.dryRun,
          validationResult: validation,
          strictValidation: false,
          logger,
        });
        throwIfCancelled(signal, 'import');
        pageId = importResult.page_id;
        pageUrl = importResult.url;
        emitStage('import', 'success', {
          pageUrl,
          studentLinked: importResult.studentLinked ?? undefined,
        });
      } else if (publishTarget === 'anytype') {
        throwIfCancelled(signal, 'import');
        const client = createAnytypeClient();
        const spaceId = await resolveAnytypeSpaceId(client, anytypeSpaceId);
        throwIfCancelled(signal, 'import');
        anytypeSpaceId = spaceId;

        const title = resolveMarkdownTitle(
          mdContents,
          basename(flags.md).replace(/\.[^.]+$/, ''),
          validation.meta?.title ?? null,
        );

        if (anytypePageId) {
          await client.updateObject(spaceId, anytypePageId, {
            name: title,
            body: mdContents,
          });
        } else {
          const created = await client.createObject(spaceId, {
            name: title,
            type_key: 'page',
            body: mdContents,
          });
          anytypePageId = resolveAnytypeObjectId(created);
          if (!anytypePageId) {
            throw new ValidationError(
              'Anytype createObject did not return an object id. Cannot continue.',
            );
          }
        }

        if (anytypePageId) {
          await addAnytypePageToCollection(client, spaceId, anytypePageId, logger, runId);
        }
        throwIfCancelled(signal, 'import');

        emitStage('import', 'success', {
          pageId: anytypePageId,
          spaceId: anytypeSpaceId,
        });
      } else {
        emitStage('import', 'success', { publishTarget: 'html', remoteImport: false });
      }
    }

    if (flags.preset) {
      if (publishTarget !== 'notion') {
        recordSkip('colorize', `${publishTarget} uses static HTML theming`);
      } else if (flags.dryRun) {
        emitStage('colorize', 'start');
        steps.push(`colorize:${flags.preset}:0/0/0`);
        emitStage('colorize', 'success', {
          preset: flags.preset,
          dryRun: true,
          counts: { h2: 0, h3: 0, toggles: 0 },
        });
        colorized = true;
      } else {
        if (!pageId) {
          throw new ValidationError(
            'Cannot apply color preset because no Notion pageId is available. Run import first.',
          );
        }
        const presetHash = hashColorPreset(
          await loadPreset(flags.preset, flags.presetsPath ?? DEFAULT_PRESETS_PATH),
        );
        const canSkipColorize =
          !flags.force &&
          notionColorization?.preset === flags.preset &&
          notionColorization.presetHash === presetHash &&
          notionColorization.pageId === pageId &&
          notionColorization.mdHash === markdownHash;

        if (canSkipColorize) {
          recordSkip('colorize', 'preset hash unchanged for current page/content');
        } else {
          emitStage('colorize', 'start');
          steps.push('colorize');
          throwIfCancelled(signal, 'colorize');
          const color = await applyHeadingPreset(
            pageId,
            flags.preset,
            flags.presetsPath ?? DEFAULT_PRESETS_PATH,
          );
          throwIfCancelled(signal, 'colorize');
          steps.push(
            `colorize:${flags.preset}:${color.counts.h2}/${color.counts.h3}/${color.counts.toggles}`,
          );
          emitStage('colorize', 'success', {
            preset: flags.preset,
            counts: color.counts,
          });
          colorized = true;
          notionColorization = {
            preset: flags.preset,
            presetHash,
            pageId,
            mdHash: markdownHash,
            appliedAt: new Date().toISOString(),
          };
        }
      }
    } else {
      recordSkip('colorize', 'no preset selected');
    }

    const shadowFocus = extractPronunciationShadowFocus(markdownContext);
    let audioArtifacts = resolveAudioArtifactsFromManifest(previousManifest);
    if (flags.withTts) {
      if (flags.skipTts) {
        recordSkip('tts', 'skip-tts flag set');
        steps.push('skip:tts');
        if (!audioArtifacts.studyText?.path && !flags.dryRun) {
          throw new ManifestError(
            'Cannot skip TTS because manifest has no audio.path. Run TTS at least once first.',
          );
        }
      } else {
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
              context: markdownContext,
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
              googleTtsModel: flags.googleTtsModel,

              // Pass TTS strategy options to TTS package
              ttsStrategy: flags.ttsStrategy,
              dialogueLanguage: flags.dialogueLanguage,
              dialogueStability: flags.dialogueStability,
              dialogueSeed: flags.dialogueSeed,
              logger,
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
        };
        emitVoiceSelectionMetrics(metrics, ttsResult.voices);
        const voiceSummary = summarizeVoiceSelections(ttsResult.voices);

        if (ttsResult.generatedCharacters !== undefined && ttsResult.generatedCharacters > 0) {
          metrics.increment('esl.tts.provider_characters', ttsResult.generatedCharacters, { type: 'generated' });
        }
        if (ttsResult.cachedCharacters !== undefined && ttsResult.cachedCharacters > 0) {
          metrics.increment('esl.tts.provider_characters', ttsResult.cachedCharacters, { type: 'cached' });
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
              `Check that :::study-text has lines and voices.yml has 'default' or 'auto: true'.`,
            );
          });
        }

        if (shadowFocus?.shadowSentence?.trim()) {
          const narratorVoiceId = ttsResult.voiceAssignments?.Narrator;
          const fallbackVoiceId = narratorVoiceId ?? ttsResult.voices[0]?.voiceId;
          if (fallbackVoiceId) {
            const shadowResult = await buildPronunciationShadowSentenceMp3(
              {
                context: markdownContext,
                mdPath: flags.md,
                voiceId: fallbackVoiceId,
              },
              {
                outPath: flags.out ?? dirname(flags.md),
                preview: flags.dryRun,
                force: flags.force || flags.redoTts,
                ttsProvider: flags.ttsProvider,
                googleTtsModel: flags.googleTtsModel,
                logger,
              },
            );
            const shadowTtsSummary = buildTtsSpendSummary(shadowResult);
            audioArtifacts.pronunciationShadowSentence = {
              path: shadowResult.path,
              hash: shadowResult.hash,
              voiceId: shadowResult.voiceId,
              tts: shadowTtsSummary,
            };
            if (shadowResult.generatedCharacters !== undefined && shadowResult.generatedCharacters > 0) {
              metrics.increment('esl.tts.provider_characters', shadowResult.generatedCharacters, {
                type: 'generated',
              });
            }
            if (shadowResult.cachedCharacters !== undefined && shadowResult.cachedCharacters > 0) {
              metrics.increment('esl.tts.provider_characters', shadowResult.cachedCharacters, {
                type: 'cached',
              });
            }
          } else {
            logger.log({
              level: 'warn',
              stage: 'tts',
              message: 'Skipping pronunciation shadow sentence TTS: no resolved voice id.',
            });
            audioArtifacts.pronunciationShadowSentence = undefined;
          }
        } else {
          audioArtifacts.pronunciationShadowSentence = undefined;
        }
      }
    } else {
      recordSkip('tts', 'tts disabled');
      audioArtifacts = {};
    }

    const artifactEntries: { kind: AudioArtifactKind; artifact: AudioArtifact | undefined }[] = [
      { kind: 'study_text', artifact: audioArtifacts.studyText },
      {
        kind: 'pronunciation_shadow_sentence',
        artifact: audioArtifacts.pronunciationShadowSentence,
      },
    ];
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
            ? resolveAudioArtifactKey(artifact.hash, keyPrefix, entry.kind)
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
          pronunciationUrl: audioArtifacts.pronunciationShadowSentence?.url,
          dryRun: flags.dryRun,
        });
      }
    } else {
      recordSkip('upload', flags.upload === 's3' ? 'no audio path available' : 'upload disabled');
    }

    const studyTextAudioUrl = audioArtifacts.studyText?.url;
    const pronunciationAudioUrl = audioArtifacts.pronunciationShadowSentence?.url;

    if (publishTarget === 'notion') {
      if ((studyTextAudioUrl || pronunciationAudioUrl) && pageId) {
        if (flags.skipUpload) {
          recordSkip('add-audio', 'skip-upload flag set');
          steps.push('skip:add-audio');
        } else if (flags.dryRun) {
          emitStage('add-audio', 'start');
          steps.push('add-audio');
          emitStage('add-audio', 'success', { dryRun: true });
        } else {
          emitStage('add-audio', 'start');
          steps.push('add-audio');
          throwIfCancelled(signal, 'add-audio');

          if (studyTextAudioUrl) {
            const result = await addOrReplaceAudio(pageId, studyTextAudioUrl, {
              replace: flags.force,
              target: 'study-text',
              previousBlockId: audioArtifacts.studyText?.notionBlockId,
            });
            if (result.blockId) {
              audioArtifacts.studyText = {
                ...audioArtifacts.studyText,
                notionBlockId: result.blockId,
              };
            }
          }

          if (pronunciationAudioUrl) {
            const result = await addOrReplaceAudio(pageId, pronunciationAudioUrl, {
              replace: flags.force,
              target: 'pronunciation-shadow-sentence',
              previousBlockId: audioArtifacts.pronunciationShadowSentence?.notionBlockId,
            });
            if (result.blockId) {
              audioArtifacts.pronunciationShadowSentence = {
                ...audioArtifacts.pronunciationShadowSentence,
                notionBlockId: result.blockId,
              };
            }
          }

          throwIfCancelled(signal, 'add-audio');
          emitStage('add-audio', 'success', {
            pageId,
            studyTextUrl: studyTextAudioUrl,
            pronunciationUrl: pronunciationAudioUrl,
          });
        }
      } else {
        recordSkip('add-audio', studyTextAudioUrl || pronunciationAudioUrl ? 'missing pageId' : 'no audio url available');
      }
    } else if (publishTarget === 'anytype' && anytypePageId && anytypeSpaceId) {
      if (flags.skipUpload) {
        recordSkip('add-audio', 'skip-upload flag set');
        steps.push('skip:add-audio');
      } else if (flags.dryRun) {
        emitStage('add-audio', 'start');
        steps.push('add-audio');
        emitStage('add-audio', 'success', { dryRun: true });
      } else {
        emitStage('add-audio', 'start');
        steps.push('add-audio');
        throwIfCancelled(signal, 'add-audio');

        const client = createAnytypeClient();
        const page = await client.getObject(anytypeSpaceId, anytypePageId);
        throwIfCancelled(signal, 'add-audio');
        const updatedBody = insertGeneratedAudioLinks(page.body ?? '', {
          studyTextUrl: studyTextAudioUrl,
          pronunciationShadowSentenceUrl: pronunciationAudioUrl,
        });
        if (updatedBody !== page.body) {
          await client.updateObject(anytypeSpaceId, anytypePageId, {
            body: updatedBody,
          });
          throwIfCancelled(signal, 'add-audio');
        }

        let headingTheme: { h2?: string; h3?: string } | undefined;
        if (flags.preset) {
          const preset = await loadPreset(flags.preset, flags.presetsPath ?? DEFAULT_PRESETS_PATH);
          headingTheme = resolveHeadingTheme(preset);
        }

        const publishMarkdown = insertGeneratedAudioLinks(mdContents, {
          studyTextUrl: studyTextAudioUrl,
          pronunciationShadowSentenceUrl: pronunciationAudioUrl,
        });
        const publishTitle = resolveMarkdownTitle(
          mdContents,
          basename(flags.md).replace(/\.[^.]+$/, ''),
          validation.meta?.title ?? null,
        );

        const publishResult = await sharePageToS3(anytypeSpaceId, anytypePageId, {
          headingTheme,
          title: publishTitle,
          markdown: publishMarkdown,
        });
        throwIfCancelled(signal, 'add-audio');
        anytypeUrl = publishResult.url;
        htmlUrl = publishResult.url;
        htmlHash = publishResult.renderHash;
        htmlKey = publishResult.key;
        htmlEtag = publishResult.etag;
        htmlReused = publishResult.reused;
        emitArtifactReuseMetric(metrics, 'html', undefined, publishResult.reused);

        emitStage('add-audio', 'success', {
          pageId: anytypePageId,
          studyTextUrl: studyTextAudioUrl,
          pronunciationUrl: pronunciationAudioUrl,
          publishUrl: anytypeUrl,
          publishKey: htmlKey,
          publishHash: htmlHash,
          publishReused: htmlReused,
        });
      }
    } else if (publishTarget === 'html') {
      emitStage('add-audio', 'start');
      steps.push('add-audio');
      throwIfCancelled(signal, 'add-audio');
      if (!flags.dryRun) {
        let headingTheme: { h2?: string; h3?: string } | undefined;
        if (flags.preset) {
          const preset = await loadPreset(flags.preset, flags.presetsPath ?? DEFAULT_PRESETS_PATH);
          headingTheme = resolveHeadingTheme(preset);
        }

        const publishMarkdown = insertGeneratedAudioLinks(mdContents, {
          studyTextUrl: studyTextAudioUrl,
          pronunciationShadowSentenceUrl: pronunciationAudioUrl,
        });
        const publishTitle = resolveMarkdownTitle(
          mdContents,
          basename(flags.md).replace(/\.[^.]+$/, ''),
          validation.meta?.title ?? null,
        );
        const publishResult = await renderAndPublishMarkdownToS3({
          headingTheme,
          title: publishTitle,
          markdown: publishMarkdown,
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
    } else {
      recordSkip('add-audio', 'missing Anytype pageId/spaceId');
    }

    const manifest: AssignmentManifest = {
      schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
      mdHash: markdownHash,
      pageId,
      pageUrl,
      publishTarget,
      anytypePageId,
      anytypeSpaceId,
      anytypeUrl,
      htmlUrl,
      htmlHash,
      htmlKey,
      htmlEtag,
      htmlReused,
      audio: audioArtifacts.studyText,
      audioArtifacts: {
        studyText: audioArtifacts.studyText,
        pronunciationShadowSentence: audioArtifacts.pronunciationShadowSentence,
      },
      preset: flags.preset,
      notionColorization,

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
      pageId,
      pageUrl,
      anytypeUrl,
      htmlUrl,
      publishTarget,
      audio: audioArtifacts.studyText,
      colorized,
      manifestPath,
      steps,
    };
  } catch (error) {
    const durationMs = Math.max(Date.now() - pipelineStartedAt, 0);
    if (isPipelineCancelledError(error)) {
      logger.log({
        level: 'warn',
        message: 'pipeline.newAssignment.cancelled',
        runId,
        stage: 'pipeline',
        detail: {
          durationMs,
          error: error.message,
          cancelledStage: error.stage,
        },
      });
      metrics.timing('esl.pipeline.new_assignment.duration_ms', durationMs, {
        result: 'cancelled',
      });
      metrics.increment('esl.pipeline.new_assignment.cancelled', 1, {});
      throw error;
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
      currentHash = hashStudyText(await readMarkdownCached(mdPath));
    } catch {
      currentHash = null;
    }

    let audioFileExists = false;
    const studyAudioPath = manifest?.audioArtifacts?.studyText?.path ?? manifest?.audio?.path;
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
  const manifestStore = dependencies.manifestStore ?? fallbackManifestStore;
  const logger = dependencies.logger ?? fallbackLogger;
  const metrics = dependencies.metrics ?? fallbackMetrics;
  const runId = dependencies.runId ?? randomUUID();
  const signal = dependencies.signal;
  const manifestMd = flags.manifestMd?.trim() || flags.md;
  const pipelineStartedAt = Date.now();
  throwIfCancelled(signal, 'tts');
  await applyVoicePreferences(flags);
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
    detail: { md: flags.md, manifestMd, requestedSteps: flags.steps },
  });

  try {
    throwIfCancelled(signal, 'tts');
    const manifest = await manifestStore.readManifest(manifestMd);
    const rerunPlan = computeRerunPlan({
      md: manifestMd,
      steps: flags.steps,
      manifest,
    });
    if (rerunPlan.errors.length > 0) {
      throw new ValidationError(rerunPlan.errors.join('\n'));
    }

    const stepsToRun = new Set(rerunPlan.executable);
    const skipReasonByStage = new Map<RerunTargetStage, string>(
      rerunPlan.skipped.map((item) => [item.stage, item.reason]),
    );
    const executed: string[] = [];

    // Planner guarantees manifest presence when no errors are reported.
    if (!manifest) {
      throw new ValidationError(`No manifest found for ${manifestMd}. Run the pipeline first.`);
    }

    const mdContents = await readMarkdownCached(flags.md);
    const audioArtifacts = resolveAudioArtifactsFromManifest(manifest);
    let audioPath = audioArtifacts.studyText?.path;
    let audioUrl = audioArtifacts.studyText?.url;
    let audioHash = audioArtifacts.studyText?.hash;
    let audioKey = audioArtifacts.studyText?.key;
    let audioEtag = audioArtifacts.studyText?.etag;
    let audioSizeBytes = audioArtifacts.studyText?.sizeBytes;
    let audioReused = audioArtifacts.studyText?.reused;
    let audioVoices = audioArtifacts.studyText?.voices;
    let audioTts = audioArtifacts.studyText?.tts;
    const publishTarget = manifest.publishTarget ?? 'notion';
    let anytypeUrl = manifest.anytypeUrl;
    let htmlUrl = manifest.htmlUrl;
    let htmlHash = manifest.htmlHash;
    let htmlKey = manifest.htmlKey;
    let htmlEtag = manifest.htmlEtag;
    let htmlReused = manifest.htmlReused;
    if (publishTarget === 'notion') {
      htmlUrl = undefined;
      htmlHash = undefined;
      htmlKey = undefined;
      htmlEtag = undefined;
      htmlReused = undefined;
    } else if (publishTarget === 'html') {
      anytypeUrl = undefined;
    }

    if (stepsToRun.has('tts')) {
      emitStage('tts', 'start');
      throwIfCancelled(signal, 'tts');
      const markdownContext = parseMarkdownContext(mdContents);
      const shadowFocus = extractPronunciationShadowFocus(markdownContext);

      // TTS mode debug logging for rerun
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
            context: markdownContext,
            mdPath: flags.md,
          },
          {
            voiceMapPath: flags.voices ?? DEFAULT_VOICES_PATH,
            outPath: flags.out ?? dirname(flags.md),
            preview: flags.dryRun,
            force: flags.force,
            defaultAccent: flags.accentPreference,
            defaultVoiceId: flags.voiceId,
            ttsProvider: flags.ttsProvider,
            googleTtsModel: flags.googleTtsModel,

            // Pass TTS strategy options to TTS package
            ttsStrategy: flags.ttsStrategy,
            dialogueLanguage: flags.dialogueLanguage,
            dialogueStability: flags.dialogueStability,
            dialogueSeed: flags.dialogueSeed,
            logger,
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
        notionBlockId: audioArtifacts.studyText?.notionBlockId,
      };
      emitVoiceSelectionMetrics(metrics, ttsResult.voices);

      if (ttsResult.generatedCharacters !== undefined && ttsResult.generatedCharacters > 0) {
        metrics.increment('esl.tts.provider_characters', ttsResult.generatedCharacters, { type: 'generated' });
      }
      if (ttsResult.cachedCharacters !== undefined && ttsResult.cachedCharacters > 0) {
        metrics.increment('esl.tts.provider_characters', ttsResult.cachedCharacters, { type: 'cached' });
      }

      emitStage('tts', 'success', {
        preview: flags.dryRun,
        voices: ttsResult.voices,
        generatedCharacters: ttsResult.generatedCharacters,
        cachedCharacters: ttsResult.cachedCharacters,
        ttsProvider: audioTts.provider,
        estimatedSpendUsd: audioTts.estimatedSpendUsd,
      });

      if (shadowFocus?.shadowSentence?.trim()) {
        const narratorVoiceId = ttsResult.voiceAssignments?.Narrator;
        const fallbackVoiceId = narratorVoiceId ?? ttsResult.voices[0]?.voiceId;
        if (fallbackVoiceId) {
          const shadowResult = await buildPronunciationShadowSentenceMp3(
            {
              context: markdownContext,
              mdPath: flags.md,
              voiceId: fallbackVoiceId,
            },
            {
              outPath: flags.out ?? dirname(flags.md),
              preview: flags.dryRun,
              force: flags.force,
              ttsProvider: flags.ttsProvider,
              googleTtsModel: flags.googleTtsModel,
              logger,
            },
          );
          const shadowTts = buildTtsSpendSummary(shadowResult);
          audioArtifacts.pronunciationShadowSentence = {
            path: shadowResult.path,
            hash: shadowResult.hash,
            voiceId: shadowResult.voiceId,
            tts: shadowTts,
            notionBlockId: audioArtifacts.pronunciationShadowSentence?.notionBlockId,
          };
          if (shadowResult.generatedCharacters !== undefined && shadowResult.generatedCharacters > 0) {
            metrics.increment('esl.tts.provider_characters', shadowResult.generatedCharacters, {
              type: 'generated',
            });
          }
          if (shadowResult.cachedCharacters !== undefined && shadowResult.cachedCharacters > 0) {
            metrics.increment('esl.tts.provider_characters', shadowResult.cachedCharacters, {
              type: 'cached',
            });
          }
        } else {
          audioArtifacts.pronunciationShadowSentence = undefined;
        }
      } else {
        audioArtifacts.pronunciationShadowSentence = undefined;
      }
      executed.push('tts');
    } else {
      emitStage('tts', 'skipped', { reason: skipReasonByStage.get('tts') ?? 'not requested' });
    }

    if (stepsToRun.has('upload')) {
      emitStage('upload', 'start');
      throwIfCancelled(signal, 'upload');
      const rerunArtifactEntries: { kind: AudioArtifactKind; artifact: AudioArtifact | undefined }[] = [
        { kind: 'study_text', artifact: audioArtifacts.studyText },
        {
          kind: 'pronunciation_shadow_sentence',
          artifact: audioArtifacts.pronunciationShadowSentence,
        },
      ];
      const uploadable = rerunArtifactEntries.filter((entry) => entry.artifact?.path);
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
          ? resolveAudioArtifactKey(artifact.hash, keyPrefix, entry.kind)
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
            skipIfExists: true,
            prefix: flags.prefix,
            public: flags.publicRead,
            presignExpiresIn: flags.presign,
            logger,
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
        pronunciationUrl: audioArtifacts.pronunciationShadowSentence?.url,
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
      const pronunciationAudioUrl = audioArtifacts.pronunciationShadowSentence?.url;
      if (publishTarget === 'notion') {
        const targetPageId = manifest.pageId;
        if (!targetPageId) {
          throw new Error(
            'Cannot add audio: manifest does not have a pageId. Re-run the import step first.',
          );
        }
        if (!studyTextAudioUrl && !pronunciationAudioUrl) {
          throw new Error('Cannot add audio: no audio URL available. Rerun upload first.');
        }

        if (!flags.dryRun) {
          if (studyTextAudioUrl) {
            const result = await addOrReplaceAudio(targetPageId, studyTextAudioUrl, {
              replace: flags.force,
              target: 'study-text',
              previousBlockId: audioArtifacts.studyText?.notionBlockId,
            });
            if (result.blockId) {
              audioArtifacts.studyText = {
                ...audioArtifacts.studyText,
                notionBlockId: result.blockId,
              };
            }
          }
          if (pronunciationAudioUrl) {
            const result = await addOrReplaceAudio(targetPageId, pronunciationAudioUrl, {
              replace: flags.force,
              target: 'pronunciation-shadow-sentence',
              previousBlockId: audioArtifacts.pronunciationShadowSentence?.notionBlockId,
            });
            if (result.blockId) {
              audioArtifacts.pronunciationShadowSentence = {
                ...audioArtifacts.pronunciationShadowSentence,
                notionBlockId: result.blockId,
              };
            }
          }
          throwIfCancelled(signal, 'add-audio');
        }

        emitStage('add-audio', 'success', {
          pageId: targetPageId,
          studyTextUrl: studyTextAudioUrl,
          pronunciationUrl: pronunciationAudioUrl,
        });
      } else if (publishTarget === 'anytype') {
        const targetPageId = manifest.anytypePageId;
        const targetSpaceId = manifest.anytypeSpaceId;
        if (!targetPageId || !targetSpaceId) {
          throw new Error(
            'Cannot add audio: manifest does not have an Anytype page/space id. Re-run import first.',
          );
        }
        if (!studyTextAudioUrl && !pronunciationAudioUrl) {
          throw new Error('Cannot add audio: no audio URL available. Rerun upload first.');
        }

        if (!flags.dryRun) {
          const client = createAnytypeClient();
          const page = await client.getObject(targetSpaceId, targetPageId);
          throwIfCancelled(signal, 'add-audio');
          const updatedBody = insertGeneratedAudioLinks(page.body ?? '', {
            studyTextUrl: studyTextAudioUrl,
            pronunciationShadowSentenceUrl: pronunciationAudioUrl,
          });
          if (updatedBody !== page.body) {
            await client.updateObject(targetSpaceId, targetPageId, { body: updatedBody });
            throwIfCancelled(signal, 'add-audio');
          }

          let headingTheme: { h2?: string; h3?: string } | undefined;
          if (manifest.preset) {
            const preset = await loadPreset(manifest.preset, DEFAULT_PRESETS_PATH);
            headingTheme = resolveHeadingTheme(preset);
          }

          const publishMarkdown = insertGeneratedAudioLinks(mdContents, {
            studyTextUrl: studyTextAudioUrl,
            pronunciationShadowSentenceUrl: pronunciationAudioUrl,
          });
          const publishTitle = resolveMarkdownTitle(
            mdContents,
            basename(flags.md).replace(/\.[^.]+$/, ''),
            null,
          );

          const publishResult = await sharePageToS3(targetSpaceId, targetPageId, {
            headingTheme,
            title: publishTitle,
            markdown: publishMarkdown,
          });
          throwIfCancelled(signal, 'add-audio');
          anytypeUrl = publishResult.url;
          htmlUrl = publishResult.url;
          htmlHash = publishResult.renderHash;
          htmlKey = publishResult.key;
          htmlEtag = publishResult.etag;
          htmlReused = publishResult.reused;
          emitArtifactReuseMetric(metrics, 'html', undefined, publishResult.reused);
        }

        emitStage('add-audio', 'success', {
          pageId: targetPageId,
          studyTextUrl: studyTextAudioUrl,
          pronunciationUrl: pronunciationAudioUrl,
          publishUrl: anytypeUrl,
          publishKey: htmlKey,
          publishHash: htmlHash,
          publishReused: htmlReused,
        });
      } else {
        if (!flags.dryRun) {
          let headingTheme: { h2?: string; h3?: string } | undefined;
          if (manifest.preset) {
            const preset = await loadPreset(manifest.preset, DEFAULT_PRESETS_PATH);
            headingTheme = resolveHeadingTheme(preset);
          }

          const publishMarkdown = insertGeneratedAudioLinks(mdContents, {
            studyTextUrl: studyTextAudioUrl,
            pronunciationShadowSentenceUrl: pronunciationAudioUrl,
          });
          const publishTitle = resolveMarkdownTitle(
            mdContents,
            basename(flags.md).replace(/\.[^.]+$/, ''),
            null,
          );
          const publishResult = await renderAndPublishMarkdownToS3({
            headingTheme,
            title: publishTitle,
            markdown: publishMarkdown,
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

      executed.push('add-audio');
    } else {
      emitStage('add-audio', 'skipped', {
        reason: skipReasonByStage.get('add-audio') ?? 'not requested',
      });
    }

    const updatedManifest: AssignmentManifest = {
      ...manifest,
      schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
      mdHash: hashStudyText(mdContents),
      publishTarget,
      anytypeUrl,
      htmlUrl,
      htmlHash,
      htmlKey,
      htmlEtag,
      htmlReused,
      audio: audioArtifacts.studyText,
      audioArtifacts: {
        studyText: audioArtifacts.studyText,
        pronunciationShadowSentence: audioArtifacts.pronunciationShadowSentence,
      },

      // Preserve prior TTS metadata unless explicitly overridden
      ttsStrategy: flags.ttsStrategy ?? manifest.ttsStrategy,
      dialogueLanguage: flags.dialogueLanguage ?? manifest.dialogueLanguage,
      dialogueStability: flags.dialogueStability ?? manifest.dialogueStability,
      dialogueSeed: flags.dialogueSeed ?? manifest.dialogueSeed,

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
    metrics.timing('esl.pipeline.rerun_assignment.duration_ms', durationMs, { result: 'success' });
    metrics.increment('esl.pipeline.rerun_assignment.success', 1, {});

    return {
      steps: executed,
      audio: updatedManifest.audio,
      pageId: updatedManifest.pageId,
      pageUrl: updatedManifest.pageUrl,
      anytypeUrl: updatedManifest.anytypeUrl,
      htmlUrl: updatedManifest.htmlUrl,
      publishTarget: updatedManifest.publishTarget,
      manifestPath,
    };
  } catch (error) {
    const durationMs = Math.max(Date.now() - pipelineStartedAt, 0);
    if (isPipelineCancelledError(error)) {
      logger.log({
        level: 'warn',
        message: 'pipeline.rerunAssignment.cancelled',
        runId,
        stage: 'pipeline',
        detail: {
          durationMs,
          error: error.message,
          cancelledStage: error.stage,
        },
      });
      metrics.timing('esl.pipeline.rerun_assignment.duration_ms', durationMs, {
        result: 'cancelled',
      });
      metrics.increment('esl.pipeline.rerun_assignment.cancelled', 1, {});
      throw error;
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
    metrics.timing('esl.pipeline.rerun_assignment.duration_ms', durationMs, { result: 'failure' });
    metrics.increment('esl.pipeline.rerun_assignment.failure', 1, {});
    throw error;
  }
}
