import { dirname } from 'node:path';
import { applyHeadingPreset } from '@esl-pipeline/notion-colorizer';
import { buildStudyTextMp3, hashStudyText } from '@esl-pipeline/tts-elevenlabs';
import { uploadFile } from '@esl-pipeline/storage-uploader';
import { addAudioUnderStudyText } from '@esl-pipeline/notion-add-audio';
import { writeManifest, type AssignmentManifest } from './manifest.js';

export type NewAssignmentFlags = {
  md: string;
  student?: string;
  preset?: string;
  presetsPath?: string;
  withTts?: boolean;
  upload?: 's3';
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
  const pageHash = hashStudyText(flags.md).slice(0, 12);
  const pageId = `page_${pageHash}`;
  // Use a dummy UUID for dry-run mode
  const realPageId = flags.dryRun ? 'ce06f3e4-e332-4b83-8b34-6b8c6e6e6e6e' : pageId;
  const pageUrl = `https://www.notion.so/${pageId}`;

  steps.push('validate');
  steps.push('import');

  let colorized = false;
  if (flags.preset && !flags.dryRun) {
    steps.push('colorize');
    const color = await applyHeadingPreset(realPageId, flags.preset, flags.presetsPath ?? "configs/presets.json");
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
      preview: true
    });
    audio = { path: ttsResult.path, hash: ttsResult.hash };
  }

  if (flags.upload === 's3' && audio?.path) {
    steps.push('upload');
    const upload = await uploadFile(audio.path, { backend: 's3', public: !flags.dryRun });
    audio.url = upload.url;
  }

  if (audio?.url) {
    steps.push('add-audio');
    await addAudioUnderStudyText(pageId, audio.url, { replace: flags.force });
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
