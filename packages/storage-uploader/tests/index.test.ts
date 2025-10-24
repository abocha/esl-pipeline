import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { uploadFile } from '../src/index.js';

// Mock AWS SDK v3
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = vi.fn().mockResolvedValue({ ETag: '"mock-etag"' });
  },
  PutObjectCommand: class {
    constructor(params: any) {
      Object.assign(this, params);
    }
  },
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://presigned-url.com'),
}));

describe('uploadFile', () => {
  let tempFile: string;

  beforeEach(async () => {
    // Create a temporary file for each test
    const tempDir = os.tmpdir();
    tempFile = path.join(tempDir, `test-audio-${Date.now()}.mp3`);
    await writeFile(tempFile, 'mock audio content');
  });

  afterEach(async () => {
    // Clean up the temporary file
    try {
      await unlink(tempFile);
    } catch (err) {
      // Ignore if file doesn't exist
    }
  });

  it('uploads file with s3 backend and returns public URL', async () => {
    const result = await uploadFile(tempFile, { backend: 's3', public: true });
    expect(result.url).toContain('.s3.amazonaws.com/');
    expect(result.key.endsWith('.mp3')).toBe(true);
    expect(result.etag).toBe('"mock-etag"');
    expect(result.isPresigned).toBe(false);
  });

  it('uploads file with s3 backend and returns presigned URL', async () => {
    const result = await uploadFile(tempFile, { backend: 's3', presignExpiresIn: 3600 });
    expect(result.url).toBe('https://presigned-url.com');
    expect(result.key.endsWith('.mp3')).toBe(true);
    expect(result.etag).toBe('"mock-etag"');
    expect(result.isPresigned).toBe(true);
    expect(result.expiresAt).toBeDefined();
  });

  it('throws error for unsupported backend', async () => {
    await expect(uploadFile(tempFile, { backend: 'unsupported' as any })).rejects.toThrow('Unsupported backend: unsupported');
  });
});
