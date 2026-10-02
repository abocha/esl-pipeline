import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const root = fileURLToPath(new URL('../..', import.meta.url));
const stateDir = path.join(root, 'tmp/product-smoke');
const runningFile = path.join(stateDir, 'running.json');
const stopFile = path.join(stateDir, 'stop');
export const composeArgs = [
  'compose',
  '--project-name',
  'esl-pipeline-smoke',
  '--file',
  'docker-compose.smoke.yml',
];
const backend = '@esl-pipeline/batch-backend';
const smokeAccountEmail = 'smoke@example.test';
const smokeApiOrigin = 'http://127.0.0.1:18080';

// Shadow every local application-env key before its normal non-overriding loader runs.
// Read keys only: ordinary developer credentials and remote service targets never enter smoke.
export function smokeEnv(
  inherited = process.env,
  localFiles = ['.env', '.env.batch-backend'],
  liveKey = '',
) {
  const env = { ...inherited };
  for (const file of ['.env.example', ...localFiles]) {
    const absolute = path.resolve(root, file);
    if (!existsSync(absolute)) continue;
    for (const key of Object.keys(parseEnv(readFileSync(absolute, 'utf8')))) env[key] = '';
  }
  for (const key of Object.keys(env)) {
    if (
      /^(PG_|REDIS_|GEN_|OPENAI_|GEMINI_|OPENROUTER_|ESL_|S3_|AWS_|STORAGE_|MCP_|MAIL_|TELEGRAM_|BATCH_|TRANSCRIBE_|STUDENT_MEMORY_|PROMPT_|JWT_|REFRESH_|FILESYSTEM_|PIPELINE_|SMOKE_|DEEPGRAM_|ELEVENLABS_|GOOGLE_|INWORLD_)/u.test(
        key,
      )
    )
      env[key] = '';
  }
  return {
    ...env,
    NODE_ENV: 'development',
    PG_ENABLED: 'true',
    PG_HOST: '127.0.0.1',
    PG_PORT: '55432',
    PG_USER: 'esl',
    PG_PASSWORD: 'esl',
    PG_DATABASE: 'esl_smoke',
    PG_CONNECTION_STRING: '',
    PG_AUTO_MIGRATE_ON_BOOT: 'false',
    PG_MIGRATIONS_DIR: path.join(root, 'packages/batch-backend/migrations'),
    REDIS_ENABLED: 'true',
    REDIS_HOST: '127.0.0.1',
    REDIS_PORT: '56379',
    REDIS_PASSWORD: '',
    BATCH_BACKEND_HTTP_PORT: '18080',
    BATCH_BACKEND_URL: 'http://127.0.0.1:18080',
    ESL_PIPELINE_CONFIG_PROVIDER: 'local',
    PIPELINE_CWD: root,
    PROMPT_TEMPLATE_PATH:
      'packages/batch-backend/prompt-assets/templates/hw_prompt_assignment_v1.md',
    STORAGE_PROVIDER: 'filesystem',
    FILESYSTEM_UPLOAD_DIR: path.join(stateDir, 'uploads'),
    JWT_SECRET: localJwtSecret(),
    REFRESH_COOKIE_SECURE: 'false',
    MCP_OAUTH_ENABLED: 'false',
    STUDENT_MEMORY_OPENAI_BATCH_ENABLED: 'false',
    OPENAI_API_KEY: liveKey,
    GEMINI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    // The API validates configured STT routes at boot even for text-only use.
    // Invalid placeholders satisfy presence checks; no transcription worker runs.
    ESL_STT_PROVIDER_ELEVENLABS_API_KEY: 'invalid-local-smoke-no-stt',
    ESL_STT_PROVIDER_DEEPGRAM_API_KEY: 'invalid-local-smoke-no-stt',
    GEN_QUOTA_SOURCE_MODE: 'configured',
    GEN_OPENAI_RETRY_MAX: '0',
    // Keep the Create action reachable so it can assemble a fresh prompt package.
    // Without a key, the provider adapter rejects before any network request.
    GEN_OPENAI_DAILY_REQUEST_BUDGET: '1',
    GEN_GOOGLE_DAILY_REQUEST_BUDGET: '0',
    GEN_OPENROUTER_DAILY_REQUEST_BUDGET: '0',
    TMPDIR: stateDir,
  };
}

