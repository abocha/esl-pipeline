import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FfmpegSemaphore, resetFfmpegSemaphore } from '../src/infrastructure/ffmpeg-semaphore.js';
import { closeRedisClient, createRedisClient } from '../src/infrastructure/redis.js';
import {
  type RateLimiterRedisClient,
  RedisRateLimiter,
} from '../src/transport/rate-limit-middleware.js';
import { requireRedisTestEnv, resolveTestTimeout } from './support/test-env.js';

requireRedisTestEnv();
const timeout = resolveTestTimeout(30_000);
const FFMPEG_LOCK_PREFIX = 'esl:ffmpeg:lock:';
const FFMPEG_QUEUE_KEY = 'esl:ffmpeg:semaphore:queue';
let redis: Redis;

async function deleteKeysWithPrefix(prefix: string): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = nextCursor;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== '0');
}

describe('ioredis v6 RESP2 runtime contracts (requires Redis)', () => {
  beforeAll(async () => {
    redis = createRedisClient();
    await redis.ping();
  }, timeout);

  afterEach(async () => {
    resetFfmpegSemaphore();
    await deleteKeysWithPrefix('test:ioredis-v6:');
    await redis.del(FFMPEG_QUEUE_KEY);
    await deleteKeysWithPrefix(FFMPEG_LOCK_PREFIX);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeRedisClient();
  });

  it('keeps the shared client and duplicates explicitly on RESP2', async () => {
    expect(redis.options.protocol).toBe(2);

    const duplicate = redis.duplicate();
    try {
      await expect(duplicate.ping()).resolves.toBe('PONG');
      expect(duplicate.options.protocol).toBe(2);
    } finally {
      await duplicate.quit();
    }
  });

  it(
    'preserves FFmpeg semaphore SCAN, BLPOP, pipeline, and TTL behavior',
    async () => {
      const firstOperation = randomUUID();
      const first = new FfmpegSemaphore(1, false);
      await first.reset();

      await first.acquire(firstOperation);
      expect(await redis.ttl(`${FFMPEG_LOCK_PREFIX}${firstOperation}`)).toBeGreaterThan(0);

      const orphanedLock = `${FFMPEG_LOCK_PREFIX}${randomUUID()}`;
      await redis.set(orphanedLock, 'orphaned');
      await (first as unknown as { cleanupStaleLocks: () => Promise<void> }).cleanupStaleLocks();
      expect(await redis.exists(orphanedLock)).toBe(0);
      expect(await redis.ttl(`${FFMPEG_LOCK_PREFIX}${firstOperation}`)).toBeGreaterThan(0);

      await first.release(firstOperation);
      await first.reset();
      expect(await first.getStats()).toEqual({ active: 0, queued: 0, max: 1 });

      const blockingClient = redis.duplicate();
      const notifyingClient = redis.duplicate();
      const queueKey = `test:ioredis-v6:blpop:${randomUUID()}`;
      try {
        const popped = blockingClient.blpop(queueKey, 1);
        await notifyingClient.rpush(queueKey, firstOperation);
        await expect(popped).resolves.toEqual([queueKey, firstOperation]);
      } finally {
        await blockingClient.quit();
        await notifyingClient.quit();
      }
    },
    timeout,
  );

  it(
    'preserves rate-limit EVAL and cached EVALSHA NOSCRIPT recovery',
    async () => {
      const evalPrefix = `test:ioredis-v6:eval:${randomUUID()}`;
      const evalOnlyClient: RateLimiterRedisClient = {
        eval: redis.eval.bind(redis),
        zcard: redis.zcard.bind(redis),
      };
      const evalLimiter = new RedisRateLimiter(evalOnlyClient, {
        windowSize: 60_000,
        maxRequests: 10,
        burstLimit: 5,
        burstWindow: 10_000,
        keyPrefix: evalPrefix,
      });

      await expect(evalLimiter.checkRateLimit('user-1')).resolves.toMatchObject({
        allowed: true,
        count: 1,
      });
      expect(await redis.ttl(`${evalPrefix}:user-1:main`)).toBeGreaterThan(0);

      const cachedPrefix = `test:ioredis-v6:cached:${randomUUID()}`;
      const cachedLimiter = new RedisRateLimiter(redis, {
        windowSize: 60_000,
        maxRequests: 10,
        burstLimit: 5,
        burstWindow: 10_000,
        keyPrefix: cachedPrefix,
      });
      (cachedLimiter as unknown as { rateLimitScriptSha: string | null }).rateLimitScriptSha =
        '0'.repeat(40);
      const evalsha = vi.spyOn(redis, 'evalsha');
      const script = vi.spyOn(redis, 'script');

      await expect(cachedLimiter.checkRateLimit('user-2')).resolves.toMatchObject({
        allowed: true,
        count: 1,
      });
      expect(evalsha).toHaveBeenCalledTimes(2);
      expect(script).toHaveBeenCalledWith('LOAD', expect.any(String));
    },
    timeout,
  );

  it(
    'preserves duplicated-client subscribe, psubscribe, and unsubscribe behavior',
    async () => {
      const channel = `test:ioredis-v6:channel:${randomUUID()}`;
      const pattern = `test:ioredis-v6:pattern:${randomUUID()}:*`;
      const patternChannel = pattern.replace('*', 'one');
      const publisher = redis.duplicate();
      const subscriber = redis.duplicate();

      try {
        const message = new Promise<[string, string]>((resolve) => {
          subscriber.once('message', (receivedChannel, payload) => {
            resolve([receivedChannel, payload]);
          });
        });
        await subscriber.subscribe(channel);
        await publisher.publish(channel, 'targeted');
        await expect(message).resolves.toEqual([channel, 'targeted']);
        await expect(subscriber.unsubscribe(channel)).resolves.toBe(0);

        const patternMessage = new Promise<[string, string, string]>((resolve) => {
          subscriber.once('pmessage', (receivedPattern, receivedChannel, payload) => {
            resolve([receivedPattern, receivedChannel, payload]);
          });
        });
        await subscriber.psubscribe(pattern);
        await publisher.publish(patternChannel, 'wildcard');
        await expect(patternMessage).resolves.toEqual([pattern, patternChannel, 'wildcard']);
        await expect(subscriber.punsubscribe(pattern)).resolves.toBe(0);
      } finally {
        await subscriber.quit();
        await publisher.quit();
      }
    },
    timeout,
  );
});
