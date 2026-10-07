import { fileURLToPath } from 'node:url';
import { DelayedError, type Job } from 'bullmq';

import type { StudentMemoryQueuePayload } from '../application/process-student-memory-job.js';
import { processStudentMemoryJob } from '../application/process-student-memory-job.js';
import { enqueuePendingProfileInitialEnrichments } from '../application/profile-initial-enrichment.js';
import { reconcileMemoryDelivery } from '../application/reconcile-memory-delivery.js';
import { isStudentMemoryPacingDeferredError } from '../application/student-memory-generation-pacing.js';
import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { type BatchBackendConfig, loadConfig } from '../config/env.js';
import { reconcileDeferredInitialEnrichmentIntents } from '../domain/assignment-session-repository.js';
import { runMigrationsIfConfigured } from '../infrastructure/migrations.js';
import { createStudentMemoryWorker } from '../infrastructure/student-memory-queue.js';
import { reportWorkerReady } from '../infrastructure/worker-readiness.js';

async function getLogger() {
  const { logger } = await import('../infrastructure/logger.js');
  return logger;
}

type StudentMemoryBullJob = Pick<
  Job<StudentMemoryQueuePayload>,
  'data' | 'attemptsMade' | 'opts' | 'token' | 'id' | 'moveToDelayed'
>;

export async function processStudentMemoryBullJob(args: {
  bullJob: StudentMemoryBullJob;
  config: BatchBackendConfig;
  now?: () => Date;
}): Promise<void> {
  try {
    await processStudentMemoryJob({
      config: args.config,
      payload: args.bullJob.data,
      attemptsMade: args.bullJob.attemptsMade,
      maxAttempts: args.bullJob.opts.attempts,
    });
  } catch (error) {
    if (!isStudentMemoryPacingDeferredError(error)) {
      throw error;
    }

    await args.bullJob.moveToDelayed(error.notBefore.getTime(), args.bullJob.token);
    const deferredAt = args.now?.() ?? new Date();
    const logger = await getLogger();
    logger.info('Student-memory job deferred for pacing', {
      event: 'student_memory_pacing_deferred',
      jobId: args.bullJob.id?.toString() ?? 'unknown',
      kind: args.bullJob.data.kind,
      provider: error.provider,
      model: error.model,
      reason: error.reason,
      notBefore: error.notBefore.toISOString(),
      deferDurationMs: Math.max(0, error.notBefore.getTime() - deferredAt.getTime()),
      estimatedTokens: error.estimatedTokens,
      ...(typeof error.retryAfterMs === 'number' ? { retryAfterMs: error.retryAfterMs } : {}),
    });
    throw new DelayedError();
  }
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

  // The operation table is recoverable intent. This bounded dispatcher runs in
  // the existing student-memory service and repairs lost delivery after restart.
  let reconciling = false;
  const reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      await reconcileMemoryDelivery({ config });
      await enqueuePendingProfileInitialEnrichments();
      await reconcileDeferredInitialEnrichmentIntents();
    } finally {
      reconciling = false;
    }
  };
  const reconciliationTimer = setInterval(() => {
    void reconcile().catch((error) =>
      logger.error(error as Error, {
        component: 'student-memory-worker',
        message: 'Student-memory delivery reconciliation failed',
      }),
    );
  }, 5_000);
  void reconcile().catch((error) =>
    logger.error(error as Error, {
      component: 'student-memory-worker',
      message: 'Student-memory delivery reconciliation failed',
    }),
  );

  const worker = createStudentMemoryWorker(async (bullJob) => {
    await processStudentMemoryBullJob({
      bullJob,
      config,
    });
  });

  worker.on('error', (err: Error) => {
    logger.error(err, {
      component: 'student-memory-worker',
      message: 'Unhandled BullMQ student-memory worker error',
    });
  });

  const shutdown = async (signal: string) => {
    clearInterval(reconciliationTimer);
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

  await reportWorkerReady(worker, 'student-memory-worker', logger);
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