function localJwtSecret() {
  mkdirSync(stateDir, { recursive: true });
  const secretFile = path.join(stateDir, 'jwt-secret');
  if (!existsSync(secretFile))
    writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  return readFileSync(secretFile, 'utf8');
}

function pnpmArgs(args) {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Direct pnpm smoke helper verifies its launcher outside Turbo tasks.
  const executable = process.env['npm_execpath'];
  if (!executable || !existsSync(executable))
    throw new Error('Run this helper through pnpm smoke:<command>.');
  return [executable, ...args];
}

function run(command, args, env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}

function runCaptured(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}): ${result.stderr.trim()}`);
  return result.stdout;
}

function pnpm(args, env) {
  run(process.execPath, pnpmArgs(args), env);
}
function pnpmCaptured(args, env) {
  return runCaptured(process.execPath, pnpmArgs(args), env);
}
function compose(args) {
  run('docker', [...composeArgs, ...args], {
    ...process.env,
    COMPOSE_PROJECT_NAME: 'esl-pipeline-smoke',
  });
}

export function buildFingerprint(base = root) {
  const hash = createHash('sha256').update(process.version);
  function add(relative) {
    const absolute = path.join(base, relative);
    hash.update(relative).update(readFileSync(absolute));
  }
  function walk(relative) {
    for (const entry of readdirSync(path.join(base, relative), { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (['node_modules', 'dist', 'tests', 'fixtures', '.turbo'].includes(entry.name)) continue;
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (/\.(ts|json|js|mjs)$/u.test(entry.name)) add(next);
    }
  }
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
  ])
    add(file);
  for (const entry of readdirSync(path.join(base, 'packages'), { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.isDirectory() && !['batch-backend', 'batch-frontend'].includes(entry.name))
      walk(path.join('packages', entry.name));
  }
  return hash.digest('hex');
}

function prepare(env, force = false) {
  if (!existsSync(path.join(root, 'node_modules/.modules.yaml')))
    throw new Error('Dependencies missing. Run pnpm install --frozen-lockfile once, then retry.');
  const fingerprint = buildFingerprint();
  const stamp = path.join(stateDir, 'build-inputs');
  if (
    force ||
    !existsSync(stamp) ||
    readFileSync(stamp, 'utf8') !== fingerprint ||
    !existsSync(path.join(root, 'packages/contracts/dist/index.js'))
  ) {
    pnpm(
      ['--filter', `${backend}^...`, '--filter', '@esl-pipeline/batch-frontend^...', 'build'],
      env,
    );
    writeFileSync(stamp, fingerprint);
  } else console.log('Reusing workspace dependency builds (inputs unchanged).');
}

function active() {
  if (!existsSync(runningFile)) return false;
  const { pid } = JSON.parse(readFileSync(runningFile, 'utf8'));
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function assertAccountBootstrapReady(running, hostServicesActive) {
  if (!hostServicesActive || !running)
    throw new Error('Run pnpm smoke:start in default mode before bootstrapping a smoke account.');
  if (running.live)
    throw new Error('Account bootstrap requires the default no-provider smoke mode.');
}

async function bootstrapAccount() {
  let running;
  if (existsSync(runningFile)) running = JSON.parse(readFileSync(runningFile, 'utf8'));
  assertAccountBootstrapReady(running, active());

  const health = await fetch(`${smokeApiOrigin}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!health.ok) throw new Error(`Smoke API health check failed (HTTP ${health.status}).`);

  const env = smokeEnv();
  const inviteArgs = [
    '--filter',
    backend,
    'exec',
    'tsx',
    '--tsconfig',
    'tsconfig.json',
    'src/tools/alpha-invites.ts',
    'create',
    '--email',
    smokeAccountEmail,
    '--app-url',
    'http://127.0.0.1:15173',
  ];
  const inviteOutput = pnpmCaptured(inviteArgs, env);
  const inviteToken = inviteOutput.match(/^Token: (\S+)$/mu)?.[1];
  if (!inviteToken) throw new Error('Smoke invite tool did not return its one-time token.');

  const password = randomBytes(24).toString('base64url');
  let registrationSucceeded = false;
  try {
    const registration = await fetch(`${smokeApiOrigin}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: smokeAccountEmail, password, inviteToken }),
      signal: AbortSignal.timeout(10000),
    });
    const registrationBody = await registration.text();
    if (registration.status !== 201) {
      let message = '';
      try {
        message = JSON.parse(registrationBody).message ?? '';
      } catch {
        // Keep unexpected response bodies out of the terminal.
      }
      throw new Error(
        `Smoke account registration failed (HTTP ${registration.status})${message ? `: ${message}` : '.'}`,
      );
    }
    registrationSucceeded = true;

    const login = await fetch(`${smokeApiOrigin}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: smokeAccountEmail, password }),
      signal: AbortSignal.timeout(10000),
    });
    await login.arrayBuffer();
    if (!login.ok)
      throw new Error(
        `Smoke account was created, but the normal login check failed (HTTP ${login.status}).`,
      );
  } catch (error) {
    if (!registrationSucceeded) {
      try {
        pnpmCaptured(
          [
            '--filter',
            backend,
            'exec',
            'tsx',
            '--tsconfig',
            'tsconfig.json',
            'src/tools/alpha-invites.ts',
            'revoke',
            '--email',
            smokeAccountEmail,
          ],
          env,
        );
      } catch {
        console.error('Could not revoke the unused smoke invite; inspect smoke invite state.');
      }
    }
    throw error;
  }

  console.log('Smoke account created through invite-only registration; normal login verified.');
  console.log(`Email: ${smokeAccountEmail}`);
  console.log(`Local test password (shown once): ${password}`);
  console.log('Open http://127.0.0.1:15173 and sign in.');
}

