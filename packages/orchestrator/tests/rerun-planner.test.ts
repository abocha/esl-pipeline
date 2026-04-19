import { describe, expect, it } from 'vitest';

import { computeRerunPlan } from '../src/rerun-planner.js';

describe('rerun planner', () => {
  it('requires either republish-only or at least one regeneration target', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      manifest: {
        mdHash: 'hash',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.executable).toEqual([]);
    expect(plan.errors).toContain(
      'Select republish-only or at least one regeneration target for the rerun request.',
    );
  });

  it('uses publish-only execution for republish-only reruns', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      republishOnly: true,
      manifest: {
        mdHash: 'hash',
        publishTarget: 'html',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.requested.republishOnly).toBe(true);
    expect(plan.executable).toEqual(['add-audio']);
    expect(plan.willReuse).toEqual({
      studyTextAudio: true,
      pronunciationMainAudio: true,
      pronunciationChunkAudio: true,
    });
    expect(plan.errors).toEqual([]);
  });

  it('uses full chain for regeneration reruns', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      regenerateStudyTextAudio: true,
      manifest: {
        mdHash: 'hash',
        pageId: 'page-1',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.executable).toEqual(['tts', 'upload', 'add-audio']);
    expect(plan.willReuse).toEqual({
      studyTextAudio: false,
      pronunciationMainAudio: true,
      pronunciationChunkAudio: true,
    });
  });

  it('reports missing manifest when no prior run exists', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      republishOnly: true,
      manifest: null,
    });

    expect(plan.requires.missingManifestFields).toEqual(['manifest']);
    expect(plan.errors).toContain('No manifest found for /tmp/lesson.md. Run the pipeline first.');
  });

  it('does not require retired notion or anytype fields for republish-only reruns', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      republishOnly: true,
      manifest: {
        mdHash: 'hash',
        audioArtifacts: {
          studyText: {
            url: 'https://example.com/audio.mp3',
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.requires.missingManifestFields).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it('normalizes legacy manifest publish targets to html without requiring retired fields', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      republishOnly: true,
      manifest: {
        mdHash: 'hash',
        publishTarget: 'notion' as never,
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.executable).toEqual(['add-audio']);
    expect(plan.requires.missingManifestFields).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it('detects canonical pronunciation mode from manifest artifacts', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      regeneratePronunciationChunkAudio: true,
      manifest: {
        mdHash: 'hash',
        pageId: 'page-1',
        audioArtifacts: {
          pronunciation: {
            mode: 'connected_speech',
            itemClips: [
              {
                id: 'clip-1',
                kind: 'connected_target',
                engine: 'provider',
                text: 'The device is as heavy as the old one.',
                url: 'https://example.com/clip.mp3',
              },
            ],
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.detectedPronunciationMode).toBe('connected_speech');
  });
});
