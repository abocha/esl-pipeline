import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { StorageConfigurationService } from '@esl-pipeline/shared-infrastructure';

import {
  FileStorageService,
  createFileStorageService,
} from '../src/infrastructure/file-storage-service.js';

describe('infrastructure/file-storage-service', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  function createFilesystemService(uploadDir: string): FileStorageService {
    const storageConfig = new StorageConfigurationService({
      provider: 'filesystem',
      filesystem: { uploadDir },
    });
    return new FileStorageService(storageConfig);
  }

  it('stores, reads metadata, checks existence, and deletes filesystem uploads', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-file-storage-'));
    const service = createFilesystemService(tempDir);
    const key = 'nested/asset.txt';
    const content = Buffer.from('hello world', 'utf8');

    const uploaded = await service.uploadFile(key, content, 'text/plain');

    expect(uploaded.key).toBe(key);
    expect(uploaded.size).toBe(content.length);
    expect(uploaded.mimeType).toBe('text/plain');
    expect(uploaded.url).toBe(path.join(tempDir, key));

    const metadata = await service.getFileMetadata(key);
    expect(metadata).toMatchObject({
      key,
      size: content.length,
      mimeType: 'application/octet-stream',
    });

    expect(await service.fileExists(key)).toBe(true);

    await service.deleteFile(key);
    expect(await service.fileExists(key)).toBe(false);
  });

  it('uploads stream content to filesystem storage', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-file-storage-stream-'));
    const service = createFilesystemService(tempDir);
    const key = 'stream/audio.bin';
    const payload = Buffer.from('audio-bytes');

    const uploaded = await service.uploadFile(
      key,
      Readable.from([payload]),
      'application/octet-stream',
    );

    expect(uploaded.size).toBe(payload.length);
    const stored = await fs.readFile(path.join(tempDir, key));
    expect(stored.equals(payload)).toBe(true);
  });

  it('returns null for presigned URLs when provider is filesystem', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-file-storage-url-'));
    const service = createFilesystemService(tempDir);

    await expect(service.generatePresignedUrl('any-key')).resolves.toBeNull();
  });

  it('does not expose legacy migrateFileToS3 helper on the service surface', () => {
    const storageConfig = new StorageConfigurationService({ provider: 'filesystem' });
    const service = createFileStorageService(storageConfig);

    expect('migrateFileToS3' in service).toBe(false);
    expect('migrateFileToS3' in FileStorageService.prototype).toBe(false);
  });
});
