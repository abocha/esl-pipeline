import { describe, expect, it } from 'vitest';

import { buildMp3MetadataArgs } from '../src/mp3-metadata.js';

describe('mp3 metadata export', () => {
  it('builds a codec-copy ffmpeg remux with student-facing title and artist tags', () => {
    expect(
      buildMp3MetadataArgs('/tmp/input.mp3', '/tmp/output.mp3', {
        title: 'Updating Old Goals - Study Text',
        artist: 'English with Andrei',
      }),
    ).toEqual([
      '-y',
      '-i',
      '/tmp/input.mp3',
      '-metadata',
      'title=Updating Old Goals - Study Text',
      '-metadata',
      'artist=English with Andrei',
      '-codec',
      'copy',
      '/tmp/output.mp3',
    ]);
  });
});
