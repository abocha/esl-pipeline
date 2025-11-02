import { dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyHeadingPreset } from '@esl-pipeline/notion-colorizer';
import {
  buildStudyTextMp3,
  hashStudyText,
  FfmpegNotFoundError,
  type BuildStudyTextResult,
} from '@esl-pipeline/tts-elevenlabs';
import { uploadFile } from '@esl-pipeline/storage-uploader';
import { addOrReplaceAudioUnderStudyText } from '@esl-pipeline/notion-add-audio';
import { runImport } from '@esl-pipeline/notion-importer';
import {
  type AssignmentManifest,
  type ManifestStore,
  createFilesystemManifestStore,
} from './manifest.js';
import type { ConfigProvider } from './config.js';
import {
  noopLogger,
  noopMetrics,
  type PipelineLogger,
  type PipelineMetrics,
} from './observability.js';
import { access, readFile } from 'node:fs/promises';
import { constants as FS } from 'node:fs';

export type AssignmentStage =
  | 'validate'
  | 'import'
  | 'colorize'
  | 'tts'
  | 'upload'
  | 'add-audio'
  | 'manifest';

export type AssignmentStageStatus = 'start' | 'success' | 'skipped';

export type AssignmentProgressEvent = {
  stage: AssignmentStage;
  status: AssignmentStageStatus;
  detail?: Record<string, unknown>;
};

export type AssignmentProgressCallbacks = {
  onStage?: (event: AssignmentProgressEvent) => void;
};

const fallbackManifestStore = createFilesystemManifestStore();
const fallbackLogger = noopLogger;
const fallbackMetrics = noopMetrics;

export type OrchestratorDependencies = {
  manifestStore?: ManifestStore;
  configProvider?: ConfigProvider;
  logger?: PipelineLogger;
  metrics?: PipelineMetrics;
  runId?: string;
};

export {
  manifestPathFor,
  readManifest,
  writeManifest,
  createFilesystemManifestStore,
} from './manifest.js';
export { createFilesystemConfigProvider } from './config.js';
export { S3ManifestStore, type S3ManifestStoreOptions } from './adapters/manifest/s3.js';
export { RemoteConfigProvider, type RemoteConfigProviderOptions } from './adapters/config/remote.js';
export type { AssignmentManifest, ManifestStore } from './manifest.js';
export type { ConfigProvider } from './config.js';
export { noopLogger, noopMetrics } from './observability.js';
export type { PipelineLogger, PipelineMetrics, PipelineLogEvent, PipelineLogLevel } from './observability.js';
export {
  createPipeline,
  resolveConfigPaths,
  loadEnvFiles,
  resolveManifestPath,
} from './pipeline.js';
export type {
  CreatePipelineOptions,
  OrchestratorPipeline,
  ResolvedConfigPaths,
  PipelineNewAssignmentOptions,
  PipelineRerunOptions,
} from './pipeline.js';

export function summarizeVoiceSelections(
  voices?: BuildStudyTextResult['voices']
): string | undefined {
  if (!voices || voices.length === 0) return undefined;
  return voices
    .map(voice => {
      const name = voice.voiceName ?? voice.voiceId;
      const tags: string[] = [];
      if (voice.gender) tags.push(voice.gender);
      switch (voice.source) {
        case 'profile':
          tags.push('profile');
          break;
        case 'voiceMap':
          tags.push('map');
          break;
        case 'auto':
          tags.push(typeof voice.score === 'number' ? `auto ${Math.round(voice.score)}` : 'auto');
          break;
        case 'default':
          tags.push('default');
          break;
        case 'fallback':
          tags.push('fallback');
          break;
        case 'reuse':
          tags.push('reuse');
          break;
      }
      if (voice.accent && tags.length < 3) tags.push(voice.accent);
      const tagString = tags.length ? ` (${tags.join(', ')})` : '';
      return `${voice.speaker}→${name}${tagString}`;
    })
    .join(', ');
}

export type NewAssignmentFlags = {
  md: string;
  student?: string;
  preset?: string;
  presetsPath?: string;
  accentPreference?: string;
  withTts?: boolean;
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
};

