// packages/batch-backend/src/infrastructure/redis.ts
// Thin Redis adapter (ioredis) for BullMQ and optional caching.
// - Controlled via REDIS_ENABLED and related envs.
// - Safe defaults for docker-compose and easy to replace in other environments.
import { Redis } from 'ioredis';

import { loadConfig } from '../config/env.js';
import { logger } from './logger.js';

let client: Redis | null = null;

// createRedisClient.declaration()
export function createRedisClient(): Redis {
  if (client) return client;

  const config = loadConfig();

  if (!config.redis.enabled) {
    throw new Error('Redis requested but REDIS_ENABLED=false');
  }

  client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  client.on('error', (err: Error) => {
    logger.error(err, {
      component: 'redis',
      message: 'Redis client error',
    });
  });

  client.on('connect', () => {
    logger.info('Redis connected', { component: 'redis' });
  });

  return client;
}
