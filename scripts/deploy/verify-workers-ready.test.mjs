import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesReadiness, verifyWorkersReady, WORKERS } from './verify-workers-ready.mjs';

const started = new Date(Date.now() - 10_000).toISOString();
const containers = WORKERS.map((worker) => ({
  Id: worker.service,
  State: { Running: true, Paused: false, StartedAt: started },
  Config: {
    Hostname: worker.service,
    Env: [],
    Labels: { 'com.docker.compose.service': worker.service },
  },
}));
const record = (worker) => ({
  event: 'worker_ready',
  service: worker.service,
  queue: worker.queue,
  instance: { hostname: worker.service, pid: 1, startupId: 'unique-start' },
  timestamp: new Date().toISOString(),
});

test('readiness must match current container, boot time, service and configured queue', () => {
  const worker = WORKERS[0];
  assert.equal(matchesReadiness(record(worker), containers[0], worker), true);
  for (const bad of [
    { ...record(worker), timestamp: new Date(Date.parse(started) - 1).toISOString() },
    { ...record(worker), instance: { hostname: 'old-container', pid: 1, startupId: 'old' } },
    { ...record(worker), queue: 'other-queue' },
    { ...record(worker), service: 'transcribe-worker' },
    { ...record(worker), event: 'started' },
  ])
    assert.equal(matchesReadiness(bad, containers[0], worker), false);
  const custom = structuredClone(containers[0]);
  custom.Config.Env = ['BATCH_JOBS_QUEUE_NAME=custom'];
  assert.equal(matchesReadiness(record(worker), custom, worker), false);
  assert.equal(matchesReadiness({ ...record(worker), queue: 'custom' }, custom, worker), true);
  custom.State.Paused = true;
  assert.equal(matchesReadiness({ ...record(worker), queue: 'custom' }, custom, worker), false);
});

test('all three current instances are required, including selective deployments', async () => {
  const docker = async ([command, , , id]) =>
    command === 'inspect'
      ? JSON.stringify(containers)
      : `irrelevant text\n${JSON.stringify(record(WORKERS.find((worker) => worker.service === id)))}`;
  assert.equal(
    (
      await verifyWorkersReady(
        containers.map((x) => x.Id),
        { docker },
      )
    ).services.length,
    3,
  );
  await assert.rejects(
    verifyWorkersReady(
      containers.map((x) => x.Id),
      {
        timeoutMs: 1,
        docker: async (args) => (args[0] === 'inspect' ? JSON.stringify(containers) : ''),
      },
    ),
    /batch-worker, transcribe-worker, student-memory-worker/,
  );
});

test('restart during log collection invalidates matching older evidence', async () => {
  let inspections = 0;
  const docker = async (args) => {
    if (args[0] === 'inspect') {
      inspections++;
      const values = structuredClone(containers);
      if (inspections > 1) values[0].State.StartedAt = new Date().toISOString();
      return JSON.stringify(values);
    }
    return JSON.stringify(record(WORKERS.find((worker) => worker.service === args[3])));
  };
  await assert.rejects(
    verifyWorkersReady(
      containers.map((x) => x.Id),
      { docker, timeoutMs: 1 },
    ),
    /batch-worker/,
  );
});
