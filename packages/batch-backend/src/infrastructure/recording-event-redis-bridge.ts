import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

import {
  getRecordingSubscriptionSnapshot,
  onRecordingSubscriptionChange,
  publishRecordingEvent,
  type RecordingEvent,
  type RecordingEventType,
  subscribeRecordingEvents,
} from '../domain/recording-events.js';
import type { RecordingRecord } from '../domain/recording-model.js';
import { logger } from './logger.js';
import { createRedisClient } from './redis.js';

const CHANNEL_BASE = 'batch_recording_events';
const RECORDING_CHANNEL_PREFIX = `${CHANNEL_BASE}:`;
const INSTANCE_ID = randomUUID();

interface SerializedRecording {
  id: string;
  source: RecordingRecord['source'];
  studentId: string | null;
  sourcePath: string | null;
  storageUri: string;
  sha256: string | null;
  bytes: number;
  durationSec: number | null;
  channels: number | null;
  status: RecordingRecord['status'];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SerializedRecordingEvent {
  sourceId: string;
  type: RecordingEventType;
  recording: SerializedRecording;
  transcriptId?: string | null;
}

let bridgePromise: Promise<void> | null = null;
let bridgeInstance: RedisRecordingEventBridge | null = null;

export function enableRedisRecordingEventBridge(): Promise<void> {
  if (bridgePromise) return bridgePromise;
  bridgeInstance = new RedisRecordingEventBridge();
  bridgePromise = bridgeInstance.start();
  return bridgePromise;
}

export function resetRecordingEventBridgeForTests(): void {
  bridgePromise = null;
  bridgeInstance?.destroy();
  bridgeInstance = null;
}

class RedisRecordingEventBridge {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private unsubscribeLocal: (() => void) | null = null;
  private unsubscribeSubscriptionTracker: (() => void) | null = null;
  private suppressForwarding = false;
  private subscribedRecordingIds = new Set<string>();
  private wildcardSubscribed = false;

  async start(): Promise<void> {
    const baseClient = createRedisClient();
    this.publisher = baseClient.duplicate();
    this.subscriber = baseClient.duplicate();

    this.subscriber.on('message', (_channel, payload) => {
      this.handleRemoteEvent(payload);
    });

    this.unsubscribeLocal = subscribeRecordingEvents(
      (event: RecordingEvent) => {
        if (this.suppressForwarding) return;
        this.publishToRedis(event);
      },
      { allRecordings: true, trackRemote: false },
    );

    const snapshot = getRecordingSubscriptionSnapshot();
    await this.syncSubscriptions(snapshot);

    this.unsubscribeSubscriptionTracker = onRecordingSubscriptionChange((change) => {
      this.handleSubscriptionChange(change).catch((error) => {
        logger.error(error as Error, {
          component: 'recording-event-bridge',
          message: 'Failed to handle subscription change',
        });
      });
    });

    logger.info('Redis recording event bridge enabled', {
      component: 'recording-event-bridge',
      channel: `${CHANNEL_BASE}[targeted]`,
    });
  }

  private publishToRedis(event: RecordingEvent): void {
    if (!this.publisher) {
      logger.warn('Redis publisher unavailable; skipping recording event broadcast', {
        component: 'recording-event-bridge',
      });
      return;
    }

    const payload: SerializedRecordingEvent = {
      sourceId: INSTANCE_ID,
      type: event.type,
      recording: serializeRecording(event.recording),
      transcriptId: event.transcriptId ?? null,
    };

    const message = JSON.stringify(payload);

    const channels = [`${RECORDING_CHANNEL_PREFIX}${event.recording.id}`, CHANNEL_BASE];

    void Promise.all(
      channels.map((channel) =>
        this.publisher!.publish(channel, message).catch((error) => {
          logger.error(error as Error, {
            component: 'recording-event-bridge',
            message: 'Failed to publish recording event',
            channel,
          });
        }),
      ),
    );
  }

