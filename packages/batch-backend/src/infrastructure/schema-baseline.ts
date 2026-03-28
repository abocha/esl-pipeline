import { randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

import { closePgPool } from './db.js';
import { getMigrationStatus, runMigrations } from './migrations.js';
import { verifyMigrations } from './migration-verify.js';

const execFile = promisify(execFileCallback);
const BASELINE_TOOL_VERSION = 'batch-backend-schema-baseline-v1';
const BASELINE_TIMESTAMP = '2000-01-01T00:00:00Z';
const DEFAULT_BASELINE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'schema.sql',
);
const DEFAULT_DOCKER_COMPOSE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'docker-compose.yml',
);
const OPTIONAL_PG_TRGM_INDEX_NAMES = [
  'idx_recordings_id_trgm',
  'idx_recordings_source_path_trgm',
  'idx_recordings_storage_uri_trgm',
] as const;
const OPTIONAL_PG_TRGM_SQL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    BEGIN
      CREATE EXTENSION pg_trgm;
    EXCEPTION
      WHEN insufficient_privilege THEN
        RAISE NOTICE 'Skipping pg_trgm extension creation because privileges are insufficient.';
    END;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_recordings_source_path_trgm'
    ) THEN
      CREATE INDEX idx_recordings_source_path_trgm
        ON recordings USING gin (source_path gin_trgm_ops);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_recordings_storage_uri_trgm'
    ) THEN
      CREATE INDEX idx_recordings_storage_uri_trgm
        ON recordings USING gin (storage_uri gin_trgm_ops);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'idx_recordings_id_trgm'
    ) THEN
      CREATE INDEX idx_recordings_id_trgm
        ON recordings USING gin ((id::text) gin_trgm_ops);
    END IF;
  END IF;
END $$;
`.trim();

export function selectDockerPostgresContainerId(
  dockerPsOutput: string,
  serverMajorVersion: string,
): string | null {
  const candidates = dockerPsOutput
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [id, image] = line.split(/\s+/, 3);
      return { id: id ?? null, image: image ?? null };
    })
    .filter(
      (candidate): candidate is { id: string; image: string } =>
        candidate.id !== null &&
        candidate.image !== null &&
        candidate.image.startsWith(`postgres:${serverMajorVersion}`),
    );

  return candidates.length === 1 ? candidates[0]!.id : null;
}

export interface SchemaBaselineVerificationResult {
  ok: boolean;
  errors: string[];
}

function resolveBaselinePath(): string {
  return DEFAULT_BASELINE_PATH;
}

function buildAdminConnectionString(connectionString: string): string {
  return connectionString;
}

async function canConnect(connectionString: string): Promise<boolean> {
  const pool = new Pool({ connectionString });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

async function resolveReachableConnectionString(connectionString: string): Promise<string> {
  const parsed = new URL(connectionString);
  if (parsed.hostname !== 'postgres') {
    return connectionString;
  }
  if (await canConnect(connectionString)) {
    return connectionString;
  }

  parsed.hostname = '127.0.0.1';
  const hostFallback = parsed.toString();
  if (await canConnect(hostFallback)) {
    return hostFallback;
  }

  return connectionString;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function buildTempDatabaseName(): string {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  return `esl_batch_schema_${suffix}`;
}

function buildGeneratedHeader(): string {
  return [
    '-- packages/batch-backend/schema.sql',
    '-- GENERATED FILE: refresh with `pnpm --filter @esl-pipeline/batch-backend db:generate-baseline`.',
    '-- Do not hand-edit.',
    '-- Fresh-install baseline generated from the full versioned migration chain.',
    '',
  ].join('\n');
}

function normalizeDumpSql(rawSql: string): string {
  const filtered = rawSql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('--') ||
        trimmed.startsWith('\\restrict') ||
        trimmed.startsWith('\\unrestrict') ||
        trimmed.startsWith('SET ') ||
        trimmed === "SELECT pg_catalog.set_config('search_path', '', false);" ||
        trimmed === 'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;' ||
        trimmed ===
          "COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';" ||
        trimmed.includes('gin_trgm_ops')
      ) {
        return false;
      }
      return true;
    })
    .join('\n');

  const collapsed = filtered
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '')
    .replace(/\s+$/, '');

  return `${buildGeneratedHeader()}${collapsed}\n\n-- Optional pg_trgm support retained from migrations.\n${OPTIONAL_PG_TRGM_SQL}\n`;
}

function buildSchemaMigrationsSeed(
  discovered: Awaited<ReturnType<typeof getMigrationStatus>>['discovered'],
): string {
  const values = discovered
    .map(
      (migration) =>
        `  (${quoteLiteral(migration.id)}, ${quoteLiteral(migration.checksum)}, ${quoteLiteral(
          BASELINE_TIMESTAMP,
        )}::timestamptz, 0, ${quoteLiteral(BASELINE_TOOL_VERSION)})`,
    )
    .join(',\n');

  return [
    '',
    '-- Seed migration ledger so fresh baseline installs report a clean migration state.',
    'INSERT INTO public.schema_migrations (id, checksum, applied_at, execution_ms, tool_version)',
    'VALUES',
    values,
    'ON CONFLICT (id) DO NOTHING;',
    '',
  ].join('\n');
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function withConnectionStringOverride<T>(
  connectionString: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = process.env.PG_CONNECTION_STRING;
  process.env.PG_ENABLED = 'true';
  process.env.PG_CONNECTION_STRING = connectionString;
  await closePgPool();
  try {
    return await fn();
  } finally {
    await closePgPool();
    if (previous === undefined) {
      delete process.env.PG_CONNECTION_STRING;
    } else {
      process.env.PG_CONNECTION_STRING = previous;
    }
  }
}

async function withTemporaryDatabase<T>(
  baseConnectionString: string,
  fn: (tempConnectionString: string) => Promise<T>,
): Promise<T> {
  const adminConnectionString = buildAdminConnectionString(baseConnectionString);
  const tempDatabase = buildTempDatabaseName();
  const tempConnection = new URL(baseConnectionString);
  tempConnection.pathname = `/${tempDatabase}`;
  const adminPool = new Pool({ connectionString: adminConnectionString });
  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(tempDatabase)}`);
  } catch (error) {
    await adminPool.end();
    throw new Error(
      `Failed to create temporary database "${tempDatabase}" for schema baseline generation: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    return await fn(tempConnection.toString());
  } finally {
    try {
      await adminPool.query(
        `
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE datname = $1
            AND pid <> pg_backend_pid()
        `,
        [tempDatabase],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(tempDatabase)}`);
    } finally {
      await adminPool.end();
    }
  }
}

