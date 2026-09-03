import { getRecordingByIdForWorkspace } from '../domain/recording-repository.js';
import { getTranscriptByRecordingIdForWorkspace } from '../domain/transcript-repository.js';
import { type RecordingDto, recordingToDto } from './recording-dto.js';

export interface GetRecordingDependencies {
  recordings: {
    getById: typeof getRecordingByIdForWorkspace;
  };
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingIdForWorkspace;
  };
}

export async function getRecording(
  recordingId: string,
  workspaceId: string,
  overrides?: Partial<GetRecordingDependencies>,
): Promise<RecordingDto | null> {
  if (!recordingId) return null;

  const recordings = overrides?.recordings ?? {
    getById: getRecordingByIdForWorkspace,
  };
  const transcripts = overrides?.transcripts ?? {
    getByRecordingId: getTranscriptByRecordingIdForWorkspace,
  };

  const recording = await recordings.getById(recordingId, workspaceId);
  if (!recording) return null;

  const transcript = await transcripts.getByRecordingId(recording.id, workspaceId);
  return recordingToDto({
    ...recording,
    transcriptId: transcript?.id ?? null,
  });
}
