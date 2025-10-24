import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { uploadToS3 } from '../src/s3.js';

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

describe('uploadToS3', () => {
  let tempFile: string;

  beforeEach(async () => {
    // Create a temporary file for each test
    const tempDir = os.tmpdir();
    tempFile = path.join(tempDir, `test-file-${Date.now()}.mp3`);
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

  it('uploads file to S3 and returns public URL', async () => {
    const result = await uploadToS3(tempFile, 'test-bucket', 'test-key', { public: true });
    expect(result.url).toContain('test-bucket.s3.amazonaws.com/test-key');
    expect(result.key).toBe('test-key');
    expect(result.etag).toBe('"mock-etag"');
    expect(result.isPresigned).toBe(false);
  });

  it('uploads file to S3 and returns presigned URL', async () => {
    const result = await uploadToS3(tempFile, 'test-bucket', 'test-key', { presignExpiresIn: 3600 });
    expect(result.url).toBe('https://presigned-url.com');
    expect(result.key).toBe('test-key');
    expect(result.etag).toBe('"mock-etag"');
    expect(result.isPresigned).toBe(true);
    expect(result.expiresAt).toBeDefined();
  });
});