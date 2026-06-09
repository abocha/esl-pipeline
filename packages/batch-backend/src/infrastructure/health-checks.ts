import type { BatchBackendConfig } from '../config/env.js';
import { withPgClient } from './db.js';
import { createRedisClient } from './redis.js';

export interface HealthCheckStatus {
  ok: boolean;
  skipped?: boolean;
}

export interface BackendHealth {
  ok: boolean;
  service: 'batch-backend';
  checks: {
    api: HealthCheckStatus;
    postgres: HealthCheckStatus;
    redis: HealthCheckStatus;
  };
}

export interface BackendHealthDependencies {
  checkPostgres?: () => Promise<void>;
  checkRedis?: () => Promise<void>;
}

async function defaultCheckPostgres(): Promise<void> {
  await withPgClient(async (client) => {
    await client.query('SELECT 1');
  });
}

async function defaultCheckRedis(): Promise<void> {
  const redis = createRedisClient();
  await redis.ping();
}

async function runCheck(check: () => Promise<void>): Promise<HealthCheckStatus> {
  try {
    await check();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function checkBackendHealth(
  config: BatchBackendConfig,
  dependencies: BackendHealthDependencies = {},
): Promise<BackendHealth> {
  const postgres = config.pg.enabled
    ? await runCheck(dependencies.checkPostgres ?? defaultCheckPostgres)
    : { ok: true, skipped: true };
  const redis = config.redis.enabled
    ? await runCheck(dependencies.checkRedis ?? defaultCheckRedis)
    : { ok: true, skipped: true };

  return {
    ok: postgres.ok && redis.ok,
    service: 'batch-backend',
    checks: {
      api: { ok: true },
      postgres,
      redis,
    },
  };
}
