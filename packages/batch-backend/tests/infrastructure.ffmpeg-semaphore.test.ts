// packages/batch-backend/tests/infrastructure.ffmpeg-semaphore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FfmpegSemaphore, resetFfmpegSemaphore } from '../src/infrastructure/ffmpeg-semaphore.js';

// Mock Redis client
const mockRedis = {
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
  ttl: vi.fn(),
  rpush: vi.fn(),
  lpop: vi.fn(),
  lpush: vi.fn(),
  blpop: vi.fn(),
  llen: vi.fn(),
};

vi.mock('../src/infrastructure/redis.js', () => ({
  createRedisClient: () => mockRedis,
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('FfmpegSemaphore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFfmpegSemaphore();

    // Safe defaults so any acquire() call completes without spinning
    mockRedis.keys.mockResolvedValue([]);
    mockRedis.set.mockResolvedValue('OK');
    mockRedis.ttl.mockResolvedValue(120);
    mockRedis.blpop.mockResolvedValue(null);
  });

  afterEach(() => {
    // Clean up any remaining semaphores to prevent timer leaks
    resetFfmpegSemaphore();
    vi.restoreAllMocks();
  });

  describe('acquire', () => {
    it('acquires successfully when under limit', async () => {
      // Disable periodic cleanup in tests to avoid timer complications
      const semaphore = new FfmpegSemaphore(3, false);
      mockRedis.keys.mockResolvedValue(['lock1', 'lock2']); // 2 active locks
      mockRedis.set.mockResolvedValue('OK'); // Successful acquisition

      await semaphore.acquire('op-1');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'esl:ffmpeg:lock:op-1',
        expect.any(String),
        'EX',
        300,
        'NX',
      );
    });

    it('waits when at limit using blpop', async () => {
      const semaphore = new FfmpegSemaphore(2, false);

      // First: at limit (2 active locks), second: slot available
      mockRedis.keys
        .mockResolvedValueOnce(['lock1', 'lock2']) // 2 active = at limit
        .mockResolvedValueOnce(['lock1']); // 1 active = available

      mockRedis.set
        .mockResolvedValueOnce(null) // First attempt fails
        .mockResolvedValueOnce('OK'); // Second attempt succeeds

      mockRedis.blpop.mockResolvedValueOnce(['queue', 'op-1']); // Got our own ID back

      await semaphore.acquire('op-1');

      expect(mockRedis.rpush).toHaveBeenCalledWith('esl:ffmpeg:semaphore:queue', 'op-1');
      expect(mockRedis.blpop).toHaveBeenCalledWith('esl:ffmpeg:semaphore:queue', 30);
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
    });
  });

  describe('release', () => {
    it('deletes lock and notifies queue', async () => {
      const semaphore = new FfmpegSemaphore(3, false);
      mockRedis.lpop.mockResolvedValue('op-2');

      await semaphore.release('op-1');

      expect(mockRedis.del).toHaveBeenCalledWith('esl:ffmpeg:lock:op-1');
      expect(mockRedis.lpop).toHaveBeenCalledWith('esl:ffmpeg:semaphore:queue');
      expect(mockRedis.lpush).toHaveBeenCalledWith('esl:ffmpeg:semaphore:queue', 'op-2');
    });
  });

  describe('getStats', () => {
    it('returns current semaphore state', async () => {
      const semaphore = new FfmpegSemaphore(5, false);
      mockRedis.keys.mockResolvedValue(['lock1', 'lock2', 'lock3']);
      mockRedis.llen.mockResolvedValue(2);

      const stats = await semaphore.getStats();

      expect(stats).toEqual({
        active: 3,
        queued: 2,
        max: 5,
      });
    });
  });

  describe('reset', () => {
    it('clears all locks and queue', async () => {
      const semaphore = new FfmpegSemaphore(3, false);
      mockRedis.keys.mockResolvedValue(['lock1', 'lock2']);
      mockRedis.del.mockResolvedValue(2);

      await semaphore.reset();

      expect(mockRedis.keys).toHaveBeenCalledWith('esl:ffmpeg:lock:*');
      expect(mockRedis.del).toHaveBeenCalledWith('lock1', 'lock2');
      expect(mockRedis.del).toHaveBeenCalledWith('esl:ffmpeg:semaphore:queue');
    });
  });

  describe('crashed worker recovery', () => {
    it('cleans up locks without TTL', async () => {
      const semaphore = new FfmpegSemaphore(3, false);
      mockRedis.keys.mockResolvedValue(['lock1', 'lock2']);
      mockRedis.ttl.mockResolvedValueOnce(-1).mockResolvedValueOnce(120); // First has no TTL
      mockRedis.set.mockResolvedValue('OK');

      await semaphore.acquire('op-1');

      expect(mockRedis.ttl).toHaveBeenCalled();
      expect(mockRedis.del).toHaveBeenCalledWith('lock1'); // Cleaned up stale lock
    });
  });

  describe('cleanup timer', () => {
    it('periodic cleanup is disabled in test mode', () => {
      const semaphore = new FfmpegSemaphore(3, false);

      // Verify cleanup timer was not started
      expect(semaphore['cleanupTimer']).toBeNull();
    });

    it('stopCleanup works when cleanup is enabled', () => {
      const semaphore = new FfmpegSemaphore(3, true);

      // Verify timer was started
      expect(semaphore['cleanupTimer']).not.toBeNull();

      semaphore.stopCleanup();

      // Verify timer was stopped
      expect(semaphore['cleanupTimer']).toBeNull();
    });
  });
});
