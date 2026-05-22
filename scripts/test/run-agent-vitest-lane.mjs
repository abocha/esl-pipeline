#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAgentVitestArtifacts,
  buildAgentVitestLaneSummary,
  buildAgentVitestSummary,
  formatAgentVitestLaneSummary,
  parsePackageTestScript,
  withAgentVitestArgs,
} from './agent-vitest-lib.mjs';

const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const options = parseArgs(process.argv.slice(2));
const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
const runArtifacts = buildAgentVitestArtifacts({
  repoRoot,
  lane: options.lane,
  packageName: 'summary',
  timestamp,
});

mkdirSync(runArtifacts.runDir, { recursive: true });

const env = options.backendDbEnv ? await buildBackendDbEnv() : process.env;
const packages = discoverPackages()
  .filter((pkg) => options.filters.length === 0 || options.filters.includes(pkg.name))
  .filter((pkg) => options.scripts.some((scriptName) => pkg.scripts?.[scriptName]));

if (packages.length === 0) {
  console.error(`vitest ${options.lane} FAIL  0ms`);
  console.error('no matching packages found');
  process.exit(1);
}

const startedMs = Date.now();
const packageResults = [];

for (const pkg of packages) {
  for (const scriptName of options.scripts) {
    if (!pkg.scripts?.[scriptName]) {
      continue;
    }
    packageResults.push(
      await runPackageScript({ pkg, scriptName, env, timestamp, lane: options.lane }),
    );
  }
}

