// packages/batch-backend/src/transport/error-handler.ts
//
// Centralized error handling middleware for Fastify.
// Provides structured error responses, logging, and security considerations.

import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../infrastructure/logger';
import { AuthenticationError, AuthorizationError } from './auth-middleware';
import { RateLimitError } from './rate-limit-middleware';
import { FileValidationError } from '../infrastructure/file-validation-service';
import { FileSanitizationError } from '../infrastructure/file-sanitization-service';
import { ValidationError } from '../application/submit-job';
import { ZodError } from 'zod';

export interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: Record<string, any>;
  timestamp?: string;
  requestId?: string;
}

/**
 * Error classification for consistent handling
 */
export enum ErrorType {
  CLIENT_ERROR = 'client_error',
  SERVER_ERROR = 'server_error',
  AUTHENTICATION_ERROR = 'authentication_error',
  AUTHORIZATION_ERROR = 'authorization_error',
  VALIDATION_ERROR = 'validation_error',
  RATE_LIMIT_ERROR = 'rate_limit_error',
}

/**
 * Classify error type from various error sources
 */
function classifyError(error: any): ErrorType {
  if (error instanceof AuthenticationError) {
    return ErrorType.AUTHENTICATION_ERROR;
  }
  if (error instanceof AuthorizationError) {
    return ErrorType.AUTHORIZATION_ERROR;
  }
  if (error instanceof RateLimitError) {
    return ErrorType.RATE_LIMIT_ERROR;
  }
  if (
    error instanceof ValidationError ||
    error instanceof FileValidationError ||
    error instanceof FileSanitizationError ||
    error instanceof ZodError
  ) {
    return ErrorType.VALIDATION_ERROR;
  }
  if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return ErrorType.CLIENT_ERROR;
  }
  return ErrorType.SERVER_ERROR;
}

/**
 * Create standardized error response
 */
function createErrorResponse(
  error: any,
  request: FastifyRequest,
  errorType: ErrorType
): ErrorResponse {
  const baseResponse: ErrorResponse = {
    error: getErrorCode(errorType),
    message: getSafeErrorMessage(error, errorType),
    code: error.code || error.name || undefined,
    timestamp: new Date().toISOString(),
    requestId: (request as any).id,
  };

  // For ZodError, extract first error details for backward compatibility
  if (errorType === ErrorType.VALIDATION_ERROR && error instanceof ZodError) {
    if (error.issues.length > 0) {
      const firstError = error.issues[0];
      if (firstError) {
        baseResponse.message = firstError.message;
        baseResponse.code = firstError.code || 'validation_failed';
      }
    }
  }

  // Add retry information for rate limiting
  if (errorType === ErrorType.RATE_LIMIT_ERROR && error instanceof RateLimitError) {
    baseResponse.details = {
      retryAfter: error.retryAfter,
      limit: error.limit,
      count: error.count,
    };
  }

  return baseResponse;
}

/**
 * Get HTTP status code for error type
 */
function getHttpStatus(errorType: ErrorType, originalError?: any): number {
  switch (errorType) {
    case ErrorType.AUTHENTICATION_ERROR:
      return 401;
    case ErrorType.AUTHORIZATION_ERROR:
      return 403;
    case ErrorType.RATE_LIMIT_ERROR:
      return 429;
    case ErrorType.VALIDATION_ERROR:
      return 400;
    case ErrorType.CLIENT_ERROR:
      return originalError?.statusCode || 400;
    case ErrorType.SERVER_ERROR:
    default:
      return 500;
  }
}

/**
 * Get error code string for response
 */
function getErrorCode(errorType: ErrorType): string {
  switch (errorType) {
    case ErrorType.AUTHENTICATION_ERROR:
      return 'unauthorized';
    case ErrorType.AUTHORIZATION_ERROR:
      return 'forbidden';
    case ErrorType.RATE_LIMIT_ERROR:
      return 'rate_limit_exceeded';
    case ErrorType.VALIDATION_ERROR:
      return 'validation_failed';
    case ErrorType.CLIENT_ERROR:
      return 'client_error';
    case ErrorType.SERVER_ERROR:
    default:
      return 'internal_error';
  }
}

/**
 * Get safe error message that doesn't leak sensitive information
 */
function getSafeErrorMessage(error: any, errorType: ErrorType): string {
  // For server errors, always use generic message
  if (errorType === ErrorType.SERVER_ERROR) {
    return 'An internal server error occurred';
  }

  // For authentication/authorization errors, use safe messages
  if (errorType === ErrorType.AUTHENTICATION_ERROR || errorType === ErrorType.AUTHORIZATION_ERROR) {
    return error.message || 'Access denied';
  }

  // For validation errors, use the error message but sanitize if needed
  if (errorType === ErrorType.VALIDATION_ERROR) {
    return error.message || 'Validation failed';
  }

  // For rate limiting, use standard message
  if (errorType === ErrorType.RATE_LIMIT_ERROR) {
    return 'Rate limit exceeded';
  }

  // For other client errors, use the original message if safe
  if (typeof error.message === 'string' && error.message.length < 200) {
    return error.message;
  }

  return 'An error occurred';
}

/**
 * Redact sensitive data from error context
 */
function redactSensitiveData(context: Record<string, any>): Record<string, any> {
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'authorization'];
  const redacted: Record<string, any> = {};

  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Log error with appropriate level and context
 */
function logError(error: any, request: FastifyRequest, errorType: ErrorType): void {
  const logContext = {
    event: 'http_error',
    errorType,
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    requestId: (request as any).id,
    userId: (request as any).user?.id,
    ...redactSensitiveData({
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : String(error),
    }),
  };

  // Log server errors as errors, client errors as warnings
  if (errorType === ErrorType.SERVER_ERROR) {
    logger.error('HTTP request failed with server error', logContext);
  } else {
    logger.warn('HTTP request failed with client error', logContext);
  }
}

/**
 * Global error handler middleware for Fastify
 */
export function errorHandler(error: any, request: FastifyRequest, reply: FastifyReply): void {
  try {
    const errorType = classifyError(error);
    const statusCode = getHttpStatus(errorType, error);

    // Log the error
    logError(error, request, errorType);

    // Create standardized response
    const errorResponse = createErrorResponse(error, request, errorType);

    // Send response
    reply.code(statusCode).send(errorResponse);
  } catch (handlerError) {
    // If error handling itself fails, log and send generic response
    logger.error('Error handler failed', {
      originalError: String(error),
      handlerError: handlerError instanceof Error ? handlerError.message : String(handlerError),
      requestId: (request as any).id,
      method: request.method,
      url: request.url,
    });

    reply.code(500).send({
      error: 'internal_error',
      message: 'An internal server error occurred',
      timestamp: new Date().toISOString(),
      requestId: (request as any).id,
    });
  }
}

/**
 * Hook to register error handler with Fastify
 */
export function registerErrorHandler(app: import('fastify').FastifyInstance): void {
  app.setErrorHandler(errorHandler);

  // Add request ID generation
  app.addHook('onRequest', (request, reply, done) => {
    (request as any).id =
      request.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    done();
  });
}
