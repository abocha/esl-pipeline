import type { RecordingRecord } from '../domain/recording-model.js';

export interface RecordingDto {
  recordingId: string;
  status: RecordingRecord['status'];
  transcriptId: string | null;
  error: string | null;
  source: RecordingRecord['source'];
  studentId: string | null;
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
    durationSec: recording.durationSec ?? null,
    channels: recording.channels ?? null,
    bytes: recording.bytes,
    createdAt: recording.createdAt.toISOString(),
    updatedAt: recording.updatedAt.toISOString(),
  };
}
