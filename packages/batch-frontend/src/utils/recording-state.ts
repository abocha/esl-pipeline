import type {
  RecordingDto,
  RecordingErrorCode,
  RecordingProductState,
} from '@esl-pipeline/contracts';

export const RECORDING_ERROR_ACTIONS: Record<RecordingErrorCode, string> = {
  file_too_large: 'Choose a source file at or below the configured 2 GiB operational upload limit.',
  insufficient_upload_capacity:
    'The server is temporarily short of upload capacity. Try again later.',
  recording_too_long: 'Choose a lesson no longer than 100 minutes.',
  no_audio: 'This file has no usable audio. Choose the lesson recording with sound.',
  corrupt_media: 'The recording appears damaged. Play or export it again, then re-upload it.',
  unsupported_media:
    'Use MP3, WAV, AAC/M4A, OGG/Opus, supported audio-only WebM, or an allowed MP4/MOV/WebM recording.',
  multiple_audio_streams:
    'Export one mixed lesson audio track or use the advanced trusted-split path.',
  preparation_failed:
    "This video's audio could not be extracted without conversion. Upload an audio export.",
  speakers_not_separated:
    'The transcript did not contain the expected two lesson speakers after automatic recovery. Upload a clearer or full lesson recording.',
  transcription_unavailable_after_retries:
    'Automatic transcription could not finish. Upload the recording again later.',
};

export const GENERIC_RECORDING_TERMINAL_ACTION =
  'Automatic transcription could not finish. Replace the recording or upload it again later.';

const PRODUCT_STATE_LABELS: Record<RecordingProductState, string> = {
  checking: 'Checking recording',
  waiting: 'Waiting to transcribe',
  transcribing: 'Transcribing',
  retrying: 'Trying again automatically',
  ready: 'Ready for review',
  attention: 'Recording needs attention',
};

export function getRecordingErrorAction(code: string | null | undefined): string {
  return code && Object.hasOwn(RECORDING_ERROR_ACTIONS, code)
    ? RECORDING_ERROR_ACTIONS[code as RecordingErrorCode]
    : GENERIC_RECORDING_TERMINAL_ACTION;
}

export function getRecordingProductLabel(
  recording: Pick<RecordingDto, 'productState'> | null,
  uploading: boolean,
  uploadProgress: number,
): string | null {
  if (uploading) return uploadProgress >= 100 ? 'Checking recording' : 'Uploading recording';
  return recording ? PRODUCT_STATE_LABELS[recording.productState] : null;
}

export function selectNewestRecording<T extends Pick<RecordingDto, 'updatedAt'>>(
  current: T | null,
  incoming: T,
): T {
  if (!current) return incoming;
  const currentAt = Date.parse(current.updatedAt);
  const incomingAt = Date.parse(incoming.updatedAt);
  if (Number.isFinite(currentAt) && Number.isFinite(incomingAt) && incomingAt < currentAt) {
    return current;
  }
  return incoming;
}
