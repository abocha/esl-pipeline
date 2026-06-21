import { randomUUID } from 'node:crypto';
import { DelayedError, Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';

import { requireRedisTestEnv, resolveTestTimeout } from './support/test-env.js';

const redis = requireRedisTestEnv();
const integrationTimeout = resolveTestTimeout(15_000);

describe('student-memory pacing delayed-job contract (requires Redis)', () => {
  const resources: {
    connection: Redis;
    queue: Queue;
    queueEvents: QueueEvents;
    worker: Worker;
  }[] = [];

  afterEach(async () => {
    await Promise.all(
      resources.splice(0).map(async ({ connection, queue, queueEvents, worker }) => {
        await worker.close();
        await queueEvents.close();
        await queue.obliterate({ force: true });
        await queue.close();
        await connection.quit();
      }),
    );
  });

  it(
    're-runs a manually delayed job without consuming an attempt',
    async () => {
      const queueName = `student-memory-pacing-delay-${randomUUID()}`;
      const connection = new Redis(redis.url, { maxRetriesPerRequest: null });
      const queue = new Queue(queueName, { connection });
      const queueEvents = new QueueEvents(queueName, { connection });
      const attemptsMade: number[] = [];
      let activations = 0;
      let failed = false;
      const worker = new Worker(
        queueName,
        async (job) => {
          activations += 1;
          attemptsMade.push(job.attemptsMade);
          if (activations === 1) {
            await job.moveToDelayed(Date.now() + 100, job.token);
            throw new DelayedError();
          }
          return 'completed-after-delay';
        },
        { connection },
      );
      queueEvents.on('failed', () => {
        failed = true;
      });
      resources.push({ connection, queue, queueEvents, worker });

      await queueEvents.waitUntilReady();
      const job = await queue.add('lesson-memory-generate', { id: 'fixture' }, { attempts: 5 });
      await job.waitUntilFinished(queueEvents, integrationTimeout);
      const completed = await queue.getJob(job.id!);

      expect(activations).toBe(2);
      expect(attemptsMade).toEqual([0, 0]);
      // BullMQ increments attemptsMade when the successful second activation completes. The
      // important invariant is that the second activation still begins at zero and no failure
      // event was emitted for the deliberate delay.
      expect(completed?.attemptsMade).toBe(1);
      expect(failed).toBe(false);
    },
    integrationTimeout,
  );
});
