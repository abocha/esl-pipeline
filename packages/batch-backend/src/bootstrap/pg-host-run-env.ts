const DEFAULT_TMP_ROOT = '/tmp/codex-tmp';

function normalizeEnvValue(value: string | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeHostForHostRun(hostname: string): string {
  return hostname === 'postgres' ? '127.0.0.1' : hostname;
}

function normalizePgConnectionString(connectionString: string): string {
  const parsed = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('PG_CONNECTION_STRING must use postgres:// or postgresql://.');
  }
  parsed.hostname = normalizeHostForHostRun(parsed.hostname);
  return parsed.toString();
}

export interface HostRunPgRuntimeEnv {
  connectionString: string | null;
  tmpDir: string;
}

export function configureHostRunPgRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): HostRunPgRuntimeEnv {
  const connectionString = normalizeEnvValue(env.PG_CONNECTION_STRING);
  if (connectionString) {
    env.PG_CONNECTION_STRING = normalizePgConnectionString(connectionString);
  } else {
    const host = normalizeEnvValue(env.PG_HOST);
    if (host) {
      env.PG_HOST = normalizeHostForHostRun(host);
    }
  }

  const tmpDir = normalizeEnvValue(env.TMPDIR) ?? DEFAULT_TMP_ROOT;
  env.TMPDIR = tmpDir;
  env.TMP = normalizeEnvValue(env.TMP) ?? tmpDir;
  env.TEMP = normalizeEnvValue(env.TEMP) ?? tmpDir;

  return {
    connectionString: normalizeEnvValue(env.PG_CONNECTION_STRING),
    tmpDir,
  };
}
