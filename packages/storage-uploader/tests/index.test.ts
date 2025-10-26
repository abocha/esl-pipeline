import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { uploadFile } from '../src/index.js';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor() {}
    send(command: any) {
      return sendMock(command);
    }
  },
  PutObjectCommand: class {
    constructor(params: any) {
      Object.assign(this, params);
    }
  },
}));

describe('uploadFile', () => {
  let tempFile: string;

  beforeEach(async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ ETag: '"mock-etag"' });
    const tempDir = tmpdir();
    tempFile = join(tempDir, `test-audio-${Date.now()}.mp3`);
    await writeFile(tempFile, 'mock audio content');
  });

  afterEach(async () => {
    await unlink(tempFile).catch(() => {});
  });

  it('uploads file with s3 backend and returns public URL', async () => {
    const result = await uploadFile(tempFile, {
      backend: 's3',
      bucket: 'test-bucket',
      region: 'us-east-1',
      prefix: 'audio/tests',
      public: true,
    });
    const fileName = basename(tempFile);
    expect(result.url).toBe(
      `https://test-bucket.s3.us-east-1.amazonaws.com/audio/tests/${fileName}`
    );
    expect(result.key).toBe(`audio/tests/${fileName}`);
    expect(result.etag).toBe('"mock-etag"');
    const command = sendMock.mock.calls[0]?.[0];
    expect(command?.Key).toBe(`audio/tests/${fileName}`);
    expect(command?.ACL).toBe('public-read');
  });

  it('passes sanitized prefix to uploader while omitting ACL when public flag is false', async () => {
    const result = await uploadFile(tempFile, {
      backend: 's3',
      bucket: 'test-bucket',
      region: 'us-east-1',
      prefix: '/audio/tests/',
    });
    const fileName = basename(tempFile);
    expect(result.key).toBe(`audio/tests/${fileName}`);
    const command = sendMock.mock.calls[0]?.[0];
    expect(command?.Key).toBe(`audio/tests/${fileName}`);
    expect(command?.ACL).toBeUndefined();
  });

  it('throws error for unsupported backend', async () => {
    await expect(uploadFile(tempFile, { backend: 'unsupported' as any })).rejects.toThrow(
      'Unsupported backend: unsupported'
    );
  });
});