async function portFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () =>
      reject(new Error(`Port ${port} is occupied; stop its owner before smoke:start.`)),
    );
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}

async function stop() {
  if (active()) {
    writeFileSync(stopFile, 'stop');
    for (let attempt = 0; attempt < 150 && active(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 200));
    if (active())
      throw new Error(
        'Smoke processes have not stopped; infrastructure was preserved. Inspect the start terminal.',
      );
  }
  compose(['down']);
}

async function start(live) {
  if (active()) throw new Error('Smoke is already running. Use pnpm smoke:status or smoke:stop.');
  await portFree(18080);
  await portFree(15173);
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Explicit foreground smoke credential is intentionally shell-scoped and outside Turbo caching.
  const key = live ? process.env['SMOKE_OPENAI_API_KEY']?.trim() : '';
  if (live && !key)
    throw new Error('Explicit live mode requires SMOKE_OPENAI_API_KEY in this shell.');
  const env = smokeEnv(process.env, undefined, key);
  prepare(env);
  compose(['up', '-d', '--wait', '--wait-timeout', '120']);
  pnpm(['--filter', backend, 'db:migrate'], env);
  pnpm(['--filter', backend, 'prompt-assets:bootstrap'], env);
  rmSync(stopFile, { force: true });
  writeFileSync(
    runningFile,
    JSON.stringify({ pid: process.pid, live, startedAt: new Date().toISOString() }),
  );
  const services = [
    ['api', ['--filter', backend, 'dev:api']],
    // Live mode runs only an intentional foreground draft call; no paid background enrichment.
    ...(!live ? [['memory', ['--filter', backend, 'dev:student-memory-worker']]] : []),
    [
      'frontend',
      ['--filter', '@esl-pipeline/batch-frontend', 'dev', '--host', '127.0.0.1', '--port', '15173'],
    ],
  ];
  const children = services.map(([name, args]) => {
    console.log(`Starting ${name}`);
    return spawn(process.execPath, pnpmArgs(args), {
      cwd: root,
      env,
      stdio: 'inherit',
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
  });
  let closing = false;
  async function finish(code = 0) {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    for (const child of children) {
      if (child.exitCode !== null || !child.pid) continue;
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      else process.kill(-child.pid, 'SIGTERM');
    }
    await Promise.all(
      children.map((child) =>
        child.exitCode !== null ? undefined : new Promise((resolve) => child.once('exit', resolve)),
      ),
    );
    rmSync(runningFile, { force: true });
    rmSync(stopFile, { force: true });
    console.log(
      'Host smoke services stopped; infrastructure/state preserved. pnpm smoke:stop stops Docker too.',
    );
    process.exitCode = code;
  }
  const timer = setInterval(() => {
    if (existsSync(stopFile)) void finish();
  }, 200);
  for (const child of children) {
    child.once('error', (error) => {
      console.error(error);
      void finish(1);
    });
    child.once('exit', (code) => {
      if (!closing) void finish(code || 1);
    });
  }
  process.once('SIGINT', () => void finish());
  process.once('SIGTERM', () => void finish());
  console.log('Waiting for frontend and API health...');
  for (let attempt = 0; attempt < 90 && !closing; attempt++) {
    try {
      const responses = await Promise.all(
        ['http://127.0.0.1:15173', 'http://127.0.0.1:18080/health'].map((url) =>
          fetch(url, { signal: AbortSignal.timeout(1000) }),
        ),
      );
      if (responses.every((response) => response.ok)) {
        console.log(
          `Smoke READY: http://127.0.0.1:15173 | API: http://127.0.0.1:18080 | ${live ? 'LIVE: one daily foreground OpenAI request, no memory worker' : 'NO LIVE PROVIDER CREDENTIALS / NO SPEND'}`,
        );
        return;
      }
    } catch {
      /* Services are still starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!closing) {
    console.error('Smoke readiness timed out; inspect startup errors above.');
    await finish(1);
  }
}

async function main() {
  mkdirSync(stateDir, { recursive: true });
  const [command, ...flags] = process.argv.slice(2);
  if (flags.some((flag) => !['--live', '--fresh-state'].includes(flag)))
    throw new Error('Unknown smoke option.');
  switch (command) {
    case 'start':
      await start(flags.includes('--live'));
      break;
    case 'prepare':
      prepare(smokeEnv(), true);
      break;
    case 'invite':
      pnpm(
        [
          '--filter',
          backend,
          'exec',
          'tsx',
          '--tsconfig',
          'tsconfig.json',
          'src/tools/alpha-invites.ts',
          'create',
          '--email',
          'smoke@example.test',
          '--app-url',
          'http://127.0.0.1:15173',
        ],
        smokeEnv(),
      );
      break;
    case 'bootstrap-account':
      await bootstrapAccount();
      break;
    case 'stop':
      await stop();
      break;
    case 'status':
      console.log(active() ? readFileSync(runningFile, 'utf8') : 'Host smoke services stopped.');
      compose(['ps']);
      for (const [name, url] of [
        ['frontend', 'http://127.0.0.1:15173'],
        ['api', 'http://127.0.0.1:18080/health'],
      ]) {
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
          console.log(`${name}: HTTP ${response.status}`);
        } catch {
          console.log(`${name}: unreachable`);
        }
      }
      break;
    case 'reset':
      if (!flags.includes('--fresh-state'))
        throw new Error(
          'Reset destroys only smoke DB/Redis/uploads. Use pnpm smoke:reset --fresh-state deliberately.',
        );
      await stop();
      compose(['down', '--volumes']);
      // Fixed workspace-owned target, never derived from user input or environment.
      rmSync(path.join(stateDir, 'uploads'), { recursive: true, force: true });
      console.log('Smoke state removed. pnpm smoke:start initializes current schema and prompts.');
      break;
    default:
      throw new Error('Use pnpm smoke:start|stop|status|reset|prepare|invite|bootstrap-account.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
