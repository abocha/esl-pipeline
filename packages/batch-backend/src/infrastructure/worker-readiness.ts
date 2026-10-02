import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import type { Logger } from './logger.js';

interface ReadinessWorker {
  name: string;
  waitUntilReady(): Promise<unknown>;
  isRunning(): boolean;
  isPaused(): boolean;
}

/** Consumer initialization only; this record is neither a heartbeat nor business success. */
export async function reportWorkerReady(
  worker: ReadinessWorker,
  service: string,
  logger: Pick<Logger, 'info'>,
  timeoutMs = 30_000,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      worker.waitUntilReady(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${service} readiness deadline exceeded`)),
          timeoutMs,
        );
      }),
    ]);
    if (!worker.isRunning() || worker.isPaused()) {
      throw new Error(`${service} initialized but is not running/unpaused`);
    }
    logger.info('BullMQ consumer initialized', {
      event: 'worker_ready',
      service,
      queue: worker.name,
      instance: { hostname: hostname(), pid: process.pid, startupId: randomUUID() },
      timestamp: new Date().toISOString(),
    });
  } finally {
    clearTimeout(timer);
  }
}