async function resolveServerMajorVersion(connectionString: string): Promise<string> {
  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query<{ server_version_num: string }>(
      'SHOW server_version_num',
    );
    const numeric = result.rows[0]?.server_version_num ?? '';
    return numeric.slice(0, 2) === '10' || numeric.length > 5 ? numeric.slice(0, 2) : numeric[0]!;
  } finally {
    await pool.end();
  }
}

async function resolveDockerPostgresContainer(serverMajorVersion: string): Promise<string | null> {
  const configuredContainer = process.env.BATCH_BACKEND_SCHEMA_BASELINE_PG_DUMP_CONTAINER?.trim();
  if (configuredContainer) {
    return configuredContainer;
  }

  try {
    const { stdout } = await execFile('docker', [
      'compose',
      '-f',
      DEFAULT_DOCKER_COMPOSE_PATH,
      'ps',
      '-q',
      'postgres',
    ]);
    const containerId = stdout.trim();
    if (containerId) {
      return containerId;
    }
  } catch {
    // Fall through to generic discovery.
  }

  try {
    const { stdout } = await execFile('docker', [
      'ps',
      '--format',
      '{{.ID}} {{.Image}} {{.Ports}}',
    ]);
    return selectDockerPostgresContainerId(stdout, serverMajorVersion);
  } catch {
    return null;
  }
}

function buildPgDumpArgs(connectionString: string): string[] {
  return ['--schema-only', '--no-owner', '--no-privileges', connectionString];
}

