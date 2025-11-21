import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadToS3 } from '../src/s3.js';

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

describe('uploadToS3', () => {
  let tempFile: string;

  beforeEach(async () => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ ETag: '"mock-etag"' });

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

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0]?.[0];
    expect(command.ACL).toBe('public-read');
    expect(command.Key).toBe(`audio/tests/${basename(tempFile)}`);
  });

  it('retries without ACL when bucket rejects ACL settings', async () => {
    sendMock
      .mockRejectedValueOnce({ Code: 'AccessControlListNotSupported' })
      .mockResolvedValueOnce({ ETag: '"mock-etag"' });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await uploadToS3(tempFile, {
      bucket: 'test-bucket',
      region: 'us-east-1',
      keyPrefix: 'audio/tests',
      publicRead: true,
    });

    expect(res.url).toBe(
      `https://test-bucket.s3.us-east-1.amazonaws.com/audio/tests/${basename(tempFile)}`,
    );
    expect(sendMock).toHaveBeenCalledTimes(2);

    const firstCall = sendMock.mock.calls[0]?.[0];
    const secondCall = sendMock.mock.calls[1]?.[0];
    expect(firstCall.ACL).toBe('public-read');
    expect(secondCall.ACL).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/ACL not supported/));

    warnSpy.mockRestore();
  });

  it('builds object key without prefix when omitted', async () => {
    const res = await uploadToS3(tempFile, {
      bucket: 'test-bucket',
      region: 'us-east-1',
    });
    expect(res.key).toBe(basename(tempFile));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ Key: basename(tempFile) }));
  });
});
