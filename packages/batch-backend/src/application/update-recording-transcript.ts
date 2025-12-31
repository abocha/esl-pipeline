import { getTranscriptByRecordingId, updateTranscriptStorage } from '../domain/transcript-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';
import {
  buildRecordingTranscriptResponse,
  type RecordingTranscriptResponse,
} from './get-recording-transcript.js';

export interface UpdateRecordingTranscriptParams {
  recordingId: string;
  text: string;
}

export interface UpdateRecordingTranscriptDependencies {
  storage: TranscriptionStorage;
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingId;
    update: typeof updateTranscriptStorage;
  };
}

export async function updateRecordingTranscript(
  params: UpdateRecordingTranscriptParams,
  overrides?: Partial<UpdateRecordingTranscriptDependencies>,
): Promise<RecordingTranscriptResponse | null> {
  if (!params.recordingId) return null;

  const storage = overrides?.storage ?? createTranscriptionStorage();
  const transcripts = overrides?.transcripts ?? {
    getByRecordingId: getTranscriptByRecordingId,
    update: updateTranscriptStorage,
  };

  const transcript = await transcripts.getByRecordingId(params.recordingId);
  if (!transcript) return null;

  const stored = await storage.putTranscript({
    transcriptId: transcript.id,
    text: params.text,
  });

  const updated = await transcripts.update({
    id: transcript.id,
    storageUri: stored.uri,
  });

  if (!updated) return null;

  return buildRecordingTranscriptResponse(updated, params.text);
}