  private handleRemoteEvent(rawPayload: string): void {
    let parsed: SerializedRecordingEvent | null = null;

    try {
      parsed = JSON.parse(rawPayload) as SerializedRecordingEvent;
    } catch (error) {
      logger.error(error as Error, {
        component: 'recording-event-bridge',
        message: 'Failed to parse recording event payload',
      });
      return;
    }

    if (!parsed || parsed.sourceId === INSTANCE_ID) return;

    const recording = deserializeRecording(parsed.recording);
    this.suppressForwarding = true;
    try {
      publishRecordingEvent({
        type: parsed.type,
        recording,
        transcriptId: parsed.transcriptId ?? null,
      });
    } finally {
      this.suppressForwarding = false;
    }
  }

  private async syncSubscriptions(snapshot: {
    all: number;
    recordings: Map<string, number>;
  }): Promise<void> {
    if (!this.subscriber) return;

    if (snapshot.all > 0) {
      if (!this.wildcardSubscribed) {
        await this.subscriber.subscribe(CHANNEL_BASE);
        this.wildcardSubscribed = true;
      }
      if (this.subscribedRecordingIds.size > 0) {
        await this.subscriber.unsubscribe(
          ...[...this.subscribedRecordingIds].map(
            (recordingId) => `${RECORDING_CHANNEL_PREFIX}${recordingId}`,
          ),
        );
        this.subscribedRecordingIds.clear();
      }
      return;
    }

    if (this.wildcardSubscribed) {
      await this.subscriber.unsubscribe(CHANNEL_BASE);
      this.wildcardSubscribed = false;
    }

    const desired = new Set(snapshot.recordings.keys());
    const toSubscribe = [...desired].filter((id) => !this.subscribedRecordingIds.has(id));
    const toUnsubscribe = [...this.subscribedRecordingIds].filter((id) => !desired.has(id));

    if (toSubscribe.length > 0) {
      await this.subscriber.subscribe(
        ...toSubscribe.map((id) => `${RECORDING_CHANNEL_PREFIX}${id}`),
      );
      for (const id of toSubscribe) this.subscribedRecordingIds.add(id);
    }

    if (toUnsubscribe.length > 0) {
      await this.subscriber.unsubscribe(
        ...toUnsubscribe.map((id) => `${RECORDING_CHANNEL_PREFIX}${id}`),
      );
      for (const id of toUnsubscribe) this.subscribedRecordingIds.delete(id);
    }
  }

  private async handleSubscriptionChange(_change: {
    scope: 'all' | 'recording';
    recordingId?: string;
    count: number;
  }): Promise<void> {
    if (!this.subscriber) return;
    const snapshot = getRecordingSubscriptionSnapshot();
    await this.syncSubscriptions(snapshot);
  }

  destroy(): void {
    this.unsubscribeLocal?.();
    this.unsubscribeSubscriptionTracker?.();
    this.subscribedRecordingIds.clear();
    this.wildcardSubscribed = false;
    this.publisher = null;
    this.subscriber = null;
  }
}

function serializeRecording(recording: RecordingRecord): SerializedRecording {
  return {
    id: recording.id,
    source: recording.source,
    studentId: recording.studentId ?? null,
    sourcePath: recording.sourcePath ?? null,
    storageUri: recording.storageUri,
    sha256: recording.sha256 ?? null,
    bytes: recording.bytes,
    durationSec: recording.durationSec ?? null,
    channels: recording.channels ?? null,
    status: recording.status,
    error: recording.error ?? null,
    createdAt: recording.createdAt.toISOString(),
    updatedAt: recording.updatedAt.toISOString(),
  };
}

function deserializeRecording(serialized: SerializedRecording): RecordingRecord {
  return {
    id: serialized.id,
    source: serialized.source,
    studentId: serialized.studentId ?? null,
    sourcePath: serialized.sourcePath ?? null,
    storageUri: serialized.storageUri,
    sha256: serialized.sha256 ?? null,
    bytes: serialized.bytes,
    durationSec: serialized.durationSec ?? null,
    channels: serialized.channels ?? null,
    status: serialized.status,
    error: serialized.error ?? null,
    createdAt: new Date(serialized.createdAt),
    updatedAt: new Date(serialized.updatedAt),
  };
}
