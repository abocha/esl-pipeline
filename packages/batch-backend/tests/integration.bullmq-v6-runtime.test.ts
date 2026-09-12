import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createJobQueue, createJobWorker } from '../src/infrastructure/queue-bullmq.js';
import { closeRedisClient, createRedisClient } from '../src/infrastructure/redis.js';
import { requireRedisTestEnv, resolveTestTimeout } from './support/test-env.js';

requireRedisTestEnv();
const timeout = resolveTestTimeout(30_000);

async function waitFor(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

describe('BullMQ v6 queue runtime contracts (requires Redis)', () => {
  const queueName = `bullmq-v6-runtime-${randomUUID()}`;
  let service: ReturnType<typeof createJobQueue>;
  let worker: ReturnType<typeof createJobWorker> | null = null;

  beforeAll(async () => {
    process.env.BATCH_JOBS_QUEUE_NAME = queueName;
    service = createJobQueue();
    await service.queue.waitUntilReady();
    await service.queueEvents.waitUntilReady();
  }, timeout);

  afterEach(async () => {
    await worker?.close();
    worker = null;
  });

  afterAll(async () => {
    await service.queue.obliterate({ force: true }).catch(() => undefined);
    await service.queueEvents.close();
    await service.queue.close();
    await closeRedisClient();
  }, timeout);

  it(
    'removes waiting jobs but reports an active-job lock conflict',
    async () => {
      const waitingJobId = randomUUID();
      await service.enqueue({ jobId: waitingJobId });

      await expect(service.cancelQueuedJob(waitingJobId)).resolves.toBe('removed');
      await expect(service.queue.getJob(waitingJobId)).resolves.toBeUndefined();

      const activeJobId = randomUUID();
      let signalActive!: () => void;
      let releaseActive!: () => void;
      const active = new Promise<void>((resolve) => {
        signalActive = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseActive = resolve;
      });
      worker = createJobWorker(async () => {
        signalActive();
        await release;
      });

      await service.enqueue({ jobId: activeJobId });
      const job = await service.queue.getJob(activeJobId);
      expect(job).not.toBeNull();
      const finished = job!.waitUntilFinished(service.queueEvents, timeout);
      await active;

      await expect(service.cancelQueuedJob(activeJobId)).resolves.toBe('active');
      releaseActive();
      await expect(finished).resolves.toBeNull();
      await expect(job!.getState()).resolves.toBe('completed');
    },
    timeout,
  );

  it(
    'retries a retained failed job with the same identity and reset counters',
    async () => {
      const jobId = randomUUID();
      const failedEvents: string[] = [];
      service.queueEvents.on('failed', ({ jobId: failedJobId }) => {
        failedEvents.push(String(failedJobId));
      });
      worker = createJobWorker(async () => {
        throw new Error('controlled terminal failure');
      });
      const job = await service.queue.add('assignment', { jobId }, { jobId, attempts: 1 });

      await expect(job.waitUntilFinished(service.queueEvents, timeout)).rejects.toThrow(
        'controlled terminal failure',
      );
      await worker.close();
      worker = null;
      expect(await job.getState()).toBe('failed');
      expect((await service.queue.getJob(jobId))?.attemptsMade).toBe(1);

      worker = createJobWorker(async () => 'reconciled');
      await service.reconcile({ jobId });
      await waitFor(
        async () => (await (await service.queue.getJob(jobId))?.getState()) === 'completed',
        'the reconciled job did not complete',
      );
      const completed = await service.queue.getJob(jobId);
      expect(completed?.id).toBe(jobId);
      expect(await completed?.getState()).toBe('completed');
      expect(completed?.attemptsMade).toBe(1);
      expect(completed?.returnvalue).toBe('reconciled');
      expect(failedEvents).toContain(jobId);
    },
    timeout,
  );

  it(
    'continues processing after worker restart and the shared Redis client reconnects',
    async () => {
      const processed: string[] = [];
      worker = createJobWorker(async (job) => {
        processed.push(job.id!);
      });
      const firstJobId = randomUUID();
      await service.enqueue({ jobId: firstJobId });
      const first = await service.queue.getJob(firstJobId);
      await first!.waitUntilFinished(service.queueEvents, timeout);
      await worker.close();
      worker = null;

      const connection = createRedisClient();
      const reconnected = new Promise<void>((resolve) => {
        connection.once('ready', resolve);
      });
      connection.disconnect(true);
      await reconnected;

      worker = createJobWorker(async (job) => {
        processed.push(job.id!);
      });
      const secondJobId = randomUUID();
      await service.enqueue({ jobId: secondJobId });
      const second = await service.queue.getJob(secondJobId);
      await second!.waitUntilFinished(service.queueEvents, timeout);

      expect(processed).toEqual([firstJobId, secondJobId]);
    },
    timeout,
  );
});
