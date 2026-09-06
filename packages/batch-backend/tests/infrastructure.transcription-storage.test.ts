import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StorageConfigurationService } from '@esl-pipeline/shared-infrastructure';

import {
  DEFAULT_PROVIDER_SUBMISSION_URL_EXPIRY_SECONDS,
  createTranscriptionStorageForUri,
  FilesystemTranscriptionStorage,
  S3TranscriptionStorage,
} from '../src/infrastructure/transcription-storage.js';
import { logger } from '../src/infrastructure/logger.js';

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
      workspaceId: 'workspace-1',
      recordingId: 'r-1',
      stream,
      extension: '.opus',
    });

    const expectedPath = path.join(
      tempDir,
      'workspaces',
      'workspace-1',
      'recordings',
      'r-1',
      'audio.opus',
    );
    const expectedHash = createHash('sha256').update(content).digest('hex');

    expect(result.uri).toBe('local://workspaces/workspace-1/recordings/r-1/audio.opus');
    expect(result.bytes).toBe(content.length);
    expect(result.sha256).toBe(expectedHash);

    const stored = await fs.readFile(expectedPath);
    expect(stored.equals(content)).toBe(true);
  });

  it('uses an immutable filesystem candidate key when an upload attempt owns storage', async () => {
    tempDir = await createTempDir();
    const storage = new FilesystemTranscriptionStorage(tempDir);

    const result = await storage.putAudio({
      workspaceId: 'workspace-1',
      recordingId: 'r-1',
      candidateId: 'attempt-1',
      stream: Readable.from([Buffer.from('candidate-audio')]),
      extension: '.opus',
    });

    expect(result.uri).toBe(
      'local://workspaces/workspace-1/recordings/r-1/candidates/attempt-1/audio.opus',
    );
  });

  it.each([
    ['.mp3', 'audio/mpeg'],
    ['.wav', 'audio/wav'],
    ['.aac', 'audio/aac'],
    ['.m4a', 'audio/mp4'],
    ['.ogg', 'audio/ogg'],
    ['.webm', 'audio/webm'],
  ])(
    'returns a file-backed provider source for %s with its prepared media identity',
    async (extension, contentType) => {
      tempDir = await createTempDir();
      const relativePath = path.join(
        'workspaces',
        'workspace-1',
        'recordings',
        'recording-1',
        `audio${extension}`,
      );
      const targetPath = path.join(tempDir, relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, 'synthetic audio');
      const storage = new FilesystemTranscriptionStorage(tempDir);

      const source = await storage.getProviderSubmissionSource(
        `local://${relativePath.replaceAll('\\', '/')}`,
      );

      expect(source).toEqual({
        kind: 'file',
        path: targetPath,
        filename: `audio${extension}`,
        contentType,
        contentLength: Buffer.byteLength('synthetic audio'),
      });
    },
  );

  it('keeps local provider source construction bounded for a large retained file', async () => {
    tempDir = await createTempDir();
    const relativePath = 'workspaces/workspace-1/recordings/large/audio.m4a';
    const targetPath = path.join(tempDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const handle = await fs.open(targetPath, 'w');
    try {
      await handle.truncate(128 * 1024 * 1024);
    } finally {
      await handle.close();
    }
    const storage = new FilesystemTranscriptionStorage(tempDir);

    const source = await storage.getProviderSubmissionSource(`local://${relativePath}`);

    expect(source.kind).toBe('file');
    expect(source).toMatchObject({
      path: targetPath,
      filename: 'audio.m4a',
      contentType: 'audio/mp4',
      contentLength: 128 * 1024 * 1024,
    });
  });

  it('fails before provider submission when the retained local file is missing', async () => {
    tempDir = await createTempDir();
    const storage = new FilesystemTranscriptionStorage(tempDir);

    await expect(
      storage.getProviderSubmissionSource(
        'local://workspaces/workspace-1/recordings/missing/audio.mp3',
      ),
    ).rejects.toThrow(/provider submission/i);
  });

  it('removes a partial local audio target when its source stream fails', async () => {
    tempDir = await createTempDir();
    const storage = new FilesystemTranscriptionStorage(tempDir);
    const stream = new Readable({
      read() {
        this.push(Buffer.from('partial'));
        this.destroy(new Error('source stream failed'));
      },
    });
    const targetPath = path.join(
      tempDir,
      'workspaces',
      'workspace-1',
      'recordings',
      'r-source-failure',
      'audio.opus',
    );

    await expect(
      storage.putAudio({
        workspaceId: 'workspace-1',
        recordingId: 'r-source-failure',
        stream,
        extension: '.opus',
      }),
    ).rejects.toThrow('source stream failed');
    await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes a partial local audio target when its destination write fails', async () => {
    tempDir = await createTempDir();
    const destinationError = new Error('destination write failed');
    const storage = new FilesystemTranscriptionStorage(tempDir, {
      writeAudio: async (_input, targetPath) => {
        await fs.writeFile(targetPath, 'partial');
        throw destinationError;
      },
    });
    const targetPath = path.join(
      tempDir,
      'workspaces',
      'workspace-1',
      'recordings',
      'r-destination-failure',
      'audio.opus',
    );

    await expect(
      storage.putAudio({
        workspaceId: 'workspace-1',
        recordingId: 'r-destination-failure',
        stream: Readable.from([Buffer.from('audio')]),
        extension: '.opus',
      }),
    ).rejects.toBe(destinationError);
    await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
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

  it('creates a fresh short-lived S3 provider URL for each source request', async () => {
    const storage = createS3Storage();
    const urls = [
      'https://storage.example.test/audio.mp3?X-Amz-Signature=first-secret',
      'https://storage.example.test/audio.mp3?X-Amz-Signature=second-secret',
    ];
    const generatePresignedUrl = vi.fn(async () => urls.shift()!);
    replaceS3Adapter(storage, {
      uploadFile: vi.fn(async () => undefined),
      deleteFile: vi.fn(async () => undefined),
      generatePresignedUrl,
    });

    const first = await storage.getProviderSubmissionSource(
      's3://bucket/workspaces/workspace-1/recordings/r-1/audio.mp3',
    );
    const second = await storage.getProviderSubmissionSource(
      's3://bucket/workspaces/workspace-1/recordings/r-1/audio.mp3',
    );

    expect(first).toEqual({
      kind: 'url',
      url: 'https://storage.example.test/audio.mp3?X-Amz-Signature=first-secret',
    });
    expect(second).toEqual({
      kind: 'url',
      url: 'https://storage.example.test/audio.mp3?X-Amz-Signature=second-secret',
    });
    expect(generatePresignedUrl).toHaveBeenCalledTimes(2);
    expect(generatePresignedUrl).toHaveBeenNthCalledWith(
      1,
      'workspaces/workspace-1/recordings/r-1/audio.mp3',
      { expiresIn: DEFAULT_PROVIDER_SUBMISSION_URL_EXPIRY_SECONDS },
    );
    expect(generatePresignedUrl).toHaveBeenNthCalledWith(
      2,
      'workspaces/workspace-1/recordings/r-1/audio.mp3',
      { expiresIn: DEFAULT_PROVIDER_SUBMISSION_URL_EXPIRY_SECONDS },
    );
  });

  it('does not log the signed S3 provider URL', async () => {
    const storage = createS3Storage();
    const logInfo = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    try {
      const source = await storage.getProviderSubmissionSource(
        's3://bucket/workspaces/workspace-1/recordings/r-1/audio.mp3',
      );
      const signedUrl = source.kind === 'url' ? source.url : '';
      const serializedLogs = JSON.stringify(logInfo.mock.calls);

      expect(signedUrl).toContain('X-Amz-Signature');
      expect(serializedLogs).not.toContain(signedUrl);
      expect(serializedLogs).not.toContain('X-Amz-Signature');
    } finally {
      logInfo.mockRestore();
    }
  });

  it('does not expose a presigned URL when S3 source preparation fails', async () => {
    const storage = createS3Storage();
    const signedUrl = 'https://storage.example.test/audio.mp3?X-Amz-Signature=secret';
    replaceS3Adapter(storage, {
      uploadFile: vi.fn(async () => undefined),
      deleteFile: vi.fn(async () => undefined),
      generatePresignedUrl: vi.fn(async () => {
        throw new Error(`presigning failed for ${signedUrl}`);
      }),
    });

    const error = await storage
      .getProviderSubmissionSource('s3://bucket/workspaces/workspace-1/recordings/r-1/audio.mp3')
      .catch((value: unknown) => value as Error);

    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error('Expected provider source preparation to fail.');
    expect(error.message).toMatch(/provider submission/i);
    expect(error.message).not.toContain(signedUrl);
    expect((error as { cause?: unknown }).cause).toBeUndefined();
    expect(error.stack).not.toContain(signedUrl);
  });

  it('compensates an owned S3 audio key when upload rejects', async () => {
    const storage = createS3Storage();
    const uploadError = new Error('upload rejected before acknowledgement');
    const adapter = {
      uploadFile: vi.fn(async (_key: string, content: Readable) => {
        for await (const _chunk of content) {
          // The production multipart uploader consumes the stream before reporting failure.
        }
        throw uploadError;
      }),
      deleteFile: vi.fn(async () => {}),
    };
    replaceS3Adapter(storage, adapter);

    await expect(
      storage.putAudio({
        workspaceId: 'workspace-1',
        recordingId: 'r-s3-rejected',
        candidateId: 'attempt-s3',
        stream: Readable.from([Buffer.from('audio')]),
        extension: '.opus',
      }),
    ).rejects.toBe(uploadError);
    expect(adapter.deleteFile).toHaveBeenCalledWith(
      'workspaces/workspace-1/recordings/r-s3-rejected/candidates/attempt-s3/audio.opus',
    );
  });

  it('derives and enforces the same deterministic S3 candidate URI used for a registered attempt', async () => {
    const storage = createS3Storage();
    const candidate = storage.getAudioUri({
      workspaceId: 'workspace-1',
      recordingId: 'r-s3-registered',
      candidateId: 'attempt-s3',
      extension: '.opus',
    });
    expect(candidate).toBe(
      's3://bucket/workspaces/workspace-1/recordings/r-s3-registered/candidates/attempt-s3/audio.opus',
    );

    await expect(
      storage.putAudio({
        workspaceId: 'workspace-1',
        recordingId: 'r-s3-registered',
        candidateId: 'attempt-s3',
        targetUri: 's3://bucket/workspaces/workspace-1/recordings/other/audio.opus',
        stream: Readable.from([Buffer.from('audio')]),
        extension: '.opus',
      }),
    ).rejects.toThrow(/pre-registered audio target/i);
  });

  it('compensates an owned S3 audio key after an ambiguous upload failure', async () => {
    const storage = createS3Storage();
    const uploadError = new Error('connection lost after object creation');
    const adapter = {
      uploadFile: vi.fn(async (_key: string, content: Readable) => {
        for await (const _chunk of content) {
          // The production multipart uploader consumes the stream before reporting failure.
        }
        throw uploadError;
      }),
      deleteFile: vi.fn(async () => {}),
    };
    replaceS3Adapter(storage, adapter);

    await expect(
      storage.putAudio({
        workspaceId: 'workspace-1',
        recordingId: 'r-s3-ambiguous',
        stream: Readable.from([Buffer.from('audio')]),
        extension: '.opus',
      }),
    ).rejects.toBe(uploadError);
    expect(adapter.deleteFile).toHaveBeenCalledWith(
      'workspaces/workspace-1/recordings/r-s3-ambiguous/audio.opus',
    );
  });

  it('does not compensate a successfully stored S3 audio object', async () => {
    const storage = createS3Storage();
    const adapter = {
      uploadFile: vi.fn(async (_key: string, content: Readable) => {
        for await (const _chunk of content) {
          // The production multipart uploader consumes the stream before succeeding.
        }
      }),
      deleteFile: vi.fn(async () => {}),
    };
    replaceS3Adapter(storage, adapter);

    await storage.putAudio({
      workspaceId: 'workspace-1',
      recordingId: 'r-s3-success',
      stream: Readable.from([Buffer.from('audio')]),
      extension: '.opus',
    });
    expect(adapter.deleteFile).not.toHaveBeenCalled();
  });

  it('logs a failed S3 compensation but preserves the upload error', async () => {
    const storage = createS3Storage();
    const uploadError = new Error('upload failed');
    const cleanupError = new Error('delete failed');
    const adapter = {
      uploadFile: vi.fn(async (_key: string, content: Readable) => {
        for await (const _chunk of content) {
          // The production multipart uploader consumes the stream before reporting failure.
        }
        throw uploadError;
      }),
      deleteFile: vi.fn(async () => {
        throw cleanupError;
      }),
    };
    replaceS3Adapter(storage, adapter);
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    try {
      await expect(
        storage.putAudio({
          workspaceId: 'workspace-1',
          recordingId: 'r-s3-cleanup-failure',
          stream: Readable.from([Buffer.from('audio')]),
          extension: '.opus',
        }),
      ).rejects.toBe(uploadError);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining('owned S3 audio target'),
        expect.objectContaining({ event: 'recording_audio_upload_compensation_failed' }),
      );
    } finally {
      logError.mockRestore();
    }
  });
});

function createS3Storage(): S3TranscriptionStorage {
  return new S3TranscriptionStorage(
    new StorageConfigurationService({
      provider: 's3',
      s3: {
        region: 'us-east-1',
        accessKeyId: 'test',
        secretAccessKey: 'secret',
        bucket: 'bucket',
      },
    }),
  );
}

function replaceS3Adapter(
  storage: S3TranscriptionStorage,
  adapter: {
    uploadFile: (key: string, content: Readable, mimeType: string) => Promise<unknown>;
    deleteFile: (key: string) => Promise<void>;
    generatePresignedUrl?: (key: string, options: { expiresIn: number }) => Promise<string>;
  },
): void {
  (storage as unknown as { adapter: typeof adapter }).adapter = adapter;
}
