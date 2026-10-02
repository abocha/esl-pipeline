import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectApplicationObservation,
  collectDockerObservation,
  collectMemoryObservation,
  composeIssues,
  hostHealthConfig,
  runHostRuntimeHealthAlert,
} from './host-runtime-health-alert.mjs';
import { QUEUE_GRACE_MS } from './worker-queue-observation.mjs';

const checkedAtUtc = '2026-10-01T00:00:00.000Z';

function healthyObservation(env = { CADDY_PUBLIC_HOSTNAME: 'production.example.test' }) {
  const expectedServices = hostHealthConfig(env).expectedServices;
  return {
    queues: { ok: true, queues: [] },
    checkedAtUtc,
    docker: {
      ok: true,
      dockerRoot: '/var/lib/docker',
      containers: expectedServices.map((service) => ({
        id: `container-${service}`,
        service,
        status: 'running',
        health: ['postgres', 'redis', 'batch-backend'].includes(service) ? 'healthy' : 'none',
        restartCount: 0,
      })),
    },
    filesystems: [
      {
        paths: ['application checkout', 'Docker data', 'operations state'],
        availableMb: 8192,
        freeInodesPercent: 50,
      },
    ],
    filesystemErrors: [],
    memory: {
      ok: true,
      totalMb: 2048,
      availableMb: 900,
      availablePercent: 43.9,
      psi: {
        some: { avg10: 0, avg60: 0, avg300: 0 },
        full: { avg10: 0, avg60: 0, avg300: 0 },
        cpuSome: { avg10: 0, avg60: 0, avg300: 0 },
      },
    },
    application: {
      ok: true,
      checks: [
        { name: 'root', statusCode: 200, ok: true },
        { name: 'apiHealth', statusCode: 200, ok: true },
      ],
    },
  };
}

test('host health is green for running critical services and healthy host/public-route fixtures', () => {
  const config = hostHealthConfig({ CADDY_PUBLIC_HOSTNAME: 'production.example.test' });
  const evaluated = composeIssues(healthyObservation(), config, {}, 1_790_000_000);
  assert.equal(evaluated.status.overall.state, 'healthy');
  assert.deepEqual(evaluated.status.components.containerRuntime.expectedServices, [
    'postgres',
    'redis',
    'batch-backend',
    'batch-frontend',
    'batch-worker',
    'transcribe-worker',
    'student-memory-worker',
    'caddy-edge',
  ]);
});

test('queue history persists despite notification failure, observation failure and container recreation', async () => {
  let state = {};
  let time = 1_790_000_000_000;
  const observation = healthyObservation();
  observation.queues = {
    ok: true,
    queues: [
      {
        service: 'batch-worker',
        queue: 'esl-jobs',
        consumers: [],
        waiting: 1,
        prioritized: 0,
        overdueDelayed: 0,
        active: 0,
        delayed: 0,
        paused: false,
        cursorPresent: false,
        lastId: '0-0',
        entriesAdded: 0,
        events: [],
      },
    ],
  };
  const run = () =>
    runHostRuntimeHealthAlert({
      previousState: state,
      env: {},
      dependencies: {
        now: () => new Date(time),
        collectObservation: () => observation,
        writeState: (_file, value) => {
          state = value;
        },
        sendTelegram: async () => ({ result: 'failed' }),
      },
    });
  await run();
  assert.equal(state.queueHistory['esl-jobs'].backlogSince, time);
  observation.queues.ok = false;
  time += QUEUE_GRACE_MS / 2;
  await run();
  observation.docker.containers.find((container) => container.service === 'batch-worker').id =
    'recreated';
  observation.queues.ok = true;
  time += QUEUE_GRACE_MS / 2;
  const expired = await run();
  assert.equal(expired.components.workerQueues.state, 'critical');
  assert.equal(state.queueHistory['esl-jobs'].backlogSince, time - QUEUE_GRACE_MS);
  assert.equal(expired.alert.pending, true);
});

