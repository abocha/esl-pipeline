import { JobsOptions, Processor, Queue, QueueEvents, Worker } from 'bullmq';
import type { SttProviderId } from '@esl-pipeline/contracts';

import { loadConfig } from '../config/env.js';
import { createJobLogger, logger } from './logger.js';
import { createRedisClient } from './redis.js';

export interface TranscribeQueuePayload {
  recordingId: string;
  sttProvider?: SttProviderId;
}

let queueSingleton: Queue<TranscribeQueuePayload> | null = null;
let queueEventsSingleton: QueueEvents | null = null;

export function createTranscribeQueue() {
  const config = loadConfig();
  const queueName = config.transcription.queueName;

  if (!queueSingleton || !queueEventsSingleton) {
    const connection = createRedisClient();
    queueSingleton = new Queue<TranscribeQueuePayload>(queueName, { connection });
    queueEventsSingleton = new QueueEvents(queueName, { connection });

    queueEventsSingleton.on('completed', (event: { jobId: string | number }) => {
      createJobLogger(String(event.jobId)).info('Transcribe queue job completed', {
        event: 'transcribe_queue_completed',
      });
    });

    queueEventsSingleton.on(
      'failed',
      (event: { jobId: string | number; failedReason: string; retryCount?: number }) => {
        createJobLogger(String(event.jobId)).error(
          `Transcribe queue job failed: ${event.failedReason}`,
          {
            event: 'transcribe_queue_failed',
            retryCount: event.retryCount,
          },
        );
      },
    );

    queueEventsSingleton.on('waiting', (event: { jobId: string | number }) => {
      createJobLogger(String(event.jobId)).info('Transcribe queue job waiting', {
        event: 'transcribe_queue_waiting',
      });
    });
  }

  return {
    queue: queueSingleton!,
    queueEvents: queueEventsSingleton!,
    async enqueue(payload: TranscribeQueuePayload) {
      const opts: JobsOptions = {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      };
      await queueSingleton!.add('transcribe', payload, opts);
    },
  };
}

export function createTranscribeWorker(
  processor: Processor<TranscribeQueuePayload>,
): Worker<TranscribeQueuePayload> {
  const config = loadConfig();
  const connection = createRedisClient();
  const queueName = config.transcription.queueName;

  const worker = new Worker<TranscribeQueuePayload>(queueName, processor, {
    connection,
    concurrency: config.transcription.maxConcurrency,
  });

  worker.on('active', (job: import('bullmq').Job<TranscribeQueuePayload>) => {
    createJobLogger(job.data.recordingId, job.id?.toString()).info('Processing recording', {
      event: 'transcribe_worker_active',
    });
  });

  worker.on('completed', (job: import('bullmq').Job<TranscribeQueuePayload>) => {
    createJobLogger(job.data.recordingId, job.id?.toString()).info('Recording transcribed', {
      event: 'transcribe_worker_completed',
    });
  });

  worker.on('failed', (job, err: Error) => {
    const recordingId = job?.data?.recordingId ?? job?.id?.toString() ?? 'unknown';
    createJobLogger(recordingId, job?.id?.toString()).error(err, {
      event: 'transcribe_worker_failed',
    });
  });

  worker.on('error', (err: Error) => {
    logger.error(err, {
      component: 'bullmq-transcribe-worker',
      message: 'Unhandled BullMQ transcribe worker error',
    });
  });

  return worker;
}
