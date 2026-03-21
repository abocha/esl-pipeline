import { JobsOptions, Processor, Queue, QueueEvents, Worker } from 'bullmq';

import type { StudentMemoryQueuePayload } from '../application/process-student-memory-job.js';
import { loadConfig } from '../config/env.js';
import { createJobLogger, logger } from './logger.js';
import { createRedisClient } from './redis.js';

let queueSingleton: Queue<StudentMemoryQueuePayload> | null = null;
let queueEventsSingleton: QueueEvents | null = null;

export interface EnqueueStudentMemoryOptions {
  jobId?: string;
  attempts?: number;
}

function sanitizeStudentMemoryJobId(jobId: string): string {
  return jobId.replaceAll(':', '__');
}

export function createStudentMemoryQueue() {
  const config = loadConfig();
  const queueName = config.studentMemory.queueName;

  if (!queueSingleton || !queueEventsSingleton) {
    const connection = createRedisClient();
    queueSingleton = new Queue<StudentMemoryQueuePayload>(queueName, { connection });
    queueEventsSingleton = new QueueEvents(queueName, { connection });

    queueEventsSingleton.on('completed', (event: { jobId: string | number }) => {
      createJobLogger(String(event.jobId)).info('Student-memory queue job completed', {
        event: 'student_memory_queue_completed',
      });
    });

    queueEventsSingleton.on(
      'failed',
      (event: { jobId: string | number; failedReason: string; retryCount?: number }) => {
        createJobLogger(String(event.jobId)).error(
          `Student-memory queue job failed: ${event.failedReason}`,
          {
            event: 'student_memory_queue_failed',
            retryCount: event.retryCount,
          },
        );
      },
    );

    queueEventsSingleton.on('waiting', (event: { jobId: string | number }) => {
      createJobLogger(String(event.jobId)).info('Student-memory queue job waiting', {
        event: 'student_memory_queue_waiting',
      });
    });
  }

  return {
    queue: queueSingleton!,
    queueEvents: queueEventsSingleton!,
    async enqueue(payload: StudentMemoryQueuePayload, options: EnqueueStudentMemoryOptions = {}) {
      const opts: JobsOptions = {
        attempts: options.attempts ?? 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
        ...(options.jobId ? { jobId: sanitizeStudentMemoryJobId(options.jobId) } : {}),
      };
      await queueSingleton!.add(payload.kind, payload, opts);
    },
  };
}

export function createStudentMemoryWorker(
  processor: Processor<StudentMemoryQueuePayload>,
): Worker<StudentMemoryQueuePayload> {
  const config = loadConfig();
  const connection = createRedisClient();
  const queueName = config.studentMemory.queueName;

  const worker = new Worker<StudentMemoryQueuePayload>(queueName, processor, {
    connection,
    concurrency: config.studentMemory.maxConcurrency,
  });

  worker.on('active', (job: import('bullmq').Job<StudentMemoryQueuePayload>) => {
    createJobLogger(job.id?.toString() ?? 'unknown').info('Processing student-memory job', {
      event: 'student_memory_worker_active',
      kind: job.data.kind,
    });
  });

  worker.on('completed', (job: import('bullmq').Job<StudentMemoryQueuePayload>) => {
    createJobLogger(job.id?.toString() ?? 'unknown').info('Student-memory job processed', {
      event: 'student_memory_worker_completed',
      kind: job.data.kind,
    });
  });

  worker.on('failed', (job, err: Error) => {
    createJobLogger(job?.id?.toString() ?? 'unknown').error(err, {
      event: 'student_memory_worker_failed',
      kind: job?.data?.kind ?? 'unknown',
    });
  });

  worker.on('error', (err: Error) => {
    logger.error(err, {
      component: 'bullmq-student-memory-worker',
      message: 'Unhandled BullMQ student-memory worker error',
    });
  });

  return worker;
}
