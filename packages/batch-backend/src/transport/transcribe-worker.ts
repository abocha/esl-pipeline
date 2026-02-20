// packages/batch-backend/src/transport/transcribe-worker.ts
// Worker entrypoint wiring BullMQ to the transcription processor.
import { fileURLToPath } from 'node:url';

import { processTranscribeJob } from '../application/process-transcribe-job.js';
import { validateTranscriptionConfig } from '../application/validate-transcription-config.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { loadConfig } from '../config/env.js';
import { runMigrationsIfConfigured } from '../infrastructure/migrations.js';
import { enableRedisRecordingEventBridge } from '../infrastructure/recording-event-redis-bridge.js';
import { createTranscribeWorker } from '../infrastructure/transcribe-queue.js';

async function getLogger() {
  const { logger } = await import('../infrastructure/logger.js');
  return logger;
}

export async function startTranscribeWorker(): Promise<void> {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-transcribe-worker');
  const config = loadConfig();
  const logger = await getLogger();
  logger.info('Startup configuration resolved', {
    event: 'startup_configuration',
    service: 'transcribe-worker',
    pgEnabled: config.pg.enabled,
    autoMigrateOnBoot: config.pg.autoMigrateOnBoot,
    poolMax: config.pg.poolMax,
    idleTimeoutMs: config.pg.idleTimeoutMs,
    connectionTimeoutMs: config.pg.connectionTimeoutMs,
  });
  await runMigrationsIfConfigured();
  await validateTranscriptionConfig();
  await enableRedisRecordingEventBridge();
  const worker = createTranscribeWorker(async (bullJob) => {
    const { recordingId } = bullJob.data;
    await processTranscribeJob({ recordingId });
  });

  worker.on('error', (err: Error) => {
    logger.error(err, {
      component: 'transcribe-worker',
      message: 'Unhandled BullMQ transcribe worker error',
    });
  });

  const shutdown = async (signal: string) => {
    logger.info(`Shutting down transcribe worker (${signal})`, {
      component: 'transcribe-worker',
    });
    try {
      await worker.close();
      logger.info('Transcribe worker closed cleanly', { component: 'transcribe-worker' });
      process.exit(0);
    } catch (error) {
      logger.error(error as Error, {
        component: 'transcribe-worker',
        message: 'Error during transcribe worker shutdown',
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('Transcribe worker started', { component: 'transcribe-worker' });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void startTranscribeWorker().catch((error) => {
    void (async () => {
      try {
        const logger = await getLogger();
        logger.error(error as Error, {
          component: 'transcribe-worker',
          message: 'Failed to start transcribe worker',
        });
      } catch {
        console.error(error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    })();
  });
}
