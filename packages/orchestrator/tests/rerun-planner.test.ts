import { describe, expect, it } from 'vitest';

import { computeRerunPlan } from '../src/rerun-planner.js';

describe('rerun planner', () => {
  it('defaults to upload + add-audio when no explicit target is provided', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      manifest: {
        mdHash: 'hash',
        pageId: 'page-1',
        audioArtifacts: {
          studyText: {
            path: '/tmp/audio.mp3',
            url: 'https://example.com/audio.mp3',
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.requested).toEqual(['upload', 'add-audio']);
    expect(plan.executable).toEqual(['upload', 'add-audio']);
    expect(plan.errors).toEqual([]);
  });

  it('maps --audio style input to full chain', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      audio: true,
      manifest: {
        mdHash: 'hash',
        pageId: 'page-1',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.requested).toEqual(['tts', 'upload', 'add-audio']);
    expect(plan.executable).toEqual(['tts', 'upload', 'add-audio']);
  });

  it('expands from/to ranges', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      from: 'upload',
      to: 'add-audio',
      manifest: {
        mdHash: 'hash',
        pageId: 'page-1',
        audioArtifacts: {
          studyText: {
            path: '/tmp/audio.mp3',
            url: 'https://example.com/audio.mp3',
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.requested).toEqual(['upload', 'add-audio']);
    expect(plan.executable).toEqual(['upload', 'add-audio']);
  });

  it('returns an error when manifest is missing', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      steps: ['upload'],
      manifest: null,
    });

    expect(plan.executable).toEqual([]);
    expect(plan.requires.missingManifestFields).toEqual(['manifest']);
    expect(plan.errors).toContain('No manifest found for /tmp/lesson.md. Run the pipeline first.');
  });

  it('adds dependency stages when manifest prerequisites are missing', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      steps: ['add-audio'],
      manifest: {
        mdHash: 'hash',
        pageId: 'page-1',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.requested).toEqual(['add-audio']);
    expect(plan.executable).toEqual(['tts', 'upload', 'add-audio']);
    expect(plan.errors).toEqual([]);
  });

  it('reports missing page prerequisites for add-audio', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      steps: ['add-audio'],
      manifest: {
        mdHash: 'hash',
        audioArtifacts: {
          studyText: {
            path: '/tmp/audio.mp3',
            url: 'https://example.com/audio.mp3',
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.requires.missingManifestFields).toContain('pageId');
    expect(plan.errors).toContain('Missing manifest fields for requested rerun steps: pageId');
  });

  it('validates anytype add-audio prerequisites', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      steps: ['add-audio'],
      manifest: {
        mdHash: 'hash',
        publishTarget: 'anytype',
        anytypePageId: 'anytype-page',
        audioArtifacts: {
          studyText: {
            path: '/tmp/audio.mp3',
            url: 'https://example.com/audio.mp3',
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.requires.missingManifestFields).toContain('anytypeSpaceId');
  });

  it('allows html add-audio rerun without audio or page prerequisites', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      steps: ['add-audio'],
      manifest: {
        mdHash: 'hash',
        publishTarget: 'html',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.requested).toEqual(['add-audio']);
    expect(plan.executable).toEqual(['add-audio']);
    expect(plan.requires.missingManifestFields).toEqual([]);
    expect(plan.errors).toEqual([]);
  });

  it('reuses legacy pronunciation shadow artifacts when planning reruns', () => {
    const plan = computeRerunPlan({
      md: '/tmp/lesson.md',
      steps: ['upload', 'add-audio'],
      manifest: {
        mdHash: 'hash',
        pageId: 'page-1',
        audioArtifacts: {
          pronunciationShadowSentence: {
            path: '/tmp/legacy-pronunciation.mp3',
            url: 'https://example.com/legacy-pronunciation.mp3',
          },
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    });

    expect(plan.executable).toEqual(['upload', 'add-audio']);
    expect(plan.errors).toEqual([]);
  });
});
