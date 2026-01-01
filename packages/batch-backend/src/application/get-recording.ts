import { getRecordingById } from '../domain/recording-repository.js';
import { getTranscriptByRecordingId } from '../domain/transcript-repository.js';
import { recordingToDto, type RecordingDto } from './recording-dto.js';

export interface GetRecordingDependencies {
  recordings: {
    getById: typeof getRecordingById;
  };
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingId;
  };
}

export async function getRecording(
  recordingId: string,
  overrides?: Partial<GetRecordingDependencies>,
): Promise<RecordingDto | null> {
  if (!recordingId) return null;

  const recordings = overrides?.recordings ?? {
    getById: getRecordingById,
  };
  const transcripts = overrides?.transcripts ?? {
    getByRecordingId: getTranscriptByRecordingId,
  };

  const recording = await recordings.getById(recordingId);
  if (!recording) return null;

  const transcript = await transcripts.getByRecordingId(recording.id);
  return recordingToDto({
    ...recording,
    transcriptId: transcript?.id ?? null,
  });
}
