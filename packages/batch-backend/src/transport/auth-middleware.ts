// packages/batch-backend/src/transport/auth-middleware.ts

import { FastifyRequest, FastifyReply } from 'fastify';
import { JwtPayload } from '../infrastructure/auth-service';
import { UserRole } from '../domain/user-model';
import { logger } from '../infrastructure/logger';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends FastifyRequest {
  user: AuthenticatedUser;
}

/**
 * Authentication error classes
 */
export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

/**
 * Extract JWT token from Authorization header
 */
function extractTokenFromHeader(authHeader: string | undefined): string {
  if (!authHeader) {
    throw new AuthenticationError('Authorization header is missing');
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw new AuthenticationError('Invalid authorization header format. Expected: Bearer <token>');
  }

  return parts[1]!;
}

/**
 * Verify JWT token and extract user information
 */
async function verifyToken(token: string): Promise<AuthenticatedUser> {
  try {
    // Import here to avoid circular dependency
    const { createAuthService } = await import('../infrastructure/auth-service.js');
    const authService = createAuthService();
    
    const payload = authService.verifyToken(token);
    
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role as UserRole,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Token expired') {
        throw new AuthenticationError('Token has expired');
      } else if (error.message === 'Invalid token') {
        throw new AuthenticationError('Invalid token');
      } else {
        throw new AuthenticationError('Token verification failed');
      }
    } else {
      throw new AuthenticationError('Token verification failed');
    }
  }
}

/**
 * Authentication middleware
 * 
 * Usage:
 * - app.get('/protected', { preHandler: authenticate }, handler)
 * 
 * This middleware:
 * - Extracts JWT from Authorization header
 * - Verifies token validity
 * - Adds authenticated user to request object
 * - Throws 401 if authentication fails
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    const token = extractTokenFromHeader(authHeader);
    
    const user = await verifyToken(token);
    
    // Add user to request object
    (request as AuthenticatedRequest).user = user;
    
    logger.debug('User authenticated', {
      userId: user.id,
      email: user.email,
      role: user.role,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      logger.warn('Authentication failed', {
        error: error.message,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        path: request.url,
      });
      
      return reply.code(401).send({
        error: 'unauthorized',
        message: error.message,
      });
    }
    
    // Unexpected error
    logger.error('Authentication middleware error', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      path: request.url,
    });
    
    return reply.code(500).send({
      error: 'internal_error',
      message: 'Authentication service error',
    });
  }
}

/**
 * Role-based authorization middleware factory
 * 
 * @param allowedRoles - Array of roles that are allowed to access the endpoint
 * 
 * Usage:
 * - app.get('/admin', { preHandler: requireRole(['admin']) }, handler)
 * - app.post('/api', { preHandler: requireRole(['admin', 'user']) }, handler)
 */
export function requireRole(allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      // Ensure user is authenticated first
      if (!(request as AuthenticatedRequest).user) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Authentication required',
        });
      }
      
      const authenticatedUser = (request as AuthenticatedRequest).user;
      
      // Check if user has required role
      if (!allowedRoles.includes(authenticatedUser.role)) {
        logger.warn('Authorization failed - insufficient permissions', {
          userId: authenticatedUser.id,
          email: authenticatedUser.email,
          userRole: authenticatedUser.role,
          requiredRoles: allowedRoles,
          ip: request.ip,
          userAgent: request.headers['user-agent'],
          path: request.url,
        });
        
        return reply.code(403).send({
          error: 'forbidden',
          message: 'Insufficient permissions',
          requiredRoles: allowedRoles,
        });
      }
      
      logger.debug('Authorization successful', {
        userId: authenticatedUser.id,
        email: authenticatedUser.email,
        userRole: authenticatedUser.role,
        requiredRoles: allowedRoles,
        path: request.url,
      });
      
    } catch (error) {
      logger.error('Authorization middleware error', {
        error: String(error),
        stack: error instanceof Error ? error.stack : undefined,
        userId: (request as AuthenticatedRequest).user?.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        path: request.url,
      });
      
      return reply.code(500).send({
        error: 'internal_error',
        message: 'Authorization service error',
      });
    }
  };
}

/**
 * Optional authentication middleware
 * 
 * Like authenticate() but doesn't require authentication.
 * If token is provided and valid, user is added to request.
 * If no token or invalid token, request proceeds without user.
 * 
 * Usage:
 * - app.get('/optional', { preHandler: optionalAuth }, handler)
 */
export async function optionalAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      // No authorization header, proceed without authentication
      return;
    }
    
    try {
      const token = extractTokenFromHeader(authHeader);
      const user = await verifyToken(token);
      
      // Add user to request object
      (request as AuthenticatedRequest).user = user;
      
      logger.debug('Optional authentication successful', {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
    } catch (error) {
      // Token verification failed, but that's ok for optional auth
      // Log for debugging but don't fail the request
      logger.debug('Optional authentication failed (ignoring)', {
        error: error instanceof Error ? error.message : String(error),
        ip: request.ip,
        userAgent: request.headers['user-agent'],
        path: request.url,
      });
    }
  } catch (error) {
    // Unexpected error in optional auth
    logger.error('Optional authentication middleware error', {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
      path: request.url,
    });
    
    // For optional auth, we don't want to fail the request
    // Just log the error and continue
  }
}

/**
 * Helper function to get authenticated user from request
 */
export function getAuthenticatedUser(request: FastifyRequest): AuthenticatedUser | null {
  return (request as AuthenticatedRequest).user || null;
}

/**
 * Helper function to check if user has any of the required roles
 */
export function userHasRole(user: AuthenticatedUser | null, requiredRoles: UserRole[]): boolean {
  if (!user) {
    return false;
  }
  
  return requiredRoles.includes(user.role);
}