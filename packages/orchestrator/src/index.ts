import { dirname, basename } from 'node:path';
import { applyHeadingPreset } from '@esl-pipeline/notion-colorizer';
import {
  buildStudyTextMp3,
  hashStudyText,
  type BuildStudyTextResult,
} from '@esl-pipeline/tts-elevenlabs';
import { uploadFile } from '@esl-pipeline/storage-uploader';
import { addOrReplaceAudioUnderStudyText } from '@esl-pipeline/notion-add-audio';
import { runImport } from '@esl-pipeline/notion-importer';
import {
  writeManifest,
  readManifest,
  manifestPathFor,
  type AssignmentManifest,
} from './manifest.js';
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
  callbacks: AssignmentProgressCallbacks = {}
): Promise<{
  pageId?: string;
  pageUrl?: string;
  audio?: { path?: string; url?: string; hash?: string; voices?: BuildStudyTextResult['voices'] };
  colorized?: boolean;
  manifestPath?: string;
  steps: string[];
}> {
  const emitStage = (
    stage: AssignmentStage,
    status: AssignmentStageStatus,
    detail?: Record<string, unknown>
  ) => {
    callbacks.onStage?.({ stage, status, detail });
  };

  const recordSkip = (stage: AssignmentStage, reason: string) =>
    emitStage(stage, 'skipped', { reason });

  const steps: string[] = [];
  const mdContents = await readFile(flags.md, 'utf8');
  const previousManifest = await readManifest(flags.md);

  let pageId = previousManifest?.pageId;
  let pageUrl = previousManifest?.pageUrl;

  let colorized = false;

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
      const ttsResult = await buildStudyTextMp3(flags.md, {
        voiceMapPath: flags.voices ?? 'configs/voices.yml',
        outPath: flags.out ?? dirname(flags.md),
        preview: flags.dryRun,
        force: flags.force || flags.redoTts,
      });
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
  const manifestPath = await writeManifest(flags.md, manifest);
  steps.push('manifest');
  emitStage('manifest', 'success', { manifestPath });

  return {
    pageId,
    pageUrl,
    audio,
    colorized,
    manifestPath,
    steps,
  };
}

export type AssignmentStatus = {
  manifestPath: string;
  manifest: AssignmentManifest | null;
  mdHashMatches: boolean;
  audioFileExists: boolean;
};

export async function getAssignmentStatus(mdPath: string): Promise<AssignmentStatus> {
  const manifestPath = manifestPathFor(mdPath);
  const manifest = await readManifest(mdPath);

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

  return {
    manifestPath,
    manifest,
    mdHashMatches,
    audioFileExists,
  };
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
};

export async function rerunAssignment(flags: RerunFlags): Promise<{
  steps: string[];
  audio?: { path?: string; url?: string; hash?: string; voices?: BuildStudyTextResult['voices'] };
  pageId?: string;
  pageUrl?: string;
  manifestPath: string;
}> {
  const manifest = await readManifest(flags.md);
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
    const ttsResult = await buildStudyTextMp3(flags.md, {
      voiceMapPath: flags.voices ?? 'configs/voices.yml',
      outPath: flags.out ?? dirname(flags.md),
      preview: flags.dryRun,
      force: flags.force,
    });
    audioPath = ttsResult.path;
    audioHash = ttsResult.hash;
    audioVoices = ttsResult.voices;
    executed.push('tts');
  }

  if (stepsToRun.has('upload')) {
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

    executed.push('upload');
  }

  if (stepsToRun.has('add-audio')) {
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

    executed.push('add-audio');
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

  const manifestPath = await writeManifest(flags.md, updatedManifest);

  return {
    steps: executed,
    audio: updatedManifest.audio,
    pageId: updatedManifest.pageId,
    pageUrl: updatedManifest.pageUrl,
    manifestPath,
  };
}