const summary = buildAgentVitestLaneSummary({
  label: options.lane,
  durationMs: Date.now() - startedMs,
  packages: packageResults,
});
writeFileSync(runArtifacts.summaryJson, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

console.log(
  formatAgentVitestLaneSummary(summary, {
    logsDir: relativeArtifactPath(runArtifacts.runDir),
  }),
);

process.exit(packageResults.find((result) => result.exitCode !== 0)?.exitCode ?? 0);

async function runPackageScript({ pkg, scriptName, env, timestamp, lane }) {
  const artifacts = buildAgentVitestArtifacts({
    repoRoot,
    lane,
    packageName: pkg.name,
    timestamp,
  });
  mkdirSync(artifacts.packageDir, { recursive: true });

  let parsed;
  try {
    parsed = parsePackageTestScript({ scripts: pkg.scripts, scriptName });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync(artifacts.rawLog, `${message}\n`, 'utf8');
    return failedPackageResult({ pkg, scriptName, artifacts, message, durationMs: 0 });
  }

  const startedMs = Date.now();
  const prepOutput = [];
  for (const prepCommand of parsed.prepCommands) {
    const prepResult = await runCommand(prepCommand.command, prepCommand.args, {
      cwd: pkg.dir,
      env,
    });
    prepOutput.push(`$ ${prepCommand.display}\n${prepResult.output}`);
    if (prepResult.exitCode !== 0) {
      writeFileSync(artifacts.prepLog, prepOutput.join('\n'), 'utf8');
      writeFileSync(
        artifacts.rawLog,
        'Vitest was not run because a prep command failed.\n',
        'utf8',
      );
      return failedPackageResult({
        pkg,
        scriptName,
        artifacts,
        message:
          firstSignal(prepResult.output) ||
          `${prepCommand.display} exited with code ${prepResult.exitCode}`,
        durationMs: Date.now() - startedMs,
        exitCode: prepResult.exitCode,
        prepFailure: true,
      });
    }
  }

  if (prepOutput.length > 0) {
    writeFileSync(artifacts.prepLog, prepOutput.join('\n'), 'utf8');
  }

  const vitestArgs = withAgentVitestArgs(parsed.vitestCommand.args, artifacts.json);
  const vitestResult = await runCommand(parsed.vitestCommand.command, vitestArgs, {
    cwd: pkg.dir,
    env,
  });
  writeFileSync(artifacts.rawLog, vitestResult.output, 'utf8');

  const durationMs = Date.now() - startedMs;
  let summary;
  try {
    summary = buildAgentVitestSummary({
      command: [parsed.vitestCommand.command, ...parsed.vitestCommand.args],
      cwd: repoRoot,
      durationMs,
      json: JSON.parse(readFileSync(artifacts.json, 'utf8')),
    });
  } catch (error) {
    return failedPackageResult({
      pkg,
      scriptName,
      artifacts,
      message: `unable to read vitest json: ${error instanceof Error ? error.message : String(error)}`,
      durationMs,
      exitCode: vitestResult.exitCode || 1,
    });
  }
  if (vitestResult.exitCode !== 0 && summary.failures.length === 0) {
    summary.failures.push({
      file: '(runner)',
      name: 'vitest command',
      message:
        summary.counts.tests.total === 0
          ? 'Vitest exited nonzero and reported 0 tests for this script.'
          : firstSignal(vitestResult.output) || `vitest exited with code ${vitestResult.exitCode}`,
    });
  }

  return {
    packageName: pkg.name,
    scriptName,
    status: vitestResult.exitCode === 0 && summary.status === 'pass' ? 'pass' : 'fail',
    exitCode: vitestResult.exitCode,
    durationMs,
    summary,
    artifacts: relativeArtifacts(artifacts, { includePrepLog: prepOutput.length > 0 }),
    repro: `pnpm --filter ${pkg.name} run ${scriptName}`,
  };
}

function failedPackageResult({
  pkg,
  scriptName,
  artifacts,
  message,
  durationMs,
  exitCode = 1,
  prepFailure = false,
}) {
  return {
    packageName: pkg.name,
    scriptName,
    status: 'fail',
    exitCode,
    durationMs,
    summary: {
      status: 'fail',
      command: [],
      durationMs,
      counts: {
        tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
        suites: { total: 0, passed: 0, failed: 0, skipped: 0 },
      },
      failures: prepFailure
        ? []
        : [
            {
              file: '(runner)',
              name: 'agent vitest runner',
              message,
            },
          ],
    },
    prepFailure: prepFailure ? { message } : null,
    artifacts: relativeArtifacts(artifacts, { includePrepLog: prepFailure }),
    repro: `pnpm --filter ${pkg.name} run ${scriptName}`,
  };
}

function discoverPackages() {
  const packagesRoot = path.join(repoRoot, 'packages');
  return readdirSync(packagesRoot)
    .map((name) => path.join(packagesRoot, name))
    .filter((pkgDir) => statSync(pkgDir).isDirectory())
    .map((pkgDir) => {
      const packageJsonPath = path.join(pkgDir, 'package.json');
      if (!existsSync(packageJsonPath)) {
        return null;
      }
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      return {
        dir: pkgDir,
        name: packageJson.name,
        scripts: packageJson.scripts ?? {},
      };
    })
    .filter(Boolean);
}

function parseArgs(args) {
  const options = {
    lane: null,
    scripts: [],
    filters: [],
    backendDbEnv: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--lane') {
      options.lane = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--script') {
      options.scripts.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--filter') {
      options.filters.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--backend-db-env') {
      options.backendDbEnv = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.lane || options.scripts.length === 0) {
    throw new Error(
      'Usage: run-agent-vitest-lane.mjs --lane name --script scriptName [--filter package] [--backend-db-env]',
    );
  }
  return options;
}

function runCommand(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const invocation = buildSpawnInvocation(resolvePackageCommand(command, args));
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        resolve({ exitCode: 1, output: `${output}\nProcess exited via signal ${signal}\n` });
        return;
      }
      resolve({ exitCode: code ?? 1, output });
    });
  });
}

function resolvePackageCommand(command, args) {
  if (command === 'pnpm' || command === 'vitest') {
    const commandArgs = command === 'vitest' ? ['exec', 'vitest', ...args] : args;
    const npmExecPath = normalizeEnvValue(process.env.npm_execpath);
    if (npmExecPath) {
      return {
        command: process.execPath,
        args: [npmExecPath, ...commandArgs],
      };
    }
    return {
      command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
      args: commandArgs,
    };
  }

  if (process.platform === 'win32' && !/\.(?:cmd|exe|bat)$/iu.test(command)) {
    return { command: `${command}.cmd`, args };
  }

  return { command, args };
}

function buildSpawnInvocation(invocation) {
  if (process.platform !== 'win32' || invocation.command === process.execPath) {
    return invocation;
  }

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', [invocation.command, ...invocation.args].map(quoteCmdArg).join(' ')],
  };
}

function quoteCmdArg(arg) {
  if (/^[a-zA-Z0-9_./:@%+=,\\-]+$/u.test(arg)) {
    return arg;
  }
  return `"${arg.replace(/(["^&|<>])/gu, '^$1')}"`;
}

