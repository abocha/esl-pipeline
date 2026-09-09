import type { AudioInputTopology, SttProviderId } from '@esl-pipeline/contracts';

import {
  getRecordingByIdForWorkspace,
  updateRecordingStatus,
} from '../domain/recording-repository.js';
import type { RecordingDto } from './recording-dto.js';

export class RecordingRetryError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'RecordingRetryError';
    this.code = code;
  }
}

export interface RetryRecordingDependencies {
  recordings: {
    getById: typeof getRecordingByIdForWorkspace;
    updateStatus: typeof updateRecordingStatus;
  };
  enqueue: (payload: {
    recordingId: string;
    sttProvider?: SttProviderId;
    mediaPreparationVersion?: string;
  }) => Promise<void>;
  publishEvent: () => void;
}

export async function retryRecordingTranscription(
  recordingId: string,
  params: {
    workspaceId: string;
    sttProvider?: SttProviderId;
    audioTopology?: AudioInputTopology;
  },
  overrides?: Partial<RetryRecordingDependencies>,
): Promise<RecordingDto | null> {
  if (!recordingId) return null;

  const recordings = overrides?.recordings ?? {
    getById: getRecordingByIdForWorkspace,
    updateStatus: updateRecordingStatus,
  };

  const recording = await recordings.getById(recordingId, params.workspaceId);
  if (!recording) return null;

  // Slice 4 makes the platform the only retry authority. A public route must
  // never mint a replacement run or submission slot, including for failed rows.
  throw new RecordingRetryError(
    'Automatic transcription recovery is platform-managed; upload the recording again after terminal failure.',
    recording.status === 'failed' ? 'recording_retry_not_supported' : 'recording_not_failed',
  );
}
