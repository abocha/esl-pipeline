import { describe, expect, it } from 'vitest';

import { buildArtifactKey, hashArtifactContent } from '../src/artifact-identity.js';

describe('artifact identity helpers', () => {
  it('matches the independent SHA-256 digest for content', () => {
    const hash = hashArtifactContent('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(hashArtifactContent('hello!')).not.toBe(hash);
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
