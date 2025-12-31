import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';

import { loadConfig } from '../config/env.js';
import { type RecordingRecord } from '../domain/recording-model.js';
import {
  type InsertRecordingParams,
  getRecordingBySha256,
  getRecordingBySourcePath,
  insertRecording,
  updateRecordingStatus,
} from '../domain/recording-repository.js';
import { logger } from '../infrastructure/logger.js';
import {
  type TranscriptionStorage,
  createTranscriptionStorage,
} from '../infrastructure/transcription-storage.js';
import { createTranscribeQueue } from '../infrastructure/transcribe-queue.js';

export interface RecordingScanResult {
  discovered: number;
  skipped: number;
}

export interface ScanRecordingsOptions {
  root: string;
  glob: string;
  storage: TranscriptionStorage;
  repository: RecordingRepository;
  enqueue: (payload: { recordingId: string }) => Promise<void>;
}

export interface RecordingRepository {
  getRecordingBySha256: (sha256: string) => Promise<RecordingRecord | null>;
  getRecordingBySourcePath: (sourcePath: string, bytes: number) => Promise<RecordingRecord | null>;
  insertRecording: (params: InsertRecordingParams) => Promise<RecordingRecord>;
  updateRecordingStatus: (params: {
    id: string;
    status: RecordingRecord['status'];
    error?: string | null;
  }) => Promise<RecordingRecord | null>;
}

export async function scanRecordings(options: ScanRecordingsOptions): Promise<RecordingScanResult> {
  const root = options.root.trim();
  if (!root) {
    return { discovered: 0, skipped: 0 };
  }

  let rootStat;
  try {
    rootStat = await fs.stat(root);
  } catch {
    return { discovered: 0, skipped: 0 };
  }

  if (!rootStat.isDirectory()) {
    return { discovered: 0, skipped: 0 };
  }

  let discovered = 0;
  let skipped = 0;

  for await (const relativePath of fs.glob(options.glob, { cwd: root })) {
    const absolutePath = path.resolve(root, relativePath);

    let stats;
    try {
      stats = await fs.stat(absolutePath);
    } catch {
      continue;
    }

    if (!stats.isFile()) continue;

    try {
      const sha256 = await sha256File(absolutePath);
      const existing =
        (sha256 ? await options.repository.getRecordingBySha256(sha256) : null) ??
        (stats.size ? await options.repository.getRecordingBySourcePath(absolutePath, stats.size) : null);

      if (existing) {
        skipped += 1;
        continue;
      }

      const recordingId = randomUUID();
      const storageResult = await options.storage.putAudio({
        recordingId,
        inputPath: absolutePath,
      });

      await options.repository.insertRecording({
        id: recordingId,
        source: 'scan',
        sourcePath: absolutePath,
        storageUri: storageResult.uri,
        sha256: sha256 ?? storageResult.sha256 ?? null,
        bytes: storageResult.bytes,
        status: 'queued',
      });

      try {
        await options.enqueue({ recordingId });
        discovered += 1;
      } catch (error) {
        await options.repository.updateRecordingStatus({
          id: recordingId,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    } catch (error) {
      logger.error(error instanceof Error ? error : String(error), {
        component: 'recording-scan',
        message: 'Failed to ingest recording',
        sourcePath: absolutePath,
      });
      skipped += 1;
    }
  }

  return { discovered, skipped };
}

export async function scanRecordingsWithDefaults(
  overrides?: Partial<Pick<ScanRecordingsOptions, 'root' | 'glob' | 'storage'>>,
): Promise<RecordingScanResult> {
  const config = loadConfig();
  const storage = overrides?.storage ?? createTranscriptionStorage();
  const queue = createTranscribeQueue();

  const repository: RecordingRepository = {
    getRecordingBySha256,
    getRecordingBySourcePath,
    insertRecording,
    updateRecordingStatus,
  };

  return scanRecordings({
    root: overrides?.root ?? config.recordings.root,
    glob: overrides?.glob ?? config.recordings.glob,
    storage,
    repository,
    enqueue: queue.enqueue,
  });
}

async function sha256File(filePath: string): Promise<string | null> {
  try {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    for await (const chunk of stream) {
      hash.update(chunk);
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}
