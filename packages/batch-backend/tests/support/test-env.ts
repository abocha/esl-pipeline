import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
    throw new Error(`${name} must be a valid URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface PgTestEnv {
  connectionString: string;
}

export function requirePgTestEnv(): PgTestEnv {
  const connectionString = readRequiredEnv('BATCH_BACKEND_TEST_PG');
  const parsed = parseUrl(connectionString, 'BATCH_BACKEND_TEST_PG');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('BATCH_BACKEND_TEST_PG must use postgres:// or postgresql://.');
  }

  process.env.PG_ENABLED = process.env.PG_ENABLED ?? 'true';
  process.env.PG_AUTO_MIGRATE_ON_BOOT = process.env.PG_AUTO_MIGRATE_ON_BOOT ?? 'false';
  process.env.PG_CONNECTION_STRING = connectionString;

  return { connectionString };
}

export interface RedisTestEnv {
  url: string;
  host: string;
  port: number;
}

export function requireRedisTestEnv(): RedisTestEnv {
  const url = readRequiredEnv('BATCH_BACKEND_TEST_REDIS');
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

  process.env.REDIS_ENABLED = process.env.REDIS_ENABLED ?? 'true';
  process.env.REDIS_HOST = process.env.REDIS_HOST ?? parsed.hostname;
  process.env.REDIS_PORT = process.env.REDIS_PORT ?? String(port);
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
