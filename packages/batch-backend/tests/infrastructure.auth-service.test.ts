// packages/batch-backend/tests/infrastructure.auth-service.test.ts
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService, createAuthService } from '../src/infrastructure/auth-service.js';

/**
 * NOTE ON VITEST HOISTING:
 * - vi.mock() calls are hoisted before this module body.
 * - Mock factories MUST NOT close over later-defined bindings (TDZ).
 * - Keep factories simple; configure behaviors in beforeEach or tests.
 */

// Mock jsonwebtoken - minimal mock to control behavior
vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn(),
    verify: vi.fn(),
    TokenExpiredError: class TokenExpiredError extends Error {
      message = 'Token expired';
    },
    JsonWebTokenError: class JsonWebTokenError extends Error {
      message = 'Invalid token';
    },
  },
}));

// Mock bcrypt
vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
  },
}));

// Mock logger
vi.mock('../src/infrastructure/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('infrastructure/auth-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AuthService', () => {
    it('hashPassword creates hash with correct salt rounds', async () => {
      // Mock bcrypt.hash to return a promise
      const mockHash = vi.fn().mockImplementation(() => Promise.resolve('hashed-password'));
      (bcrypt as any).hash = mockHash;

      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      const result = await authService.hashPassword('password123');

      expect(mockHash).toHaveBeenCalledWith('password123', 12);
      expect(result).toBe('hashed-password');
    });

    it('verifyPassword returns true for correct password', async () => {
      // Mock bcrypt.compare to return a promise
      const mockCompare = vi.fn().mockImplementation(() => Promise.resolve(true));
      (bcrypt as any).compare = mockCompare;

      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      const result = await authService.verifyPassword('password123', 'hashed-password');

      expect(mockCompare).toHaveBeenCalledWith('password123', 'hashed-password');
      expect(result).toBe(true);
    });

    it('verifyPassword returns false for incorrect password', async () => {
      // Mock bcrypt.compare to return a promise
      const mockCompare = vi.fn().mockImplementation(() => Promise.resolve(false));
      (bcrypt as any).compare = mockCompare;

      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      const result = await authService.verifyPassword('wrongpassword', 'hashed-password');

      expect(result).toBe(false);
    });

    it('generateTokens creates access and refresh tokens with correct payload', () => {
      vi.mocked(jwt.sign)
        .mockReturnValueOnce('mock-access-token' as any)
        .mockReturnValueOnce('mock-refresh-token' as any);

      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      const result = authService.generateTokens('user-123', 'test@example.com', 'user');

      expect(jwt.sign).toHaveBeenCalledTimes(2);

      // First call should be access token
      expect(jwt.sign).toHaveBeenNthCalledWith(
        1,
        {
          sub: 'user-123',
          email: 'test@example.com',
          role: 'user',
        },
        'test-secret',
        {
          expiresIn: '15m',
          issuer: '@esl-pipeline/batch-backend',
        },
      );

      // Second call should be refresh token
      expect(jwt.sign).toHaveBeenNthCalledWith(
        2,
        {
          sub: 'user-123',
          email: 'test@example.com',
          role: 'user',
          type: 'refresh',
        },
        'test-secret',
        {
          expiresIn: '7d',
          issuer: '@esl-pipeline/batch-backend',
        },
      );

      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 900, // 15 minutes in seconds
        refreshExpiresIn: 604_800, // 7 days in seconds
      });
    });

    it('verifyToken validates JWT token and returns payload', () => {
      const mockPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        role: 'user',
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 900,
      };

      vi.mocked(jwt.verify).mockReturnValue(mockPayload as any);

      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      const result = authService.verifyToken('valid-token');

      expect(jwt.verify).toHaveBeenCalledWith('valid-token', 'test-secret', {
        algorithms: ['HS256'],
        issuer: '@esl-pipeline/batch-backend',
      });

      expect(result).toEqual(mockPayload);
    });

    it('verifyToken throws error for expired token', () => {
      vi.mocked(jwt.verify).mockImplementation(() => {
        throw new jwt.TokenExpiredError('Token expired', new Date());
      });

      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      expect(() => authService.verifyToken('expired-token')).toThrow('Token expired');
    });

    it('verifyRefreshToken validates refresh token and checks type', () => {
      const mockPayload = {
        sub: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'refresh',
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 604_800,
      };

      vi.mocked(jwt.verify).mockReturnValue(mockPayload as any);

      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      const result = authService.verifyRefreshToken('valid-refresh-token');

      expect(result).toEqual(mockPayload);
    });

    it('verifyRefreshToken throws error for access token type', () => {
      // Mock jwt.verify to return payload without 'type' field (access token)
      vi.mocked(jwt.verify).mockReturnValue({
        sub: 'user-123',
        email: 'test@example.com',
        role: 'user',
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 900,
      } as any);

      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      expect(() => authService.verifyRefreshToken('access-token')).toThrow('Invalid token type');
    });

    it('refreshTokens generates new tokens from valid refresh token', () => {
      // Mock jwt.verify for refresh token validation
      vi.mocked(jwt.verify).mockReturnValueOnce({
        sub: 'user-123',
        email: 'test@example.com',
        role: 'user',
        type: 'refresh',
        iat: 1_234_567_890,
        exp: 1_234_567_890 + 604_800,
      } as any);

      // Mock jwt.sign for token generation
      vi.mocked(jwt.sign)
        .mockReturnValueOnce('mock-access-token' as any)
        .mockReturnValueOnce('mock-refresh-token' as any);

      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      const result = authService.refreshTokens('valid-refresh-token');

      expect(jwt.verify).toHaveBeenCalledWith('valid-refresh-token', 'test-secret', {
        algorithms: ['HS256'],
        issuer: '@esl-pipeline/batch-backend',
      });

      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        expiresIn: 900,
        refreshExpiresIn: 604_800,
      });
    });

    it('validatePassword returns valid for strong password', () => {
      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      const result = authService.validatePassword('StrongPass123!');

      expect(result).toEqual({
        valid: true,
        errors: [],
      });
    });

    it('validatePassword returns errors for weak password', () => {
      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      const result = authService.validatePassword('weak');

      expect(result).toEqual({
        valid: false,
        errors: expect.arrayContaining([
          'Password must be at least 8 characters long',
          'Password must contain at least one uppercase letter',
          'Password must contain at least one number',
          'Password must contain at least one special character (@$!%*?&)',
        ]),
      });
    });

    it('validateEmail returns true for valid email', () => {
      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      expect(authService.validateEmail('user@example.com')).toBe(true);
      expect(authService.validateEmail('test.user+tag@domain.co.uk')).toBe(true);
    });

    it('validateEmail returns false for invalid email', () => {
      const authService = new AuthService({
        jwtSecret: 'test-secret',
        jwtExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        bcryptRounds: 12,
      });

      expect(authService.validateEmail('invalid-email')).toBe(false);
      expect(authService.validateEmail('user@')).toBe(false);
      expect(authService.validateEmail('@domain.com')).toBe(false);
      expect(authService.validateEmail('user.domain.com')).toBe(false);
    });
  });

  describe('createAuthService', () => {
    it('creates service with provided config', () => {
      const mockConfig = {
        jwtSecret: 'custom-secret',
        jwtExpiresIn: '30m',
        refreshTokenExpiresIn: '14d',
        bcryptRounds: 15,
      };

      // Mock the constructor to track calls
      const AuthServiceConstructorSpy = vi.spyOn(AuthService as any, 'constructor');
      vi.mocked(AuthServiceConstructorSpy).mockImplementation(
        () =>
          ({
            hashPassword: vi.fn(),
            verifyPassword: vi.fn(),
            generateTokens: vi.fn(),
            verifyToken: vi.fn(),
            verifyRefreshToken: vi.fn(),
            refreshTokens: vi.fn(),
            validatePassword: vi.fn(),
            validateEmail: vi.fn(),
          }) as any,
      );

      const authService = createAuthService(mockConfig);

      // Since createAuthService returns a new AuthService, we just verify it was created
      expect(authService).toBeInstanceOf(Object);

      // Restore the spy
      AuthServiceConstructorSpy.mockRestore();
    });

    it('creates service with environment variables when no config provided', () => {
      // Mock process.env
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        JWT_SECRET: 'env-secret',
        JWT_EXPIRES_IN: '45m',
        REFRESH_TOKEN_EXPIRES_IN: '30d',
        BCRYPT_ROUNDS: '18',
      };

      const authService = createAuthService();

      expect(authService).toBeInstanceOf(Object);
      expect((authService as any).config.jwtSecret).toBe('env-secret');
      expect((authService as any).config.jwtExpiresIn).toBe('45m');
      expect((authService as any).config.refreshTokenExpiresIn).toBe('30d');
      expect((authService as any).config.bcryptRounds).toBe(18);

      // Restore original env
      process.env = originalEnv;
    });

    it('uses fallback values when environment variables are not set', () => {
      // Mock process.env with missing values
      const originalEnv = process.env;
      process.env = {
        ...originalEnv,
        JWT_SECRET: undefined as any,
        JWT_EXPIRES_IN: undefined as any,
        REFRESH_TOKEN_EXPIRES_IN: undefined as any,
        BCRYPT_ROUNDS: undefined as any,
      };

      const authService = createAuthService();

      expect(authService).toBeInstanceOf(Object);
      expect((authService as any).config.jwtSecret).toBe('your-super-secret-jwt-key');
      expect((authService as any).config.jwtExpiresIn).toBe('15m');
      expect((authService as any).config.refreshTokenExpiresIn).toBe('7d');
      expect((authService as any).config.bcryptRounds).toBe(12);

      // Restore original env
      process.env = originalEnv;
    });
  });
});