async function dumpSchemaWithLocalPgDump(connectionString: string): Promise<string> {
  const { stdout } = await execFile('pg_dump', buildPgDumpArgs(connectionString), {
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function dumpSchemaWithDockerPgDump(
  connectionString: string,
  serverMajorVersion: string,
): Promise<string> {
  const containerId = await resolveDockerPostgresContainer(serverMajorVersion);
  if (!containerId) {
    throw new Error(
      `Local pg_dump could not dump PostgreSQL ${serverMajorVersion} and no matching postgres:${serverMajorVersion} container was found for fallback.`,
    );
  }

  const parsed = new URL(connectionString);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const args = ['exec'];
  if (parsed.password) {
    args.push('-e', `PGPASSWORD=${decodeURIComponent(parsed.password)}`);
  }
  args.push(containerId, 'pg_dump', '--schema-only', '--no-owner', '--no-privileges');
  if (parsed.username) {
    args.push('--username', decodeURIComponent(parsed.username));
  }
  args.push('--host', 'localhost');
  if (parsed.port && parsed.port !== '5432') {
    args.push('--port', parsed.port);
  }
  args.push('--dbname', dbName);

  const { stdout } = await execFile('docker', args, {
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function dumpSchemaSql(connectionString: string): Promise<string> {
  try {
    return await dumpSchemaWithLocalPgDump(connectionString);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('server version mismatch')) {
      throw error;
    }
    const serverMajorVersion = await resolveServerMajorVersion(connectionString);
    return dumpSchemaWithDockerPgDump(connectionString, serverMajorVersion);
  }
}

export async function generateSchemaBaselineSql(
  connectionString: string = process.env.PG_CONNECTION_STRING ?? '',
): Promise<string> {
  if (!connectionString) {
    throw new Error('PG_CONNECTION_STRING is required to generate the schema baseline.');
  }

  const reachableConnectionString = await resolveReachableConnectionString(connectionString);
  return withTemporaryDatabase(reachableConnectionString, async (tempConnectionString) => {
    await withConnectionStringOverride(tempConnectionString, async () => {
      await runMigrations();
    });
    const dumpSql = await dumpSchemaSql(tempConnectionString);
    const status = await withConnectionStringOverride(tempConnectionString, async () =>
      getMigrationStatus(),
    );
    return `${normalizeDumpSql(dumpSql)}${buildSchemaMigrationsSeed(status.discovered)}`;
  });
}

export async function writeSchemaBaseline(
  destinationPath: string = resolveBaselinePath(),
  connectionString: string = process.env.PG_CONNECTION_STRING ?? '',
): Promise<string> {
  const sql = await generateSchemaBaselineSql(connectionString);
  await fs.writeFile(destinationPath, sql, 'utf8');
  return destinationPath;
}

async function applySqlFile(connectionString: string, filePath: string): Promise<void> {
  await execFile('psql', [connectionString, '-v', 'ON_ERROR_STOP=1', '-f', filePath], {
    maxBuffer: 20 * 1024 * 1024,
  });
}

export async function verifySchemaBaseline(
  baselinePath: string = resolveBaselinePath(),
  connectionString: string = process.env.PG_CONNECTION_STRING ?? '',
): Promise<SchemaBaselineVerificationResult> {
  if (!connectionString) {
    return {
      ok: false,
      errors: ['PG_CONNECTION_STRING is required to verify the schema baseline.'],
    };
  }

  const reachableConnectionString = await resolveReachableConnectionString(connectionString);
  const expected = await generateSchemaBaselineSql(reachableConnectionString);
  const actual = await fs.readFile(baselinePath, 'utf8');
  const errors: string[] = [];

  if (actual !== expected) {
    errors.push(
      `Committed schema baseline at ${baselinePath} is out of date. Run db:generate-baseline and commit the result.`,
    );
  }

  await withTemporaryDatabase(reachableConnectionString, async (tempConnectionString) => {
    await applySqlFile(tempConnectionString, baselinePath);
    const status = await withConnectionStringOverride(tempConnectionString, async () =>
      getMigrationStatus(),
    );
    const verification = await withConnectionStringOverride(tempConnectionString, async () =>
      verifyMigrations(),
    );

    if (status.pending.length > 0) {
      errors.push(
        `Baseline-applied database still reports pending migrations: ${status.pending
          .map((migration) => migration.id)
          .join(', ')}`,
      );
    }
    if (status.checksumMismatches.length > 0) {
      errors.push(
        `Baseline-applied database has migration checksum mismatches: ${status.checksumMismatches
          .map((entry) => entry.id)
          .join(', ')}`,
      );
    }
    if (!verification.ok) {
      errors.push(...verification.errors.map((error) => `Baseline verification failed: ${error}`));
    }
  });

  return {
    ok: errors.length === 0,
    errors,
  };
}
