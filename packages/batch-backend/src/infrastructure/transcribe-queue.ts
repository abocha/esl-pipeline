import { JobsOptions, Queue, QueueEvents } from 'bullmq';

import { loadConfig } from '../config/env.js';
import { createJobLogger, logger } from './logger.js';
import { createRedisClient } from './redis.js';

export interface TranscribeQueuePayload {
  recordingId: string;
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
