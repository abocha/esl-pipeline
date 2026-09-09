import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createTranscribeQueue,
  createTranscribeWorker,
} from '../src/infrastructure/transcribe-queue.js';
import { requireRedisTestEnv, resolveTestTimeout } from './support/test-env.js';

requireRedisTestEnv();
const timeout = resolveTestTimeout(30_000);

describe('transcribe queue (requires Redis)', () => {
  const queueName = `transcribe-execution-${randomUUID()}`;
  let service: ReturnType<typeof createTranscribeQueue>;
  let worker: ReturnType<typeof createTranscribeWorker> | null = null;

  beforeAll(async () => {
    process.env.TRANSCRIBE_QUEUE_NAME = queueName;
    service = createTranscribeQueue();
    await service.queue.waitUntilReady();
    await service.queueEvents.waitUntilReady();
  }, timeout);

  afterAll(async () => {
    await worker?.close();
    await service.queue.obliterate({ force: true }).catch(() => undefined);
    await service.queueEvents.close();
    await service.queue.close();
  }, timeout);

  it(
    'deduplicates a deterministic run jobId and applies bounded exponential redelivery',
    async () => {
      const runId = randomUUID();
      const recordingId = randomUUID();
      let deliveries = 0;

      await service.enqueue({ runId, recordingId });
      await service.enqueue({ runId, recordingId });
      const job = await service.queue.getJob(runId);
      expect(job).not.toBeNull();
      expect(
        await service.queue.getJobCounts('waiting', 'delayed', 'active', 'completed'),
      ).toMatchObject({
        waiting: 1,
      });
      expect(job?.opts).toMatchObject({
        jobId: runId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      });

      worker = createTranscribeWorker(async () => {
        deliveries += 1;
        if (deliveries === 1) throw new Error('controlled retryable delivery failure');
        return null;
      });
      await job!.waitUntilFinished(service.queueEvents);
      expect(deliveries).toBe(2);
    },
    timeout,
  );
});