export async function newAssignment(
  flags: NewAssignmentFlags,
  callbacks: AssignmentProgressCallbacks = {},
  dependencies: OrchestratorDependencies = {}
): Promise<{
  pageId?: string;
  pageUrl?: string;
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

  const emitStage = (
    stage: AssignmentStage,
    status: AssignmentStageStatus,
    detail?: Record<string, unknown>
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
    const durationMs = startedAt !== undefined ? Math.max(Date.now() - startedAt, 0) : undefined;
    const detailWithDuration =
      durationMs !== undefined
        ? { ...(detail ?? {}), durationMs }
        : detail;

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
  const mdContents = await readFile(flags.md, 'utf8');
  const previousManifest = await manifestStore.readManifest(flags.md);

  let pageId = previousManifest?.pageId;
  let pageUrl = previousManifest?.pageUrl;

  let colorized = false;

  logger.log({
    level: 'info',
    message: 'pipeline.newAssignment.start',
    runId,
    stage: 'pipeline',
    detail: { md: flags.md, preset: flags.preset, student: flags.student },
  });

  try {
    if (flags.skipImport) {
    recordSkip('validate', 'skip-import flag set');
    recordSkip('import', 'skip-import flag set');
    steps.push('skip:validate');
    steps.push('skip:import');
    if (!pageId && !flags.dryRun) {
      throw new Error(
        'Cannot skip import because no existing pageId was found. Run a full pipeline first.'
      );
    }
  } else {
    emitStage('validate', 'start');
    emitStage('import', 'start');
    steps.push('validate');
    steps.push('import');
    const importResult = await runImport({
      mdPath: flags.md,
      dbId: flags.dbId,
      dbName: flags.db,
      dataSourceId: flags.dataSourceId,
      dataSourceName: flags.dataSource,
      student: flags.student,
      dryRun: flags.dryRun,
    });
    pageId = importResult.page_id;
    pageUrl = importResult.url;
    emitStage('validate', 'success');
    emitStage('import', 'success', {
      pageUrl,
      studentLinked: importResult.studentLinked ?? undefined,
    });
  }

  if (flags.preset) {
    if (flags.dryRun) {
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
        throw new Error(
          'Cannot apply color preset because no Notion pageId is available. Run import first.'
        );
      }
      emitStage('colorize', 'start');
      steps.push('colorize');
      const color = await applyHeadingPreset(
        pageId,
        flags.preset,
        flags.presetsPath ?? 'configs/presets.json'
      );
      steps.push(
        `colorize:${flags.preset}:${color.counts.h2}/${color.counts.h3}/${color.counts.toggles}`
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
        throw new Error(
          'Cannot skip TTS because manifest has no audio.path. Run TTS at least once first.'
        );
      }
    } else {
      emitStage('tts', 'start');
      steps.push('tts');
      let ttsResult: Awaited<ReturnType<typeof buildStudyTextMp3>>;
      try {
        ttsResult = await buildStudyTextMp3(flags.md, {
          voiceMapPath: flags.voices ?? 'configs/voices.yml',
          outPath: flags.out ?? dirname(flags.md),
          preview: flags.dryRun,
          force: flags.force || flags.redoTts,
          defaultAccent: flags.accentPreference,
        });
      } catch (error: unknown) {
        if (error instanceof FfmpegNotFoundError) {
          throw new Error(`TTS requires FFmpeg.\n\n${error.message}`, { cause: error });
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
          throw new Error(
            `No audio file produced at ${audioPath}. ` +
              `Check that :::study-text has lines and voices.yml has 'default' or 'auto: true'.`
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
        throw new Error(
          'Cannot skip upload because manifest has no existing audio.url. Upload once before skipping.'
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

  const manifest: AssignmentManifest = {
    mdHash: hashStudyText(mdContents),
    pageId,
    pageUrl,
    audio,
    preset: flags.preset,
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

export type AssignmentStatus = {
  manifestPath: string;
  manifest: AssignmentManifest | null;
  mdHashMatches: boolean;
  audioFileExists: boolean;
};

export async function getAssignmentStatus(
  mdPath: string,
  dependencies: OrchestratorDependencies = {}
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
    metrics.timing('esl.pipeline.get_assignment_status.duration_ms', durationMs, { result: 'success' });
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
    metrics.timing('esl.pipeline.get_assignment_status.duration_ms', durationMs, { result: 'failure' });
    metrics.increment('esl.pipeline.get_assignment_status.failure', 1, {});
    throw error;
  }
}

export type RerunFlags = {
  md: string;
  steps?: Array<'tts' | 'upload' | 'add-audio'>;
  voices?: string;
  out?: string;
  force?: boolean;
  dryRun?: boolean;
  upload?: 's3';
  prefix?: string;
  publicRead?: boolean;
  presign?: number;
  accentPreference?: string;
};

export async function rerunAssignment(
  flags: RerunFlags,
  dependencies: OrchestratorDependencies = {}
): Promise<{
  steps: string[];
  audio?: { path?: string; url?: string; hash?: string; voices?: BuildStudyTextResult['voices'] };
  pageId?: string;
  pageUrl?: string;
  manifestPath: string;
}> {
  const manifestStore = dependencies.manifestStore ?? fallbackManifestStore;
  const logger = dependencies.logger ?? fallbackLogger;
  const metrics = dependencies.metrics ?? fallbackMetrics;
  const runId = dependencies.runId ?? randomUUID();
  const pipelineStartedAt = Date.now();
  const stageStartTimes = new Map<AssignmentStage, number>();

  const emitStage = (
    stage: AssignmentStage,
    status: AssignmentStageStatus,
    detail?: Record<string, unknown>
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
    const durationMs = startedAt !== undefined ? Math.max(Date.now() - startedAt, 0) : undefined;
    const detailWithDuration =
      durationMs !== undefined
        ? { ...(detail ?? {}), durationMs }
        : detail;

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
      flags.steps && flags.steps.length ? flags.steps : ['upload', 'add-audio']
    );
    const executed: string[] = [];

    const mdContents = await readFile(flags.md, 'utf8');
    let audioPath = manifest.audio?.path;
    let audioUrl = manifest.audio?.url;
    let audioHash = manifest.audio?.hash;
    let audioVoices = manifest.audio?.voices;

    if (stepsToRun.has('tts')) {
      emitStage('tts', 'start');
      let ttsResult: Awaited<ReturnType<typeof buildStudyTextMp3>>;
      try {
        ttsResult = await buildStudyTextMp3(flags.md, {
          voiceMapPath: flags.voices ?? 'configs/voices.yml',
          outPath: flags.out ?? dirname(flags.md),
          preview: flags.dryRun,
          force: flags.force,
          defaultAccent: flags.accentPreference,
        });
      } catch (error: unknown) {
        if (error instanceof FfmpegNotFoundError) {
          throw new Error(`TTS requires FFmpeg.\n\n${error.message}`, { cause: error });
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
          'Cannot upload audio: no audio path found. Re-run TTS or provide a manifest with audio.path.'
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
      const targetPageId = manifest.pageId;
      if (!targetPageId) {
        throw new Error(
          'Cannot add audio: manifest does not have a pageId. Re-run the import step first.'
        );
      }
      if (!audioUrl) {
        throw new Error('Cannot add audio: no audio URL available. Rerun upload first.');
      }

      if (!flags.dryRun) {
        await addOrReplaceAudioUnderStudyText(targetPageId, audioUrl, { replace: flags.force });
      }

      emitStage('add-audio', 'success', { pageId: targetPageId, url: audioUrl });
      executed.push('add-audio');
    } else {
      emitStage('add-audio', 'skipped', { reason: 'not requested' });
    }

    const updatedManifest: AssignmentManifest = {
      ...manifest,
      mdHash: hashStudyText(mdContents),
      audio: {
        path: audioPath,
        url: audioUrl,
        hash: audioHash,
        voices: audioVoices,
      },
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
