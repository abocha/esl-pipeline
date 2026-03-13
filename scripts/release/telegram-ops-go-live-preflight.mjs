#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_ARTIFACT_DIR,
  REPO_ROOT,
  loadEnvFromFiles,
  normalizeEnvValue,
  parseBool,
  truncateText,
  writeJsonArtifact,
} from './telegram-ops-go-live-utils.mjs';

const VALID_PROFILES = new Set(['readonly_canary', 'mutable_ops']);
const DEFAULT_PROFILE = 'readonly_canary';
const DEFAULT_JSON_OUT = path.join(DEFAULT_ARTIFACT_DIR, 'preflight.json');

function printUsage() {
  console.log(
    'Usage: node scripts/release/telegram-ops-go-live-preflight.mjs [--profile readonly_canary|mutable_ops] [--json-out <path>]',
  );
}

function parseArgs(argv) {
  const args = {
    profile: DEFAULT_PROFILE,
    jsonOutPath: DEFAULT_JSON_OUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--profile') {
      args.profile = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token.startsWith('--profile=')) {
      args.profile = token.slice('--profile='.length);
      continue;
    }
    if (token === '--json-out') {
      args.jsonOutPath = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (token.startsWith('--json-out=')) {
      args.jsonOutPath = token.slice('--json-out='.length);
      continue;
    }
    if (token === '-h' || token === '--help') {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  args.profile = normalizeEnvValue(args.profile) || DEFAULT_PROFILE;
  if (!VALID_PROFILES.has(args.profile)) {
    throw new Error(
      `Invalid --profile value: ${args.profile}. Expected one of: ${[...VALID_PROFILES].join(', ')}`,
    );
  }
  if (!normalizeEnvValue(args.jsonOutPath)) {
    throw new Error('--json-out cannot be empty');
  }
  return args;
}

function parseAllowedUserIds(rawValue) {
  const tokens = normalizeEnvValue(rawValue)
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
  const valid = [];
  const invalid = [];
  for (const token of tokens) {
    if (/^\d+$/u.test(token)) {
      valid.push(token);
    } else {
      invalid.push(token);
    }
  }
  return {
    valid,
    invalid,
    totalTokens: tokens.length,
  };
}

function readPgTupleState(env) {
  const tupleKeys = ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'];
  const missingTupleKeys = tupleKeys.filter((key) => normalizeEnvValue(env[key]).length === 0);
  const anyTupleConfigured = tupleKeys.some((key) => normalizeEnvValue(env[key]).length > 0);
  return {
    tupleKeys,
    missingTupleKeys,
    anyTupleConfigured,
    completeTupleConfigured: missingTupleKeys.length === 0,
  };
}

function evaluateLeaderElectionDbConfig(env) {
  const leaderElectionDatabaseUrl = normalizeEnvValue(env.TELEGRAM_OPS_BOT_LEADER_ELECTION_DATABASE_URL);
  const pgConnectionString = normalizeEnvValue(env.PG_CONNECTION_STRING);
  const tupleState = readPgTupleState(env);

  const source = leaderElectionDatabaseUrl
    ? 'leader_election_database_url'
    : pgConnectionString
      ? 'pg_connection_string'
      : tupleState.completeTupleConfigured
        ? 'pg_tuple'
        : null;
  return {
    passed: source !== null,
    source,
    leaderElectionDatabaseUrlConfigured: leaderElectionDatabaseUrl.length > 0,
    pgConnectionStringConfigured: pgConnectionString.length > 0,
    anyPgTupleConfigured: tupleState.anyTupleConfigured,
    missingTupleKeys: tupleState.missingTupleKeys,
  };
}

function createCheck({ id, passed, message, severity = 'error', details }) {
  return {
    id,
    passed: Boolean(passed),
    severity,
    message,
    details: details ?? {},
  };
}

function summarizeChecks(checks) {
  let failed = 0;
  let warnings = 0;
  for (const check of checks) {
    if (check.passed) {
      continue;
    }
    if (check.severity === 'warning') {
      warnings += 1;
      continue;
    }
    failed += 1;
  }
  return {
    total: checks.length,
    failed,
    warnings,
    passed: failed === 0,
  };
}

function defaultCommandRunner(args) {
  const commandEnv = {
    ...(args.env ?? process.env),
  };
  if (process.platform === 'linux') {
    const tmpRoot = normalizeEnvValue(commandEnv.TMPDIR) || '/tmp';
    commandEnv.TMPDIR = tmpRoot;
    if (!normalizeEnvValue(commandEnv.TMP)) {
      commandEnv.TMP = tmpRoot;
    }
    if (!normalizeEnvValue(commandEnv.TEMP)) {
      commandEnv.TEMP = tmpRoot;
    }
  }

  const result = spawnSync(args.command, args.args, {
    cwd: args.cwd ?? REPO_ROOT,
    env: commandEnv,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    command: `${args.command} ${args.args.join(' ')}`.trim(),
    exitCode: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    failedToStart: result.error ? String(result.error.message ?? result.error) : null,
  };
}

function buildHostSafeDbCommandEnv(env) {
  const commandEnv = {
    ...env,
  };

  const rawConnectionString = normalizeEnvValue(commandEnv.PG_CONNECTION_STRING);
  if (rawConnectionString) {
    try {
      const parsed = new URL(rawConnectionString);
      if (parsed.protocol.startsWith('postgres') && parsed.hostname === 'postgres') {
        parsed.hostname = '127.0.0.1';
        commandEnv.PG_CONNECTION_STRING = parsed.toString();
      }
      return commandEnv;
    } catch {
      // Fall through to PG_HOST-based rewrite.
    }
  }

  const pgHost = normalizeEnvValue(commandEnv.PG_HOST);
  if (pgHost === 'postgres') {
    const pgUser = normalizeEnvValue(commandEnv.PG_USER) || 'esl';
    const pgPassword = normalizeEnvValue(commandEnv.PG_PASSWORD) || 'esl';
    const pgDatabase = normalizeEnvValue(commandEnv.PG_DATABASE) || 'esl_batch';
    const pgPort = normalizeEnvValue(commandEnv.PG_PORT) || '5432';

    const encodedUser = encodeURIComponent(pgUser);
    const encodedPassword = encodeURIComponent(pgPassword);
    commandEnv.PG_CONNECTION_STRING = `postgresql://${encodedUser}:${encodedPassword}@127.0.0.1:${pgPort}/${pgDatabase}`;
  }

  return commandEnv;
}

function parsePendingMigrationCount(output) {
  const match = output.match(/Pending migrations:\s*(\d+)/iu);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1], 10);
}

function buildBackendPgClientConfig(env) {
  const connectionString = normalizeEnvValue(env.PG_CONNECTION_STRING);
  const timeoutMsRaw = normalizeEnvValue(env.PG_CONNECTION_TIMEOUT_MS);
  const timeoutMs = timeoutMsRaw ? Number.parseInt(timeoutMsRaw, 10) : 5000;

  if (connectionString) {
    return {
      connectionString,
      connectionTimeoutMillis: Number.isFinite(timeoutMs) ? timeoutMs : 5000,
    };
  }

  const host = normalizeEnvValue(env.PG_HOST);
  const user = normalizeEnvValue(env.PG_USER);
  const password = normalizeEnvValue(env.PG_PASSWORD);
  const database = normalizeEnvValue(env.PG_DATABASE);
  const portRaw = normalizeEnvValue(env.PG_PORT);
  const port = portRaw ? Number.parseInt(portRaw, 10) : 5432;

  if (!host || !user || !password || !database || !Number.isFinite(port)) {
    return null;
  }

  return {
    host,
    user,
    password,
    database,
    port,
    connectionTimeoutMillis: Number.isFinite(timeoutMs) ? timeoutMs : 5000,
  };
}

async function defaultOpsActionsSchemaProbe(args) {
  const config = buildBackendPgClientConfig(args.env);
  if (!config) {
    return {
      available: false,
      exists: null,
      warning: 'No explicit Postgres config available for direct schema probe.',
    };
  }

  let PgClient;
  try {
    const backendRequire = createRequire(
      path.join(REPO_ROOT, 'packages', 'batch-backend', 'package.json'),
    );
    const pgModule = backendRequire('pg');
    PgClient = pgModule.Client;
  } catch {
    return {
      available: false,
      exists: null,
      warning: 'Schema probe unavailable: pg module not resolvable from backend runtime.',
    };
  }

  const client = new PgClient(config);
  try {
    await client.connect();
    const query = await client.query(
      `SELECT to_regclass('public.ops_actions') IS NOT NULL AS exists_table`,
    );
    const exists = query.rows[0]?.exists_table === true;
    return {
      available: true,
      exists,
      warning: null,
    };
  } catch (error) {
    return {
      available: false,
      exists: null,
      warning: `Schema probe unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await client.end().catch(() => {});
  }
}

function collectConfigChecks(args) {
  const env = args.env;
  const checks = [];

  const botEnabled = parseBool(env.TELEGRAM_OPS_BOT_ENABLED, false);
  checks.push(
    createCheck({
      id: 'bot_enabled',
      passed: botEnabled,
      message: 'TELEGRAM_OPS_BOT_ENABLED must be true.',
      details: {
        value: normalizeEnvValue(env.TELEGRAM_OPS_BOT_ENABLED),
      },
    }),
  );

  const botMode = normalizeEnvValue(env.TELEGRAM_OPS_BOT_MODE || 'polling');
  checks.push(
    createCheck({
      id: 'polling_mode',
      passed: botMode === 'polling',
      message: 'TELEGRAM_OPS_BOT_MODE must be polling for Polling GA closeout.',
      details: { value: botMode || '(empty)' },
    }),
  );

  const startupReplayGuardEnabled = parseBool(env.TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP, true);
  checks.push(
    createCheck({
      id: 'startup_replay_guard',
      passed: startupReplayGuardEnabled,
      message: 'TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP must remain true.',
      details: {
        value: normalizeEnvValue(env.TELEGRAM_OPS_BOT_SKIP_PENDING_UPDATES_ON_STARTUP),
      },
    }),
  );

  const backendUrl = normalizeEnvValue(env.TELEGRAM_OPS_BOT_BACKEND_URL);
  checks.push(
    createCheck({
      id: 'backend_url',
      passed: backendUrl.length > 0,
      message: 'TELEGRAM_OPS_BOT_BACKEND_URL must be configured.',
      details: { value: backendUrl || '(empty)' },
    }),
  );

  const backendEmail = normalizeEnvValue(env.TELEGRAM_OPS_BOT_BACKEND_EMAIL);
  const backendPassword = normalizeEnvValue(env.TELEGRAM_OPS_BOT_BACKEND_PASSWORD);
  checks.push(
    createCheck({
      id: 'backend_service_account',
      passed: backendEmail.length > 0 && backendPassword.length > 0,
      message: 'TELEGRAM_OPS_BOT_BACKEND_EMAIL and TELEGRAM_OPS_BOT_BACKEND_PASSWORD must be configured.',
      details: {
        emailConfigured: backendEmail.length > 0,
        passwordConfigured: backendPassword.length > 0,
      },
    }),
  );

  const allowedUserIds = parseAllowedUserIds(env.TELEGRAM_OPS_BOT_ALLOWED_USER_IDS);
  checks.push(
    createCheck({
      id: 'allowed_user_ids',
      passed: allowedUserIds.valid.length > 0 && allowedUserIds.invalid.length === 0,
      message:
        'TELEGRAM_OPS_BOT_ALLOWED_USER_IDS must include at least one numeric user id and no invalid tokens.',
      details: {
        configuredCount: allowedUserIds.valid.length,
        invalidTokens: allowedUserIds.invalid,
        tokenCount: allowedUserIds.totalTokens,
      },
    }),
  );

  const backendOpsControlEnabled = parseBool(env.BATCH_BACKEND_ENABLE_OPS_CONTROL, false);
  checks.push(
    createCheck({
      id: 'backend_ops_control_enabled',
      passed: backendOpsControlEnabled,
      message: 'BATCH_BACKEND_ENABLE_OPS_CONTROL must be true.',
      details: {
        value: normalizeEnvValue(env.BATCH_BACKEND_ENABLE_OPS_CONTROL),
      },
    }),
  );

  const backendSecret = normalizeEnvValue(env.BATCH_BACKEND_OPS_CONTROL_BOT_SECRET);
  const botSecret = normalizeEnvValue(env.TELEGRAM_OPS_BOT_BACKEND_SHARED_SECRET);
  if (backendSecret) {
    checks.push(
      createCheck({
        id: 'shared_secret_pairing',
        passed: botSecret.length > 0 && backendSecret === botSecret,
        message:
          'BATCH_BACKEND_OPS_CONTROL_BOT_SECRET is set; TELEGRAM_OPS_BOT_BACKEND_SHARED_SECRET must be set and equal.',
        details: {
          backendSecretConfigured: true,
          botSecretConfigured: botSecret.length > 0,
          valuesMatch: backendSecret === botSecret,
        },
      }),
    );
  } else {
    checks.push(
      createCheck({
        id: 'shared_secret_pairing',
        passed: false,
        severity: 'warning',
        message:
          'BATCH_BACKEND_OPS_CONTROL_BOT_SECRET is not configured; defense-in-depth for /ops/* is disabled.',
        details: {
          backendSecretConfigured: false,
        },
      }),
    );
  }

  const leaderElectionEnabled = parseBool(env.TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED, false);
  if (leaderElectionEnabled) {
    const leaderElectionDb = evaluateLeaderElectionDbConfig(env);
    checks.push(
      createCheck({
        id: 'leader_election_db_config',
        passed: leaderElectionDb.passed,
        message:
          'TELEGRAM_OPS_BOT_LEADER_ELECTION_ENABLED=true requires TELEGRAM_OPS_BOT_LEADER_ELECTION_DATABASE_URL, PG_CONNECTION_STRING, or a complete PG_* tuple.',
        details: {
          leaderElectionEnabled: true,
          source: leaderElectionDb.source,
          leaderElectionDatabaseUrlConfigured: leaderElectionDb.leaderElectionDatabaseUrlConfigured,
          pgConnectionStringConfigured: leaderElectionDb.pgConnectionStringConfigured,
          anyPgTupleConfigured: leaderElectionDb.anyPgTupleConfigured,
          missingTupleKeys: leaderElectionDb.missingTupleKeys,
          approvalReplayDatabaseUrlConfigured:
            normalizeEnvValue(env.TELEGRAM_OPS_BOT_APPROVAL_REPLAY_DATABASE_URL).length > 0,
        },
      }),
    );
  } else {
    checks.push(
      createCheck({
        id: 'leader_election_db_config',
        passed: true,
        message: 'Leader election is disabled; explicit DB config check skipped.',
        details: {
          leaderElectionEnabled: false,
        },
      }),
    );
  }

  const actionCommandsEnabled = parseBool(env.TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS, false);
  if (args.profile === 'readonly_canary') {
    checks.push(
      createCheck({
        id: 'readonly_action_commands_disabled',
        passed: !actionCommandsEnabled,
        message: 'readonly_canary profile requires TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=false.',
        details: {
          value: normalizeEnvValue(env.TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS),
        },
      }),
    );
  }

  if (args.profile === 'mutable_ops') {
    checks.push(
      createCheck({
        id: 'mutable_action_commands_enabled',
        passed: actionCommandsEnabled,
        severity: actionCommandsEnabled ? 'error' : 'warning',
        message:
          'mutable_ops profile expects TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS=true after explicit sign-off.',
        details: {
          value: normalizeEnvValue(env.TELEGRAM_OPS_BOT_ENABLE_ACTION_COMMANDS),
        },
      }),
      createCheck({
        id: 'mutable_ops_strict_secret_required',
        passed: backendSecret.length > 0 && botSecret.length > 0 && backendSecret === botSecret,
        message:
          'mutable_ops profile requires strict shared-secret hardening for /ops/* (backend + bot secrets configured and matching).',
        details: {
          backendSecretConfigured: backendSecret.length > 0,
          botSecretConfigured: botSecret.length > 0,
          valuesMatch: backendSecret === botSecret,
        },
      }),
    );
  }

  return checks;
}

function printReport(report) {
  console.log('[telegram-ops-go-live-preflight]');
  console.log(`- profile: ${report.profile}`);
  console.log(`- artifact: ${report.artifactPath}`);
  for (const check of report.checks) {
    if (check.passed) {
      console.log(`PASS ${check.id}: ${check.message}`);
      continue;
    }
    const prefix = check.severity === 'warning' ? 'WARN' : 'FAIL';
    console.log(`${prefix} ${check.id}: ${check.message}`);
  }
  if (report.commands.dbStatus) {
    console.log(
      `- db:status exit=${report.commands.dbStatus.exitCode} pending=${report.commands.dbStatus.pendingMigrations ?? 'unknown'}`,
    );
  }
  if (report.commands.dbVerify) {
    console.log(`- db:verify exit=${report.commands.dbVerify.exitCode}`);
  }
  console.log(
    `- summary: passed=${report.summary.passed} failed=${report.summary.failed} warnings=${report.summary.warnings}`,
  );
}

export async function runPreflight(args = {}) {
  const profile = args.profile ?? DEFAULT_PROFILE;
  const env = args.env ?? (await loadEnvFromFiles());
  const runCommand = args.runCommand ?? defaultCommandRunner;
  const probeOpsActionsTable = args.probeOpsActionsTable ?? defaultOpsActionsSchemaProbe;
  const jsonOutPath = args.jsonOutPath ?? DEFAULT_JSON_OUT;

  const checks = collectConfigChecks({ profile, env });
  const commands = {};
  const dbCommandEnv = buildHostSafeDbCommandEnv(env);

  const dbStatus = await runCommand({
    command: 'pnpm',
    args: ['--filter', '@esl-pipeline/batch-backend', 'db:status'],
    cwd: REPO_ROOT,
    env: dbCommandEnv,
  });
  const pendingMigrations = parsePendingMigrationCount(`${dbStatus.stdout}\n${dbStatus.stderr}`);
  commands.dbStatus = {
    ...dbStatus,
    stdout: truncateText(dbStatus.stdout),
    stderr: truncateText(dbStatus.stderr),
    pendingMigrations,
  };
  checks.push(
    createCheck({
      id: 'db_status_command',
      passed: dbStatus.exitCode === 0,
      message: 'pnpm --filter @esl-pipeline/batch-backend db:status must succeed.',
      details: {
        exitCode: dbStatus.exitCode,
        failedToStart: dbStatus.failedToStart,
      },
    }),
    createCheck({
      id: 'db_status_pending_migrations',
      passed: typeof pendingMigrations === 'number' && pendingMigrations === 0,
      message: 'db:status must report Pending migrations: 0 for rollout closeout.',
      details: {
        pendingMigrations,
      },
    }),
  );

  const dbVerify = await runCommand({
    command: 'pnpm',
    args: ['--filter', '@esl-pipeline/batch-backend', 'db:verify'],
    cwd: REPO_ROOT,
    env: dbCommandEnv,
  });
  commands.dbVerify = {
    ...dbVerify,
    stdout: truncateText(dbVerify.stdout),
    stderr: truncateText(dbVerify.stderr),
  };
  checks.push(
    createCheck({
      id: 'db_verify_command',
      passed: dbVerify.exitCode === 0,
      message: 'pnpm --filter @esl-pipeline/batch-backend db:verify must succeed.',
      details: {
        exitCode: dbVerify.exitCode,
        failedToStart: dbVerify.failedToStart,
      },
    }),
  );

  const schemaProbe = await probeOpsActionsTable({ env: dbCommandEnv });
  commands.opsActionsSchemaProbe = schemaProbe;
  if (schemaProbe.available) {
    checks.push(
      createCheck({
        id: 'ops_actions_table_exists',
        passed: schemaProbe.exists === true,
        message: 'ops_actions table must exist when direct schema probe is available.',
        details: {
          exists: schemaProbe.exists,
        },
      }),
    );
  } else {
    checks.push(
      createCheck({
        id: 'ops_actions_table_probe',
        passed: false,
        severity: 'warning',
        message: `ops_actions schema probe skipped: ${schemaProbe.warning ?? 'unavailable'}`,
      }),
    );
  }

  const summary = summarizeChecks(checks);
  const report = {
    kind: 'telegram_ops_go_live_preflight',
    version: 1,
    generatedAt: new Date().toISOString(),
    profile,
    summary,
    checks,
    commands,
  };

  const artifactPath = await writeJsonArtifact(jsonOutPath, report);
  return {
    report: {
      ...report,
      artifactPath,
    },
    exitCode: summary.passed ? 0 : 1,
  };
}

async function main() {
  let parsedArgs;
  try {
    parsedArgs = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `[telegram-ops-go-live-preflight] error: ${error instanceof Error ? error.message : String(error)}`,
    );
    printUsage();
    process.exit(1);
  }

  const result = await runPreflight(parsedArgs);
  printReport(result.report);
  process.exit(result.exitCode);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(
      `[telegram-ops-go-live-preflight] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
    process.exit(1);
  });
}

export {
  DEFAULT_PROFILE,
  DEFAULT_JSON_OUT,
  parseArgs,
  parseAllowedUserIds,
  evaluateLeaderElectionDbConfig,
  buildBackendPgClientConfig,
};
