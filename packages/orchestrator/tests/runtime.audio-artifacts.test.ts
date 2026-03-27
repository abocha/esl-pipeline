import { describe, expect, it } from 'vitest';

import {
  deriveS3GlobalUrl,
  emitArtifactReuseMetric,
  resolveAudioArtifactKey,
  resolveAudioArtifactsFromManifest,
} from '../src/runtime/audio-artifacts.js';

describe('runtime/audio-artifacts', () => {
  it('resolves deterministic artifact keys with optional prefix', () => {
    expect(resolveAudioArtifactKey('abc123', undefined, 'study_text')).toBe(
      'audio/final/abc123.mp3',
    );
    expect(resolveAudioArtifactKey('abc123', '/root/prefix/', 'study_text')).toBe(
      'root/prefix/audio/final/abc123.mp3',
    );
    expect(resolveAudioArtifactKey('abc123', 'root', 'pronunciation_primary')).toBe(
      'root/audio/pronunciation/abc123.mp3',
    );
  });

  it('resolves artifact views from manifests with canonical audioArtifacts payload', () => {
    const modern = resolveAudioArtifactsFromManifest({
      mdHash: 'hash',
      timestamp: '2026-03-09T00:00:00.000Z',
      audioArtifacts: {
        studyText: { path: '/tmp/study.mp3' },
        pronunciation: {
          mode: 'shadow_sentence',
          primaryClip: {
            id: 'primary-shadow-sentence',
            kind: 'shadow_sentence',
            engine: 'provider',
            text: 'Hello there',
            path: '/tmp/pronunciation.mp3',
          },
        },
      },
    });

    expect(modern.studyText?.path).toBe('/tmp/study.mp3');
    expect(modern.pronunciation?.primaryClip?.path).toBe('/tmp/pronunciation.mp3');
  });

  it('reuses legacy pronunciation shadow audio from older manifests', () => {
    const legacy = resolveAudioArtifactsFromManifest({
      mdHash: 'hash',
      timestamp: '2026-03-09T00:00:00.000Z',
      audioArtifacts: {
        pronunciationShadowSentence: {
          path: '/tmp/legacy-pronunciation.mp3',
          url: 'https://example.com/legacy-pronunciation.mp3',
        },
      },
    });

    expect(legacy.pronunciation?.mode).toBe('shadow_sentence');
    expect(legacy.pronunciation?.primaryClip?.path).toBe('/tmp/legacy-pronunciation.mp3');
    expect(legacy.pronunciation?.primaryClip?.url).toBe(
      'https://example.com/legacy-pronunciation.mp3',
    );
  });

  it('emits reuse metrics only when reuse value is present', () => {
    const increments: { metric: string; value?: number; tags?: Record<string, string> }[] = [];
    emitArtifactReuseMetric(
      {
        timing: () => {
          // noop
        },
        increment: (metric, value, tags) => increments.push({ metric, value, tags }),
      },
      'audio',
      'study_text',
      true,
    );

    emitArtifactReuseMetric(
      {
        timing: () => {
          // noop
        },
        increment: (metric, value, tags) => increments.push({ metric, value, tags }),
      },
      'audio',
      'study_text',
    );

    expect(increments).toEqual([
      {
        metric: 'esl.artifact.reuse_hit',
        value: 1,
        tags: { kind: 'audio', audioKind: 'study_text' },
      },
    ]);
    expect(deriveS3GlobalUrl('bucket-x', 'path/to/object.mp3')).toBe(
      'https://bucket-x.s3.amazonaws.com/path/to/object.mp3',
    );
  });
});
