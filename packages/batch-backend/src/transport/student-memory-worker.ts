import { fileURLToPath } from 'node:url';

import { processStudentMemoryJob } from '../application/process-student-memory-job.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { loadConfig } from '../config/env.js';
import { runMigrationsIfConfigured } from '../infrastructure/migrations.js';
import { createStudentMemoryWorker } from '../infrastructure/student-memory-queue.js';

async function getLogger() {
  const { logger } = await import('../infrastructure/logger.js');
  return logger;
}

export async function startStudentMemoryWorker(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-student-memory-worker');
  const config = loadConfig();
  const logger = await getLogger();
  logger.info('Startup configuration resolved', {
    event: 'startup_configuration',
    service: 'student-memory-worker',
    pgEnabled: config.pg.enabled,
    autoMigrateOnBoot: config.pg.autoMigrateOnBoot,
    poolMax: config.pg.poolMax,
    idleTimeoutMs: config.pg.idleTimeoutMs,
    connectionTimeoutMs: config.pg.connectionTimeoutMs,
  });
  await runMigrationsIfConfigured();

  const worker = createStudentMemoryWorker(async (bullJob) => {
    await processStudentMemoryJob({
      config: config.generation,
      payload: bullJob.data,
      attemptsMade: bullJob.attemptsMade,
      maxAttempts: bullJob.opts.attempts,
    });
  });

  worker.on('error', (err: Error) => {
    logger.error(err, {
      component: 'student-memory-worker',
      message: 'Unhandled BullMQ student-memory worker error',
    });
  });

  const shutdown = async (signal: string) => {
    logger.info(`Shutting down student-memory worker (${signal})`, {
      component: 'student-memory-worker',
    });
    try {
      await worker.close();
      logger.info('Student-memory worker closed cleanly', {
        component: 'student-memory-worker',
      });
      process.exit(0);
    } catch (error) {
      logger.error(error as Error, {
        component: 'student-memory-worker',
        message: 'Error during student-memory worker shutdown',
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('Student-memory worker started', { component: 'student-memory-worker' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void startStudentMemoryWorker().catch((error) => {
    void (async () => {
      try {
        const logger = await getLogger();
        logger.error(error as Error, {
          component: 'student-memory-worker',
          message: 'Failed to start student-memory worker',
        });
      } catch {
        console.error(error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    })();
  });
}
