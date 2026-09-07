import type { RecordingRecord } from './recording-model.js';
import type { TranscriptionRun } from './transcription-run-repository.js';

export type RecordingEventType = 'recording_state_changed';

export interface RecordingEvent {
  type: RecordingEventType;
  recording: RecordingRecord;
  transcriptId?: string | null;
  run?: Pick<TranscriptionRun, 'state' | 'errorCode'> | null;
}

class RecordingEventCustomEvent extends Event {
  constructor(
    type: string,
    public readonly recordingEvent: RecordingEvent,
  ) {
    super(type);
  }
}

class SubscriptionChangeEvent extends Event {
  constructor(
    type: string,
    public readonly change: SubscriptionChange,
  ) {
    super(type);
  }
}

const recordingEventTarget = new EventTarget();

export interface RecordingSubscriptionOptions {
  recordingIds?: string[];
  allRecordings?: boolean;
  trackRemote?: boolean;
}

type SubscriptionChange =
  | { scope: 'all'; count: number }
  | { scope: 'recording'; recordingId: string; count: number };

const subscriptionChangeTarget = new EventTarget();
const recordingSubscriptionCounts = new Map<string, number>();
let wildcardSubscriptionCount = 0;

function emitSubscriptionChange(change: SubscriptionChange): void {
  const event = new SubscriptionChangeEvent('change', change);
  subscriptionChangeTarget.dispatchEvent(event);
}

export function publishRecordingEvent(event: RecordingEvent): void {
  const customEvent = new RecordingEventCustomEvent(event.type, event);
  recordingEventTarget.dispatchEvent(customEvent);
}

export function subscribeRecordingEvents(
  listener: (event: RecordingEvent) => void,
  options?: RecordingSubscriptionOptions,
): () => void {
  const trackRemote = options?.trackRemote !== false;
  const isAll =
    options?.allRecordings === true || !options?.recordingIds || options.recordingIds.length === 0;
  const recordingIds = isAll ? null : [...new Set(options?.recordingIds)];

  const handler = (evt: Event) => {
    if (!(evt instanceof RecordingEventCustomEvent)) return;
    const event = evt.recordingEvent;
    if (!isAll && recordingIds && !recordingIds.includes(event.recording.id)) return;
    listener(event);
  };

  recordingEventTarget.addEventListener('recording_state_changed', handler);

  if (trackRemote) {
    if (isAll) {
      wildcardSubscriptionCount += 1;
      emitSubscriptionChange({ scope: 'all', count: wildcardSubscriptionCount });
    } else if (recordingIds) {
      for (const recordingId of recordingIds) {
        const next = (recordingSubscriptionCounts.get(recordingId) ?? 0) + 1;
        recordingSubscriptionCounts.set(recordingId, next);
        emitSubscriptionChange({ scope: 'recording', recordingId, count: next });
      }
    }
  }

  return () => {
    recordingEventTarget.removeEventListener('recording_state_changed', handler);

    if (trackRemote) {
      if (isAll) {
        wildcardSubscriptionCount = Math.max(0, wildcardSubscriptionCount - 1);
        emitSubscriptionChange({ scope: 'all', count: wildcardSubscriptionCount });
      } else if (recordingIds) {
        for (const recordingId of recordingIds) {
          const current = recordingSubscriptionCounts.get(recordingId) ?? 0;
          const next = Math.max(0, current - 1);
          if (next === 0) {
            recordingSubscriptionCounts.delete(recordingId);
          } else {
            recordingSubscriptionCounts.set(recordingId, next);
          }
          emitSubscriptionChange({ scope: 'recording', recordingId, count: next });
        }
      }
    }
  };
}

export function onRecordingSubscriptionChange(
  listener: (change: SubscriptionChange) => void,
): () => void {
  const handler = (evt: Event) => {
    if (!(evt instanceof SubscriptionChangeEvent)) return;
    listener(evt.change);
  };

  subscriptionChangeTarget.addEventListener('change', handler);
  return () => subscriptionChangeTarget.removeEventListener('change', handler);
}

export function getRecordingSubscriptionSnapshot(): {
  all: number;
  recordings: Map<string, number>;
} {
  return {
    all: wildcardSubscriptionCount,
    recordings: new Map(recordingSubscriptionCounts),
  };
}
