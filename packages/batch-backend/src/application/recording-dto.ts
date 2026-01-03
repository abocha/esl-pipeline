import path from 'node:path';

import type { RecordingRecord } from '../domain/recording-model.js';

export interface RecordingDto {
  recordingId: string;
  status: RecordingRecord['status'];
  transcriptId: string | null;
  error: string | null;
  source: RecordingRecord['source'];
  studentId: string | null;
  displayName: string;
  durationSec: number | null;
  channels: number | null;
  bytes: number;
  createdAt: string;
  updatedAt: string;
}

export type RecordingWithTranscript = RecordingRecord & { transcriptId?: string | null };

export function recordingToDto(recording: RecordingWithTranscript): RecordingDto {
  return {
    recordingId: recording.id,
    status: recording.status,
    transcriptId: recording.transcriptId ?? null,
    error: recording.error ?? null,
    source: recording.source,
    studentId: recording.studentId ?? null,
    displayName: deriveRecordingDisplayName(recording),
    durationSec: recording.durationSec ?? null,
    channels: recording.channels ?? null,
    bytes: recording.bytes,
    createdAt: recording.createdAt.toISOString(),
    updatedAt: recording.updatedAt.toISOString(),
  };
}

export function deriveRecordingDisplayName(recording: RecordingRecord): string {
  const sourcePath = recording.sourcePath?.trim() ?? '';
  const storageUri = recording.storageUri?.trim() ?? '';
  const candidate = sourcePath || storageUri;
  if (!candidate) return recording.id;

  const cleaned = candidate.split('?')[0]?.split('#')[0] ?? candidate;
  const base = path.basename(cleaned);
  return base && base !== '.' && base !== '/' ? base : recording.id;
}
