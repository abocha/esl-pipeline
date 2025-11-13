// packages/batch-backend/tests/transport.rate-limit-middleware.test.ts
//
// Tests for rate limiting middleware covering Redis-based rate limiting,
// burst handling, and middleware integration.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRateLimiterService, RateLimiterService, RateLimitError } from '../src/transport/rate-limit-middleware';
import { createRedisClient } from '../src/infrastructure/redis';

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
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = {
      zremrangebyscore: vi.fn(),
      zcard: vi.fn(),
      zadd: vi.fn(),
      expire: vi.fn(),
      keys: vi.fn(),
      zrange: vi.fn(),
    };

    (createRedisClient as any).mockReturnValue(mockRedis);

    // Create with Redis enabled
    rateLimiter = new RateLimiterService(mockRedis, {
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
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard
        .mockResolvedValueOnce(5) // 5 requests in main window
        .mockResolvedValueOnce(5); // 5 requests in burst window
      mockRedis.zadd.mockResolvedValue(1);

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(true);
      expect(result.remainingRequests).toBe(4); // 10 - 6 = 4
      expect(result.count).toBe(6);
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        expect.stringContaining('user:123:main'),
        expect.any(Number),
        expect.any(String),
      );
      expect(mockRedis.zadd).toHaveBeenCalledWith(
        expect.stringContaining('user:123:burst'),
        expect.any(Number),
        expect.any(String),
      );
    });

    it('should block requests over main window limit', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard
        .mockResolvedValueOnce(10) // Main window at limit
        .mockResolvedValueOnce(5); // Burst window allows
      mockRedis.zadd.mockResolvedValue(1);

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });

it('should block when both windows exceed limits', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      // This mock now responds based on the key, not call order.
      mockRedis.zcard.mockImplementation(async (key: string) => {
        if (key.includes(':main')) {
          return 10; // Main window is full
        }
        if (key.includes(':burst')) {
          return 20; // Burst window is full
        }
        return 0;
      });

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });
  });

  describe('Redis Operations', () => {
    it('should clean expired entries', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(5);
      mockRedis.zcard.mockResolvedValue(3);

      await rateLimiter.checkRateLimit('user:123');

      expect(mockRedis.zremrangebyscore).toHaveBeenCalledWith(expect.any(String), 0, expect.any(Number));
    });

    it('should set TTL on keys', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValue(2);
      mockRedis.zadd.mockResolvedValue(1);

      await rateLimiter.checkRateLimit('user:123');

      expect(mockRedis.expire).toHaveBeenCalledWith(expect.stringContaining(':main'), 60);
      expect(mockRedis.expire).toHaveBeenCalledWith(expect.stringContaining(':burst'), 10);
    });

it('should BLOCK requests on Redis errors to protect the service (fail-closed)', async () => {
      mockRedis.zcard.mockRejectedValue(new Error('Connection failed'));

      const result = await rateLimiter.checkRateLimit('user:123');

      // We now expect the request to be BLOCKED to protect the service.
      expect(result.allowed).toBe(false);
      expect(result.remainingRequests).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });
  });


  describe('Retry Time Calculation', () => {
    it('should calculate retry time based on oldest request', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValue(10);
      mockRedis.zrange.mockResolvedValue(['', '1699123456000']); // 1 minute ago

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('should handle missing oldest request data', async () => {
      mockRedis.zremrangebyscore.mockResolvedValue(0);
      mockRedis.zcard.mockResolvedValue(10);
      mockRedis.zrange.mockResolvedValue([]);

      const result = await rateLimiter.checkRateLimit('user:123');

      expect(result.allowed).toBe(false);
      expect(result.retryAfter).toBe(60000); // Default to window size
    });
  });
});

describe('Rate Limit Middleware', () => {
  let rateLimiter: RateLimiterService;
  let mockRedis: any;

  beforeEach(() => {
    mockRedis = {
      zremrangebyscore: vi.fn(),
      zcard: vi.fn(),
      zadd: vi.fn(),
      expire: vi.fn(),
      keys: vi.fn(),
      zrange: vi.fn(),
    };

    (createRedisClient as any).mockReturnValue(mockRedis);
  });

  it('should handle rate limit exceeded', async () => {
    rateLimiter = new RateLimiterService(mockRedis, {
      windowSize: 60 * 1000,
      maxRequests: 10,
      burstLimit: 20,
      burstWindow: 10 * 1000,
      keyPrefix: 'test:rate_limit',
    });

    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(10);
    mockRedis.zrange.mockResolvedValue([]);

    const result = await rateLimiter.checkRateLimit('user:123');

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeDefined();
  });

  it('should use IP address when no user authenticated', async () => {
    rateLimiter = new RateLimiterService(mockRedis, {
      windowSize: 60 * 1000,
      maxRequests: 10,
      burstLimit: 20,
      burstWindow: 10 * 1000,
      keyPrefix: 'test:rate_limit',
    });

    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(5);
    mockRedis.zadd.mockResolvedValue(1);

    const result = await rateLimiter.checkRateLimit('192.168.1.1');

    expect(result.allowed).toBe(true);
    expect(mockRedis.zadd).toHaveBeenCalledWith(
      expect.stringContaining('192.168.1.1'),
      expect.any(Number),
      expect.any(String),
    );
  });

  it('should integrate with Fastify middleware pattern', async () => {
    const mockRequest = {
      headers: { 'x-forwarded-for': '192.168.1.1' },
      user: null,
    };
    const mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };
    const mockNext = vi.fn();

    rateLimiter = new RateLimiterService(mockRedis, {
      windowSize: 60 * 1000,
      maxRequests: 10,
      burstLimit: 20,
      burstWindow: 10 * 1000,
      keyPrefix: 'test:rate_limit',
    });

    mockRedis.zremrangebyscore.mockResolvedValue(0);
    mockRedis.zcard.mockResolvedValue(5);
    mockRedis.zadd.mockResolvedValue(1);

    const middleware = async (request: any, reply: any, next: any) => {
      const identifier = request.headers['x-forwarded-for'] || 'unknown';
      const result = await rateLimiter.checkRateLimit(identifier);
      
      if (!result.allowed) {
        reply.code(429).send({ error: 'Rate limit exceeded' });
        return;
      }
      
      next();
    };

    await middleware(mockRequest, mockReply, mockNext);

    expect(mockReply.code).not.toHaveBeenCalledWith(429);
    expect(mockNext).toHaveBeenCalled();
  });
});
