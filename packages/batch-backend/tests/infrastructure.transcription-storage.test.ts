import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { FilesystemTranscriptionStorage } from '../src/infrastructure/transcription-storage.js';

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

    expect(result.uri).toBe('local://transcripts/t-1.txt');
    expect(result.bytes).toBe(Buffer.byteLength('Hello world', 'utf8'));

    const expectedPath = path.join(tempDir, 'transcripts', 't-1.txt');
    const fileContents = await fs.readFile(expectedPath, 'utf8');
    expect(fileContents).toBe('Hello world');

    const readBack = await storage.getText(result.uri);
    expect(readBack).toBe('Hello world');
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
});
