import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PipelineLogEvent, PipelineLogger } from '@esl-pipeline/contracts';

import { uploadToS3 } from '../src/s3.js';

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

describe('uploadToS3', () => {
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

    const dir = tmpdir();
    tempFile = join(dir, `test-file-${Date.now()}.mp3`);
    await writeFile(tempFile, 'mock audio content');
  });

  afterEach(async () => {
    await unlink(tempFile).catch(() => {});
  });

  it('uploads file to S3 with optional ACL when publicRead is true', async () => {
    const res = await uploadToS3(tempFile, {
      bucket: 'test-bucket',
      region: 'us-east-1',
      keyPrefix: 'audio/tests',
      publicRead: true,
    });

    expect(res.url).toBe(
      `https://test-bucket.s3.us-east-1.amazonaws.com/audio/tests/${basename(tempFile)}`,
    );
    expect(res.key).toBe(`audio/tests/${basename(tempFile)}`);
    expect(res.etag).toBe('"mock-etag"');
    expect(res.reused).toBe(false);
    expect(res.sizeBytes).toBeGreaterThan(0);
    expect(res.sha256).toBeDefined();

    expect(sendMock).toHaveBeenCalledTimes(2);
    const command = sendMock.mock.calls.find((call) => call[0]?.__type === 'put')?.[0];
    expect(command.ACL).toBe('public-read');
    expect(command.Key).toBe(`audio/tests/${basename(tempFile)}`);
  });

  it('retries without ACL when bucket rejects ACL settings', async () => {
    let putCalls = 0;
    sendMock.mockImplementation(async (command: { __type?: string; Body?: unknown }) => {
      if (command.__type === 'head') {
        throw { name: 'NotFound', $metadata: { httpStatusCode: 404 } };
      }
      await drainPutBody(command);
      putCalls++;
      if (putCalls === 1) {
        throw { Code: 'AccessControlListNotSupported' };
      }
      return { ETag: '"mock-etag"' };
    });
    const logs: PipelineLogEvent[] = [];
    const logger: PipelineLogger = { log: (event) => logs.push(event) };

    const res = await uploadToS3(tempFile, {
      bucket: 'test-bucket',
      region: 'us-east-1',
      keyPrefix: 'audio/tests',
      publicRead: true,
      logger,
    });

    expect(res.url).toBe(
      `https://test-bucket.s3.us-east-1.amazonaws.com/audio/tests/${basename(tempFile)}`,
    );
    expect(sendMock).toHaveBeenCalledTimes(3);

    const putCommands = sendMock.mock.calls
      .map((call) => call[0])
      .filter((cmd) => cmd?.__type === 'put');
    const firstCall = putCommands[0];
    const secondCall = putCommands[1];
    expect(firstCall.ACL).toBe('public-read');
    expect(secondCall.ACL).toBeUndefined();
    expect(logs.some((log) => /ACL not supported/.test(log.message))).toBe(true);
  });

  it('builds object key without prefix when omitted', async () => {
    const res = await uploadToS3(tempFile, {
      bucket: 'test-bucket',
      region: 'us-east-1',
    });
    expect(res.key).toBe(basename(tempFile));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ __type: 'head' }));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ Key: basename(tempFile) }));
  });

  it('reuses existing object when metadata hash matches', async () => {
    const hash = createHash('sha256').update('mock audio content').digest('hex');
    sendMock.mockImplementation(async (command: { __type?: string; Body?: unknown }) => {
      if (command.__type === 'head') {
        return {
          ETag: '"existing-etag"',
          ContentLength: 'mock audio content'.length,
          Metadata: { sha256: hash },
        };
      }
      await drainPutBody(command);
      return { ETag: '"new-etag"' };
    });

    const res = await uploadToS3(tempFile, {
      bucket: 'test-bucket',
      region: 'us-east-1',
      keyPrefix: 'audio/tests',
    });

    expect(res.reused).toBe(true);
    expect(res.etag).toBe('"existing-etag"');
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0]?.__type).toBe('head');
  });

  it('rejects uploads that exceed S3_UPLOAD_MAX_MB', async () => {
    const prev = process.env.S3_UPLOAD_MAX_MB;
    process.env.S3_UPLOAD_MAX_MB = '0.000001';
    try {
      await expect(
        uploadToS3(tempFile, {
          bucket: 'test-bucket',
          region: 'us-east-1',
        }),
      ).rejects.toThrow(/S3_UPLOAD_MAX_MB/);
      expect(sendMock).not.toHaveBeenCalled();
    } finally {
      if (prev === undefined) {
        delete process.env.S3_UPLOAD_MAX_MB;
      } else {
        process.env.S3_UPLOAD_MAX_MB = prev;
      }
    }
  });
});
