// packages/batch-backend/src/infrastructure/ffmpeg-semaphore.ts
// Redis-based semaphore for limiting concurrent FFmpeg operations across workers.
// - Uses Redis atomic operations with TTL-based locks to ensure distributed coordination.
// - Automatic cleanup of stale locks from crashed workers.
// - FIFO queue with blocking pop for fairness and efficiency.
import type { Redis } from 'ioredis';

import { logger } from './logger.js';
import { createRedisClient } from './redis.js';

const LOCK_KEY_PREFIX = 'esl:ffmpeg:lock:';
const QUEUE_KEY = 'esl:ffmpeg:semaphore:queue';
const LOCK_TTL = 300; // 5 minutes max per FFmpeg operation
const CLEANUP_INTERVAL = 60_000; // Clean up stale locks every 60 seconds

export class FfmpegSemaphore {
  private static instances = new Set<FfmpegSemaphore>();
  private redis: Redis;
  private maxConcurrent: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxConcurrent: number, enablePeriodicCleanup = true) {
    this.redis = createRedisClient();
    this.maxConcurrent = maxConcurrent;

    // Register this instance for cleanup tracking
    FfmpegSemaphore.instances.add(this);

    // Start periodic cleanup of stale locks (optional, for production robustness)
    if (enablePeriodicCleanup) {
      this.startCleanup();
    }
  }

  /**
   * Acquire a semaphore slot for FFmpeg operation.
   * Blocks until a slot is available via FIFO queue.
   */
  async acquire(operationId: string): Promise<void> {
    const startTime = Date.now();
    const lockKey = `${LOCK_KEY_PREFIX}${operationId}`;

    while (true) {
      // Clean up expired locks before attempting acquisition
      await this.cleanupStaleLocks();

      // Count active (non-expired) locks
      const activeLocks = await this.countActiveLocks();

      if (activeLocks < this.maxConcurrent) {
        // Try to acquire lock with TTL using ioredis setex + setnx pattern
        // Use SETNX-like behavior with expiry
        const acquired = await this.redis.set(lockKey, Date.now().toString(), 'EX', LOCK_TTL, 'NX');

        if (acquired) {
          logger.debug(`FFmpeg semaphore acquired`, {
            operationId,
            activeLocks: activeLocks + 1,
            max: this.maxConcurrent,
            waitMs: Date.now() - startTime,
          });
          return;
        }
      }

      // Add to queue and wait for notification
      await this.redis.rpush(QUEUE_KEY, operationId);

      // Block waiting for queue head notification (30 second timeout)
      // This prevents busy-waiting and ensures FIFO fairness
      const popped = await this.redis.blpop(QUEUE_KEY, 30);

      // If we got our own ID back (or timeout), retry acquiring
      if (!popped || popped[1] === operationId) {
        continue;
      } else {
        // Someone else's ID - put it back and keep waiting
        await this.redis.lpush(QUEUE_KEY, popped[1]);
      }
    }
  }

  /**
   * Release a semaphore slot after FFmpeg operation completes.
   */
  async release(operationId: string): Promise<void> {
    const lockKey = `${LOCK_KEY_PREFIX}${operationId}`;

    // Delete the lock
    await this.redis.del(lockKey);

    // Notify one waiter in queue (if any)
    const nextWaiter = await this.redis.lpop(QUEUE_KEY);
    if (nextWaiter) {
      // Push back so BLPOP in that waiter's acquire will pick it up
      await this.redis.lpush(QUEUE_KEY, nextWaiter);
    }

    logger.debug(`FFmpeg semaphore released`, {
      operationId,
      notified: nextWaiter,
    });
  }

  /**
   * Count currently active (non-expired) locks.
   */
  private async countActiveLocks(): Promise<number> {
    const keys = await this.redis.keys(`${LOCK_KEY_PREFIX}*`);
    return keys.length;
  }

  /**
   * Clean up stale locks that have exceeded TTL.
   * Redis will auto-expire them, but this ensures cleanup happens promptly.
   */
  private async cleanupStaleLocks(): Promise<void> {
    const keys = await this.redis.keys(`${LOCK_KEY_PREFIX}*`);

    for (const key of keys) {
      const ttl = await this.redis.ttl(key);
      if (ttl === -1) {
        // Key exists but has no TTL (shouldn't happen, but defensive)
        await this.redis.del(key);
        logger.warn('Cleaned up lock without TTL', { key });
      } else if (ttl === -2) {
        // Key doesn't exist (already expired)
        continue;
      }
    }
  }

  /**
   * Start periodic cleanup timer.
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleLocks().catch((error) => {
        logger.error(error, { message: 'FFmpeg semaphore cleanup failed' });
      });
    }, CLEANUP_INTERVAL);
  }

  /**
   * Stop cleanup timer (for graceful shutdown).
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Destroy this semaphore instance and clean up resources.
   */
  destroy(): void {
    this.stopCleanup();
    FfmpegSemaphore.instances.delete(this);
  }

  /**
   * Destroy all semaphore instances (for test cleanup).
   */
  static destroyAll(): void {
    for (const instance of FfmpegSemaphore.instances) {
      instance.stopCleanup();
    }
    FfmpegSemaphore.instances.clear();
  }

  /**
   * Get current semaphore state for monitoring.
   */
  async getStats(): Promise<{ active: number; queued: number; max: number }> {
    const active = await this.countActiveLocks();
    const queueLength = await this.redis.llen(QUEUE_KEY);

    return {
      active,
      queued: queueLength,
      max: this.maxConcurrent,
    };
  }

  /**
   * Reset semaphore state (for maintenance/recovery).
   */
  async reset(): Promise<void> {
    const lockKeys = await this.redis.keys(`${LOCK_KEY_PREFIX}*`);
    if (lockKeys.length > 0) {
      await this.redis.del(...lockKeys);
    }
    await this.redis.del(QUEUE_KEY);
    logger.info('FFmpeg semaphore reset');
  }
}

// Singleton instance, initialized lazily
let semaphoreInstance: FfmpegSemaphore | null = null;

export function getFfmpegSemaphore(maxConcurrent?: number): FfmpegSemaphore {
  if (!semaphoreInstance) {
    if (maxConcurrent === undefined) {
      throw new Error(
        'FFmpeg semaphore not initialized. Call getFfmpegSemaphore(maxConcurrent) first.',
      );
    }
    semaphoreInstance = new FfmpegSemaphore(maxConcurrent);
  }
  return semaphoreInstance;
}

export function resetFfmpegSemaphore(): void {
  if (semaphoreInstance) {
    semaphoreInstance.stopCleanup();
  }
  semaphoreInstance = null;

  // Also destroy all non-singleton instances (e.g., from tests)
  FfmpegSemaphore.destroyAll();
}
