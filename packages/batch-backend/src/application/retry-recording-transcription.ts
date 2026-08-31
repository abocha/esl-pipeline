import type { AudioInputTopology, SttProviderId } from '@esl-pipeline/contracts';

import { publishRecordingEvent } from '../domain/recording-events.js';
import type { RecordingRecord } from '../domain/recording-model.js';
import {
  getRecordingById,
  updateRecordingAudioTopology,
  updateRecordingStatus,
} from '../domain/recording-repository.js';
import { createTranscribeQueue } from '../infrastructure/transcribe-queue.js';
import { type RecordingDto, recordingToDto } from './recording-dto.js';

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
    getById: typeof getRecordingById;
    updateStatus: typeof updateRecordingStatus;
    updateAudioTopology?: typeof updateRecordingAudioTopology;
  };
  enqueue: (payload: { recordingId: string; sttProvider?: SttProviderId }) => Promise<void>;
  publishEvent: typeof publishRecordingEvent;
}

export async function retryRecordingTranscription(
  recordingId: string,
  params?: { sttProvider?: SttProviderId; audioTopology?: AudioInputTopology },
  overrides?: Partial<RetryRecordingDependencies>,
): Promise<RecordingDto | null> {
  if (!recordingId) return null;

  const recordings = overrides?.recordings ?? {
    getById: getRecordingById,
    updateStatus: updateRecordingStatus,
    updateAudioTopology: updateRecordingAudioTopology,
  };
  const enqueue = overrides?.enqueue ?? createTranscribeQueue().enqueue;
  const publishEvent = overrides?.publishEvent ?? publishRecordingEvent;

  const recording = await recordings.getById(recordingId);
  if (!recording) return null;

  if (recording.status !== 'failed') {
    throw new RecordingRetryError('Recording is not in a failed state', 'recording_not_failed');
  }

  const topology = params?.audioTopology ?? recording.audioTopology ?? 'mixed_recording';
  const topologyRecording =
    recording.audioTopology === topology || !recordings.updateAudioTopology
      ? recording
      : ((await recordings.updateAudioTopology({ id: recording.id, audioTopology: topology })) ??
        recording);
  const queued = await recordings.updateStatus({
    id: recording.id,
    status: 'queued',
    error: null,
  });

  if (!queued) {
    return null;
  }

  publishEvent({
    type: 'recording_state_changed',
    recording: queued,
  });

  try {
    await enqueue({
      recordingId: topologyRecording.id,
      sttProvider: params?.sttProvider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await recordings.updateStatus({
      id: recording.id,
      status: 'failed',
      error: message,
    });
    if (failed) {
      publishEvent({
        type: 'recording_state_changed',
        recording: failed,
      });
    }
    throw error;
  }

  return recordingToDto(queuedWithTranscriptId(queued));
}

function queuedWithTranscriptId(recording: RecordingRecord): RecordingRecord & {
  transcriptId: string | null;
} {
  return {
    ...recording,
    transcriptId: null,
  };
}
