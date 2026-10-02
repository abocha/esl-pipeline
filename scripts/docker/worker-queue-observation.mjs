import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { WORKERS } from '../deploy/verify-workers-ready.mjs';

export const QUEUE_GRACE_MS = 10 * 60 * 1000;
export const COLLECTOR_TIMEOUT_MS = 10_000;

// BullMQ 6.3.4 Redis layout: delayed scores encode milliseconds * 4096.
// EVAL_RO enforces Redis's non-writing script boundary, even if this script regresses.
export const QUEUE_READ_SCRIPT = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local events = {}
local lastId = '0-0'
local entriesAdded = 0
local cursorPresent = false
if redis.call('EXISTS', KEYS[6]) == 1 then
  local info = redis.call('XINFO', 'STREAM', KEYS[6])
  for i = 1, #info, 2 do
    if info[i] == 'last-generated-id' then lastId = info[i+1] end
    if info[i] == 'entries-added' then entriesAdded = info[i+1] end
  end
  cursorPresent = #redis.call('XRANGE', KEYS[6], ARGV[1], ARGV[1], 'COUNT', 1) == 1
  events = redis.call('XRANGE', KEYS[6], '(' .. ARGV[1], '+', 'COUNT', 1001)
end
return cjson.encode({
  observedAtMs = now,
  waiting = redis.call('LLEN', KEYS[1]),
  prioritized = redis.call('ZCARD', KEYS[2]),
  active = redis.call('LLEN', KEYS[3]),
  delayed = redis.call('ZCARD', KEYS[4]),
  overdueDelayed = redis.call('ZCOUNT', KEYS[4], '-inf', now * 4096 + 4095),
  paused = redis.call('HEXISTS', KEYS[5], 'paused') == 1,
  lastId = lastId, entriesAdded = entriesAdded,
  cursorPresent = cursorPresent, events = events
})`;

export function queueReadCommand(queue, cursor = '0-0') {
  return [
    'EVAL_RO',
    QUEUE_READ_SCRIPT,
    '6',
    ...['wait', 'prioritized', 'active', 'delayed', 'meta', 'events'].map(
      (suffix) => `bull:${queue}:${suffix}`,
    ),
    cursor,
  ];
}

export function consumerConnections(clientList, queue) {
  const name = `bull:${Buffer.from(queue).toString('base64')}`;
  return clientList
    .split('\n')
    .filter(Boolean)
    .map((line) =>
      Object.fromEntries(
        line.split(' ').map((field) => {
          const index = field.indexOf('=');
          return [field.slice(0, index), field.slice(index + 1)];
        }),
      ),
    )
    .filter((client) => client.name === name || client.name?.startsWith(`${name}:w:`))
    .map(({ id, name: clientName }) => ({ id, name: clientName }));
}

export function normalizeQueueHistory(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const epoch = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
  return Object.fromEntries(
    Object.entries(value).flatMap(([queue, row]) => {
      if (
        !row ||
        !/^\d+-\d+$/u.test(row.cursor) ||
        !Number.isSafeInteger(row.entriesAdded) ||
        row.entriesAdded < 0
      )
        return [];
      return [
        [
          queue,
          {
            cursor: row.cursor,
            entriesAdded: row.entriesAdded,
            missingSince: epoch(row.missingSince),
            backlogSince: epoch(row.backlogSince),
            lastProgressAt: epoch(row.lastProgressAt),
          },
        ],
      ];
    }),
  );
}

/** Host invokes the Redis service's bundled CLI; no host npm install or Queue constructor. */
export async function collectQueueObservation(env, docker, history = {}, dependencies = {}) {
  let timer;
  const controller = new AbortController();
  try {
    const redis =
      docker?.ok &&
      docker.containers.filter((value) => value.service === 'redis' && value.status === 'running');
    if (!redis || redis.length !== 1) throw new Error('Redis service unavailable');
    // This path observes the repository's local Compose Redis, not an arbitrary remote server.
    if (env.REDIS_HOST && !['redis', 'localhost', '127.0.0.1'].includes(env.REDIS_HOST))
      throw new Error('Unsupported Redis topology');
    if (env.REDIS_PORT && env.REDIS_PORT !== '6379') throw new Error('Unsupported Redis port');
    const execute =
      dependencies.executeRedis ??
      (async (command) => {
        // Password travels on stdin, never argv, logs, or errors. CLI only issues the supplied read.
        const child = (dependencies.execRedisCli ?? promisify(execFile))(
          'docker',
          [
            'exec',
            '-i',
            redis[0].id,
            'sh',
            '-c',
            'IFS= read -r REDISCLI_AUTH; if [ -n "$REDISCLI_AUTH" ]; then export REDISCLI_AUTH; else unset REDISCLI_AUTH; fi; exec redis-cli --json "$@"',
            'sh',
            ...command,
          ],
          {
            encoding: 'utf8',
            signal: controller.signal,
            timeout: COLLECTOR_TIMEOUT_MS,
            maxBuffer: 2 * 1024 * 1024,
          },
        );
        child.child.stdin.end(`${env.REDIS_PASSWORD ?? ''}\n`);
        const { stdout } = await child;
        // CLIENT LIST is a RESP3 verbatim string; redis-cli prints it raw even with --json.
        return command[0] === 'CLIENT' ? stdout : JSON.parse(stdout);
      });
    const collect = async () => {
      const clients = await execute(['CLIENT', 'LIST']);
      if (
        typeof clients !== 'string' ||
        clients
          .trim()
          .split('\n')
          .filter(Boolean)
          .some((line) => !/^id=\d+ /u.test(line))
      )
        throw new Error('Invalid CLIENT LIST response');
      const queues = [];
      for (const worker of WORKERS) {
        const queue = env[worker.env] || worker.queue;
        if (queue.includes(':') || !queue.trim()) throw new Error('Invalid queue name');
        const snapshot = JSON.parse(await execute(queueReadCommand(queue, history[queue]?.cursor)));
        if (
          !Number.isFinite(snapshot.observedAtMs) ||
          !Number.isFinite(snapshot.waiting) ||
          !Number.isFinite(snapshot.entriesAdded) ||
          typeof snapshot.lastId !== 'string'
        )
          throw new Error('Invalid queue snapshot');
        queues.push({
          ...snapshot,
          events: Array.isArray(snapshot.events) ? snapshot.events : [],
          service: worker.service,
          queue,
          consumers: consumerConnections(clients, queue),
        });
      }
      return { ok: true, queues };
    };
    return await Promise.race([
      collect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Collector deadline'));
        }, dependencies.timeoutMs ?? COLLECTOR_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Do not expose subprocess output or credentials in monitor status.
    return {
      ok: false,
      state: 'observation_unavailable',
      error: 'Queue read observation failed or timed out',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function evaluateQueueObservation(observation, previous = {}, nowMs = Date.now()) {
  const history = { ...previous };
  const issues = [];
  const queues = [];
  if (!observation?.ok) {
    return {
      history,
      queues,
      issues: [
        {
          severity: 'degraded',
          message: 'observation_unavailable: queue/consumer observation unavailable',
        },
      ],
    };
  }
  for (const snapshot of observation.queues) {
    const old = previous[snapshot.queue] ?? {};
    const events = snapshot.events;
    const hasBaseline = typeof old.cursor === 'string';
    const gap =
      hasBaseline &&
      (snapshot.entriesAdded < old.entriesAdded ||
        (old.cursor !== '0-0' && !snapshot.cursorPresent) ||
        snapshot.entriesAdded - old.entriesAdded !== events.length ||
        events.length > 1000);
    const progress =
      hasBaseline &&
      !gap &&
      events.some(([, fields]) => {
        const event = fields[fields.indexOf('event') + 1];
        return ['active', 'completed', 'failed'].includes(event);
      });
    const runnable = snapshot.waiting + snapshot.prioritized + snapshot.overdueDelayed;
    const missingSince = snapshot.consumers.length ? null : (old.missingSince ?? nowMs);
    const backlogSince = runnable ? (old.backlogSince ?? nowMs) : null;
    const lastProgressAt = progress ? nowMs : (old.lastProgressAt ?? null);
    history[snapshot.queue] = {
      cursor: snapshot.lastId,
      entriesAdded: snapshot.entriesAdded,
      missingSince,
      backlogSince,
      lastProgressAt,
    };
    let state;
    if (snapshot.paused) state = 'paused';
    else if (!snapshot.consumers.length) state = 'consumer_connection_missing';
    else if (progress || snapshot.active > 0) state = 'processing_observed';
    else if (runnable) state = 'runnable_work_not_claimed';
    else state = 'idle';
    const missingExpired = missingSince !== null && nowMs - missingSince >= QUEUE_GRACE_MS;
    const backlogExpired =
      backlogSince !== null &&
      nowMs - Math.max(backlogSince, lastProgressAt ?? 0) >= QUEUE_GRACE_MS;
    if (snapshot.paused)
      issues.push({
        severity: 'degraded',
        message: `${snapshot.service}/${snapshot.queue}: paused queue`,
      });
    if (missingExpired)
      issues.push({
        severity: 'critical',
        message: `${snapshot.service}/${snapshot.queue}: consumer_connection_missing for at least ten minutes`,
      });
    // An active snapshot is not new progress. No execution-duration policy exists in v1,
    // so runnable work waiting behind active work is retained in history but not timed out.
    if (!snapshot.paused && snapshot.active === 0 && !progress && backlogExpired)
      issues.push({
        severity: 'critical',
        message: `${snapshot.service}/${snapshot.queue}: runnable_work_not_claimed for at least ten minutes without observed processing progress`,
      });
    if (gap)
      issues.push({
        severity: 'degraded',
        message: `${snapshot.service}/${snapshot.queue}: observation gap in event stream`,
      });
    queues.push({
      service: snapshot.service,
      queue: snapshot.queue,
      state,
      consumers: snapshot.consumers,
      waiting: snapshot.waiting,
      prioritized: snapshot.prioritized,
      active: snapshot.active,
      delayed: snapshot.delayed,
      overdueDelayed: snapshot.overdueDelayed,
      processingEventsObserved: progress,
      activeStateObserved: snapshot.active > 0,
      observationGap: gap,
      baselineEstablished: !hasBaseline,
      missingSince,
      backlogSince,
      lastProgressAt,
    });
  }
  return { history, queues, issues };
}
