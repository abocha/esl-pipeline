import type { PoolClient } from 'pg';

import { withPgClient } from './db.js';
import { logger } from './logger.js';
import {
  maybeRunTtsCacheMaintenance,
  type TtsCacheMaintenanceOptions,
  type TtsCacheMaintenanceResult,
} from './tts-cache-maintenance.js';

export interface TtsCacheMaintenanceWithPgLockOptions extends TtsCacheMaintenanceOptions {
  lockKey: string;
}

export async function maybeRunTtsCacheMaintenanceWithPgLock(
  options: TtsCacheMaintenanceWithPgLockOptions,
): Promise<TtsCacheMaintenanceResult> {
  const { lockKey, ...maintenanceOptions } = options;
  if (maintenanceOptions.intervalMinutes <= 0) {
    return {
      ran: false,
      reason: 'disabled',
      scannedFiles: 0,
      deletedFiles: 0,
      reclaimedBytes: 0,
      remainingBytes: 0,
    };
  }

  return withPgClient(async (client) => {
    const acquired = await tryAcquireAdvisoryLock(client, lockKey);
    if (!acquired) {
      return {
        ran: false,
        reason: 'global_lock',
        scannedFiles: 0,
        deletedFiles: 0,
        reclaimedBytes: 0,
        remainingBytes: 0,
      };
    }

    try {
      return await maybeRunTtsCacheMaintenance(maintenanceOptions);
    } finally {
      try {
        await releaseAdvisoryLock(client, lockKey);
      } catch (error) {
        logger.warn('Failed to release TTS cache maintenance advisory lock', {
          component: 'tts-cache-maintenance',
          lockKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
}

async function tryAcquireAdvisoryLock(client: PoolClient, lockKey: string): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    'SELECT pg_try_advisory_lock($1::bigint) AS acquired',
    [lockKey],
  );
  return result.rows[0]?.acquired === true;
}

async function releaseAdvisoryLock(client: PoolClient, lockKey: string): Promise<void> {
  await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey]);
}
