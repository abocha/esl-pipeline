import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { StorageConfigurationService } from '@esl-pipeline/shared-infrastructure';

import {
  createTranscriptionStorageForUri,
  FilesystemTranscriptionStorage,
  S3TranscriptionStorage,
} from '../src/infrastructure/transcription-storage.js';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'esl-transcription-'));
}

async function removeTempDir(dir: string | null): Promise<void> {
  if (!dir) return;
  await fs.rm(dir, { recursive: true, force: true });
}

describe('infrastructure/transcription-storage', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    await removeTempDir(tempDir);
    tempDir = null;
  });

  it('writes and reads transcript text using local URIs', async () => {
    tempDir = await createTempDir();
    const storage = new FilesystemTranscriptionStorage(tempDir);

    const result = await storage.putTranscript({ transcriptId: 't-1', text: 'Hello world' });

    const expectedHash = createHash('sha256').update('Hello world').digest('hex');
    expect(result.uri).toBe(`local://transcripts/t-1/content/${expectedHash}.txt`);
    expect(result.bytes).toBe(Buffer.byteLength('Hello world', 'utf8'));
    expect(result.sha256).toBe(expectedHash);

    const expectedPath = path.join(tempDir, 'transcripts', 't-1', 'content', `${expectedHash}.txt`);
    const fileContents = await fs.readFile(expectedPath, 'utf8');
    expect(fileContents).toBe('Hello world');

    const readBack = await storage.getText(result.uri);
    expect(readBack).toBe('Hello world');
  });

  it('keeps earlier transcript and draft content-addressed objects immutable', async () => {
    tempDir = await createTempDir();
    const storage = new FilesystemTranscriptionStorage(tempDir);

    const firstTranscript = await storage.putTranscript({ transcriptId: 't-cas', text: 'first' });
    const secondTranscript = await storage.putTranscript({ transcriptId: 't-cas', text: 'second' });
    const firstDraft = await storage.putDraft({ draftId: 'd-cas', text: 'draft one' });
    const secondDraft = await storage.putDraft({ draftId: 'd-cas', text: 'draft two' });

    expect(secondTranscript.uri).not.toBe(firstTranscript.uri);
    expect(secondDraft.uri).not.toBe(firstDraft.uri);
    await expect(storage.getText(firstTranscript.uri)).resolves.toBe('first');
    await expect(storage.getText(secondTranscript.uri)).resolves.toBe('second');
    await expect(storage.getText(firstDraft.uri)).resolves.toBe('draft one');
    await expect(storage.getText(secondDraft.uri)).resolves.toBe('draft two');

    const repeatedDraft = await storage.putDraft({ draftId: 'd-cas', text: 'draft two' });
    expect(repeatedDraft).toEqual(secondDraft);
  });

  it('stores optional raw response JSON payloads', async () => {
    tempDir = await createTempDir();
    const storage = new FilesystemTranscriptionStorage(tempDir);

    const result = await storage.putRawResponse({
      transcriptId: 't-raw',
      json: { ok: true, count: 2 },
    });

    expect(result.uri).toBe('local://transcripts/t-raw.json');
    const expectedPath = path.join(tempDir, 'transcripts', 't-raw.json');
    const payload = await fs.readFile(expectedPath, 'utf8');
    expect(payload).toContain('"ok": true');
    expect(payload).toContain('"count": 2');
  });

  it('writes audio streams with deterministic URIs and sha256', async () => {
    tempDir = await createTempDir();
    const storage = new FilesystemTranscriptionStorage(tempDir);
    const content = Buffer.from('audio-bytes');
    const stream = Readable.from([content]);

    const result = await storage.putAudio({
      recordingId: 'r-1',
      stream,
      extension: '.opus',
    });

    const expectedPath = path.join(tempDir, 'recordings', 'r-1.opus');
    const expectedHash = createHash('sha256').update(content).digest('hex');

    expect(result.uri).toBe('local://recordings/r-1.opus');
    expect(result.bytes).toBe(content.length);
    expect(result.sha256).toBe(expectedHash);

    const stored = await fs.readFile(expectedPath);
    expect(stored.equals(content)).toBe(true);
  });

  it('selects filesystem storage for local URIs even when provider is s3', async () => {
    tempDir = await createTempDir();
    const storageConfig = new StorageConfigurationService({
      provider: 's3',
      s3: {
        region: 'us-east-1',
        accessKeyId: 'test',
        secretAccessKey: 'secret',
        bucket: 'bucket',
      },
      filesystem: {
        uploadDir: tempDir,
      },
    });

    const storage = createTranscriptionStorageForUri(
      'local://transcripts/t-local/content/hash.txt',
      {
        storageConfig,
      },
    );

    expect(storage).toBeInstanceOf(FilesystemTranscriptionStorage);

    const stored = await storage.putTranscript({ transcriptId: 't-local', text: 'Hello' });
    expect(stored.uri).toMatch(/^local:\/\/transcripts\/t-local\/content\/[0-9a-f]{64}\.txt$/);
  });

  it('selects s3 storage for s3 URIs', () => {
    const storageConfig = new StorageConfigurationService({
      provider: 's3',
      s3: {
        region: 'us-east-1',
        accessKeyId: 'test',
        secretAccessKey: 'secret',
        bucket: 'bucket',
      },
    });

    const storage = createTranscriptionStorageForUri('s3://bucket/transcripts/t.txt', {
      storageConfig,
    });

    expect(storage).toBeInstanceOf(S3TranscriptionStorage);
  });
});
