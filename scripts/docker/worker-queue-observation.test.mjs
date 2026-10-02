import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectQueueObservation,
  consumerConnections,
  evaluateQueueObservation,
  QUEUE_GRACE_MS,
} from './worker-queue-observation.mjs';

const now = 1_790_000_000_000;
const snapshot = (extra = {}) => ({
  service: 'batch-worker',
  queue: 'esl-jobs',
  waiting: 0,
  prioritized: 0,
  active: 0,
  delayed: 0,
  overdueDelayed: 0,
  paused: false,
  consumers: [{ id: '1', name: 'consumer' }],
  lastId: '1-0',
  entriesAdded: 1,
  cursorPresent: true,
  events: [],
  ...extra,
});
const evaluate = (value, history = {}, time = now) =>
  evaluateQueueObservation({ ok: true, queues: [value] }, history, time);

test('idle ignores historic completion; future delayed work is not runnable', () => {
  for (const value of [
    snapshot(),
    snapshot({ delayed: 1 }),
    snapshot({ events: [['1-0', ['event', 'completed']]] }),
  ]) {
    const result = evaluate(value);
    assert.equal(result.queues[0].state, 'idle');
    assert.equal(result.history['esl-jobs'].lastProgressAt, null);
    assert.deepEqual(result.issues, []);
  }
});

test('missing connections have persistent grace and recover without a recent completion', () => {
  const missing = snapshot({ consumers: [] });
  const first = evaluate(missing);
  assert.equal(first.queues[0].state, 'consumer_connection_missing');
  assert.deepEqual(first.issues, []);
  const recreated = evaluate(missing, first.history, now + QUEUE_GRACE_MS);
  assert.equal(recreated.issues[0].severity, 'critical');
  const recovered = evaluate(
    snapshot({ consumers: [{ id: 'new-worker' }] }),
    recreated.history,
    now + QUEUE_GRACE_MS,
  );
  assert.equal(recovered.queues[0].state, 'idle');
  assert.deepEqual(recovered.issues, []);
});

test('waiting, prioritized and overdue delayed backlog survive recreation and gaps', () => {
  for (const field of ['waiting', 'prioritized', 'overdueDelayed']) {
    const value = snapshot({ [field]: 1 });
    const first = evaluate(value);
    assert.equal(first.queues[0].state, 'runnable_work_not_claimed');
    const unavailable = evaluateQueueObservation(
      { ok: false },
      first.history,
      now + QUEUE_GRACE_MS / 2,
    );
    assert.deepEqual(unavailable.history, first.history);
    const recreated = evaluate(
      { ...value, consumers: [{ id: 'replacement' }], cursorPresent: false },
      unavailable.history,
      now + QUEUE_GRACE_MS,
    );
    assert.equal(recreated.history['esl-jobs'].backlogSince, now);
    assert.ok(
      recreated.issues.some((issue) => issue.message.includes('runnable_work_not_claimed')),
    );
    assert.ok(recreated.queues[0].observationGap);
    assert.equal(evaluate(snapshot(), recreated.history).history['esl-jobs'].backlogSince, null);
  }
});

test('only claims and attempt outcomes are event progress; active state has no duration policy', () => {
  const baseline = evaluate(snapshot({ waiting: 1 })).history;
  for (const event of ['waiting', 'added', 'delayed', 'progress', 'drained', 'stalled']) {
    const result = evaluate(
      snapshot({ waiting: 1, lastId: '2-0', entriesAdded: 2, events: [['2-0', ['event', event]]] }),
      baseline,
      now + QUEUE_GRACE_MS,
    );
    assert.equal(result.history['esl-jobs'].lastProgressAt, null);
    assert.equal(result.issues[0].severity, 'critical');
  }
  for (const event of ['active', 'completed', 'failed']) {
    const result = evaluate(
      snapshot({ waiting: 1, lastId: '2-0', entriesAdded: 2, events: [['2-0', ['event', event]]] }),
      baseline,
      now + QUEUE_GRACE_MS,
    );
    assert.equal(result.queues[0].state, 'processing_observed');
    assert.equal(result.history['esl-jobs'].lastProgressAt, now + QUEUE_GRACE_MS);
    assert.deepEqual(result.issues, []);
  }
  const active = evaluate(snapshot({ waiting: 1, active: 1 }), baseline, now + 24 * 60 * 60 * 1000);
  assert.equal(active.queues[0].state, 'processing_observed');
  assert.equal(active.queues[0].processingEventsObserved, false);
  assert.equal(active.history['esl-jobs'].lastProgressAt, null);
  assert.deepEqual(active.issues, []);
});

