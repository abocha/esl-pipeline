import { randomUUID } from 'node:crypto';
import { constants as FS } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { InfrastructureError, ManifestError, ValidationError } from '@esl-pipeline/contracts';
import { validateMarkdownFile } from '@esl-pipeline/md-validator';
import { createAnytypeClient, sharePageToS3 } from '@esl-pipeline/anytype-adapter';
import {
  addOrReplaceAudioUnderStudyText,
  applyHeadingPreset,
  loadPreset,
  runImport,
  type ColorPreset,
} from '@esl-pipeline/notion-adapter';
import { uploadFile } from '@esl-pipeline/storage-uploader';
import {
  type BuildStudyTextResult,
  FfmpegNotFoundError,
  type VoiceCatalog,
  buildStudyTextMp3,
  hashStudyText,
  loadVoicesCatalog,
} from '@esl-pipeline/tts-elevenlabs';

import {
  type AssignmentManifest,
  CURRENT_MANIFEST_SCHEMA_VERSION,
  createFilesystemManifestStore,
} from './manifest.js';
import { noopLogger, noopMetrics, type PipelineLogger } from './observability.js';
import type {
  AssignmentProgressCallbacks,
  AssignmentStage,
  AssignmentStageStatus,
  AssignmentStatus,
  NewAssignmentFlags,
  OrchestratorDependencies,
  RerunFlags,
} from './types.js';

export type {
  AssignmentStage,
  AssignmentStageStatus,
  AssignmentProgressEvent,
  AssignmentProgressCallbacks,
  OrchestratorDependencies,
  NewAssignmentFlags,
  AssignmentStatus,
  RerunFlags,
} from './types.js';

const fallbackManifestStore = createFilesystemManifestStore();
const fallbackLogger = noopLogger;
const fallbackMetrics = noopMetrics;

interface CachedMarkdown {
  content: string;
  mtimeMs: number;
  size: number;
}
const markdownCache = new Map<string, CachedMarkdown>();

async function readMarkdownCached(mdPath: string): Promise<string> {
  try {
    const stats = await stat(mdPath);
    const cached = markdownCache.get(mdPath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached.content;
    }
    const content = await readFile(mdPath, 'utf8');
    markdownCache.set(mdPath, { content, mtimeMs: stats.mtimeMs, size: stats.size });
    return content;
  } catch {
    const content = await readFile(mdPath, 'utf8');
    markdownCache.set(mdPath, { content, mtimeMs: 0, size: content.length });
    return content;
  }
}

const STUDY_TEXT_MARKER = ':::study-text Transcript';
const AUDIO_LINK_REGEX = /^\[Audio recording\]\([^)]+\)\s*$/i;

function insertAudioBeforeStudyText(markdown: string, audioUrl: string): string {
  if (!audioUrl) return markdown;
  const lines = markdown.split('\n');
  const cleaned: string[] = [];
  let markerIndex = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === STUDY_TEXT_MARKER) {
      markerIndex = cleaned.length;
    }
    if (AUDIO_LINK_REGEX.test(trimmed)) {
      continue;
    }
    cleaned.push(line);
  }

  const audioLine = `[Audio recording](${audioUrl})`;
  if (cleaned.some((line) => line.trim() === audioLine)) {
    return cleaned.join('\n');
  }

  const insertAt = markerIndex === -1 ? cleaned.length : markerIndex;
  const nextLines = [...cleaned];
  nextLines.splice(insertAt, 0, audioLine, '');
  return nextLines.join('\n');
}

