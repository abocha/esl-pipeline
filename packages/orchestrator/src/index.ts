import { dirname, basename } from 'node:path';
import { applyHeadingPreset } from '@esl-pipeline/notion-colorizer';
import { buildStudyTextMp3, hashStudyText } from '@esl-pipeline/tts-elevenlabs';
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

export async function newAssignment(flags: NewAssignmentFlags): Promise<{
  pageId?: string;
  pageUrl?: string;
  audio?: { path?: string; url?: string; hash?: string };
  colorized?: boolean;
  manifestPath?: string;
  steps: string[];
}> {
  const steps: string[] = [];
  const mdContents = await readFile(flags.md, 'utf8');
  const previousManifest = await readManifest(flags.md);

  let pageId = previousManifest?.pageId;
  let pageUrl = previousManifest?.pageUrl;

  let colorized = false;

  if (flags.skipImport) {
    steps.push('skip:validate');
    steps.push('skip:import');
    if (!pageId && !flags.dryRun) {
      throw new Error(
        'Cannot skip import because no existing pageId was found. Run a full pipeline first.'
      );
    }
  } else {
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
  }

  if (flags.preset) {
    if (flags.dryRun) {
      steps.push(
        `colorize:${flags.preset}:0/0/0`
      );
      colorized = true;
    } else {
      if (!pageId) {
        throw new Error(
          'Cannot apply color preset because no Notion pageId is available. Run import first.'
        );
      }
      steps.push('colorize');
      const color = await applyHeadingPreset(
        pageId,
        flags.preset,
        flags.presetsPath ?? 'configs/presets.json'
      );
      steps.push(
        `colorize:${flags.preset}:${color.counts.h2}/${color.counts.h3}/${color.counts.toggles}`
      );
      colorized = true;
    }
  }

  let audio = previousManifest?.audio ? { ...previousManifest.audio } : undefined;
  if (flags.withTts) {
    if (flags.skipTts) {
      steps.push('skip:tts');
      if (!audio?.path && !flags.dryRun) {
        throw new Error(
          'Cannot skip TTS because manifest has no audio.path. Run TTS at least once first.'
        );
      }
    } else {
      steps.push('tts');
      const ttsResult = await buildStudyTextMp3(flags.md, {
        voiceMapPath: flags.voices ?? 'configs/voices.yml',
        outPath: flags.out ?? dirname(flags.md),
        preview: flags.dryRun,
        force: flags.force || flags.redoTts,
      });
      audio = { path: ttsResult.path, hash: ttsResult.hash };

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
    audio = undefined;
  }

  if (flags.upload === 's3' && audio?.path) {
    if (flags.skipUpload) {
      steps.push('skip:upload');
      if (!audio.url && !flags.dryRun) {
        throw new Error(
          'Cannot skip upload because manifest has no existing audio.url. Upload once before skipping.'
        );
      }
    } else {
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
    }
  }

  if (audio?.url && pageId) {
    if (flags.skipUpload) {
      steps.push('skip:add-audio');
    } else if (flags.dryRun) {
      steps.push('add-audio');
    } else {
      steps.push('add-audio');
      await addOrReplaceAudioUnderStudyText(pageId, audio.url, { replace: flags.force });
    }
  }

  const manifest: AssignmentManifest = {
    mdHash: hashStudyText(mdContents),
    pageId,
    pageUrl,
    audio,
    preset: flags.preset,
    timestamp: new Date().toISOString(),
  };

  const manifestPath = await writeManifest(flags.md, manifest);
  steps.push('manifest');

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
  audio?: { path?: string; url?: string; hash?: string };
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

  if (stepsToRun.has('tts')) {
    const ttsResult = await buildStudyTextMp3(flags.md, {
      voiceMapPath: flags.voices ?? 'configs/voices.yml',
      outPath: flags.out ?? dirname(flags.md),
      preview: flags.dryRun,
      force: flags.force,
    });
    audioPath = ttsResult.path;
    audioHash = ttsResult.hash;
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
