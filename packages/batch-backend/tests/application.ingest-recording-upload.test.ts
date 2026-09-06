import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    const enqueued: { runId: string; recordingId: string }[] = [];

    const record = await ingestRecordingUpload({
      workspaceId: 'workspace-1',
      filename: 'lesson.opus',
      sourcePath: 'lesson.opus',
      stream: Readable.from([Buffer.from('audio-data')]),
      studentId: 'student-1',
      mediaPreparationVersion: 'recording-media-vA',
      storage,
      repository: repo,
      enqueue: async ({ runId, recordingId }) => {
        enqueued.push({ runId, recordingId });
      },
    });

    expect(record.source).toBe('upload');
    expect(repo.inserted[0]?.audioTopology).toBe('mixed_recording');
    expect(
      (
        repo.inserted[0] as (typeof repo.inserted)[number] & {
          mediaPreparationVersion?: string | null;
        }
      )?.mediaPreparationVersion,
    ).toBe('recording-media-vA');
    expect(record).toMatchObject({ mediaPreparationVersion: 'recording-media-vA' });
    expect(record.studentId).toBe('student-1');
    expect(enqueued).toEqual([{ runId: `run-${record.id}`, recordingId: record.id }]);
    expect(record.storageUri).toBe(
      `local://workspaces/workspace-1/recordings/${record.id}/audio.opus`,
    );
    expect(repo.records).toHaveLength(1);
  });

  it('durably registers the deterministic candidate before its storage mutation', async () => {
    uploadDir = await createTempDir();
    const storage = new FilesystemTranscriptionStorage(uploadDir);
    const putAudio = vi.spyOn(storage, 'putAudio');
    const recordCandidate = vi.fn(async (uri: string) => {
      expect(uri).toBe(
        'local://workspaces/workspace-1/recordings/recording-1/candidates/attempt-1/audio.opus',
      );
      expect(putAudio).not.toHaveBeenCalled();
      return true;
    });

    await ingestRecordingUpload({
      workspaceId: 'workspace-1',
      filename: 'lesson.opus',
      stream: Readable.from([Buffer.from('audio-data')]),
      storage,
      repository: createInMemoryRecordingRepository(),
      uploadOperation: {
        id: 'operation-1',
        attemptToken: 'attempt-1',
        recordingId: 'recording-1',
        recordCandidate,
      },
      enqueue: async () => undefined,
    });

    expect(recordCandidate).toHaveBeenCalledTimes(1);
    expect(putAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        targetUri:
          'local://workspaces/workspace-1/recordings/recording-1/candidates/attempt-1/audio.opus',
      }),
    );
  });

  it('does not begin a storage write if pre-registration loses current-attempt authority', async () => {
    uploadDir = await createTempDir();
    const storage = new FilesystemTranscriptionStorage(uploadDir);
    const putAudio = vi.spyOn(storage, 'putAudio');

    await expect(
      ingestRecordingUpload({
        workspaceId: 'workspace-1',
        filename: 'lesson.opus',
        stream: Readable.from([Buffer.from('audio-data')]),
        storage,
        repository: createInMemoryRecordingRepository(),
        uploadOperation: {
          id: 'operation-1',
          attemptToken: 'attempt-1',
          recordingId: 'recording-1',
          recordCandidate: async () => false,
        },
        enqueue: async () => undefined,
      }),
    ).rejects.toThrow(/no longer owned/i);
    expect(putAudio).not.toHaveBeenCalled();
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
    async insertRecordingWithRun({ recording, provider, requestProfile }) {
      const stored = await this.insertRecording(recording);
      expect(provider).toBe('elevenlabs');
      expect(requestProfile).toContain('elevenlabs');
      return { recording: stored, run: { id: `run-${stored.id}` } };
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
