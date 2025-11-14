// packages/batch-backend/src/infrastructure/job-event-redis-bridge.ts
//
// Bridges in-process job events to Redis Pub/Sub so the API and worker (distinct Node processes)
// observe the same lifecycle updates.

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  publishJobEvent,
  subscribeJobEvents,
  type JobEvent,
  type JobEventType,
} from '../domain/job-events';
import type { JobRecord } from '../domain/job-model';
import { createRedisClient } from './redis';
import { logger } from './logger';

const CHANNEL_NAME = 'batch_job_events';
const INSTANCE_ID = randomUUID();

type SerializedJobRecord = {
  id: string;
  state: JobRecord['state'];
  md: string;
  preset: string | null;
  withTts: boolean | null;
  upload: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  manifestPath: string | null;
};

interface SerializedJobEvent {
  sourceId: string;
  type: JobEventType;
  job: SerializedJobRecord;
}

let bridgePromise: Promise<void> | null = null;

export function enableRedisJobEventBridge(): Promise<void> {
  if (bridgePromise) return bridgePromise;
  const bridge = new RedisJobEventBridge();
  bridgePromise = bridge.start();
  return bridgePromise;
}

class RedisJobEventBridge {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private unsubscribeLocal: (() => void) | null = null;
  private suppressForwarding = false;

  async start(): Promise<void> {
    const baseClient = createRedisClient();
    this.publisher = baseClient.duplicate();
    this.subscriber = baseClient.duplicate();

    await this.subscriber.subscribe(CHANNEL_NAME);
    this.subscriber.on('message', (_channel, payload) => {
      this.handleRemoteEvent(payload);
    });

    this.unsubscribeLocal = subscribeJobEvents(event => {
      if (this.suppressForwarding) return;
      this.publishToRedis(event);
    });

    logger.info('Redis job event bridge enabled', {
      component: 'job-event-bridge',
      channel: CHANNEL_NAME,
    });
  }

  private publishToRedis(event: JobEvent): void {
    if (!this.publisher) {
      logger.warn('Redis publisher unavailable; skipping job event broadcast', {
        component: 'job-event-bridge',
      });
      return;
    }

    const payload: SerializedJobEvent = {
      sourceId: INSTANCE_ID,
      type: event.type,
      job: serializeJobRecord(event.job),
    };

    void this.publisher.publish(CHANNEL_NAME, JSON.stringify(payload)).catch(err => {
      logger.error(err as Error, {
        component: 'job-event-bridge',
        message: 'Failed to publish job event',
      });
    });
  }

  private handleRemoteEvent(rawPayload: string): void {
    let parsed: SerializedJobEvent | null = null;

    try {
      parsed = JSON.parse(rawPayload) as SerializedJobEvent;
    } catch (err) {
      logger.error(err as Error, {
        component: 'job-event-bridge',
        message: 'Failed to parse job event payload',
      });
      return;
    }

    if (!parsed || parsed.sourceId === INSTANCE_ID) return;

    const job = deserializeJobRecord(parsed.job);

    this.suppressForwarding = true;
    try {
      publishJobEvent({ type: parsed.type, job });
    } finally {
      this.suppressForwarding = false;
    }
  }
}

function serializeJobRecord(job: JobRecord): SerializedJobRecord {
  return {
    id: job.id,
    state: job.state,
    md: job.md,
    preset: job.preset ?? null,
    withTts: job.withTts ?? null,
    upload: job.upload ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    error: job.error ?? null,
    manifestPath: job.manifestPath ?? null,
  };
}

function deserializeJobRecord(serialized: SerializedJobRecord): JobRecord {
  return {
    id: serialized.id,
    state: serialized.state,
    md: serialized.md,
    preset: serialized.preset ?? null,
    withTts: serialized.withTts ?? null,
    upload: serialized.upload ?? null,
    createdAt: new Date(serialized.createdAt),
    updatedAt: new Date(serialized.updatedAt),
    startedAt: serialized.startedAt ? new Date(serialized.startedAt) : null,
    finishedAt: serialized.finishedAt ? new Date(serialized.finishedAt) : null,
    error: serialized.error ?? null,
    manifestPath: serialized.manifestPath ?? null,
  };
}
