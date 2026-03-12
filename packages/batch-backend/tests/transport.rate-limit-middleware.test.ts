// packages/batch-backend/tests/transport.rate-limit-middleware.test.ts
//
// Tests for rate limiting middleware covering Redis-based rate limiting,
// burst handling, and middleware integration.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';

import { createRedisClient } from '../src/infrastructure/redis.js';
import {
  RateLimiterService,
  createUploadRateLimitMiddleware,
} from '../src/transport/rate-limit-middleware.js';

// Mock Redis client
vi.mock('../src/infrastructure/redis', () => ({
  createRedisClient: vi.fn(),
}));

// Mock config loading
vi.mock('../src/config/env', () => ({
  loadConfig: vi.fn(() => ({
    redis: { enabled: true },
    security: {
      uploadRateLimit: 10,
      uploadBurstLimit: 20,
      enableRateLimiting: true,
    },
  })),
}));

describe('RateLimiterService', () => {
  let rateLimiter: RateLimiterService;
  let mockRedis: {
    eval: ReturnType<typeof vi.fn>;
    evalsha: ReturnType<typeof vi.fn>;
    script: ReturnType<typeof vi.fn>;
    zcard: ReturnType<typeof vi.fn>;
  };
  const asRedis = (value: unknown): Redis => value as Redis;

  beforeEach(() => {
    mockRedis = {
      eval: vi.fn(),
      evalsha: vi.fn(),
      script: vi.fn(),
      zcard: vi.fn(),
    };

    (createRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(asRedis(mockRedis));

    // Create with Redis enabled
    rateLimiter = new RateLimiterService(asRedis(mockRedis), {
      windowSize: 60 * 1000, // 1 minute
      maxRequests: 10,
      burstLimit: 20,
      burstWindow: 10 * 1000, // 10 seconds
      keyPrefix: 'test:rate_limit',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rate Limiting Logic', () => {
    it('should allow requests within limit', async () => {
      mockRedis.eval.mockResolvedValue([1, 6, 6, 0, 0, -1, -1]);

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(4); // 10 - 6 = 4
      expect(result.count).toBe(6);
    });

    it('should block requests over burst window limit', async () => {
      mockRedis.eval.mockResolvedValue([0, 2, 20, 0, 1, -1, Date.now() - 1000]);

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.limit).toBe(20);
      expect(result.count).toBe(20);
      expect(result.retryAfter).toBeDefined();
    });

    it('should block requests over main window limit', async () => {
      mockRedis.eval.mockResolvedValue([0, 10, 5, 1, 0, Date.now() - 1000, -1]);

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });

    it('should block when both windows exceed limits', async () => {
      mockRedis.eval.mockResolvedValue([0, 10, 20, 1, 1, Date.now() - 3000, Date.now() - 1000]);

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });
  });

  describe('Redis Operations', () => {
    it('should execute rate limiting logic atomically via eval', async () => {
      mockRedis.eval.mockResolvedValue([1, 3, 2, 0, 0, -1, -1]);

      await rateLimiter.checkRateLimit('user:123');

      expect(mockRedis.eval).toHaveBeenCalledTimes(1);
      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.any(String),
        2,
        expect.stringContaining('user:123:main'),
        expect.stringContaining('user:123:burst'),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        '10',
        '20',
        '60',
        '10',
        expect.any(String),
      );
    });

    it('should use evalsha path when script is loaded', async () => {
      mockRedis.script.mockResolvedValue('sha123');
      mockRedis.evalsha.mockResolvedValue([1, 4, 3, 0, 0, -1, -1]);

      await rateLimiter.checkRateLimit('user:123');

      expect(mockRedis.script).toHaveBeenCalledWith('LOAD', expect.any(String));
      expect(mockRedis.evalsha).toHaveBeenCalledWith(
        'sha123',
        2,
        expect.stringContaining('user:123:main'),
        expect.stringContaining('user:123:burst'),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        '10',
        '20',
        '60',
        '10',
        expect.any(String),
      );
    });

    it('should BLOCK requests on Redis errors to protect the service (fail-closed)', async () => {
      mockRedis.eval.mockRejectedValue(new Error('Connection failed'));

      const result = await rateLimiter.checkRateLimit('user:123');

      // We now expect the request to be BLOCKED to protect the service.
      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });
  });

  describe('Retry Time Calculation', () => {
    it('should calculate retry time based on oldest request', async () => {
      mockRedis.eval.mockResolvedValue([0, 10, 4, 1, 0, Date.now() - 1000, -1]);

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should handle missing oldest request data', async () => {
      mockRedis.eval.mockResolvedValue([0, 10, 1, 1, 0, -1, -1]);

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(60_000); // Default to window size
    });
  });
});

describe('Rate Limit Middleware', () => {
  let rateLimiter: RateLimiterService;
  let mockRedis: {
    eval: ReturnType<typeof vi.fn>;
    evalsha: ReturnType<typeof vi.fn>;
    script: ReturnType<typeof vi.fn>;
    zcard: ReturnType<typeof vi.fn>;
  };
  const asRedis = (value: unknown): Redis => value as Redis;

  beforeEach(() => {
    mockRedis = {
      eval: vi.fn(),
      evalsha: vi.fn(),
      script: vi.fn(),
      zcard: vi.fn(),
    };

    (createRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(asRedis(mockRedis));
  });

  it('should handle rate limit exceeded', async () => {
    rateLimiter = new RateLimiterService(asRedis(mockRedis), {
      windowSize: 60 * 1000,
      maxRequests: 10,
      burstLimit: 20,
      burstWindow: 10 * 1000,
      keyPrefix: 'test:rate_limit',
    });

    mockRedis.eval.mockResolvedValue([0, 10, 2, 1, 0, -1, -1]);

    const result = await rateLimiter.checkRateLimit('user:123');

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeDefined();
  });

  it('should use IP address when no user authenticated', async () => {
    rateLimiter = new RateLimiterService(asRedis(mockRedis), {
      windowSize: 60 * 1000,
      maxRequests: 10,
      burstLimit: 20,
      burstWindow: 10 * 1000,
      keyPrefix: 'test:rate_limit',
    });

    mockRedis.eval.mockResolvedValue([1, 6, 4, 0, 0, -1, -1]);

    const result = await rateLimiter.checkRateLimit('192.168.1.1');

    expect(result.allowed).toBe(true);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      expect.stringContaining('192.168.1.1'),
      expect.stringContaining('192.168.1.1'),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      '10',
      '20',
      '60',
      '10',
      expect.any(String),
    );
  });

  it('should use request.ip for anonymous requests even when forwarded headers are spoofed', async () => {
    const checkRateLimit = vi.fn().mockResolvedValue({
      allowed: true,
      remainingRequests: 9,
      resetTime: Date.now() + 60_000,
      limit: 10,
      count: 1,
    });
    const middleware = createUploadRateLimitMiddleware({
      checkRateLimit,
    } as unknown as RateLimiterService);

    const mockRequest = {
      headers: {
        'x-forwarded-for': '203.0.113.9',
        'x-real-ip': '198.51.100.8',
      },
      ip: '10.0.0.5',
      user: null,
    };
    const mockReply = {
      header: vi.fn().mockReturnThis(),
    };

    await middleware(mockRequest as any, mockReply as any);

    expect(checkRateLimit).toHaveBeenCalledWith('ip:10.0.0.5');
  });

  it('should prefer authenticated user identifier over IP address', async () => {
    const checkRateLimit = vi.fn().mockResolvedValue({
      allowed: true,
      remainingRequests: 9,
      resetTime: Date.now() + 60_000,
      limit: 10,
      count: 1,
    });
    const middleware = createUploadRateLimitMiddleware({
      checkRateLimit,
    } as unknown as RateLimiterService);

    const mockRequest = {
      headers: {
        'x-forwarded-for': '203.0.113.9',
      },
      ip: '10.0.0.5',
      user: { id: 'user-42' },
    };
    const mockReply = {
      header: vi.fn().mockReturnThis(),
    };

    await middleware(mockRequest as any, mockReply as any);

    expect(checkRateLimit).toHaveBeenCalledWith('user:user-42');
  });
});
