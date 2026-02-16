import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadFile } from '../src/index.js';

const sendMock = vi.fn();

interface DrainableBody {
  on(event: 'error' | 'end', listener: (...args: unknown[]) => void): DrainableBody;
  resume(): DrainableBody;
}

async function drainPutBody(command: { __type?: string; Body?: unknown }) {
  if (command.__type !== 'put') return;
  const body = command.Body as DrainableBody | undefined;
  if (!body || typeof body.on !== 'function' || typeof body.resume !== 'function') return;
  await new Promise<void>((resolve, reject) => {
    body.on('error', reject);
    body.on('end', resolve);
    body.resume();
  });
}

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor() {}
    send(command: any) {
      return sendMock(command);
    }
  },
  HeadObjectCommand: class {
    __type = 'head';
    constructor(params: any) {
      Object.assign(this, params);
    }
  },
  PutObjectCommand: class {
    __type = 'put';
    constructor(params: any) {
      Object.assign(this, params);
    }
  },
}));

describe('uploadFile', () => {
  let tempFile: string;

  beforeEach(async () => {
    sendMock.mockReset();
    sendMock.mockImplementation(async (command: { __type?: string; Body?: unknown }) => {
      if (command.__type === 'head') {
        throw { name: 'NotFound', $metadata: { httpStatusCode: 404 } };
      }
      await drainPutBody(command);
      return { ETag: '"mock-etag"' };
    });
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
      `https://test-bucket.s3.us-east-1.amazonaws.com/audio/tests/${fileName}`,
    );
    expect(result.key).toBe(`audio/tests/${fileName}`);
    expect(result.etag).toBe('"mock-etag"');
    expect(result.reused).toBe(false);
    const command = sendMock.mock.calls.find((call) => call[0]?.__type === 'put')?.[0];
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
    const command = sendMock.mock.calls.find((call) => call[0]?.__type === 'put')?.[0];
    expect(command?.Key).toBe(`audio/tests/${fileName}`);
    expect(command?.ACL).toBeUndefined();
  });

  it('supports explicit deterministic object key', async () => {
    const result = await uploadFile(tempFile, {
      backend: 's3',
      bucket: 'test-bucket',
      region: 'us-east-1',
      key: 'audio/final/content-hash.mp3',
    });
    expect(result.key).toBe('audio/final/content-hash.mp3');
    const command = sendMock.mock.calls.find((call) => call[0]?.__type === 'put')?.[0];
    expect(command?.Key).toBe('audio/final/content-hash.mp3');
  });

  it('throws error for unsupported backend', async () => {
    await expect(uploadFile(tempFile, { backend: 'unsupported' as any })).rejects.toThrow(
      'Unsupported backend: unsupported',
    );
  });
});
