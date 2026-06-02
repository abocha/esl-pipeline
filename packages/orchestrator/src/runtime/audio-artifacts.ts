import type {
  PronunciationAudioClip,
  PronunciationAudioMode,
  PronunciationAudioPayload,
} from '@esl-pipeline/shared-infrastructure';

import type {
  AssignmentManifest,
  AudioArtifactManifest,
  PronunciationAudioWarning,
} from '../manifest.js';
import type { PipelineMetrics } from '../observability.js';

export type AudioArtifactKind = 'study_text' | 'pronunciation_primary' | 'pronunciation_item';
export type AudioArtifact = AudioArtifactManifest;

export type PronunciationAudioArtifactClip = PronunciationAudioClip & AudioArtifactManifest;

export interface PronunciationAudioArtifact
  extends Omit<PronunciationAudioPayload, 'primaryClip' | 'itemClips'> {
  mode: PronunciationAudioMode;
  primaryClip?: PronunciationAudioArtifactClip | null;
  itemClips?: PronunciationAudioArtifactClip[];
  warnings?: PronunciationAudioWarning[];
}

export interface AudioArtifacts {
  studyText?: AudioArtifact;
  pronunciation?: PronunciationAudioArtifact;
}

const STUDENT_AUDIO_ARTIST = 'English with Andrei';

function sanitizeStudentFacingTitle(title?: string): string {
  const unwrapped = title?.replace(/^homework\s+assignment\s*:\s*/i, '').trim() ?? '';
  const sanitized = unwrapped
    .replaceAll(/[/\\:*?"<>|]+/g, '-')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/[-.\s]+$/g, '')
    .trim();
  return sanitized || 'Homework Assignment';
}

function resolveStudentFacingFileStem(title: string | undefined, kind: AudioArtifactKind): string {
  const lessonTitle = sanitizeStudentFacingTitle(title);
  return kind === 'study_text' ? `${lessonTitle} - Study Text` : `${lessonTitle} - Pronunciation`;
}

export function resolveStudentFacingAudioMetadata(
  title: string | undefined,
  kind: AudioArtifactKind,
): { title: string; artist: string } | undefined {
  if (kind === 'pronunciation_item') return undefined;
  return {
    title: resolveStudentFacingFileStem(title, kind),
    artist: STUDENT_AUDIO_ARTIST,
  };
}

function cloneAudioArtifact(artifact?: AudioArtifact): AudioArtifact | undefined {
  return artifact ? { ...artifact } : undefined;
}

export function resolveAudioArtifactsFromManifest(
  manifest?: AssignmentManifest | null,
): AudioArtifacts {
  const pronunciation = manifest?.audioArtifacts?.pronunciation;
  const legacyPronunciationShadowSentence = manifest?.audioArtifacts?.pronunciationShadowSentence;

  const normalizedPronunciation: PronunciationAudioArtifact | undefined = pronunciation
    ? {
        ...pronunciation,
        primaryClip: pronunciation.primaryClip ? { ...pronunciation.primaryClip } : undefined,
        itemClips: pronunciation.itemClips?.map((clip) => ({ ...clip })),
        warnings: pronunciation.warnings?.map((warning) => ({ ...warning })),
      }
    : legacyPronunciationShadowSentence
      ? {
          mode: 'shadow_sentence',
          primaryClip: {
            id: 'legacy-pronunciation-shadow-sentence',
            kind: 'shadow_sentence',
            engine: 'provider',
            text: '',
            ...legacyPronunciationShadowSentence,
          },
        }
      : undefined;

  if (!manifest) return {};
  return {
    studyText: cloneAudioArtifact(manifest.audioArtifacts?.studyText),
    pronunciation: normalizedPronunciation,
  };
}

export function resolveAudioArtifactKey(
  audioHash: string,
  prefix: string | undefined,
  kind: AudioArtifactKind = 'study_text',
  title?: string,
): string {
  const normalizedPrefix = prefix?.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '') ?? '';
  const key =
    kind === 'study_text'
      ? `audio/final/${audioHash}/${resolveStudentFacingFileStem(title, kind)}.mp3`
      : kind === 'pronunciation_primary'
        ? `audio/pronunciation/${audioHash}/${resolveStudentFacingFileStem(title, kind)}.mp3`
        : `audio/pronunciation-item/${audioHash}.mp3`;
  return normalizedPrefix ? `${normalizedPrefix}/${key}` : key;
}

export function deriveS3GlobalUrl(bucket: string, key: string): string {
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  return `https://${bucket}.s3.amazonaws.com/${encodedKey}`;
}

export function emitArtifactReuseMetric(
  metrics: PipelineMetrics | undefined,
  kind: 'audio' | 'html',
  audioKind?: AudioArtifactKind,
  reused?: boolean,
): void {
  if (!metrics || reused === undefined) return;
  metrics.increment(reused ? 'esl.artifact.reuse_hit' : 'esl.artifact.reuse_miss', 1, {
    kind,
    ...(audioKind ? { audioKind } : {}),
  });
}
