// packages/batch-backend/src/infrastructure/job-event-redis-bridge.ts
//
// Bridges in-process job events to Redis Pub/Sub so the API and worker (distinct Node processes)
// observe the same lifecycle updates.

import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  publishJobEvent,
  subscribeJobEvents,
  onJobSubscriptionChange,
  getJobSubscriptionSnapshot,
  type JobEvent,
  type JobEventType,
} from '../domain/job-events';
import type { JobRecord, JobUploadOption } from '../domain/job-model';
import { createRedisClient } from './redis';
import { logger } from './logger';

const CHANNEL_BASE = 'batch_job_events';
const JOB_CHANNEL_PREFIX = `${CHANNEL_BASE}:`;
const INSTANCE_ID = randomUUID();

type SerializedJobRecord = {
  id: string;
  state: JobRecord['state'];
  md: string;
  preset: string | null;
  withTts: boolean | null;
  upload: JobUploadOption | null;
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
let bridgeInstance: RedisJobEventBridge | null = null;

export function enableRedisJobEventBridge(): Promise<void> {
  if (bridgePromise) return bridgePromise;
  bridgeInstance = new RedisJobEventBridge();
  bridgePromise = bridgeInstance.start();
  return bridgePromise;
}

export function resetJobEventBridgeForTests(): void {
  bridgePromise = null;
  bridgeInstance?.destroy();
  bridgeInstance = null;
}

export function getJobEventBridgeMetrics(): {
  publishedEvents: number;
  publishErrors: number;
  receivedEvents: number;
  lastError: string | null;
} {
  return bridgeInstance?.getMetrics() ?? {
    publishedEvents: 0,
    publishErrors: 0,
    receivedEvents: 0,
    lastError: null,
  };
}

class RedisJobEventBridge {
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private unsubscribeLocal: (() => void) | null = null;
  private unsubscribeSubscriptionTracker: (() => void) | null = null;
  private suppressForwarding = false;
  private subscribedJobIds = new Set<string>();
  private wildcardSubscribed = false;
  private metrics = {
    publishedEvents: 0,
    publishErrors: 0,
    receivedEvents: 0,
    lastError: null as string | null,
  };

  async start(): Promise<void> {
    const baseClient = createRedisClient();
    this.publisher = baseClient.duplicate();
    this.subscriber = baseClient.duplicate();

    this.subscriber.on('message', (_channel, payload) => {
      this.handleRemoteEvent(payload);
    });

    // Listen to local events and forward them to Redis, but do not register as a remote consumer.
    this.unsubscribeLocal = subscribeJobEvents(
      event => {
        if (this.suppressForwarding) return;
        this.publishToRedis(event);
      },
      { allJobs: true, trackRemote: false }
    );

    // Honor existing subscriptions (if any) and then react to new ones.
    const snapshot = getJobSubscriptionSnapshot();
    await this.syncSubscriptions(snapshot);

    this.unsubscribeSubscriptionTracker = onJobSubscriptionChange(_change => {
      this.handleSubscriptionChange(_change).catch(err => {
        logger.error(err as Error, {
          component: 'job-event-bridge',
          message: 'Failed to handle subscription change',
        });
      });
    });

    logger.info('Redis job event bridge enabled', {
      component: 'job-event-bridge',
      channel: `${CHANNEL_BASE}[targeted]`,
    });
  }

  private publishToRedis(event: JobEvent): void {
    if (!this.publisher) {
      logger.warn('Redis publisher unavailable; skipping job event broadcast', {
        component: 'job-event-bridge',
      });
      return;
    }

    this.metrics.publishedEvents += 1;

    const payload: SerializedJobEvent = {
      sourceId: INSTANCE_ID,
      type: event.type,
      job: serializeJobRecord(event.job),
    };

    const message = JSON.stringify(payload);

    const channels = [
      `${JOB_CHANNEL_PREFIX}${event.job.id}`, // targeted channel
      CHANNEL_BASE, // legacy/fallback broadcast
    ];

    void Promise.all(
      channels.map(channel =>
        this.publisher!.publish(channel, message).catch(err => {
          this.metrics.publishErrors += 1;
          this.metrics.lastError = err instanceof Error ? err.message : String(err);
          logger.error(err as Error, {
            component: 'job-event-bridge',
            message: 'Failed to publish job event',
            channel,
          });
        })
      )
    );
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
    this.metrics.receivedEvents += 1;

    this.suppressForwarding = true;
    try {
      publishJobEvent({ type: parsed.type, job });
    } finally {
      this.suppressForwarding = false;
    }
  }

  private async syncSubscriptions(snapshot: { all: number; jobs: Map<string, number> }): Promise<
    void
  > {
    if (!this.subscriber) return;

    // Wildcard subscribers (all jobs)
    if (snapshot.all > 0) {
      // When wildcard subscribers exist, only subscribe to the broadcast channel once.
      if (!this.wildcardSubscribed) {
        await this.subscriber.subscribe(CHANNEL_BASE);
        this.wildcardSubscribed = true;
      }
      // Drop any targeted subscriptions to avoid duplicate deliveries.
      if (this.subscribedJobIds.size > 0) {
        await this.subscriber.unsubscribe(
          ...Array.from(this.subscribedJobIds).map(jobId => `${JOB_CHANNEL_PREFIX}${jobId}`)
        );
        this.subscribedJobIds.clear();
      }
      return;
    }

    // No wildcard subscribers: ensure broadcast is unsubscribed and manage targeted channels.
    if (this.wildcardSubscribed) {
      await this.subscriber.unsubscribe(CHANNEL_BASE);
      this.wildcardSubscribed = false;
    }

    const desired = new Set(snapshot.jobs.keys());
    const toSubscribe = Array.from(desired).filter(jobId => !this.subscribedJobIds.has(jobId));
    const toUnsubscribe = Array.from(this.subscribedJobIds).filter(jobId => !desired.has(jobId));

    if (toSubscribe.length > 0) {
      await this.subscriber.subscribe(...toSubscribe.map(jobId => `${JOB_CHANNEL_PREFIX}${jobId}`));
      toSubscribe.forEach(jobId => this.subscribedJobIds.add(jobId));
    }

    if (toUnsubscribe.length > 0) {
      await this.subscriber.unsubscribe(
        ...toUnsubscribe.map(jobId => `${JOB_CHANNEL_PREFIX}${jobId}`)
      );
      toUnsubscribe.forEach(jobId => this.subscribedJobIds.delete(jobId));
    }
  }

  private async handleSubscriptionChange(_change: {
    scope: 'all' | 'job';
    jobId?: string;
    count: number;
  }): Promise<void> {
    if (!this.subscriber) return;
    // Re-compute subscriptions from snapshot to keep wildcard/targeted states coherent.
    const snapshot = getJobSubscriptionSnapshot();
    await this.syncSubscriptions(snapshot);
  }

  destroy(): void {
    this.unsubscribeLocal?.();
    this.unsubscribeSubscriptionTracker?.();
    this.subscribedJobIds.clear();
    this.wildcardSubscribed = false;
    this.publisher = null;
    this.subscriber = null;
  }

  getMetrics(): {
    publishedEvents: number;
    publishErrors: number;
    receivedEvents: number;
    lastError: string | null;
  } {
    return { ...this.metrics };
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