test('missing/unhealthy services, failed public checks, and exhausted disk are critical', () => {
  const observation = healthyObservation();
  observation.docker.containers = observation.docker.containers.filter(
    (container) => container.service !== 'transcribe-worker',
  );
  observation.docker.containers.find((container) => container.service === 'postgres').health =
    'unhealthy';
  observation.filesystems[0].availableMb = 1500;
  observation.filesystems[0].freeInodesPercent = 3;
  observation.application = {
    ok: false,
    errors: ['apiHealth: HTTP 503'],
    checks: [{ name: 'apiHealth', statusCode: 503, ok: false }],
  };
  const result = composeIssues(
    observation,
    hostHealthConfig({ CADDY_PUBLIC_HOSTNAME: 'production.example.test' }),
    {},
    1_790_000_000,
  );
  assert.equal(result.status.overall.state, 'critical');
  assert.match(
    result.status.components.containerRuntime.reasons.join(' '),
    /transcribe-worker.*no container/u,
  );
  assert.match(result.status.components.containerRuntime.reasons.join(' '), /postgres.*unhealthy/u);
  assert.match(result.status.components.disk.reasons.join(' '), /1500 MiB/u);
  assert.match(result.status.components.disk.reasons.join(' '), /3\.0% free inodes/u);
  assert.match(result.status.components.applicationReachability.reasons.join(' '), /HTTP 503/u);
});

test('memory and CPU PSI report meaningful resource pressure at configured boundaries', () => {
  const observation = healthyObservation();
  observation.memory.availablePercent = 12;
  observation.memory.psi.some.avg60 = 11;
  observation.memory.psi.full.avg60 = 1.1;
  observation.memory.psi.cpuSome.avg60 = 45;
  const result = composeIssues(
    observation,
    hostHealthConfig({ CADDY_PUBLIC_HOSTNAME: 'production.example.test' }),
    {},
    1_790_000_000,
  );
  assert.equal(result.status.components.memory.state, 'critical');
  assert.equal(result.status.components.cpuPressure.state, 'degraded');
  assert.equal(result.status.overall.state, 'critical');
});

test('MemAvailable remains monitored when kernel PSI is unavailable', () => {
  const observation = healthyObservation();
  observation.memory.availablePercent = 7;
  observation.memory.psi = { some: null, full: null, cpuSome: null };
  const result = composeIssues(
    observation,
    hostHealthConfig({ CADDY_PUBLIC_HOSTNAME: 'production.example.test' }),
    {},
    1_790_000_000,
  );
  assert.equal(result.status.components.memory.state, 'critical');
  assert.equal(result.status.components.cpuPressure.state, 'degraded');
});

test('a rising restart count is degraded for the stability window; a new container ID is a baseline', () => {
  const observation = healthyObservation();
  const worker = observation.docker.containers.find(
    (container) => container.service === 'batch-worker',
  );
  worker.restartCount = 2;
  const previous = {
    lastDockerRestartCounts: { 'batch-worker:container-batch-worker': 1 },
  };
  const config = hostHealthConfig({ CADDY_PUBLIC_HOSTNAME: 'production.example.test' });
  const withRestart = composeIssues(observation, config, previous, 1_790_000_000);
  assert.equal(withRestart.status.components.containerRuntime.state, 'degraded');
  assert.deepEqual(withRestart.status.components.containerRuntime.restartEvents, [
    { service: 'batch-worker', delta: 1, previousCount: 1, currentCount: 2 },
  ]);

  worker.id = 'replacement-container';
  const afterRecreate = composeIssues(observation, config, previous, 1_790_000_001);
  assert.equal(afterRecreate.status.overall.state, 'healthy');
  assert.deepEqual(afterRecreate.status.components.containerRuntime.restartEvents, []);
});

test('Docker collection parses a fixture and never needs a live daemon in the test', () => {
  const calls = [];
  const container = {
    Id: 'abc123',
    RestartCount: 3,
    Config: { Labels: { 'com.docker.compose.service': 'batch-worker' } },
    State: { Status: 'running' },
  };
  const result = collectDockerObservation(
    {},
    {
      execFileSync(_command, args, options) {
        calls.push({ args, timeout: options.timeout });
        if (args[0] === 'ps') return 'abc123\n';
        if (args[0] === 'inspect') return JSON.stringify([container]);
        if (args[0] === 'info') return '/var/lib/docker\n';
        throw new Error(`unexpected Docker args: ${args.join(' ')}`);
      },
    },
  );
  assert.deepEqual(
    calls.map(({ args }) => args[0]),
    ['ps', 'inspect', 'info'],
  );
  assert.deepEqual(
    calls.map(({ timeout }) => timeout),
    [10_000, 10_000, 10_000],
  );
  assert.deepEqual(result, {
    ok: true,
    dockerRoot: '/var/lib/docker',
    containers: [
      { id: 'abc123', service: 'batch-worker', status: 'running', health: 'none', restartCount: 3 },
    ],
  });

  const unavailable = collectDockerObservation(
    {},
    {
      execFileSync() {
        throw new Error('Docker daemon fixture is unavailable');
      },
    },
  );
  assert.equal(unavailable.ok, false);
  assert.match(unavailable.error, /Docker daemon fixture/u);
});

