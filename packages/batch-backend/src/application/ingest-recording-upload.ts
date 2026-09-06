import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Readable } from 'node:stream';

import type { AudioInputTopology, SttProviderId } from '@esl-pipeline/contracts';

import { loadConfig } from '../config/env.js';
import type { RecordingRecord } from '../domain/recording-model.js';
import {
  type InsertRecordingParams,
  insertRecordingWithQueuedTranscriptionRun,
} from '../domain/recording-repository.js';
import { createTranscribeQueue } from '../infrastructure/transcribe-queue.js';
import {
  createTranscriptionStorage,
  type TranscriptionStorage,
} from '../infrastructure/transcription-storage.js';
import { resolveTranscriptionRoute } from './transcription-routing.js';

export interface UploadRecordingOptions {
  /** Client-generated transport-operation identity; reused only for an ambiguous retry. */
  recordingId?: string;
  /** Durable operation ownership, acquired before media/spooling work by HTTP. */
  uploadOperation?: {
    id: string;
    attemptToken: string;
    recordingId: string;
    recordCandidate: (candidateUri: string) => Promise<boolean>;
  };
  workspaceId: string;
  filename: string;
  stream?: Readable;
  inputPath?: string;
  sourcePath?: string | null;
  studentId?: string | null;
  sttProvider?: SttProviderId;
  audioTopology?: AudioInputTopology;
  mediaPreparationVersion?: string;
  storage: TranscriptionStorage;
  repository: RecordingRepository;
  enqueue: (payload: {
    runId: string;
    recordingId: string;
    mediaPreparationVersion?: string;
  }) => Promise<void>;
}

export interface RecordingRepository {
  getRecordingByIdForWorkspace?: (
    id: string,
    workspaceId: string,
  ) => Promise<RecordingRecord | null>;
  insertRecordingWithRun?: (params: {
    recording: InsertRecordingParams;
    provider: SttProviderId;
    requestProfile: string;
    uploadOperation?: { id: string; attemptToken: string; candidateUri: string };
  }) => Promise<{ recording: RecordingRecord; run: { id: string } }>;
  /** Legacy test seam; production invocation requires insertRecordingWithRun. */
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
  const recordingId = options.uploadOperation?.recordingId ?? options.recordingId ?? randomUUID();
  // Legacy callers without a durable operation retain their old idempotent seam.
  // The production upload route always provides uploadOperation and never treats a
  // shared recording key as writer ownership.
  if (!options.uploadOperation) {
    const existing = await options.repository.getRecordingByIdForWorkspace?.(
      recordingId,
      options.workspaceId,
    );
    if (existing) return existing;
  }
  const audioOptions = {
    workspaceId: options.workspaceId,
    recordingId,
    candidateId: options.uploadOperation?.attemptToken,
    stream: options.stream,
    inputPath: options.inputPath,
    extension,
  };
  const candidateUri = options.uploadOperation
    ? options.storage.getAudioUri?.(audioOptions)
    : undefined;
  if (options.uploadOperation) {
    if (!candidateUri) {
      throw new Error('Upload candidate storage must expose its deterministic URI before writing.');
    }
    const current = await options.uploadOperation.recordCandidate(candidateUri);
    if (!current) {
      throw new Error('Recording upload operation is no longer owned by this request.');
    }
  }
  const storageResult = await options.storage.putAudio({
    ...audioOptions,
    targetUri: candidateUri,
  });

  const topology = options.audioTopology ?? 'mixed_recording';
  const route = resolveTranscriptionRoute({
    config: loadConfig(),
    topology,
    requestedProvider: options.sttProvider,
  });
  if (!options.repository.insertRecordingWithRun) {
    throw new Error('Recording ingestion requires transactional recording/run creation.');
  }
  const created = await options.repository.insertRecordingWithRun({
    recording: {
      id: recordingId,
      workspaceId: options.workspaceId,
      source: 'upload',
      studentId: options.studentId ?? null,
      sourcePath: options.sourcePath ?? options.filename,
      storageUri: storageResult.uri,
      sha256: storageResult.sha256 ?? null,
      bytes: storageResult.bytes,
      audioTopology: topology,
      mediaPreparationVersion: options.mediaPreparationVersion ?? null,
      status: 'queued',
    },
    provider: route.provider,
    requestProfile: route.profile,
    ...(options.uploadOperation
      ? {
          uploadOperation: {
            id: options.uploadOperation.id,
            attemptToken: options.uploadOperation.attemptToken,
            candidateUri: storageResult.uri,
          },
        }
      : {}),
  });
  const record = created.recording;

  try {
    await options.enqueue({ runId: created.run.id, recordingId: record.id });
  } catch {
    // DB state is authoritative. The worker-owned reconciler recreates this stable
    // job later, including after an ambiguous successful add acknowledgement.
  }

  return record;
}

export async function ingestRecordingUploadWithDefaults(params: {
  workspaceId: string;
  recordingId?: string;
  filename: string;
  stream?: Readable;
  inputPath?: string;
  sourcePath?: string | null;
  studentId?: string | null;
  sttProvider?: SttProviderId;
  audioTopology?: AudioInputTopology;
  mediaPreparationVersion?: string;
  storage?: TranscriptionStorage;
}): Promise<RecordingRecord> {
  const storage = params.storage ?? createTranscriptionStorage();
  const queue = createTranscribeQueue();
  const repository: RecordingRepository = {
    insertRecordingWithRun: insertRecordingWithQueuedTranscriptionRun,
    insertRecording: async () => {
      throw new Error('legacy recording insertion is not an execution path');
    },
    updateRecordingStatus: async () => null,
  };

  return ingestRecordingUpload({
    workspaceId: params.workspaceId,
    recordingId: params.recordingId,
    filename: params.filename,
    stream: params.stream,
    inputPath: params.inputPath,
    sourcePath: params.sourcePath,
    studentId: params.studentId,
    sttProvider: params.sttProvider,
    audioTopology: params.audioTopology,
    mediaPreparationVersion: params.mediaPreparationVersion,
    storage,
    repository,
    enqueue: queue.enqueue,
  });
}

function resolveExtension(filename: string): string {
  const ext = path.extname(filename || '');
  return ext || '.bin';
}
