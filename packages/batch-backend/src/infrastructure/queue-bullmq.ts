// packages/batch-backend/src/infrastructure/queue-bullmq.ts
// BullMQ-based queue adapter for batch jobs.
// - Uses shared Redis connection from ./redis.
// - Queue name from env via config/env.
// - Sane defaults: exponential backoff, limited history.
// - Purposefully small so it is easy to replace or extend.
import { JobsOptions, Processor, Queue, QueueEvents, Worker } from 'bullmq';

import { loadConfig } from '../config/env.js';
import { createJobLogger, logger } from './logger.js';
import { createRedisClient } from './redis.js';

export interface QueueJobPayload {
  jobId: string;
}

// Internal helper to avoid multiple QueueEvents/Queue per call.
// For now we construct lazily per process; acceptable for single service+worker.
let queueSingleton: Queue<QueueJobPayload> | null = null;
let queueEventsSingleton: QueueEvents | null = null;

// createJobQueue.declaration()
export function createJobQueue() {
  const config = loadConfig();

  if (!queueSingleton || !queueEventsSingleton) {
    const connection = createRedisClient();

    queueSingleton = new Queue<QueueJobPayload>(config.queue.name, {
      connection,
    });

    queueEventsSingleton = new QueueEvents(config.queue.name, { connection });

    queueEventsSingleton.on('completed', (event: { jobId: string | number }) => {
      createJobLogger(String(event.jobId)).info('Queue job completed', {
        event: 'queue_completed',
      });
    });

    queueEventsSingleton.on(
      'failed',
      (event: { jobId: string | number; failedReason: string; retryCount?: number }) => {
        createJobLogger(String(event.jobId)).error(`Queue job failed: ${event.failedReason}`, {
          event: 'queue_failed',
          retryCount: event.retryCount,
        });
      },
    );

    queueEventsSingleton.on('waiting', (event: { jobId: string | number }) => {
      createJobLogger(String(event.jobId)).info('Queue job waiting', {
        event: 'queue_waiting',
      });
    });
  }

  const queue = queueSingleton!;

  return {
    queue,
    queueEvents: queueEventsSingleton!,
    async enqueue(payload: QueueJobPayload) {
      const opts: JobsOptions = {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      };
      await queue.add('assignment', payload, opts);
    },
  };
}

// createJobWorker.declaration()
export function createJobWorker(processor: Processor<QueueJobPayload>): Worker<QueueJobPayload> {
  const config = loadConfig();
  const connection = createRedisClient();

  const worker = new Worker<QueueJobPayload>(config.queue.name, processor, {
    connection,
    concurrency: config.worker.concurrency,
  });

  worker.on('active', (job: import('bullmq').Job<QueueJobPayload>) => {
    createJobLogger(job.data.jobId, job.id?.toString()).info('Processing job', {
      event: 'worker_active',
    });
  });

  worker.on('completed', (job: import('bullmq').Job<QueueJobPayload>) => {
    createJobLogger(job.data.jobId, job.id?.toString()).info('Job completed', {
      event: 'worker_completed',
    });
  });

  worker.on('failed', (job, err: Error, _prev: string) => {
    const jobId = job?.data?.jobId ?? job?.id?.toString() ?? 'unknown';
    createJobLogger(jobId, job?.id?.toString()).error(err, {
      event: 'worker_failed',
    });
  });

  worker.on('error', (err: Error) => {
    logger.error(err, {
      component: 'bullmq-worker',
      message: 'Unhandled BullMQ worker error',
    });
  });

  return worker;
}