test('Docker command timeout is bounded and enters the Docker-unavailable observation path', () => {
  const result = collectDockerObservation(
    {},
    {
      execFileSync(_command, _args, options) {
        assert.equal(options.timeout, 10_000);
        const error = new Error('spawnSync docker ETIMEDOUT');
        error.code = 'ETIMEDOUT';
        throw error;
      },
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /ETIMEDOUT/u);
});

test('runner evaluates filesystem collector errors and missing required paths without parent fallback', async (t) => {
  const hostRoot = mkdtempSync(path.join(tmpdir(), 'esl-host-runtime-health-'));
  t.after(() => rmSync(hostRoot, { recursive: true, force: true }));

  const missingCheckout = path.join(hostRoot, 'missing-checkout');
  const env = {
    CADDY_PUBLIC_HOSTNAME: 'production.example.test',
    ESL_HOST_HEALTH_CHECKOUT: missingCheckout,
    ESL_HOST_HEALTH_STATE_DIR: hostRoot,
    ESL_HOST_HEALTH_ALERT_STATE_FILE: path.join(hostRoot, 'state.json'),
  };
  let persistedState;
  const messages = [];
  const result = await runHostRuntimeHealthAlert({
    env,
    dependencies: {
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      collectDocker(currentEnv) {
        return {
          ok: true,
          dockerRoot: hostRoot,
          containers: hostHealthConfig(currentEnv).expectedServices.map((service) => ({
            id: `container-${service}`,
            service,
            status: 'running',
            health: ['postgres', 'redis', 'batch-backend'].includes(service) ? 'healthy' : 'none',
            restartCount: 0,
          })),
        };
      },
      collectMemory: () => healthyObservation().memory,
      collectApplication: async () => ({
        ok: true,
        checks: [
          { name: 'root', statusCode: 200, ok: true },
          { name: 'apiHealth', statusCode: 200, ok: true },
        ],
      }),
      sendTelegram(message) {
        messages.push(message);
        return { configured: true, result: 'sent' };
      },
      writeState(_file, state) {
        persistedState = structuredClone(state);
      },
    },
  });

  assert.equal(result.overall.state, 'degraded');
  assert.ok(
    result.components.disk.reasons.some((reason) =>
      reason.includes(
        `application checkout filesystem could not be inspected at ${missingCheckout}: configured path does not exist`,
      ),
    ),
  );
  assert.equal(
    result.components.disk.filesystems.some((filesystem) =>
      filesystem.paths.includes('application checkout'),
    ),
    false,
  );
  assert.equal(result.alert.kind, 'failure');
  assert.equal(messages.length, 1);
  assert.equal(persistedState.lastState, 'degraded');
});

test('application collection checks the public frontend and API health route with bounded GETs', async () => {
  const calls = [];
  const config = hostHealthConfig({
    CADDY_PUBLIC_HOSTNAME: 'production.example.test',
    ESL_HOST_HEALTH_HTTP_TIMEOUT_MS: '20',
  });
  const result = await collectApplicationObservation(
    {
      root: 'https://production.example.test/',
      apiHealth: 'https://production.example.test/api/health',
    },
    config,
    {
      fetch(url, options) {
        calls.push({ url, options });
        return Promise.resolve({
          status: 200,
          ok: true,
          async json() {
            return { ok: true };
          },
        });
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map(({ url, options }) => ({
      url,
      method: options.method,
      redirect: options.redirect,
      hasAbortSignal: options.signal instanceof AbortSignal,
    })),
    [
      {
        url: 'https://production.example.test/',
        method: 'GET',
        redirect: 'error',
        hasAbortSignal: true,
      },
      {
        url: 'https://production.example.test/api/health',
        method: 'GET',
        redirect: 'error',
        hasAbortSignal: true,
      },
    ],
  );
  assert.equal(result.checks.length, 2);
});

test('application collection reports API health rejection and request timeout as failures', async () => {
  const config = hostHealthConfig({ ESL_HOST_HEALTH_HTTP_TIMEOUT_MS: '10' });
  const failedApi = await collectApplicationObservation(
    {
      root: 'https://production.example.test/',
      apiHealth: 'https://production.example.test/api/health',
    },
    config,
    {
      async fetch(url) {
        return url.endsWith('/api/health')
          ? {
              status: 200,
              ok: true,
              async json() {
                return { ok: false };
              },
            }
          : { status: 200, ok: true };
      },
    },
  );
  assert.equal(failedApi.ok, false);
  assert.deepEqual(failedApi.errors, ['apiHealth: health payload did not report ok: true']);

  const timedOut = await collectApplicationObservation(
    {
      root: 'https://production.example.test/',
      apiHealth: 'https://production.example.test/api/health',
    },
    config,
    {
      fetch(_url, { signal }) {
        return new Promise((resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    },
  );
  assert.equal(timedOut.ok, false);
  assert.deepEqual(timedOut.errors, [
    'root: request failed or timed out',
    'apiHealth: request failed or timed out',
  ]);
});

test('memory collection parses host available memory and PSI from fixture files', () => {
  const fixtures = new Map([
    [
      path.join('/fixture/proc', 'meminfo'),
      'MemTotal:       2097152 kB\nMemAvailable:   786432 kB\n',
    ],
    [
      path.join('/fixture/proc', 'pressure', 'memory'),
      'some avg10=0.25 avg60=1.50 avg300=2.75 total=100000\nfull avg10=0.00 avg60=0.50 avg300=1.00 total=10000\n',
    ],
    [
      path.join('/fixture/proc', 'pressure', 'cpu'),
      'some avg10=3.00 avg60=4.50 avg300=5.25 total=90000\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n',
    ],
  ]);
  const observation = collectMemoryObservation(
    { ESL_HOST_HEALTH_PROC_ROOT: path.join('/fixture', 'proc') },
    {
      readFileSync(file) {
        if (!fixtures.has(file)) throw new Error(`missing fixture ${file}`);
        return fixtures.get(file);
      },
    },
  );

  assert.deepEqual(observation, {
    ok: true,
    totalMb: 2048,
    availableMb: 768,
    availablePercent: 37.5,
    psi: {
      some: { avg10: 0.25, avg60: 1.5, avg300: 2.75 },
      full: { avg10: 0, avg60: 0.5, avg300: 1 },
      cpuSome: { avg10: 3, avg60: 4.5, avg300: 5.25 },
    },
    psiError: '',
  });
});

test('failed Telegram delivery preserves failure/recovery transitions for retry', async () => {
  const env = {
    CADDY_PUBLIC_HOSTNAME: 'production.example.test',
    ESL_HOST_HEALTH_ALERT_STATE_FILE: '/unused/state.json',
    PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN: 'test-token',
    PG_BACKUP_ALERT_TELEGRAM_CHAT_ID: 'test-chat',
  };
  let storedState = {};
  let currentObservation = healthyObservation();
  let now = new Date('2026-10-01T00:00:00.000Z');
  let failDelivery = false;
  const messages = [];
  const dependencies = {
    now: () => now,
    collectObservation: async () => structuredClone(currentObservation),
    readFileSync: () => JSON.stringify(storedState),
    writeState(_file, state) {
      storedState = structuredClone(state);
    },
    sendTelegram(message) {
      messages.push(message);
      return failDelivery
        ? { configured: true, result: 'failed', error: 'offline fake delivery failure' }
        : { configured: true, result: 'sent' };
    },
  };

  await runHostRuntimeHealthAlert({ env, dependencies });
  assert.equal(storedState.lastState, 'healthy');
  assert.equal(messages.length, 0);

  currentObservation.docker.containers.find(
    (container) => container.service === 'batch-worker',
  ).restartCount = 1;
  now = new Date('2026-10-01T00:05:00.000Z');
  failDelivery = true;
  const failedAlert = await runHostRuntimeHealthAlert({ env, dependencies });
  assert.equal(failedAlert.overall.state, 'degraded');
  assert.equal(failedAlert.alert.pending, true);
  assert.equal(storedState.lastState, 'healthy');

  failDelivery = false;
  now = new Date('2026-10-01T00:10:00.000Z');
  const retry = await runHostRuntimeHealthAlert({ env, dependencies });
  assert.equal(retry.alert.kind, 'failure');
  assert.equal(retry.alert.delivery, 'sent');
  assert.equal(storedState.lastState, 'degraded');
  assert.equal(messages.length, 2);

  now = new Date('2026-10-01T00:36:00.000Z');
  const recovery = await runHostRuntimeHealthAlert({ env, dependencies });
  assert.equal(recovery.overall.state, 'healthy');
  assert.equal(recovery.alert.kind, 'recovery');
  assert.equal(recovery.alert.delivery, 'sent');
  assert.equal(storedState.lastState, 'healthy');
  assert.equal(messages.length, 3);
});

test('corrupt persisted state restores cooldown eligibility and is normalized before persistence', async () => {
  const env = {
    CADDY_PUBLIC_HOSTNAME: 'production.example.test',
    ESL_HOST_HEALTH_ALERT_STATE_FILE: '/unused/state.json',
  };
  const criticalObservation = healthyObservation();
  criticalObservation.docker.containers.find(
    (container) => container.service === 'postgres',
  ).health = 'unhealthy';
  let storedState = {
    lastState: 'critical',
    lastSeverity: 99,
    lastSentEpoch: 'invalid',
  };
  let now = new Date('2026-10-01T00:00:00.000Z');
  let failDelivery = true;
  let sendCount = 0;
  const dependencies = {
    now: () => now,
    collectObservation: async () => structuredClone(criticalObservation),
    readFileSync: () => JSON.stringify(storedState),
    writeState(_file, state) {
      storedState = structuredClone(state);
    },
    sendTelegram() {
      sendCount += 1;
      return failDelivery
        ? { configured: true, result: 'failed', error: 'offline fake delivery failure' }
        : { configured: true, result: 'sent' };
    },
  };

  const failedRepeat = await runHostRuntimeHealthAlert({ env, dependencies });
  assert.equal(failedRepeat.alert.kind, 'cooldown-repeat');
  assert.equal(failedRepeat.alert.pending, true);
  assert.deepEqual(
    {
      lastState: storedState.lastState,
      lastSeverity: storedState.lastSeverity,
      lastSentEpoch: storedState.lastSentEpoch,
    },
    { lastState: 'critical', lastSeverity: 2, lastSentEpoch: 0 },
  );

  failDelivery = false;
  now = new Date('2026-10-01T00:05:00.000Z');
  const retriedRepeat = await runHostRuntimeHealthAlert({ env, dependencies });
  assert.equal(retriedRepeat.alert.kind, 'cooldown-repeat');
  assert.equal(retriedRepeat.alert.delivery, 'sent');
  assert.equal(storedState.lastSeverity, 2);
  assert.equal(storedState.lastSentEpoch, Math.floor(now.getTime() / 1000));
  assert.equal(sendCount, 2);
});

test('unsupported persisted alert state resets to a failure-eligible baseline', async () => {
  const env = {
    CADDY_PUBLIC_HOSTNAME: 'production.example.test',
    ESL_HOST_HEALTH_ALERT_STATE_FILE: '/unused/state.json',
  };
  const criticalObservation = healthyObservation();
  criticalObservation.docker.containers.find(
    (container) => container.service === 'postgres',
  ).health = 'unhealthy';
  let storedState = {
    lastState: 'broken',
    lastSeverity: 2,
    lastSentEpoch: 1_790_000_000,
  };
  const now = new Date('2026-10-01T00:00:00.000Z');
  let message = '';
  const result = await runHostRuntimeHealthAlert({
    env,
    dependencies: {
      now: () => now,
      collectObservation: async () => structuredClone(criticalObservation),
      readFileSync: () => JSON.stringify(storedState),
      writeState(_file, state) {
        storedState = structuredClone(state);
      },
      sendTelegram(alertMessage) {
        message = alertMessage;
        return { configured: true, result: 'sent' };
      },
    },
  });

  assert.equal(result.alert.kind, 'failure');
  assert.match(message, /critical \(failure\)/u);
  assert.equal(storedState.lastState, 'critical');
  assert.equal(storedState.lastSeverity, 2);
});
