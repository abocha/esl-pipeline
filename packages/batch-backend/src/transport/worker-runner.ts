// packages/batch-backend/src/transport/worker-runner.ts
// Worker entrypoint wiring BullMQ to our processQueueJob application service.
// Usage (after build):
//   node dist/transport/worker-runner.js
//
// The worker:
// - Listens to the configured BullMQ queue.
// - For each message { jobId }, calls processQueueJob.
// - Logs lifecycle events and shuts down gracefully on SIGINT/SIGTERM.
import { fileURLToPath } from 'node:url';

import { processQueueJob } from '../application/process-queue-job.js';
import { enableRedisJobEventBridge } from '../infrastructure/job-event-redis-bridge.js';
import { logger } from '../infrastructure/logger.js';
import { createJobWorker } from '../infrastructure/queue-bullmq.js';

// startWorker.declaration()
export async function startWorker(): Promise<void> {
  await enableRedisJobEventBridge();
  const worker = createJobWorker(async (bullJob) => {
    const { jobId } = bullJob.data;
    await processQueueJob({ jobId });
  });

  worker.on('error', (err: Error) => {
    logger.error(err, {
      component: 'worker',
      message: 'Unhandled BullMQ worker error',
    });
  });

  const shutdown = async (signal: string) => {
    logger.info(`Shutting down worker (${signal})`, { component: 'worker' });
    try {
      await worker.close();
      logger.info('Worker closed cleanly', { component: 'worker' });
      process.exit(0);
    } catch (error) {
      logger.error(error as Error, {
        component: 'worker',
        message: 'Error during worker shutdown',
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('Worker started', { component: 'worker' });
}

// Allow running directly: node dist/transport/worker-runner.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void startWorker().catch((error) => {
    logger.error(error as Error, {
      component: 'worker',
      message: 'Failed to start worker',
    });
    process.exit(1);
  });
}
