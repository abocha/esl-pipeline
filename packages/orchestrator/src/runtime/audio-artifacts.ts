import type { AssignmentManifest } from '../manifest.js';
import type { PipelineMetrics } from '../observability.js';

export type AudioArtifactKind = 'study_text' | 'pronunciation_shadow_sentence';
export type AudioArtifact = NonNullable<AssignmentManifest['audio']>;

export interface AudioArtifacts {
  studyText?: AudioArtifact;
  pronunciationShadowSentence?: AudioArtifact;
}

function cloneAudioArtifact(artifact?: AudioArtifact): AudioArtifact | undefined {
  return artifact ? { ...artifact } : undefined;
}

export function resolveAudioArtifactsFromManifest(
  manifest?: AssignmentManifest | null,
): AudioArtifacts {
  if (!manifest) return {};
  return {
    studyText: cloneAudioArtifact(manifest.audioArtifacts?.studyText ?? manifest.audio),
    pronunciationShadowSentence: cloneAudioArtifact(manifest.audioArtifacts?.pronunciationShadowSentence),
  };
}

export function resolveAudioArtifactKey(
  audioHash: string,
  prefix: string | undefined,
  kind: AudioArtifactKind = 'study_text',
): string {
  const normalizedPrefix = prefix?.replace(/^[\/\\]+/, '').replace(/[\/\\]+$/, '') ?? '';
  const key =
    kind === 'study_text'
      ? `audio/final/${audioHash}.mp3`
      : `audio/pronunciation-shadow/${audioHash}.mp3`;
  return normalizedPrefix ? `${normalizedPrefix}/${key}` : key;
}

export function deriveS3GlobalUrl(bucket: string, key: string): string {
  return `https://${bucket}.s3.amazonaws.com/${key}`;
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
