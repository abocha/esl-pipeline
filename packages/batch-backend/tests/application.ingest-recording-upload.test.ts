import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ingestRecordingUpload,
  type RecordingRepository,
} from '../src/application/ingest-recording-upload.js';
import type { RecordingRecord } from '../src/domain/recording-model.js';
import { FilesystemTranscriptionStorage } from '../src/infrastructure/transcription-storage.js';

async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'esl-recording-upload-'));
}

async function removeTempDir(dir: string | null): Promise<void> {
  if (!dir) return;
  await fs.rm(dir, { recursive: true, force: true });
}

describe('application/ingest-recording-upload', () => {
  let uploadDir: string | null = null;

  afterEach(async () => {
    await removeTempDir(uploadDir);
    uploadDir = null;
  });

  it('creates an upload recording and enqueues transcription', async () => {
    uploadDir = await createTempDir();

    const storage = new FilesystemTranscriptionStorage(uploadDir);
    const repo = createInMemoryRecordingRepository();
    const enqueued: { recordingId: string; mediaPreparationVersion?: string }[] = [];

    const record = await ingestRecordingUpload({
      workspaceId: 'workspace-1',
      filename: 'lesson.opus',
      sourcePath: 'lesson.opus',
      stream: Readable.from([Buffer.from('audio-data')]),
      studentId: 'student-1',
      mediaPreparationVersion: 'recording-media-vA',
      storage,
      repository: repo,
      enqueue: async ({ recordingId, mediaPreparationVersion }) => {
        enqueued.push({ recordingId, mediaPreparationVersion });
      },
    });

    expect(record.source).toBe('upload');
    expect(repo.inserted[0]?.audioTopology).toBe('mixed_recording');
    expect(
      (repo.inserted[0] as (typeof repo.inserted)[number] & {
        mediaPreparationVersion?: string | null;
      })?.mediaPreparationVersion,
    ).toBe('recording-media-vA');
    expect(record).toMatchObject({ mediaPreparationVersion: 'recording-media-vA' });
    expect(record.studentId).toBe('student-1');
    expect(enqueued).toEqual([
      { recordingId: record.id, mediaPreparationVersion: 'recording-media-vA' },
    ]);
    expect(record.storageUri).toBe(
      `local://workspaces/workspace-1/recordings/${record.id}/audio.opus`,
    );
    expect(repo.records).toHaveLength(1);
  });
});

function createInMemoryRecordingRepository(): RecordingRepository & {
  records: RecordingRecord[];
  inserted: Parameters<RecordingRepository['insertRecording']>[0][];
} {
  const records: RecordingRecord[] = [];
  const inserted: Parameters<RecordingRepository['insertRecording']>[0][] = [];

  return {
    records,
    inserted,
    async insertRecording(params) {
      inserted.push(params);
      const now = new Date();
      const record: RecordingRecord = {
        id: params.id ?? `rec-${records.length + 1}`,
        workspaceId: params.workspaceId,
        source: params.source,
        studentId: params.studentId ?? null,
        sourcePath: params.sourcePath ?? null,
        storageUri: params.storageUri,
        audioLifecycle: params.audioLifecycle ?? 'retained',
        mediaPreparationVersion: (
          params as typeof params & { mediaPreparationVersion?: string | null }
        ).mediaPreparationVersion,
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
