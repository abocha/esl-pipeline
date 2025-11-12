import { basename, dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { BuildStudyTextResult } from '@esl-pipeline/tts-elevenlabs';

export const CURRENT_MANIFEST_SCHEMA_VERSION = 1;

export type AssignmentManifest = {
  schemaVersion?: number;
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
  
  // TTS mode information for reproducibility
  ttsMode?: 'auto' | 'dialogue' | 'monologue';
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
  
  timestamp: string;
};

export type ManifestStore = {
  manifestPathFor(mdPath: string): string;
  writeManifest(mdPath: string, manifest: AssignmentManifest): Promise<string>;
  readManifest(mdPath: string): Promise<AssignmentManifest | null>;
};

export function createFilesystemManifestStore(): ManifestStore {
  const manifestPathFor = (mdPath: string): string => {
    const dir = dirname(mdPath);
    const base = basename(mdPath).replace(/\.[^.]+$/, '');
    return join(dir, `${base}.manifest.json`);
  };

  return {
    manifestPathFor,
    async writeManifest(mdPath, manifest) {
      const target = manifestPathFor(mdPath);
      await mkdir(dirname(target), { recursive: true });
      
      // Ensure backward compatibility: only include TTS mode fields if they exist
      const compatibleManifest = {
        ...manifest,
        ...(manifest.ttsMode && { ttsMode: manifest.ttsMode }),
        ...(manifest.dialogueLanguage && { dialogueLanguage: manifest.dialogueLanguage }),
        ...(manifest.dialogueStability !== undefined && { dialogueStability: manifest.dialogueStability }),
        ...(manifest.dialogueSeed !== undefined && { dialogueSeed: manifest.dialogueSeed }),
      };
      
      await writeFile(target, JSON.stringify(compatibleManifest, null, 2));
      return target;
    },
    async readManifest(mdPath) {
      try {
        const contents = await readFile(manifestPathFor(mdPath), 'utf8');
        const parsed = JSON.parse(contents) as AssignmentManifest;
        if (parsed.schemaVersion === undefined) {
          parsed.schemaVersion = CURRENT_MANIFEST_SCHEMA_VERSION;
        }
        return parsed;
      } catch {
        return null;
      }
    },
  };
}

const defaultManifestStore = createFilesystemManifestStore();

export function manifestPathFor(mdPath: string): string {
  return defaultManifestStore.manifestPathFor(mdPath);
}

export async function writeManifest(mdPath: string, manifest: AssignmentManifest): Promise<string> {
  return defaultManifestStore.writeManifest(mdPath, manifest);
}

export async function readManifest(mdPath: string): Promise<AssignmentManifest | null> {
  return defaultManifestStore.readManifest(mdPath);
}
