import { basename, dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { BuildStudyTextResult } from '@esl-pipeline/tts-elevenlabs';

export type AssignmentManifest = {
  mdHash: string;
  pageId?: string;
  pageUrl?: string;
  audio?: {
    path?: string;
    url?: string;
    hash?: string;
    voices?: BuildStudyTextResult['voices'];
  };
  preset?: string;
  timestamp: string;
};

export function manifestPathFor(mdPath: string): string {
  const dir = dirname(mdPath);
  const base = basename(mdPath).replace(/\.[^.]+$/, '');
  return join(dir, `${base}.manifest.json`);
}

export async function writeManifest(mdPath: string, manifest: AssignmentManifest): Promise<string> {
  const target = manifestPathFor(mdPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(manifest, null, 2));
  return target;
}

export async function readManifest(mdPath: string): Promise<AssignmentManifest | null> {
  try {
    const contents = await readFile(manifestPathFor(mdPath), 'utf8');
    return JSON.parse(contents) as AssignmentManifest;
  } catch {
    return null;
  }
}
