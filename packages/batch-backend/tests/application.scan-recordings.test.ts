import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanRecordings, type RecordingRepository } from '../src/application/scan-recordings.js';
import type { RecordingRecord } from '../src/domain/recording-model.js';
import { FilesystemTranscriptionStorage } from '../src/infrastructure/transcription-storage.js';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'esl-recordings-'));
}

async function removeTempDir(dir: string | null): Promise<void> {
  if (!dir) return;
  await fs.rm(dir, { recursive: true, force: true });
}

describe('application/scan-recordings', () => {
  let rootDir: string | null = null;
  let uploadDir: string | null = null;

  afterEach(async () => {
    await removeTempDir(rootDir);
    await removeTempDir(uploadDir);
    rootDir = null;
    uploadDir = null;
  });

  it('discovers new recordings and enqueues transcription jobs', async () => {
    rootDir = await createTempDir();
    uploadDir = await createTempDir();

    const audioPath = path.join(rootDir, 'lesson.opus');
    await fs.writeFile(audioPath, 'audio-data');

    const storage = new FilesystemTranscriptionStorage(uploadDir);
    const repo = createInMemoryRecordingRepository();
    const enqueued: string[] = [];

    const result = await scanRecordings({
      root: rootDir,
      glob: '**/*.{opus,mp3,wav,m4a}',
      storage,
      repository: repo,
      enqueue: async ({ recordingId }) => {
        enqueued.push(recordingId);
      },
    });

    expect(result.discovered).toBe(1);
    expect(result.skipped).toBe(0);
    expect(repo.records).toHaveLength(1);
    expect(enqueued).toHaveLength(1);
    expect(repo.records[0]?.storageUri).toBe(`local://recordings/${enqueued[0]}.opus`);
  });

  it('deduplicates recordings by sha256', async () => {
    rootDir = await createTempDir();
    uploadDir = await createTempDir();

    const audioPath = path.join(rootDir, 'lesson.opus');
    await fs.writeFile(audioPath, 'audio-data');

    const storage = new FilesystemTranscriptionStorage(uploadDir);
    const repo = createInMemoryRecordingRepository();

    const first = await scanRecordings({
      root: rootDir,
      glob: '**/*.{opus,mp3,wav,m4a}',
      storage,
      repository: repo,
      enqueue: async () => undefined,
    });

    const second = await scanRecordings({
      root: rootDir,
      glob: '**/*.{opus,mp3,wav,m4a}',
      storage,
      repository: repo,
      enqueue: async () => undefined,
    });

    expect(first.discovered).toBe(1);
    expect(second.discovered).toBe(0);
    expect(second.skipped).toBe(1);
    expect(repo.records).toHaveLength(1);
  });
});

function createInMemoryRecordingRepository(): RecordingRepository & { records: RecordingRecord[] } {
  const records: RecordingRecord[] = [];

  return {
    records,
    async getRecordingBySha256(sha256: string) {
      return records.find((record) => record.sha256 === sha256) ?? null;
    },
    async getRecordingBySourcePath(sourcePath: string, bytes: number) {
      return (
        records.find(
          (record) => record.sourcePath === sourcePath && record.bytes === bytes,
        ) ?? null
      );
    },
    async insertRecording(params) {
      const now = new Date();
      const record: RecordingRecord = {
        id: params.id ?? `rec-${records.length + 1}`,
        source: params.source,
        studentId: params.studentId ?? null,
        sourcePath: params.sourcePath ?? null,
        storageUri: params.storageUri,
        sha256: params.sha256 ?? null,
        bytes: params.bytes,
        durationSec: params.durationSec ?? null,
        channels: params.channels ?? null,
        status: params.status,
        error: params.error ?? null,
        createdAt: now,
        updatedAt: now,
      };
      records.push(record);
      return record;
    },
    async updateRecordingStatus({ id, status, error }) {
      const record = records.find((item) => item.id === id);
      if (!record) return null;
      record.status = status;
      if (error !== undefined) record.error = error;
      record.updatedAt = new Date();
      return record;
    },
  };
}
