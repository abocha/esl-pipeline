import path from 'node:path';

import type {
  RecordingDto,
  RecordingErrorCode,
  RecordingProductState,
  TranscriptionRunState,
} from '@esl-pipeline/contracts';

import type { RecordingRecord } from '../domain/recording-model.js';
import type { TranscriptionRun } from '../domain/transcription-run-repository.js';

export type { RecordingDto } from '@esl-pipeline/contracts';

export type RecordingWithTranscript = RecordingRecord & { transcriptId?: string | null };

export function recordingToDto(
  recording: RecordingWithTranscript,
  run?: Pick<TranscriptionRun, 'state' | 'errorCode'> | null,
): RecordingDto {
  const runState = run === undefined ? inferRunState(recording.status) : (run?.state ?? null);
  const productState = projectProductState(recording.status, runState);
  const errorCode =
    productState === 'attention'
      ? toStableRecordingErrorCode(run?.errorCode ?? recording.error ?? null)
      : null;
  return {
    recordingId: recording.id,
    status: recording.status,
    productState,
    runState,
    transcriptId: recording.transcriptId ?? null,
    error: errorCode,
    errorCode,
    source: recording.source,
    studentId: recording.studentId ?? null,
    displayName: deriveRecordingDisplayName(recording),
    durationSec: recording.durationSec ?? null,
    channels: recording.channels ?? null,
    audioTopology: recording.audioTopology ?? null,
    audioLifecycle: recording.audioLifecycle,
    audioAvailable: recording.audioLifecycle === 'retained' && Boolean(recording.storageUri),
    bytes: recording.bytes,
    createdAt: recording.createdAt.toISOString(),
    updatedAt: recording.updatedAt.toISOString(),
  };
}

function inferRunState(status: RecordingRecord['status']): TranscriptionRunState | null {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'transcribing':
      return 'submitting';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

function projectProductState(
  status: RecordingRecord['status'],
  runState: TranscriptionRunState | null,
): RecordingProductState {
  switch (runState) {
    case 'queued':
      return 'waiting';
    case 'submitting':
      return 'transcribing';
    case 'retry_wait':
      return 'retrying';
    case 'succeeded':
      return 'ready';
    case 'failed':
      return 'attention';
    default:
      break;
  }
  switch (status) {
    case 'ingested':
      return 'checking';
    case 'queued':
      return 'waiting';
    case 'transcribing':
      return 'transcribing';
    case 'transcribed':
      return 'ready';
    case 'failed':
      return 'attention';
  }
}

const STABLE_RECORDING_ERROR_CODES = new Set<RecordingErrorCode>([
  'file_too_large',
  'insufficient_upload_capacity',
  'recording_too_long',
  'no_audio',
  'corrupt_media',
  'unsupported_media',
  'multiple_audio_streams',
  'preparation_failed',
  'speakers_not_separated',
  'transcription_unavailable_after_retries',
]);

function toStableRecordingErrorCode(value: string | null): RecordingErrorCode | null {
  return value && STABLE_RECORDING_ERROR_CODES.has(value as RecordingErrorCode)
    ? (value as RecordingErrorCode)
    : null;
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
