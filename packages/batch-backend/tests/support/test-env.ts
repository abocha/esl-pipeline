import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadBatchBackendEnv } from '../../src/bootstrap/env.js';
import { requirePgTestRuntimeEnv } from '../../src/bootstrap/pg-test-env.js';

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for this test suite.`);
  }
  return value;
}

function parseUrl(value: string, name: string): URL {
  try {
    return new URL(value);
  } catch (error) {
    throw new Error(
      `${name} must be a valid URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface PgTestEnv {
  connectionString: string;
}

export function requirePgTestEnv(): PgTestEnv {
  loadBatchBackendEnv(import.meta.url, 'batch-backend-test-env-support');
  const { connectionString } = requirePgTestRuntimeEnv();
  return { connectionString };
}

export interface RedisTestEnv {
  url: string;
  host: string;
  port: number;
}

// The repository's local Compose Redis publishes this test-only host port.
// An explicit environment value still wins for CI and alternate local setups.
const DEFAULT_LOCAL_TEST_REDIS = 'redis://127.0.0.1:6380';

export function requireRedisTestEnv(): RedisTestEnv {
  const url = process.env.BATCH_BACKEND_TEST_REDIS?.trim() || DEFAULT_LOCAL_TEST_REDIS;
  const parsed = parseUrl(url, 'BATCH_BACKEND_TEST_REDIS');
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) {
    throw new Error('BATCH_BACKEND_TEST_REDIS must use redis:// or rediss://.');
  }
  if (!parsed.hostname) {
    throw new Error('BATCH_BACKEND_TEST_REDIS must include a hostname.');
  }

  const port = parsed.port ? Number.parseInt(parsed.port, 10) : 6379;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('BATCH_BACKEND_TEST_REDIS must include a valid port.');
  }

  // The queue reads REDIS_HOST/REDIS_PORT, not BATCH_BACKEND_TEST_REDIS.
  // Force both from the resolved isolated test endpoint so stale development
  // .env values cannot make a service test connect somewhere else and hang.
  process.env.REDIS_ENABLED = 'true';
  process.env.REDIS_HOST = parsed.hostname;
  process.env.REDIS_PORT = String(port);
  if (parsed.password && !process.env.REDIS_PASSWORD) {
    process.env.REDIS_PASSWORD = decodeURIComponent(parsed.password);
  }

  return {
    url,
    host: parsed.hostname,
    port,
  };
}

export function resolveTestTimeout(defaultMs: number): number {
  const raw = process.env.BATCH_BACKEND_TEST_TIMEOUT_MS?.trim();
  if (!raw) {
    return defaultMs;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultMs;
  }
  return parsed;
}

export async function writeTestArtifact(
  fileName: string,
  payload: string | unknown,
): Promise<void> {
  const artifactsDir = process.env.BATCH_BACKEND_TEST_ARTIFACTS_DIR?.trim();
  if (!artifactsDir) {
    return;
  }

  await mkdir(artifactsDir, { recursive: true });
  const absolutePath = path.join(artifactsDir, fileName);
  const contents = typeof payload === 'string' ? payload : `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(absolutePath, contents, 'utf8');
}
