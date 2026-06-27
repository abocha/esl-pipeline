const DEFAULT_TMP_ROOT = '/tmp/codex-tmp';

function normalizeEnvValue(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parsePgUrl(value: string, envName: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(
      `${envName} must be a valid URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`${envName} must use postgres:// or postgresql://.`);
  }

  const rawDbName = parsed.pathname.replace(/^\/+/, '').trim();
  if (!rawDbName || rawDbName.includes('/')) {
    throw new Error(
      `${envName} must include exactly one database name in URL path (for example: .../esl_batch_test).`,
    );
  }

  return parsed;
}

function normalizeHostForHostRun(hostname: string): string {
  return hostname === 'postgres' ? '127.0.0.1' : hostname;
}

function deriveTestDatabaseName(dbName: string): string {
  return dbName.toLowerCase().endsWith('_test') ? dbName : `${dbName}_test`;
}

function serializePgUrl(parsed: URL): string {
  parsed.hostname = normalizeHostForHostRun(parsed.hostname);
  return parsed.toString();
}

function derivePgTestConnectionString(env: NodeJS.ProcessEnv): string | null {
  const explicit = normalizeEnvValue(env.BATCH_BACKEND_TEST_PG);
  if (explicit) {
    const parsed = parsePgUrl(explicit, 'BATCH_BACKEND_TEST_PG');
    const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').trim());
    if (!dbName.toLowerCase().endsWith('_test')) {
      throw new Error(
        `BATCH_BACKEND_TEST_PG must target a dedicated test database ending with "_test". Received "${dbName}".`,
      );
    }
    return serializePgUrl(parsed);
  }

  const runtimeConnectionString = normalizeEnvValue(env.PG_CONNECTION_STRING);
  if (runtimeConnectionString) {
    const parsed = parsePgUrl(runtimeConnectionString, 'PG_CONNECTION_STRING');
    const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, '').trim());
    parsed.pathname = `/${encodeURIComponent(deriveTestDatabaseName(dbName))}`;
    return serializePgUrl(parsed);
  }

  const database = normalizeEnvValue(env.PG_DATABASE);
  if (!database) {
    return null;
  }

  const parsed = new URL('postgresql://placeholder');
  parsed.username = normalizeEnvValue(env.PG_USER) ?? 'esl';
  parsed.password = normalizeEnvValue(env.PG_PASSWORD) ?? 'esl';
  parsed.hostname = normalizeHostForHostRun(normalizeEnvValue(env.PG_HOST) ?? 'postgres');

  const port = normalizeEnvValue(env.PG_PORT) ?? '5432';
  parsed.port = port;
  parsed.pathname = `/${encodeURIComponent(deriveTestDatabaseName(database))}`;
  return parsed.toString();
}

export interface PgTestRuntimeEnv {
  connectionString: string;
  tmpDir: string;
}

export function tryConfigurePgTestRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): PgTestRuntimeEnv | null {
  const connectionString = derivePgTestConnectionString(env);
  if (!connectionString) {
    return null;
  }

  const tmpDir = normalizeEnvValue(env.TMPDIR) ?? DEFAULT_TMP_ROOT;

  env.BATCH_BACKEND_TEST_PG = connectionString;
  env.PG_ENABLED = env.PG_ENABLED ?? 'true';
  env.PG_AUTO_MIGRATE_ON_BOOT = env.PG_AUTO_MIGRATE_ON_BOOT ?? 'false';
  env.PG_CONNECTION_STRING = connectionString;
  env.TMPDIR = tmpDir;
  env.TMP = normalizeEnvValue(env.TMP) ?? tmpDir;
  env.TEMP = normalizeEnvValue(env.TEMP) ?? tmpDir;

  return {
    connectionString,
    tmpDir,
  };
}

export function requirePgTestRuntimeEnv(env: NodeJS.ProcessEnv = process.env): PgTestRuntimeEnv {
  const resolved = tryConfigurePgTestRuntimeEnv(env);
  if (resolved) {
    return resolved;
  }

  throw new Error(
    'BATCH_BACKEND_TEST_PG is required for this test suite. Define it directly or provide PG_CONNECTION_STRING/PG_DATABASE in .env.',
  );
}
