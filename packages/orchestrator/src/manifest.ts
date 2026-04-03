import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type {
  PronunciationAudioClip,
  PronunciationAudioPayload,
} from '@esl-pipeline/shared-infrastructure';
import type { BuildStudyTextResult } from '@esl-pipeline/tts-core';

export const CURRENT_MANIFEST_SCHEMA_VERSION = 3;
const LEGACY_MANIFEST_SCHEMA_VERSION = 1;

export interface AudioArtifactManifest {
  path?: string;
  url?: string;
  hash?: string;
  key?: string;
  etag?: string;
  sizeBytes?: number;
  reused?: boolean;
  voices?: BuildStudyTextResult['voices'];
  voiceId?: string;
  notionBlockId?: string;
  tts?: {
    provider?: string;
    generatedCharacters?: number;
    cachedCharacters?: number;
    costPer1kCharsUsd?: number;
    estimatedSpendUsd?: number;
  };
}

export interface PronunciationAudioWarning {
  code: string;
  message: string;
}

type PronunciationAudioArtifactManifest = PronunciationAudioClip & AudioArtifactManifest;

export interface AssignmentManifest {
  schemaVersion?: number;
  mdHash: string;
  pageId?: string;
  pageUrl?: string;
  publishTarget?: 'notion' | 'anytype' | 'html';
  anytypePageId?: string;
  anytypeSpaceId?: string;
  anytypeUrl?: string;
  htmlUrl?: string;
  htmlHash?: string;
  htmlKey?: string;
  htmlEtag?: string;
  htmlReused?: boolean;
  audioArtifacts?: {
    studyText?: AudioArtifactManifest;
    pronunciationShadowSentence?: AudioArtifactManifest;
    pronunciation?: Omit<PronunciationAudioPayload, 'primaryClip' | 'itemClips'> & {
      primaryClip?: PronunciationAudioArtifactManifest | null;
      itemClips?: PronunciationAudioArtifactManifest[];
      warnings?: PronunciationAudioWarning[];
    };
  };
  preset?: string;
  notionColorization?: {
    preset: string;
    presetHash: string;
    pageId: string;
    mdHash: string;
    appliedAt: string;
  };

  // TTS strategy information for reproducibility
  ttsStrategy?: 'auto' | 'dialogue' | 'tts';
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;

  timestamp: string;
}

export interface ManifestStore {
  manifestPathFor(mdPath: string): string;
  writeManifest(mdPath: string, manifest: AssignmentManifest): Promise<string>;
  readManifest(mdPath: string): Promise<AssignmentManifest | null>;
}

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

      // Only include optional TTS fields if they exist
      const compatibleManifest = {
        ...manifest,
        ...(manifest.ttsStrategy && { ttsStrategy: manifest.ttsStrategy }),
        ...(manifest.dialogueLanguage && { dialogueLanguage: manifest.dialogueLanguage }),
        ...(manifest.dialogueStability !== undefined && {
          dialogueStability: manifest.dialogueStability,
        }),
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
          parsed.schemaVersion = LEGACY_MANIFEST_SCHEMA_VERSION;
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