function resolveMarkdownTitle(mdContents: string, fallback: string, metaTitle?: string | null): string {
  if (metaTitle && metaTitle.trim()) return metaTitle.trim();
  const headingMatch = mdContents.match(/^#\s+(.+)$/m);
  if (headingMatch?.[1]) return headingMatch[1].trim();
  return fallback;
}

const NOTION_COLOR_TO_HEX: Record<string, string> = {
  default: '#1b1b1d',
  gray: '#6b6f76',
  brown: '#8d6e63',
  orange: '#f2994a',
  yellow: '#f2c94c',
  green: '#27ae60',
  blue: '#2d9cdb',
  purple: '#9b51e0',
  pink: '#d16ba5',
  red: '#eb5757',
  default_background: '#1b1b1d',
  gray_background: '#6b6f76',
  brown_background: '#8d6e63',
  orange_background: '#f2994a',
  yellow_background: '#f2c94c',
  green_background: '#27ae60',
  blue_background: '#2d9cdb',
  purple_background: '#9b51e0',
  pink_background: '#d16ba5',
  red_background: '#eb5757',
};

function resolveHeadingTheme(preset?: ColorPreset): { h2?: string; h3?: string } | undefined {
  if (!preset) return undefined;
  const h2 = preset.h2 ? NOTION_COLOR_TO_HEX[preset.h2] ?? undefined : undefined;
  const h3 = preset.h3 ? NOTION_COLOR_TO_HEX[preset.h3] ?? undefined : undefined;
  if (!h2 && !h3) return undefined;
  return { h2, h3 };
}

async function resolveAnytypeSpaceId(
  client: ReturnType<typeof createAnytypeClient>,
  explicitId?: string,
): Promise<string> {
  const fromEnv = process.env.ANYTYPE_SPACE_ID;
  const candidateId = explicitId ?? fromEnv;
  if (candidateId) return candidateId;

  const spaces = await client.listSpaces();
  if (spaces.length === 1 && spaces[0]?.id) return spaces[0].id;

  const desiredName = process.env.ANYTYPE_SPACE_NAME?.trim();
  if (desiredName) {
    const match = spaces.find((space: { name?: string }) => space.name === desiredName);
    if (match?.id) return match.id;
  }

  throw new ValidationError(
    'Anytype space not resolved. Set ANYTYPE_SPACE_ID or ANYTYPE_SPACE_NAME.',
  );
}

async function addAnytypePageToCollection(
  client: ReturnType<typeof createAnytypeClient>,
  spaceId: string,
  pageId: string,
  logger: PipelineLogger,
  runId?: string,
): Promise<boolean> {
  const collectionId = process.env.ANYTYPE_COLLECTION_ID?.trim();
  if (!collectionId) return false;

  try {
    await client.addObjectsToList(spaceId, collectionId, [pageId]);
    logger.log({
      level: 'info',
      message: 'anytype.collection.added',
      runId,
      stage: 'import',
      detail: { collectionId, pageId },
    });
    return true;
  } catch (error) {
    logger.log({
      level: 'warn',
      message: 'anytype.collection.add_failed',
      runId,
      stage: 'import',
      detail: {
        collectionId,
        pageId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return false;
  }
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
  resolveJobOptions,
  type JobOptionsPayload,
  type VoiceOption as JobVoiceOption,
  type NotionDatabaseOption as JobNotionDatabaseOption,
} from './metadata/job-options.js';

export function summarizeVoiceSelections(
  voices?: BuildStudyTextResult['voices'],
): string | undefined {
  if (!voices || voices.length === 0) return undefined;
  return voices
    .map((voice) => {
      const name = voice.voiceName ?? voice.voiceId;
      const tags: string[] = [];
      if (voice.gender) tags.push(voice.gender);
      switch (voice.source) {
        case 'profile': {
          tags.push('profile');
          break;
        }
        case 'voiceMap': {
          tags.push('map');
          break;
        }
        case 'auto': {
          tags.push(typeof voice.score === 'number' ? `auto ${Math.round(voice.score)}` : 'auto');
          break;
        }
        case 'default': {
          tags.push('default');
          break;
        }
        case 'fallback': {
          tags.push('fallback');
          break;
        }
        case 'reuse': {
          tags.push('reuse');
          break;
        }
      }
      if (voice.accent && tags.length < 3) tags.push(voice.accent);
      const tagString = tags.length > 0 ? ` (${tags.join(', ')})` : '';
      return `${voice.speaker}→${name}${tagString}`;
    })
    .join(', ');
}

export async function newAssignment(
  flags: NewAssignmentFlags,
  callbacks: AssignmentProgressCallbacks = {},
  dependencies: OrchestratorDependencies = {},
): Promise<{
  pageId?: string;
  pageUrl?: string;
  anytypeUrl?: string;
  publishTarget?: 'notion' | 'anytype';
  audio?: { path?: string; url?: string; hash?: string; voices?: BuildStudyTextResult['voices'] };
  colorized?: boolean;
  manifestPath?: string;
  steps: string[];
}> {
  const manifestStore = dependencies.manifestStore ?? fallbackManifestStore;
  const logger = dependencies.logger ?? fallbackLogger;
  const metrics = dependencies.metrics ?? fallbackMetrics;
  const runId = dependencies.runId ?? randomUUID();
  const stageStartTimes = new Map<AssignmentStage, number>();
  const pipelineStartedAt = Date.now();
  await applyVoicePreferences(flags);

  const emitStage = (
    stage: AssignmentStage,
    status: AssignmentStageStatus,
    detail?: Record<string, unknown>,
  ) => {
    callbacks.onStage?.({ stage, status, detail });
    if (status === 'start') {
      stageStartTimes.set(stage, Date.now());
      logger.log({
        level: 'info',
        message: `stage.${stage}.start`,
        runId,
        stage,
        detail,
      });
      return;
    }

    const startedAt = stageStartTimes.get(stage);
    if (startedAt !== undefined) {
      stageStartTimes.delete(stage);
    }
    const durationMs = startedAt === undefined ? undefined : Math.max(Date.now() - startedAt, 0);
    const detailWithDuration = durationMs === undefined ? detail : { ...detail, durationMs };

    if (status === 'success') {
      logger.log({
        level: 'info',
        message: `stage.${stage}.success`,
        runId,
        stage,
        detail: detailWithDuration,
      });
      if (durationMs !== undefined) {
        metrics.timing('esl.pipeline.stage.duration_ms', durationMs, {
          stage,
          status,
        });
      }
      metrics.increment('esl.pipeline.stage.success', 1, { stage });
    } else {
      logger.log({
        level: 'warn',
        message: `stage.${stage}.skipped`,
        runId,
        stage,
        detail: detailWithDuration,
      });
      metrics.increment('esl.pipeline.stage.skipped', 1, { stage });
    }
  };

  const recordSkip = (stage: AssignmentStage, reason: string) =>
    emitStage(stage, 'skipped', { reason });

  const steps: string[] = [];
  const mdContents = await readMarkdownCached(flags.md);
  const previousManifest = await manifestStore.readManifest(flags.md);

  const publishTarget = flags.publishTarget ?? previousManifest?.publishTarget ?? 'notion';
  let pageId = previousManifest?.pageId;
  let pageUrl = previousManifest?.pageUrl;
  let anytypePageId = previousManifest?.anytypePageId;
  let anytypeSpaceId = flags.anytypeSpaceId ?? previousManifest?.anytypeSpaceId;
  let anytypeUrl = previousManifest?.anytypeUrl;

  let colorized = false;

  if (publishTarget === 'anytype') {
    pageId = undefined;
    pageUrl = undefined;
  } else {
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
    emitStage('validate', 'start');
    steps.push('validate');
    const validation = await validateMarkdownFile(flags.md, { strict: false, content: mdContents });
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
        const importResult = await runImport({
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
        pageId = importResult.page_id;
        pageUrl = importResult.url;
        emitStage('import', 'success', {
          pageUrl,
          studentLinked: importResult.studentLinked ?? undefined,
        });
      } else {
        const client = createAnytypeClient();
        const spaceId = await resolveAnytypeSpaceId(client, anytypeSpaceId);
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
          anytypePageId = created.id;
        }

        if (anytypePageId) {
          await addAnytypePageToCollection(client, spaceId, anytypePageId, logger, runId);
        }

        emitStage('import', 'success', {
          pageId: anytypePageId,
          spaceId: anytypeSpaceId,
        });
      }
    }

    if (flags.preset) {
      if (publishTarget === 'anytype') {
        recordSkip('colorize', 'anytype uses static HTML theming');
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
        emitStage('colorize', 'start');
        steps.push('colorize');
        const color = await applyHeadingPreset(
          pageId,
          flags.preset,
          flags.presetsPath ?? 'configs/presets.json',
        );
        steps.push(
          `colorize:${flags.preset}:${color.counts.h2}/${color.counts.h3}/${color.counts.toggles}`,
        );
        emitStage('colorize', 'success', {
          preset: flags.preset,
          counts: color.counts,
        });
        colorized = true;
      }
    } else {
      recordSkip('colorize', 'no preset selected');
    }

    let audio = previousManifest?.audio ? { ...previousManifest.audio } : undefined;
    if (flags.withTts) {
      if (flags.skipTts) {
        recordSkip('tts', 'skip-tts flag set');
        steps.push('skip:tts');
        if (!audio?.path && !flags.dryRun) {
          throw new ManifestError(
            'Cannot skip TTS because manifest has no audio.path. Run TTS at least once first.',
          );
        }
      } else {
        emitStage('tts', 'start');
        steps.push('tts');

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
          ttsResult = await buildStudyTextMp3(flags.md, {
            voiceMapPath: flags.voices ?? 'configs/voices.yml',
            outPath: flags.out ?? dirname(flags.md),
            preview: flags.dryRun,
            force: flags.force || flags.redoTts,
            defaultAccent: flags.accentPreference,
            defaultVoiceId: flags.voiceId,

            // Pass TTS strategy options to TTS package
            ttsStrategy: flags.ttsStrategy,
            dialogueLanguage: flags.dialogueLanguage,
            dialogueStability: flags.dialogueStability,
            dialogueSeed: flags.dialogueSeed,
            logger,
          });
        } catch (error: unknown) {
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
        audio = { path: ttsResult.path, hash: ttsResult.hash, voices: ttsResult.voices };
        const voiceSummary = summarizeVoiceSelections(ttsResult.voices);
        emitStage('tts', 'success', {
          path: ttsResult.path,
          preview: flags.dryRun,
          voices: ttsResult.voices,
          voiceSummary,
        });

        if (!flags.dryRun && audio?.path) {
          const audioPath = audio.path;
          await access(audioPath, FS.F_OK).catch(() => {
            throw new InfrastructureError(
              `No audio file produced at ${audioPath}. ` +
                `Check that :::study-text has lines and voices.yml has 'default' or 'auto: true'.`,
            );
          });
        }
      }
    } else {
      recordSkip('tts', 'tts disabled');
      audio = undefined;
    }

    if (flags.upload === 's3' && audio?.path) {
      if (flags.skipUpload) {
        recordSkip('upload', 'skip-upload flag set');
        steps.push('skip:upload');
        if (!audio.url && !flags.dryRun) {
          throw new ManifestError(
            'Cannot skip upload because manifest has no existing audio.url. Upload once before skipping.',
          );
        }
      } else {
        emitStage('upload', 'start');
        steps.push('upload');
        if (flags.dryRun) {
          const bucket = process.env.S3_BUCKET ?? 'stub-bucket';
          const prefix = flags.prefix ?? process.env.S3_PREFIX ?? 'audio/assignments';
          const normalizedPrefix = prefix.replace(/\/$/, '');
          const key = normalizedPrefix
            ? `${normalizedPrefix}/${basename(audio.path)}`
            : basename(audio.path);
          audio.url = `https://${bucket}.s3.amazonaws.com/${key}`;
        } else {
          const upload = await uploadFile(audio.path, {
            backend: 's3',
            public: flags.publicRead,
            presignExpiresIn: flags.presign,
            prefix: flags.prefix,
            logger,
          });
          audio.url = upload.url;
        }
        emitStage('upload', 'success', {
          url: audio.url,
          dryRun: flags.dryRun,
        });
      }
    } else {
      recordSkip('upload', flags.upload === 's3' ? 'no audio path available' : 'upload disabled');
    }

    if (publishTarget === 'notion') {
      if (audio?.url && pageId) {
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
          await addOrReplaceAudioUnderStudyText(pageId, audio.url, { replace: flags.force });
          emitStage('add-audio', 'success', { pageId, url: audio.url });
        }
      } else {
        recordSkip('add-audio', audio?.url ? 'missing pageId' : 'no audio url available');
      }
    } else if (anytypePageId && anytypeSpaceId) {
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

        const client = createAnytypeClient();
        const page = await client.getObject(anytypeSpaceId, anytypePageId);
        if (audio?.url) {
          const updatedBody = insertAudioBeforeStudyText(page.body ?? '', audio.url);
          if (updatedBody !== page.body) {
            await client.updateObject(anytypeSpaceId, anytypePageId, {
              body: updatedBody,
            });
          }
        }

        let headingTheme: { h2?: string; h3?: string } | undefined;
        if (flags.preset) {
          const preset = await loadPreset(flags.preset, flags.presetsPath ?? 'configs/presets.json');
          headingTheme = resolveHeadingTheme(preset);
        }

        const publishResult = await sharePageToS3(anytypeSpaceId, anytypePageId, {
          headingTheme,
        });
        anytypeUrl = publishResult.url;

        emitStage('add-audio', 'success', {
          pageId: anytypePageId,
          url: audio?.url,
          publishUrl: anytypeUrl,
        });
      }
    } else {
      recordSkip('add-audio', 'missing Anytype pageId/spaceId');
    }

    const manifest: AssignmentManifest = {
      schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
      mdHash: hashStudyText(mdContents),
      pageId,
      pageUrl,
      publishTarget,
      anytypePageId,
      anytypeSpaceId,
      anytypeUrl,
      audio,
      preset: flags.preset,

      // Preserve TTS metadata from previous runs when flags are omitted
      ttsStrategy: flags.ttsStrategy ?? previousManifest?.ttsStrategy,
      dialogueLanguage: flags.dialogueLanguage ?? previousManifest?.dialogueLanguage,
      dialogueStability: flags.dialogueStability ?? previousManifest?.dialogueStability,
      dialogueSeed: flags.dialogueSeed ?? previousManifest?.dialogueSeed,

      timestamp: new Date().toISOString(),
    };

    emitStage('manifest', 'start');
    const manifestPath = await manifestStore.writeManifest(flags.md, manifest);
    steps.push('manifest');
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
      publishTarget,
      audio,
      colorized,
      manifestPath,
      steps,
    };
  } catch (error) {
    const durationMs = Math.max(Date.now() - pipelineStartedAt, 0);
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
    if (manifest?.audio?.path) {
      try {
        await access(manifest.audio.path, FS.F_OK);
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
): Promise<{
  steps: string[];
  audio?: { path?: string; url?: string; hash?: string; voices?: BuildStudyTextResult['voices'] };
  pageId?: string;
  pageUrl?: string;
  anytypeUrl?: string;
  publishTarget?: 'notion' | 'anytype';
  manifestPath: string;
}> {
  const manifestStore = dependencies.manifestStore ?? fallbackManifestStore;
  const logger = dependencies.logger ?? fallbackLogger;
  const metrics = dependencies.metrics ?? fallbackMetrics;
  const runId = dependencies.runId ?? randomUUID();
  const pipelineStartedAt = Date.now();
  const stageStartTimes = new Map<AssignmentStage, number>();
  await applyVoicePreferences(flags);

  const emitStage = (
    stage: AssignmentStage,
    status: AssignmentStageStatus,
    detail?: Record<string, unknown>,
  ) => {
    if (status === 'start') {
      stageStartTimes.set(stage, Date.now());
      logger.log({
        level: 'info',
        message: `stage.${stage}.start`,
        runId,
        stage,
        detail,
      });
      return;
    }

    const startedAt = stageStartTimes.get(stage);
    if (startedAt !== undefined) {
      stageStartTimes.delete(stage);
    }
    const durationMs = startedAt === undefined ? undefined : Math.max(Date.now() - startedAt, 0);
    const detailWithDuration = durationMs === undefined ? detail : { ...detail, durationMs };

    if (status === 'success') {
      logger.log({
        level: 'info',
        message: `stage.${stage}.success`,
        runId,
        stage,
        detail: detailWithDuration,
      });
      if (durationMs !== undefined) {
        metrics.timing('esl.pipeline.stage.duration_ms', durationMs, {
          stage,
          status,
        });
      }
      metrics.increment('esl.pipeline.stage.success', 1, { stage });
    } else {
      logger.log({
        level: 'warn',
        message: `stage.${stage}.skipped`,
        runId,
        stage,
        detail: detailWithDuration,
      });
      metrics.increment('esl.pipeline.stage.skipped', 1, { stage });
    }
  };

  logger.log({
    level: 'info',
    message: 'pipeline.rerunAssignment.start',
    runId,
    stage: 'pipeline',
    detail: { md: flags.md, steps: flags.steps },
  });

  try {
    const manifest = await manifestStore.readManifest(flags.md);
    if (!manifest) {
      throw new Error(`No manifest found for ${flags.md}. Run the pipeline first.`);
    }

    const stepsToRun = new Set(
      flags.steps && flags.steps.length > 0 ? flags.steps : ['upload', 'add-audio'],
    );
    const executed: string[] = [];

    const mdContents = await readMarkdownCached(flags.md);
    let audioPath = manifest.audio?.path;
    let audioUrl = manifest.audio?.url;
    let audioHash = manifest.audio?.hash;
    let audioVoices = manifest.audio?.voices;
    const publishTarget = manifest.publishTarget ?? 'notion';
    let anytypeUrl = manifest.anytypeUrl;

    if (stepsToRun.has('tts')) {
      emitStage('tts', 'start');

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
        ttsResult = await buildStudyTextMp3(flags.md, {
          voiceMapPath: flags.voices ?? 'configs/voices.yml',
          outPath: flags.out ?? dirname(flags.md),
          preview: flags.dryRun,
          force: flags.force,
          defaultAccent: flags.accentPreference,
          defaultVoiceId: flags.voiceId,

          // Pass TTS strategy options to TTS package
          ttsStrategy: flags.ttsStrategy,
          dialogueLanguage: flags.dialogueLanguage,
          dialogueStability: flags.dialogueStability,
          dialogueSeed: flags.dialogueSeed,
          logger,
        });
      } catch (error: unknown) {
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
      audioVoices = ttsResult.voices;
      emitStage('tts', 'success', {
        preview: flags.dryRun,
        voices: ttsResult.voices,
      });
      executed.push('tts');
    } else {
      emitStage('tts', 'skipped', { reason: 'not requested' });
    }

    if (stepsToRun.has('upload')) {
      emitStage('upload', 'start');
      if (!audioPath) {
        throw new Error(
          'Cannot upload audio: no audio path found. Re-run TTS or provide a manifest with audio.path.',
        );
      }

      if (flags.upload !== 's3') {
        throw new Error('Only S3 uploads are supported in rerun mode. Pass --upload s3.');
      }

      if (flags.dryRun) {
        const bucket = process.env.S3_BUCKET ?? 'stub-bucket';
        const prefix = flags.prefix ?? process.env.S3_PREFIX ?? 'audio/assignments';
        const normalizedPrefix = prefix.replace(/\/$/, '');
        const key = normalizedPrefix
          ? `${normalizedPrefix}/${basename(audioPath)}`
          : basename(audioPath);
        audioUrl = `https://${bucket}.s3.amazonaws.com/${key}`;
      } else {
        const upload = await uploadFile(audioPath, {
          backend: 's3',
          public: flags.publicRead,
          presignExpiresIn: flags.presign,
          prefix: flags.prefix,
          logger,
        });
        audioUrl = upload.url;
      }

      emitStage('upload', 'success', {
        url: audioUrl,
        dryRun: flags.dryRun,
      });
      executed.push('upload');
    } else {
      emitStage('upload', 'skipped', { reason: 'not requested' });
    }

    if (stepsToRun.has('add-audio')) {
      emitStage('add-audio', 'start');
      if (publishTarget === 'notion') {
        const targetPageId = manifest.pageId;
        if (!targetPageId) {
          throw new Error(
            'Cannot add audio: manifest does not have a pageId. Re-run the import step first.',
          );
        }
        if (!audioUrl) {
          throw new Error('Cannot add audio: no audio URL available. Rerun upload first.');
        }

        if (!flags.dryRun) {
          await addOrReplaceAudioUnderStudyText(targetPageId, audioUrl, { replace: flags.force });
        }

        emitStage('add-audio', 'success', { pageId: targetPageId, url: audioUrl });
      } else {
        const targetPageId = manifest.anytypePageId;
        const targetSpaceId = manifest.anytypeSpaceId;
        if (!targetPageId || !targetSpaceId) {
          throw new Error(
            'Cannot add audio: manifest does not have an Anytype page/space id. Re-run import first.',
          );
        }
        if (!audioUrl) {
          throw new Error('Cannot add audio: no audio URL available. Rerun upload first.');
        }

        if (!flags.dryRun) {
          const client = createAnytypeClient();
          const page = await client.getObject(targetSpaceId, targetPageId);
          const updatedBody = insertAudioBeforeStudyText(page.body ?? '', audioUrl);
          if (updatedBody !== page.body) {
            await client.updateObject(targetSpaceId, targetPageId, { body: updatedBody });
          }

          let headingTheme: { h2?: string; h3?: string } | undefined;
          if (manifest.preset) {
            const preset = await loadPreset(manifest.preset, 'configs/presets.json');
            headingTheme = resolveHeadingTheme(preset);
          }

          const publishResult = await sharePageToS3(targetSpaceId, targetPageId, {
            headingTheme,
          });
          anytypeUrl = publishResult.url;
        }

        emitStage('add-audio', 'success', {
          pageId: targetPageId,
          url: audioUrl,
          publishUrl: anytypeUrl,
        });
      }

      executed.push('add-audio');
    } else {
      emitStage('add-audio', 'skipped', { reason: 'not requested' });
    }

    const updatedManifest: AssignmentManifest = {
      ...manifest,
      schemaVersion: CURRENT_MANIFEST_SCHEMA_VERSION,
      mdHash: hashStudyText(mdContents),
      publishTarget,
      anytypeUrl,
      audio: {
        path: audioPath,
        url: audioUrl,
        hash: audioHash,
        voices: audioVoices,
      },

      // Preserve prior TTS metadata unless explicitly overridden
      ttsStrategy: flags.ttsStrategy ?? manifest.ttsStrategy,
      dialogueLanguage: flags.dialogueLanguage ?? manifest.dialogueLanguage,
      dialogueStability: flags.dialogueStability ?? manifest.dialogueStability,
      dialogueSeed: flags.dialogueSeed ?? manifest.dialogueSeed,

      timestamp: new Date().toISOString(),
    };

    emitStage('manifest', 'start');
    const manifestPath = await manifestStore.writeManifest(flags.md, updatedManifest);
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
      publishTarget: updatedManifest.publishTarget,
      manifestPath,
    };
  } catch (error) {
    const durationMs = Math.max(Date.now() - pipelineStartedAt, 0);
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

let cachedVoiceCatalog: VoiceCatalog | null = null;

async function getVoiceCatalog(): Promise<VoiceCatalog> {
  if (cachedVoiceCatalog) return cachedVoiceCatalog;
  cachedVoiceCatalog = await loadVoicesCatalog().catch<VoiceCatalog>(() => ({ voices: [] }));
  return cachedVoiceCatalog;
}

function findVoiceByToken(token: string, catalog: VoiceCatalog) {
  const normalized = token.trim().toLowerCase();
  return catalog.voices.find(
    (voice) =>
      voice.id === token ||
      (typeof voice.name === 'string' && voice.name.toLowerCase() === normalized),
  );
}

async function applyVoicePreferences(flags: NewAssignmentFlags): Promise<void> {
  const needsResolution = Boolean(flags.voiceId || flags.accentPreference);
  if (!needsResolution) return;

  const catalog = await getVoiceCatalog();
  if (flags.voiceId) {
    const match = findVoiceByToken(flags.voiceId, catalog);
    if (match) {
      flags.voiceId = match.id;
      if (!flags.accentPreference && typeof match.labels?.accent === 'string') {
        flags.accentPreference = match.labels.accent;
      }
      return;
    }
  }

  if (flags.accentPreference) {
    const match = findVoiceByToken(flags.accentPreference, catalog);
    if (match) {
      flags.voiceId = match.id;
      if (typeof match.labels?.accent === 'string') {
        flags.accentPreference = match.labels.accent;
      }
    }
  }
}