async function buildBackendDbEnv() {
  loadEnvFile(path.join(repoRoot, '.env.batch-backend'));

  const pgUrl = normalizeServiceUrl(process.env.BATCH_BACKEND_TEST_PG, {
    protocols: ['postgres:', 'postgresql:'],
    hostFallback: '127.0.0.1',
  });
  if (!pgUrl) {
    throw new Error(
      'BATCH_BACKEND_TEST_PG is required for backend DB checks. Define it in the shell or in .env.batch-backend.',
    );
  }

  const redisCandidate =
    normalizeEnvValue(process.env.BATCH_BACKEND_TEST_REDIS) ||
    (normalizeEnvValue(process.env.REDIS_HOST)
      ? `redis://${process.env.REDIS_HOST.trim()}:${normalizeEnvValue(process.env.REDIS_PORT) || '6379'}`
      : 'redis://127.0.0.1:6379');

  const redisUrl = normalizeServiceUrl(redisCandidate, {
    protocols: ['redis:', 'rediss:'],
    hostFallback: '127.0.0.1',
  });
  if (!redisUrl) {
    throw new Error(
      'BATCH_BACKEND_TEST_REDIS is required for backend DB checks. Define it in the shell or in .env.batch-backend.',
    );
  }

  const pgEndpoint = parseEndpoint(pgUrl, 5432);
  const redisEndpoint = parseEndpoint(redisUrl, 6379);
  await checkPort('Postgres test DB', pgEndpoint.host, pgEndpoint.port);
  await checkPort('Redis test instance', redisEndpoint.host, redisEndpoint.port);

  const tmpRoot = normalizeEnvValue(process.env.TMPDIR) || path.join(repoRoot, 'tmp', 'codex-tmp');
  mkdirSync(tmpRoot, { recursive: true });

  return {
    ...process.env,
    BATCH_BACKEND_TEST_PG: pgUrl,
    BATCH_BACKEND_TEST_REDIS: redisUrl,
    PG_ENABLED: 'true',
    PG_AUTO_MIGRATE_ON_BOOT: 'false',
    PG_CONNECTION_STRING: pgUrl,
    REDIS_ENABLED: 'true',
    REDIS_HOST: redisEndpoint.host,
    REDIS_PORT: String(redisEndpoint.port),
    TMPDIR: tmpRoot,
    TMP: normalizeEnvValue(process.env.TMP) || tmpRoot,
    TEMP: normalizeEnvValue(process.env.TEMP) || tmpRoot,
  };
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const equalsIndex = line.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    if (!key || normalizeEnvValue(process.env[key])) {
      continue;
    }

    process.env[key] = stripWrappingQuotes(line.slice(equalsIndex + 1).trim());
  }
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeServiceUrl(rawValue, { protocols, hostFallback }) {
  const value = normalizeEnvValue(rawValue);
  if (!value) {
    return null;
  }

  const parsed = new URL(value);
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`Expected one of ${protocols.join(', ')} but received ${parsed.protocol}.`);
  }
  if (parsed.hostname === 'postgres' || parsed.hostname === 'redis') {
    parsed.hostname = hostFallback;
  }
  return parsed.toString();
}

function parseEndpoint(urlString, fallbackPort) {
  const parsed = new URL(urlString);
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : fallbackPort;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`${urlString} must resolve to a valid port.`);
  }
  return { host: parsed.hostname, port };
}

function checkPort(label, host, port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(
        new Error(
          `${label} is unreachable at ${host}:${String(port)}. Start the local services first (for example: pnpm docker:up).`,
        ),
      );
    }, 1500);

    socket.on('connect', () => {
      clearTimeout(timeout);
      socket.end();
      resolve();
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `${label} is unreachable at ${host}:${String(port)}: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
  });
}

function normalizeEnvValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstSignal(output) {
  return output
    .replace(ansiEscapePattern, '')
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-12)
    .join('\n');
}

function relativeArtifacts(artifacts, { includePrepLog } = { includePrepLog: false }) {
  return Object.fromEntries(
    Object.entries(artifacts)
      .filter(([key]) => includePrepLog || key !== 'prepLog')
      .map(([key, value]) => [key, relativeArtifactPath(value)]),
  );
}

function relativeArtifactPath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}
