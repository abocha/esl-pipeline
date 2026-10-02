import { randomUUID } from 'node:crypto';
import { connect, createServer, type Socket } from 'node:net';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Host tooling is dependency-free ESM, shared with these service-backed assertions.
// @ts-expect-error host script intentionally has no TypeScript declaration
import * as queueObservation from '../../../scripts/docker/worker-queue-observation.mjs';
import { reportWorkerReady } from '../src/infrastructure/worker-readiness.js';
import { requireRedisTestEnv } from './support/test-env.js';

const { collectQueueObservation, evaluateQueueObservation, QUEUE_GRACE_MS, QUEUE_READ_SCRIPT } =
  queueObservation;

const { host, port } = requireRedisTestEnv();
const options = { host, port, password: process.env.REDIS_PASSWORD, maxRetriesPerRequest: null };
const connection = new Redis(options);
const name = `worker-observation-${randomUUID()}`;
const queue = new Queue(name, { connection });
const env = {
  BATCH_JOBS_QUEUE_NAME: name,
  TRANSCRIBE_QUEUE_NAME: `${name}-t`,
  STUDENT_MEMORY_QUEUE_NAME: `${name}-s`,
};
const docker = {
  ok: true,
  containers: [{ service: 'redis', status: 'running', id: 'disposable' }],
};
let worker: Worker | undefined;
const executeRedis =
  (client = connection) =>
  async (args: string[]) =>
    client.call(args[0]!, ...args.slice(1));
const collect = async (history = {}, client = connection) => {
  const result = await collectQueueObservation(env, docker, history, {
    executeRedis: executeRedis(client),
  });
  expect(result.ok).toBe(true);
  return result;
};
const evaluate = (observation: unknown, history = {}, time = Date.now()) =>
  evaluateQueueObservation(observation, history, time);
