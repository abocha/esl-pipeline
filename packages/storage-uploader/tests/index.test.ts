import { describe, expect, it } from 'vitest';
import { uploadFile } from '../src/index.js';

describe('storage uploader stub', () => {
  it('constructs an S3 url', async () => {
    const result = await uploadFile('audio.mp3', { backend: 's3', public: true });
    expect(result.url).toContain('.s3.amazonaws.com/');
    expect(result.key.endsWith('audio.mp3')).toBe(true);
  });
});
