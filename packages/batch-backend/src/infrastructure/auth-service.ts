// packages/batch-backend/src/infrastructure/auth-service.ts

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { logger } from './logger';

export interface JwtPayload {
  sub: string; // user ID
  email: string;
  role: string;
  iat: number;
  exp: number;
  type?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface AuthServiceConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenExpiresIn: string;
  bcryptRounds: number;
}

export class AuthService {
  private config: AuthServiceConfig;

  constructor(config: AuthServiceConfig) {
    this.config = config;
  }

  /**
   * Hash a password using bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    try {
      return await bcrypt.hash(password, this.config.bcryptRounds);
    } catch (error) {
      logger.error('Failed to hash password', { error: String(error) });
      throw new Error('Password hashing failed');
    }
  }

  /**
   * Verify a password against its hash
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      logger.error('Failed to verify password', { error: String(error) });
      throw new Error('Password verification failed');
    }
  }

  /**
   * Generate JWT access token
   */
  private generateAccessToken(userId: string, email: string, role: string): string {
    const payload = {
      sub: userId,
      email,
      role,
    };

    return jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: this.config.jwtExpiresIn,
      issuer: '@esl-pipeline/batch-backend',
    } as jwt.SignOptions);
  }

  /**
   * Generate JWT refresh token
   */
  private generateRefreshToken(userId: string, email: string, role: string): string {
    const payload = {
      sub: userId,
      email,
      role,
      type: 'refresh',
    };

    return jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: this.config.refreshTokenExpiresIn,
      issuer: '@esl-pipeline/batch-backend',
    } as jwt.SignOptions);
  }

  /**
   * Generate token pair (access + refresh tokens)
   */
  generateTokens(userId: string, email: string, role: string): TokenPair {
    const accessToken = this.generateAccessToken(userId, email, role);
    const refreshToken = this.generateRefreshToken(userId, email, role);

    // Calculate expiration times in seconds
    const accessExp = this.parseExpiration(this.config.jwtExpiresIn);
    const refreshExp = this.parseExpiration(this.config.refreshTokenExpiresIn);

    logger.info('Tokens generated', {
      userId,
      email,
      role,
      accessExpiresIn: accessExp,
      refreshExpiresIn: refreshExp,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExp,
      refreshExpiresIn: refreshExp,
    };
  }

  /**
   * Verify JWT token and return payload
   */
  verifyToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: '@esl-pipeline/batch-backend',
      }) as JwtPayload;

      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      } else {
        logger.error('Token verification failed', { error: String(error) });
        throw new Error('Token verification failed');
      }
    }
  }

  /**
   * Verify refresh token specifically
   */
  verifyRefreshToken(refreshToken: string): JwtPayload {
    try {
      const decoded = jwt.verify(refreshToken, this.config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: '@esl-pipeline/batch-backend',
      }) as JwtPayload;

      // Ensure this is a refresh token
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }

      return decoded;
    } catch (error) {
      // Handle specific error types first
      if (error instanceof jwt.TokenExpiredError) {
        throw new Error('Refresh token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid refresh token');
      } else if (error instanceof Error && error.message === 'Invalid token type') {
        // Re-throw the specific token type error
        throw error;
      } else {
        logger.error('Refresh token verification failed', { error: String(error) });
        throw new Error('Refresh token verification failed');
      }
    }
  }

  /**
   * Generate new tokens using a valid refresh token
   */
  refreshTokens(refreshToken: string): TokenPair {
    const payload = this.verifyRefreshToken(refreshToken);

    return this.generateTokens(payload.sub, payload.email, payload.role);
  }

  /**
   * Validate password strength
   */
  validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }

    if (!/(?=.*[a-z])/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }

    if (!/(?=.*[A-Z])/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }

    if (!/(?=.*\d)/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    if (!/(?=.*[@$!%*?&])/.test(password)) {
      errors.push('Password must contain at least one special character (@$!%*?&)');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate email format
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Parse expiration string to seconds
   */
  private parseExpiration(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match || !match[1] || !match[2]) {
      throw new Error(`Invalid expiration format: ${expiresIn}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 60 * 60 * 24;
      default:
        throw new Error(`Unknown time unit: ${unit}`);
    }
  }
}

/**
 * Create auth service from environment config
 */
export function createAuthService(config?: AuthServiceConfig): AuthService {
  if (config) {
    return new AuthService(config);
  }

  // Fallback to environment variables for backward compatibility
  const fallbackConfig: AuthServiceConfig = {
    jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12'),
  };

  return new AuthService(fallbackConfig);
}
