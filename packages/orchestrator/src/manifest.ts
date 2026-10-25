import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type {
  PronunciationAudioClip,
  PronunciationAudioPayload,
} from '@esl-pipeline/shared-infrastructure';
import type {
  BuildStudyTextResult,
  SpeechPerformancePlan,
  VoicePlan,
} from '@esl-pipeline/tts-core';

export const CURRENT_MANIFEST_SCHEMA_VERSION = 6;
const LEGACY_MANIFEST_SCHEMA_VERSION = 1;

export interface AudioArtifactManifest {
  path?: string;
  url?: string;
  hash?: string;
  key?: string;
  etag?: string;
  sizeBytes?: number;
  reused?: boolean;
  voicePlanHash?: string;
  speechPlanHash?: string;
  voices?: BuildStudyTextResult['voices'];
  voiceId?: string;
  tts?: {
    provider?: string;
    modelId?: string;
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
  assignmentHash?: string;
  publication?: import('@esl-pipeline/contracts').AssignmentPublicationMetadata;
  schemaVersion?: number;
  mdHash: string;
  publishTarget?: 'html';
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
  speechPlans?: {
    studyText?: SpeechPerformancePlan;
  };
  voicePlans?: {
    studyText?: VoicePlan;
  };
  preset?: string;

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

export function normalizeManifestPublishTarget(
  _value: AssignmentManifest['publishTarget'] | string | null | undefined,
): 'html' {
  return 'html';
}

function sanitizeAudioArtifactManifest(
  artifact: AudioArtifactManifest | null | undefined,
): AudioArtifactManifest | undefined {
  if (!artifact) {
    return undefined;
  }

  return {
    ...(artifact.path !== undefined ? { path: artifact.path } : {}),
    ...(artifact.url !== undefined ? { url: artifact.url } : {}),
    ...(artifact.hash !== undefined ? { hash: artifact.hash } : {}),
    ...(artifact.key !== undefined ? { key: artifact.key } : {}),
    ...(artifact.etag !== undefined ? { etag: artifact.etag } : {}),
    ...(artifact.sizeBytes !== undefined ? { sizeBytes: artifact.sizeBytes } : {}),
    ...(artifact.reused !== undefined ? { reused: artifact.reused } : {}),
    ...(artifact.voicePlanHash !== undefined ? { voicePlanHash: artifact.voicePlanHash } : {}),
    ...(artifact.speechPlanHash !== undefined ? { speechPlanHash: artifact.speechPlanHash } : {}),
    ...(artifact.voices !== undefined ? { voices: artifact.voices } : {}),
    ...(artifact.voiceId !== undefined ? { voiceId: artifact.voiceId } : {}),
    ...(artifact.tts !== undefined ? { tts: artifact.tts } : {}),
  };
}

function sanitizeVoicePlan(plan: VoicePlan): VoicePlan {
  const { capabilityPolicyVersion: _capabilityPolicyVersion, assignments, ...rest } = plan;
  const sanitized: VoicePlan = {
    ...rest,
    mode: (plan as { mode: string }).mode === 'resolved' ? 'deterministic' : plan.mode,
    assignments: assignments.map((assignment) => {
      const { language: _language, ...assignmentRest } = assignment;
      return {
        ...assignmentRest,
        ...(typeof assignment.language === 'string' && assignment.language.trim().length > 0
          ? { language: assignment.language }
          : {}),
      };
    }),
  };
  return plan.capabilityPolicyVersion === 'model-scoped-v1'
    ? { ...sanitized, capabilityPolicyVersion: plan.capabilityPolicyVersion }
    : sanitized;
}

function sanitizeSpeechPlan(plan: SpeechPerformancePlan): SpeechPerformancePlan {
  if (!plan.planner) return plan;
  const {
    promptPolicyVersion: _promptPolicyVersion,
    promptHash: _promptHash,
    ...planner
  } = plan.planner;
  const promptPolicyVersion = plan.planner.promptPolicyVersion;
  const promptHash = plan.planner.promptHash;
  return {
    ...plan,
    planner: {
      ...planner,
      ...(promptPolicyVersion === 'speech-performance-v1-restrained-natural' ||
      promptPolicyVersion === 'speech-performance-v2-inworld-tts2' ||
      promptPolicyVersion === 'contextual-bracket-annotation-v1'
        ? { promptPolicyVersion }
        : {}),
      ...(typeof promptHash === 'string' && /^[a-f0-9]{64}$/u.test(promptHash)
        ? { promptHash }
        : {}),
    },
  };
}

export function sanitizeAssignmentManifest(manifest: AssignmentManifest): AssignmentManifest {
  const audioArtifacts = manifest.audioArtifacts
    ? {
        ...(manifest.audioArtifacts.studyText
          ? {
              studyText: sanitizeAudioArtifactManifest(manifest.audioArtifacts.studyText),
            }
          : {}),
        ...(manifest.audioArtifacts.pronunciationShadowSentence
          ? {
              pronunciationShadowSentence: sanitizeAudioArtifactManifest(
                manifest.audioArtifacts.pronunciationShadowSentence,
              ),
            }
          : {}),
        ...(manifest.audioArtifacts.pronunciation
          ? {
              pronunciation: {
                ...manifest.audioArtifacts.pronunciation,
                ...(manifest.audioArtifacts.pronunciation.primaryClip
                  ? {
                      primaryClip: {
                        ...manifest.audioArtifacts.pronunciation.primaryClip,
                        ...sanitizeAudioArtifactManifest(
                          manifest.audioArtifacts.pronunciation.primaryClip,
                        ),
                      },
                    }
                  : {}),
                ...(manifest.audioArtifacts.pronunciation.itemClips
                  ? {
                      itemClips: manifest.audioArtifacts.pronunciation.itemClips.map((clip) => ({
                        ...clip,
                        ...sanitizeAudioArtifactManifest(clip),
                      })),
                    }
                  : {}),
              },
            }
          : {}),
      }
    : undefined;

  return {
    ...(manifest.schemaVersion !== undefined ? { schemaVersion: manifest.schemaVersion } : {}),
    mdHash: manifest.mdHash,
    ...(manifest.assignmentHash !== undefined ? { assignmentHash: manifest.assignmentHash } : {}),
    ...(manifest.publication !== undefined ? { publication: manifest.publication } : {}),
    publishTarget: normalizeManifestPublishTarget(manifest.publishTarget),
    ...(manifest.htmlUrl !== undefined ? { htmlUrl: manifest.htmlUrl } : {}),
    ...(manifest.htmlHash !== undefined ? { htmlHash: manifest.htmlHash } : {}),
    ...(manifest.htmlKey !== undefined ? { htmlKey: manifest.htmlKey } : {}),
    ...(manifest.htmlEtag !== undefined ? { htmlEtag: manifest.htmlEtag } : {}),
    ...(manifest.htmlReused !== undefined ? { htmlReused: manifest.htmlReused } : {}),
    ...(audioArtifacts !== undefined ? { audioArtifacts } : {}),
    ...(manifest.speechPlans !== undefined
      ? {
          speechPlans: {
            ...(manifest.speechPlans.studyText
              ? { studyText: sanitizeSpeechPlan(manifest.speechPlans.studyText) }
              : {}),
          },
        }
      : {}),
    ...(manifest.voicePlans !== undefined
      ? {
          voicePlans: {
            ...(manifest.voicePlans.studyText
              ? { studyText: sanitizeVoicePlan(manifest.voicePlans.studyText) }
              : {}),
          },
        }
      : {}),
    ...(manifest.preset !== undefined ? { preset: manifest.preset } : {}),
    ...(manifest.ttsStrategy !== undefined ? { ttsStrategy: manifest.ttsStrategy } : {}),
    ...(manifest.dialogueLanguage !== undefined
      ? { dialogueLanguage: manifest.dialogueLanguage }
      : {}),
    ...(manifest.dialogueStability !== undefined
      ? { dialogueStability: manifest.dialogueStability }
      : {}),
    ...(manifest.dialogueSeed !== undefined ? { dialogueSeed: manifest.dialogueSeed } : {}),
    timestamp: manifest.timestamp,
  };
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

      await writeFile(target, JSON.stringify(sanitizeAssignmentManifest(manifest), null, 2));
      return target;
    },
    async readManifest(mdPath) {
      try {
        const contents = await readFile(manifestPathFor(mdPath), 'utf8');
        const parsed = JSON.parse(contents) as AssignmentManifest;
        if (parsed.schemaVersion === undefined) {
          parsed.schemaVersion = LEGACY_MANIFEST_SCHEMA_VERSION;
        }
        return sanitizeAssignmentManifest(parsed);
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
