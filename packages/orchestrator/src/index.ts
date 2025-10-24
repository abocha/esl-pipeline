import { dirname, basename } from 'node:path';
import { applyHeadingPreset } from '@esl-pipeline/notion-colorizer';
import { buildStudyTextMp3, hashStudyText } from '@esl-pipeline/tts-elevenlabs';
import { uploadFile } from '@esl-pipeline/storage-uploader';
import { addOrReplaceAudioUnderStudyText } from '@esl-pipeline/notion-add-audio';
import { runImport } from '@esl-pipeline/notion-importer';
import { writeManifest, type AssignmentManifest } from './manifest.js';

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
  steps.push('validate');
  steps.push('import');
  const importResult = await runImport({
    mdPath: flags.md,
    dbId: flags.dbId,
    dbName: flags.db,
    dataSourceId: flags.dataSourceId,
    dataSourceName: flags.dataSource,
    student: flags.student,
    dryRun: flags.dryRun
  });
  const pageId = importResult.page_id;
  const pageUrl = importResult.url;

  let colorized = false;
  if (flags.preset && !flags.dryRun) {
    steps.push('colorize');
    const color = await applyHeadingPreset(pageId, flags.preset, flags.presetsPath ?? "configs/presets.json");
    steps.push(`colorize:${flags.preset}:${color.counts.h2}/${color.counts.h3}/${color.counts.toggles}`);
    colorized = true;
  } else if (flags.preset && flags.dryRun) {
    // In dry-run mode, pretend we colorized
    steps.push(`colorize:${flags.preset}:0/0/0`);
    colorized = true;
  }

  let audio: { path?: string; url?: string; hash?: string } | undefined;
  if (flags.withTts) {
    steps.push('tts');
    const ttsResult = await buildStudyTextMp3(flags.md, {
      voiceMapPath: flags.voices ?? 'voices.json',
      outPath: flags.out ?? dirname(flags.md),
      preview: flags.dryRun
    });
    audio = { path: ttsResult.path, hash: ttsResult.hash };
  }

  if (flags.upload === 's3' && audio?.path) {
    steps.push('upload');
    if (flags.dryRun) {
      // In dry-run mode, generate a realistic preview URL without uploading
      const bucket = process.env.S3_BUCKET ?? 'stub-bucket';
      const prefix = flags.prefix ?? process.env.S3_PREFIX ?? 'audio/assignments';
      const key = `${prefix.replace(/\/$/, '')}/${basename(audio.path)}`;
      audio.url = `https://${bucket}.s3.amazonaws.com/${key}`;
    } else {
      const upload = await uploadFile(audio.path, {
        backend: 's3',
        public: flags.publicRead,
        presignExpiresIn: flags.presign,
        prefix: flags.prefix
      });
      audio.url = upload.url;
    }
  }

  if (audio?.url && pageId && !flags.dryRun) {
    steps.push('add-audio');
    await addOrReplaceAudioUnderStudyText(pageId, audio.url, { replace: flags.force });
  } else if (audio?.url && pageId && flags.dryRun) {
    // In dry-run mode, skip the Notion API call
    steps.push('add-audio');
  }

  const manifest: AssignmentManifest = {
    mdHash: hashStudyText(flags.md),
    pageId,
    pageUrl,
    audio,
    preset: flags.preset,
    timestamp: new Date().toISOString()
  };

  const manifestPath = await writeManifest(flags.md, manifest);
  steps.push('manifest');

  return {
    pageId,
    pageUrl,
    audio,
    colorized,
    manifestPath,
    steps
  };
}
