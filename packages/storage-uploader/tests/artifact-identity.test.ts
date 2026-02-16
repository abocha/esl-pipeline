import { describe, expect, it } from 'vitest';

import { buildArtifactKey, hashArtifactContent } from '../src/artifact-identity.js';

describe('artifact identity helpers', () => {
  it('creates deterministic hashes for content', () => {
    const first = hashArtifactContent('hello');
    const second = hashArtifactContent('hello');
    const third = hashArtifactContent('hello!');
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
    expect(first).not.toBe(third);
  });

  it('builds deterministic object keys by artifact kind', () => {
    const hash = 'a'.repeat(64);
    expect(buildArtifactKey('audio-final', hash)).toBe(`audio/final/${hash}.mp3`);
    expect(buildArtifactKey('audio-chunk', hash)).toBe(`audio/chunks/${hash}.mp3`);
    expect(buildArtifactKey('html', hash)).toBe(`materials/html/artifacts/${hash}.html`);
    expect(buildArtifactKey('html', hash, { prefix: 'exports' })).toBe(
      `exports/materials/html/artifacts/${hash}.html`,
    );
  });
});
