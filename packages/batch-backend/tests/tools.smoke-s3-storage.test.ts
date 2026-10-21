import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { logger } from '../src/infrastructure/logger.js';
import { S3StorageAdapter } from '../src/infrastructure/s3-storage-adapter.js';
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

  it('reports the retained full key without hiding an earlier smoke failure', async () => {
    const primaryError = new Error('Synthetic metadata validation failed.');
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    const adapter: S3SmokeAdapter = {
      uploadFile: vi.fn(async (key) => ({ key: `alpha/${key}` })),
      getFileMetadata: vi.fn(async () => {
        throw primaryError;
      }),
      generatePresignedUrl: vi.fn(async () => 'https://example.test/unused'),
      deleteFile: vi.fn(async () => {
        throw new Error('SECRET_PROVIDER_PAYLOAD https://signed.test/?token=SECRET');
      }),
    };
    try {
      await expect(
        runS3StorageSmoke({
          adapter,
          bucket: 'alpha-bucket',
          now: new Date('2026-06-10T00:00:00.000Z'),
          id: 'fixed',
        }),
      ).rejects.toBe(primaryError);
      expect(adapter.deleteFile).toHaveBeenCalledExactlyOnceWith(
        'smoke/closed-alpha/s3-storage-20260610-000000000Z-fixed.txt',
      );
      expect(diagnostic).toHaveBeenCalledTimes(1);
      const message = String(diagnostic.mock.calls[0]?.[0]);
      expect(message).toContain('S3 smoke cleanup failed; the object may remain.');
      expect(message).toContain('"bucket":"alpha-bucket"');
      expect(message).toContain(
        '"key":"alpha/smoke/closed-alpha/s3-storage-20260610-000000000Z-fixed.txt"',
      );
      expect(message).not.toMatch(/SECRET|signed\.test/);
      expect(message).toContain('authorized S3 cleanup workflow');
    } finally {
      diagnostic.mockRestore();
    }
  });

  it('rejects cleanup-only failure with safe recovery details and no retry', async () => {
    let uploadedSize = 0;
    const adapter: S3SmokeAdapter = {
      uploadFile: vi.fn(async (key, _content, _mimeType, size) => {
        uploadedSize = size;
        return { key: `alpha/${key}` };
      }),
      getFileMetadata: vi.fn(async (key) => ({
        key: `alpha/${key}`,
        size: uploadedSize,
        mimeType: 'text/plain',
      })),
      generatePresignedUrl: vi.fn(async () => 'https://signed.test/?token=SECRET'),
      deleteFile: vi.fn(async () => {
        throw new Error('SECRET_PROVIDER_PAYLOAD');
      }),
    };
    const failure = await runS3StorageSmoke({
      adapter,
      bucket: 'alpha-bucket',
      key: 'smoke/check.txt',
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('S3 smoke cleanup failed; the object may remain.');
    expect((failure as Error).message).toContain(
      '"bucket":"alpha-bucket","key":"alpha/smoke/check.txt"',
    );
    expect((failure as Error).message).not.toMatch(/SECRET|signed\.test/);
    expect(adapter.deleteFile).toHaveBeenCalledExactlyOnceWith('smoke/check.txt');
  });

  it('redacts adapter delete failures before they reach logs or the smoke caller', async () => {
    const providerError = new Error('SECRET_PROVIDER_PAYLOAD https://signed.test/?token=SECRET');
    const transport = vi.spyOn(S3Client.prototype, 'send').mockRejectedValueOnce(providerError);
    const diagnostic = vi.spyOn(logger, 'error').mockImplementation(() => {});
    const adapter = new S3StorageAdapter({
      region: 'synthetic-region',
      bucket: 'alpha-bucket',
      pathPrefix: 'alpha',
      accessKeyId: 'synthetic-id',
      secretAccessKey: 'synthetic-secret',
    });
    try {
      const failure = await adapter.deleteFile('smoke/check.txt').catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe('S3 delete failed.');
      expect((failure as Error).cause).toBe(providerError);
      const command = transport.mock.calls[0]?.[0] as DeleteObjectCommand;
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toEqual({ Bucket: 'alpha-bucket', Key: 'alpha/smoke/check.txt' });
      expect(diagnostic).toHaveBeenCalledExactlyOnceWith('Failed to delete file from S3', {
        bucket: 'alpha-bucket',
        key: 'alpha/smoke/check.txt',
        error: 's3_delete_failed',
      });
      expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/SECRET|signed\.test/);
    } finally {
      transport.mockRestore();
      diagnostic.mockRestore();
    }
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