test('paused queues report degradation; trimmed/reset/overflow streams never invent progress', () => {
  assert.equal(evaluate(snapshot({ paused: true })).queues[0].state, 'paused');
  assert.equal(evaluate(snapshot({ paused: true })).issues[0].severity, 'degraded');
  const history = evaluate(snapshot()).history;
  for (const extra of [
    { cursorPresent: false },
    { entriesAdded: 0, lastId: '0-0' },
    { events: Array.from({ length: 1001 }, () => ['2-0', ['event', 'completed']]) },
  ]) {
    const result = evaluate(
      snapshot({ events: [['2-0', ['event', 'completed']]], ...extra }),
      history,
    );
    assert.equal(result.queues[0].observationGap, true);
    assert.equal(result.queues[0].processingEventsObserved, false);
    assert.equal(result.history['esl-jobs'].lastProgressAt, null);
  }
});

test('consumer matching excludes QueueEvents/producer connections and neighboring queue names', () => {
  const name = `bull:${Buffer.from('esl-jobs').toString('base64')}`;
  const clients = `id=1 name=${name} cmd=bzpopmin\nid=2 name=${name}:w:worker cmd=evalsha\nid=3 name=${name}:qe\nid=4 name=\nid=5 name=${name}extra`;
  assert.deepEqual(
    consumerConnections(clients, 'esl-jobs').map((x) => x.id),
    ['1', '2'],
  );
});

test('collector deadline and read errors return unavailable with a fixed read-command boundary', async () => {
  const docker = { ok: true, containers: [{ service: 'redis', status: 'running', id: 'local' }] };
  assert.equal(
    (
      await collectQueueObservation(
        {},
        docker,
        {},
        {
          timeoutMs: 5,
          executeRedis: () => new Promise(() => {}),
        },
      )
    ).state,
    'observation_unavailable',
  );
  const commands = [];
  const result = await collectQueueObservation(
    {},
    docker,
    {},
    {
      executeRedis: async (command) => {
        commands.push(command);
        if (command[0] === 'CLIENT') return '';
        return JSON.stringify(snapshot({ observedAtMs: now }));
      },
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    commands.map((command) => command[0]),
    ['CLIENT', 'EVAL_RO', 'EVAL_RO', 'EVAL_RO'],
  );
  const failure = await collectQueueObservation(
    {},
    docker,
    {},
    {
      executeRedis: async () => {
        throw new Error('secret');
      },
    },
  );
  assert.equal(failure.state, 'observation_unavailable');
  assert.ok(!JSON.stringify(failure).includes('secret'));
});

test('host CLI path accepts RESP3 verbatim CLIENT LIST and JSON script results without password in argv', async () => {
  const commands = [];
  const inputs = [];
  const result = await collectQueueObservation(
    { REDIS_PASSWORD: 'test-secret' },
    { ok: true, containers: [{ service: 'redis', status: 'running', id: 'local' }] },
    {},
    {
      execRedisCli: (_file, args) => {
        commands.push(args);
        const stdout = args.includes('CLIENT')
          ? 'id=1 name= cmd=client|list\n'
          : JSON.stringify(JSON.stringify(snapshot({ observedAtMs: now })));
        const promise = Promise.resolve({ stdout });
        promise.child = { stdin: { end: (value) => inputs.push(value) } };
        return promise;
      },
    },
  );
  assert.equal(result.ok, true);
  assert.ok(commands.every((command) => !command.includes('test-secret')));
  assert.ok(
    commands.every((command) =>
      command.some((value) => value.includes('exec redis-cli --json "$@"')),
    ),
  );
  assert.deepEqual(inputs, Array(4).fill('test-secret\n'));
});
