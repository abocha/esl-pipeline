import fs from 'node:fs/promises';
import path from 'node:path';

import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';

export type JobPronunciationMode =
  | 'shadow_sentence'
  | 'connected_speech'
  | 'intonation'
  | 'rhythm_chunking'
  | 'sentence_stress'
  | 'minimal_pair';

const PRONUNCIATION_MODE_VALUES = new Set<JobPronunciationMode>([
  'shadow_sentence',
  'connected_speech',
  'intonation',
  'rhythm_chunking',
  'sentence_stress',
  'minimal_pair',
]);

export async function detectJobPronunciationMode(args: {
  md: string | null;
  mdStorageUri?: string | null;
}): Promise<JobPronunciationMode | null> {
  const markdown = await readJobMarkdownSource(args);
  if (!markdown) {
    return null;
  }

  const match = markdown.match(/\*\*Mode:\*\*\s*([a-z_]+)/i);
  if (!match) {
    return null;
  }

  const mode = match[1]?.trim().toLowerCase();
  return mode && PRONUNCIATION_MODE_VALUES.has(mode as JobPronunciationMode)
    ? (mode as JobPronunciationMode)
    : null;
}

async function readJobMarkdownSource(args: {
  md: string | null;
  mdStorageUri?: string | null;
}): Promise<string | null> {
  if (args.mdStorageUri) {
    try {
      const storage = createTranscriptionStorageForUri(args.mdStorageUri);
      return await storage.getText(args.mdStorageUri);
    } catch {
      return null;
    }
  }

  if (!args.md) {
    return null;
  }

  try {
    const resolvedPath = await resolveMarkdownPath(args.md);
    return await fs.readFile(resolvedPath, 'utf8');
  } catch {
    return null;
  }
}

async function resolveMarkdownPath(mdPath: string): Promise<string> {
  const sanitized = mdPath.trim();
  const candidates = new Set<string>();

  if (path.isAbsolute(sanitized)) {
    candidates.add(sanitized);
  } else {
    candidates.add(path.resolve(process.cwd(), sanitized));
    candidates.add(path.resolve(process.cwd(), 'uploads', sanitized.replace(/^uploads[\\/]/, '')));
  }

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  throw new Error(`Markdown file not found: ${mdPath}`);
}
