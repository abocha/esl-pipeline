import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const repoRoot = process.cwd();
const envFilePath = path.join(repoRoot, '.env');

function normalizeEnvValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

    const rawValue = line.slice(equalsIndex + 1).trim();
    process.env[key] = stripWrappingQuotes(rawValue);
  }
}

function normalizeServiceUrl(rawValue, { protocols, hostFallback }) {
  const value = normalizeEnvValue(rawValue);
  if (!value) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error(
      `Invalid URL "${value}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

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
  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : fallbackPort,
  };
}

function assertFinitePort(port, label) {
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`${label} must resolve to a valid port. Received "${String(port)}".`);
  }
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

function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} ${args.join(' ')} exited via signal ${signal}.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${String(code)}.`));
        return;
      }
      resolve();
    });
  });
}

function resolvePackageManagerCommand(args) {
  const npmExecPath = normalizeEnvValue(process.env.npm_execpath);
  if (npmExecPath) {
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
    };
  }

  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args,
  };
}

loadEnvFile(envFilePath);

const pgUrl = normalizeServiceUrl(process.env.BATCH_BACKEND_TEST_PG, {
  protocols: ['postgres:', 'postgresql:'],
  hostFallback: '127.0.0.1',
});
if (!pgUrl) {
  throw new Error(
    'BATCH_BACKEND_TEST_PG is required for backend DB checks. Define it in the shell or in .env.',
  );
}

const redisCandidate =
  normalizeEnvValue(process.env.BATCH_BACKEND_TEST_REDIS) ||
  (normalizeEnvValue(process.env.REDIS_HOST)
    ? `redis://${process.env.REDIS_HOST.trim()}:${normalizeEnvValue(process.env.REDIS_PORT) || '6380'}`
    : 'redis://127.0.0.1:6380');

const redisUrl = normalizeServiceUrl(redisCandidate, {
  protocols: ['redis:', 'rediss:'],
  hostFallback: '127.0.0.1',
});
if (!redisUrl) {
  throw new Error(
    'BATCH_BACKEND_TEST_REDIS is required for backend DB checks. Define it in the shell or in .env.',
  );
}

const tmpRoot = normalizeEnvValue(process.env.TMPDIR) || '/tmp/codex-tmp';
mkdirSync(tmpRoot, { recursive: true });
const pgEndpoint = parseEndpoint(pgUrl, 5432);
const redisEndpoint = parseEndpoint(redisUrl, 6380);
assertFinitePort(pgEndpoint.port, 'BATCH_BACKEND_TEST_PG');
assertFinitePort(redisEndpoint.port, 'BATCH_BACKEND_TEST_REDIS');

await checkPort('Postgres test DB', pgEndpoint.host, pgEndpoint.port);
await checkPort('Redis test instance', redisEndpoint.host, redisEndpoint.port);

const commandEnv = {
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

for (const scriptName of ['test:db:migrations', 'test:db:postgres', 'test:integration:worker']) {
  const command = resolvePackageManagerCommand([
    '--filter',
    '@esl-pipeline/batch-backend',
    scriptName,
  ]);
  await runCommand(command.command, command.args, commandEnv);
}