async function waitFor(check: () => Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Observation condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

afterAll(async () => {
  await worker?.close(true);
  await queue.obliterate({ force: true });
  await queue.close();
  connection.disconnect();
});

describe('worker readiness and raw queue observations against Redis', () => {
  it('waits for the real blocking connection as well as the initialized shared connection', async () => {
    await connection.ping();
    const sockets: Socket[] = [];
    let acceptBlocking!: () => void;
    const gate = new Promise<void>((resolve) => {
      acceptBlocking = resolve;
    });
    const proxy = createServer((socket) => {
      sockets.push(socket);
      void gate.then(() => {
        const upstream = connect({ host, port });
        sockets.push(upstream);
        socket.pipe(upstream).pipe(socket);
        upstream.on('error', () => socket.destroy());
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxyPort = (proxy.address() as { port: number }).port;
    const duplicate = vi
      .spyOn(connection, 'duplicate')
      .mockImplementation(() => new Redis({ ...options, host: '127.0.0.1', port: proxyPort }));
    const info = vi.fn();
    try {
      worker = new Worker(name, async () => {}, { connection });
      worker.on('error', () => {});
      const ready = reportWorkerReady(worker, 'batch-worker', { info });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(info).not.toHaveBeenCalled();
      acceptBlocking();
      await ready;
      expect(info).toHaveBeenCalledWith(
        'BullMQ consumer initialized',
        expect.objectContaining({ event: 'worker_ready', queue: name }),
      );
    } finally {
      duplicate.mockRestore();
      await worker?.close(true);
      worker = undefined;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });

  it('observes idle, progress, paused/missing consumption and reconnect/recreation', async () => {
    worker = new Worker(name, async () => {}, { connection });
    await worker.waitUntilReady();
    const baseline = evaluate(await collect());
    expect(baseline.queues[0].state).toBe('idle');
    await queue.add('attempt', {});
    await waitFor(async () => (await queue.getCompletedCount()) === 1);
    const progress = evaluate(await collect(baseline.history), baseline.history);
    expect(progress.queues[0].state).toBe('processing_observed');
    const idle = evaluate(
      await collect(progress.history),
      progress.history,
      Date.now() + 12 * 60 * 60 * 1000,
    );
    expect(idle.queues[0].state).toBe('idle');
    await queue.pause();
    expect(evaluate(await collect()).queues[0].state).toBe('paused');
    await queue.resume();
    await worker.pause();
    await queue.add('unclaimed', {}, { priority: 2 });
    const pending = evaluate(await collect(idle.history), idle.history);
    expect(pending.queues[0].prioritized).toBe(1);
    const expired = evaluate(
      await collect(pending.history),
      pending.history,
      Date.now() + QUEUE_GRACE_MS,
    );
    expect(
      expired.issues.some((issue: { message: string }) =>
        issue.message.includes('runnable_work_not_claimed'),
      ),
    ).toBe(true);
    await worker.close();
    worker = undefined;
    const missing = evaluate(await collect(expired.history), expired.history);
    expect(missing.queues[0].state).toBe('consumer_connection_missing');
    expect(missing.history[name].backlogSince).toBe(pending.history[name].backlogSince);
    const reconnected = new Promise<void>((resolve) => connection.once('ready', resolve));
    connection.disconnect(true);
    await reconnected;
    worker = new Worker(name, async () => {}, { connection });
    await worker.waitUntilReady();
    await waitFor(async () => (await queue.getCompletedCount()) === 2);
    const recovered = evaluate(await collect(missing.history), missing.history);
    expect(recovered.queues[0].state).toBe('processing_observed');
    expect(recovered.history[name].backlogSince).toBeNull();
    await worker.close();
    worker = undefined;
  });

  it('distinguishes future/overdue delayed work and detects stream trim/reset/deleted history', async () => {
    const future = await queue.add('future', {}, { delay: 60_000 });
    await queue.add('overdue', {}, { delay: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const observed = await collect();
    expect(observed.queues[0].delayed).toBe(2);
    expect(observed.queues[0].overdueDelayed).toBe(1);
    const baseline = evaluate(observed);
    await queue.add('waiting', {});
    await connection.xtrim(`bull:${name}:events`, 'MAXLEN', 1);
    const trimmed = evaluate(await collect(baseline.history), baseline.history);
    expect(trimmed.queues[0].observationGap).toBe(true);
    expect(trimmed.queues[0].processingEventsObserved).toBe(false);
    await connection.del(`bull:${name}:events`);
    const reset = evaluate(await collect(trimmed.history), trimmed.history);
    expect(reset.queues[0].observationGap).toBe(true);
    expect(reset.history[name].backlogSince).toBe(baseline.history[name].backlogSince);
    const lost = await connection.xadd(
      `bull:${name}:events`,
      '*',
      'event',
      'completed',
      'jobId',
      'lost',
    );
    await connection.xdel(`bull:${name}:events`, lost!);
    const deleted = evaluate(await collect(reset.history), reset.history);
    expect(deleted.queues[0].observationGap).toBe(true);
    expect(deleted.queues[0].processingEventsObserved).toBe(false);
    await future.remove();
  });

  it('collector works under a read-command-only ACL and preserves every queue key byte-for-byte', async () => {
    const user = `monitor-${randomUUID()}`;
    const password = randomUUID();
    await connection.call(
      'ACL',
      'SETUSER',
      user,
      'on',
      `>${password}`,
      'resetkeys',
      `~bull:${name}*`,
      '-@all',
      '+info',
      '+client|setinfo',
      '+client|list',
      '+eval_ro',
      '+time',
      '+exists',
      '+xinfo|stream',
      '+xrange',
      '+llen',
      '+zcard',
      '+zcount',
      '+hexists',
    );
    const monitor = new Redis({ ...options, username: user, password });
    const digest = async () => {
      const keys = (await connection.keys(`bull:${name}*`)).sort();
      return Promise.all(
        keys.map(async (key) => [key, (await connection.dumpBuffer(key))?.toString('base64')]),
      );
    };
    try {
      const before = await digest();
      await collect({}, monitor);
      expect(await digest()).toEqual(before);
      await expect(monitor.set(`bull:${name}:meta`, 'bad')).rejects.toThrow('NOPERM');
      // Redis independently rejects writes even when EVAL_RO runs as the admin test user.
      await expect(
        connection.call(
          'EVAL_RO',
          "return redis.call('SET', KEYS[1], 'bad')",
          '1',
          `bull:${name}:probe`,
        ),
      ).rejects.toThrow(/write|readonly/i);
      expect(QUEUE_READ_SCRIPT).not.toContain("redis.call('SET'");
    } finally {
      monitor.disconnect();
      await connection.call('ACL', 'DELUSER', user);
    }
  });
});
