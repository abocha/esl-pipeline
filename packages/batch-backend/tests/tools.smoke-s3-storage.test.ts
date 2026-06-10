import { describe, expect, it, vi } from 'vitest';

import {
  parseArgs,
  runS3StorageSmoke,
  type S3SmokeAdapter,
} from '../src/tools/smoke-s3-storage.js';

describe('tools/smoke-s3-storage', () => {
  it('uploads, reads, presigns, and deletes the smoke object by default', async () => {
    const calls: string[] = [];
    let uploadedSize = 0;
    const adapter: S3SmokeAdapter = {
      uploadFile: vi.fn(async (key, _content, _mimeType, size) => {
        calls.push(`upload:${key}`);
        uploadedSize = size;
        return { key: `alpha/${key}` };
      }),
      getFileMetadata: vi.fn(async (key) => {
        calls.push(`head:${key}`);
        return {
          key: `alpha/${key}`,
          size: uploadedSize,
          mimeType: 'text/plain',
        };
      }),
      generatePresignedUrl: vi.fn(async (key) => {
        calls.push(`presign:${key}`);
        return `https://example.test/${key}`;
      }),
      deleteFile: vi.fn(async (key) => {
        calls.push(`delete:${key}`);
      }),
    };

    const result = await runS3StorageSmoke({
      adapter,
      bucket: 'alpha-bucket',
      key: 'smoke/check.txt',
      now: new Date('2026-06-10T00:00:00.000Z'),
      id: 'fixed',
    });

    expect(result).toEqual({
      ok: true,
      bucket: 'alpha-bucket',
      key: 'alpha/smoke/check.txt',
      size: uploadedSize,
      presignedUrlGenerated: true,
      deleted: true,
    });
    expect(calls).toEqual([
      'upload:smoke/check.txt',
      'head:smoke/check.txt',
      'presign:smoke/check.txt',
      'delete:smoke/check.txt',
    ]);
  });

  it('rejects unsafe object keys before touching S3', () => {
    expect(() => parseArgs(['--key', '../secret.txt'])).toThrow(
      'Smoke key must be a relative S3 object key.',
    );
  });

  it('keeps the smoke object when explicitly requested', async () => {
    let uploadedSize = 0;
    const adapter: S3SmokeAdapter = {
      uploadFile: vi.fn(async (key, _content, _mimeType, size) => {
        uploadedSize = size;
        return { key };
      }),
      getFileMetadata: vi.fn(async (key) => ({ key, size: uploadedSize, mimeType: 'text/plain' })),
      generatePresignedUrl: vi.fn(async () => 'https://example.test/smoke'),
      deleteFile: vi.fn(async () => {}),
    };

    const result = await runS3StorageSmoke({
      adapter,
      bucket: 'alpha-bucket',
      key: 'smoke/keep.txt',
      keepObject: true,
      now: new Date('2026-06-10T00:00:00.000Z'),
      id: 'fixed',
    });

    expect(result.deleted).toBe(false);
    expect(adapter.deleteFile).not.toHaveBeenCalled();
  });
});
