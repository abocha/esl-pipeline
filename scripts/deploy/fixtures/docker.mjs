#!/usr/bin/env node
// Strict disposable CLI double for the host deploy-script tests. No network or daemon access.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

// biome-ignore lint/suspicious/noUndeclaredEnvVars: fixture-only input, outside Turbo tasks.
const directory = process.env.DEPLOY_TEST_DIR;
const args = process.argv.slice(2);
const scenario = JSON.parse(readFileSync(`${directory}/scenario.json`, 'utf8'));
const runningFile = `${directory}/running.json`;
let running = JSON.parse(readFileSync(runningFile, 'utf8'));
appendFileSync(`${directory}/events.jsonl`, `${JSON.stringify(args)}\n`);
const output = (value) => console.log(value);
const fail = () => process.exit(1);
const workers = ['batch-worker', 'transcribe-worker', 'student-memory-worker'];
const commands = {
  'batch-worker': 'dist/transport/worker-runner.js',
  'transcribe-worker': 'dist/transport/transcribe-worker.js',
  'student-memory-worker': 'dist/transport/student-memory-worker.js',
};

if (args[0] === 'info') output(args.includes('--format') ? directory : 'docker healthy');
else if (args[0] === 'pull') {
  output('fixture layer: Pull complete');
  if (scenario.pullFail) {
    console.error('fixture registry unavailable');
    process.exit(17);
  }
} else if (args[0] === 'image') process.exit(0);
else if (args[0] === 'buildx') output(JSON.stringify({ digest: `sha256:${'b'.repeat(64)}` }));
else if (args[0] === 'run') {
  output(
    readFileSync(
      `${directory}/${args.includes(scenario.previousImage) ? 'previous' : 'requested'}.json`,
      'utf8',
    ),
  );
} else if (args[0] === 'ps') {
  const botOnly = args.some((x) => x.includes('service=telegram-ops-bot'));
  if (
    !botOnly &&
    (scenario.psFail || (scenario.psFailAfterStop && !running.includes('batch-backend')))
  )
    fail();
  output(running.filter((x) => !botOnly || x === 'telegram-ops-bot').join('\n'));
} else if (args[0] === 'stop') {
  if (scenario.stopFail) fail();
  if (!scenario.stillRunning) {
    running = running.filter((x) => !args.includes(x));
    writeFileSync(runningFile, JSON.stringify(running));
  }
} else if (args[0] === 'inspect') {
  const format = args[2];
  const id = args.at(-1);
  if (scenario.inspectFail && args[1] === '-f' && format.includes('com.docker.compose.service'))
    fail();
  if (args[1] !== '-f') {
    output(
      JSON.stringify(
        args.slice(1).map((service) => ({
          Id: service,
          Config: { Hostname: service, Env: [], Labels: { 'com.docker.compose.service': service } },
          State: {
            Running: running.includes(service),
            Paused: false,
            StartedAt: '2026-01-01T00:00:00Z',
          },
        })),
      ),
    );
  } else if (format.includes('com.docker.compose.service')) output(id);
  else if (format.includes('.State.Running')) output(String(running.includes(id)));
  else if (format.includes('.State.Health')) output('healthy');
  else if (format.includes('.Config.Cmd')) output(`node ${commands[id]}`);
  else throw new Error(`Unexpected inspect: ${args}`);
} else if (args[0] === 'logs') {
  const service = args.at(-1);
  output(
    JSON.stringify({
      event: 'worker_ready',
      service,
      queue: ['esl-jobs', 'transcribe-queue', 'student-memory-queue'][workers.indexOf(service)],
      timestamp: '2026-01-01T00:01:00Z',
      instance: { hostname: service, pid: 1, startupId: 'test' },
    }),
  );
} else if (args[0] === 'compose') {
  const commandIndex = args.findIndex((x) =>
    ['config', 'ps', 'exec', 'run', 'up', 'logs'].includes(x),
  );
  const command = args[commandIndex];
  const tail = args.slice(commandIndex + 1);
  if (command === 'config') {
    if (tail.includes('json'))
      output(
        JSON.stringify({
          services: {
            'batch-backend': { environment: { PG_MIGRATIONS_DIR: scenario.migrationsDir || '' } },
          },
        }),
      );
  } else if (command === 'logs') process.exit(0);
  else if (command === 'ps')
    output(
      tail
        .slice(1)
        .filter((x) => running.includes(x))
        .join('\n'),
    );
  else if (command === 'exec' && tail[1] === 'postgres')
    output(readFileSync(`${directory}/applied.json`, 'utf8'));
  else if (command === 'run') {
    if (tail.includes('caddy-edge') && tail.includes('validate')) {
      output('fixture Caddy routine lifecycle chatter');
      if (scenario.caddyWarning) console.error('WARN caddyfile fixture nonfatal warning');
    }
    if (tail.includes('migrate') && scenario.migrationFail) fail();
    if (tail.includes('dist/tools/validate-env.js') && scenario.environmentFail) fail();
    if (tail.includes('caddy-edge') && tail.includes('validate') && scenario.caddyValidationFail)
      fail();
  } else if (command === 'exec') {
    if (tail.at(-1) === 'verify' && scenario.verifyFail) fail();
    if (tail.includes('caddy-edge') && tail.includes('cat'))
      output('reverse_proxy batch-frontend:8080');
  } else if (command === 'up') {
    if (scenario.upFail) fail();
    running = [
      ...new Set([
        ...running,
        ...tail.filter(
          (x) => commands[x] || ['batch-backend', 'batch-frontend', 'telegram-ops-bot'].includes(x),
        ),
      ]),
    ];
    writeFileSync(runningFile, JSON.stringify(running));
  } else throw new Error(`Unexpected compose command: ${args}`);
} else throw new Error(`Unexpected Docker command: ${args}`);
