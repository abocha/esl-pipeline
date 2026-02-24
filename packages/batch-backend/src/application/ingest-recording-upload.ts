import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Readable } from 'node:stream';

import type { RecordingRecord } from '../domain/recording-model.js';
import {
  type InsertRecordingParams,
  insertRecording,
  updateRecordingStatus,
} from '../domain/recording-repository.js';
import { createTranscribeQueue } from '../infrastructure/transcribe-queue.js';
import {
  type TranscriptionStorage,
  createTranscriptionStorage,
} from '../infrastructure/transcription-storage.js';

export interface UploadRecordingOptions {
  filename: string;
  stream: Readable;
  sourcePath?: string | null;
  studentId?: string | null;
  sttProvider?: 'deepgram' | 'elevenlabs';
  storage: TranscriptionStorage;
  repository: RecordingRepository;
  enqueue: (payload: {
    recordingId: string;
    sttProvider?: 'deepgram' | 'elevenlabs';
  }) => Promise<void>;
}

export interface RecordingRepository {
  insertRecording: (params: InsertRecordingParams) => Promise<RecordingRecord>;
  updateRecordingStatus: (params: {
    id: string;
    status: RecordingRecord['status'];
    error?: string | null;
  }) => Promise<RecordingRecord | null>;
}

export async function ingestRecordingUpload(
  options: UploadRecordingOptions,
): Promise<RecordingRecord> {
  const extension = resolveExtension(options.filename);
  const recordingId = randomUUID();
  const storageResult = await options.storage.putAudio({
    recordingId,
    stream: options.stream,
    extension,
  });

  const record = await options.repository.insertRecording({
    id: recordingId,
    source: 'upload',
    studentId: options.studentId ?? null,
    sourcePath: options.sourcePath ?? options.filename,
    storageUri: storageResult.uri,
    sha256: storageResult.sha256 ?? null,
    bytes: storageResult.bytes,
    status: 'queued',
  });

  try {
    await options.enqueue({
      recordingId,
      sttProvider: options.sttProvider,
    });
  } catch (error) {
    await options.repository.updateRecordingStatus({
      id: recordingId,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return record;
}

export async function ingestRecordingUploadWithDefaults(params: {
  filename: string;
  stream: Readable;
  sourcePath?: string | null;
  studentId?: string | null;
  sttProvider?: 'deepgram' | 'elevenlabs';
  storage?: TranscriptionStorage;
}): Promise<RecordingRecord> {
  const storage = params.storage ?? createTranscriptionStorage();
  const queue = createTranscribeQueue();
  const repository: RecordingRepository = {
    insertRecording,
    updateRecordingStatus,
  };

  return ingestRecordingUpload({
    filename: params.filename,
    stream: params.stream,
    sourcePath: params.sourcePath,
    studentId: params.studentId,
    sttProvider: params.sttProvider,
    storage,
    repository,
    enqueue: queue.enqueue,
  });
}

function resolveExtension(filename: string): string {
  const ext = path.extname(filename || '');
  return ext || '.bin';
}
