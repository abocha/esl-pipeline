import type { TranscriptMode, TranscriptRecord } from '../domain/transcript-model.js';
import type { SttProviderId } from '@esl-pipeline/contracts';
import { getTranscriptByRecordingId } from '../domain/transcript-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';

export interface RecordingTranscriptResponse {
  recordingId: string;
  transcriptId: string;
  text: string;
  summaryJson: Record<string, unknown> | null;
  sttProvider: SttProviderId;
  model: string;
  language: string;
  mode: TranscriptMode;
  createdAt: string;
  updatedAt: string;
}

export interface RecordingTranscriptDependencies {
  storage: TranscriptionStorage;
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingId;
  };
}

export async function getRecordingTranscript(
  recordingId: string,
  overrides?: Partial<RecordingTranscriptDependencies>,
): Promise<RecordingTranscriptResponse | null> {
  if (!recordingId) return null;

  const transcripts = overrides?.transcripts ?? {
    getByRecordingId: getTranscriptByRecordingId,
  };

  const transcript = await transcripts.getByRecordingId(recordingId);
  if (!transcript) return null;

  const storage = overrides?.storage ?? createTranscriptionStorageForUri(transcript.storageUri);
  const text = await storage.getText(transcript.storageUri);
  return buildRecordingTranscriptResponse(transcript, text);
}

export function buildRecordingTranscriptResponse(
  transcript: TranscriptRecord,
  text: string,
): RecordingTranscriptResponse {
  return {
    recordingId: transcript.recordingId,
    transcriptId: transcript.id,
    text,
    summaryJson: transcript.summaryJson ?? null,
    sttProvider: transcript.sttProvider,
    model: transcript.model,
    language: transcript.language,
    mode: transcript.mode,
    createdAt: transcript.createdAt.toISOString(),
    updatedAt: transcript.updatedAt.toISOString(),
  };
}
