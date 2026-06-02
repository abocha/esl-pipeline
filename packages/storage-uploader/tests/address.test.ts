import { describe, expect, it } from 'vitest';

import { deriveS3ObjectUrl } from '../src/address.js';

describe('S3 address helpers', () => {
  it('encodes readable object-key characters in public URLs without changing path separators', () => {
    expect(
      deriveS3ObjectUrl({
        bucket: 'lesson-bucket',
        key: 'audio/final/abc123/Updating Old Goals - Study Text.mp3',
        urlStyle: 'global',
      }),
    ).toBe(
      'https://lesson-bucket.s3.amazonaws.com/audio/final/abc123/Updating%20Old%20Goals%20-%20Study%20Text.mp3',
    );
  });
});
