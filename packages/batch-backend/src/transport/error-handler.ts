// packages/batch-backend/src/transport/error-handler.ts
//
// Centralized error handling middleware for Fastify.
// Provides structured error responses, logging, and security considerations.
import { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { ValidationError } from '../application/submit-job.js';
import { FileSanitizationError } from '../infrastructure/file-sanitization-service.js';
import { FileValidationError } from '../infrastructure/file-validation-service.js';
import { logger } from '../infrastructure/logger.js';
import { AuthenticationError, AuthorizationError } from './auth-middleware.js';
import { RateLimitError } from './rate-limit-middleware.js';

export interface ErrorResponse {
  error: string;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
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
function classifyError(error: unknown): ErrorType {
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
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return ErrorType.CLIENT_ERROR;
    }
  }
  return ErrorType.SERVER_ERROR;
}

/**
 * Create standardized error response
 */
function createErrorResponse(
  error: unknown,
  request: FastifyRequest,
  errorType: ErrorType,
): ErrorResponse {
  const baseResponse: ErrorResponse = {
    error: getErrorCode(errorType),
    message: getSafeErrorMessage(error, errorType),
    code:
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : error &&
            typeof error === 'object' &&
            'name' in error &&
            typeof (error as { name?: unknown }).name === 'string'
          ? (error as { name: string }).name
          : undefined,
    timestamp: new Date().toISOString(),
    requestId: (request as { id?: string }).id,
  };

  // For ZodError, extract first error details for backward compatibility
  if (
    errorType === ErrorType.VALIDATION_ERROR &&
    error instanceof ZodError &&
    error.issues.length > 0
  ) {
    const firstError = error.issues[0];
    if (firstError) {
      baseResponse.message = firstError.message;
      baseResponse.code = firstError.code || 'validation_failed';
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
function getHttpStatus(errorType: ErrorType, originalError?: unknown): number {
  switch (errorType) {
    case ErrorType.AUTHENTICATION_ERROR: {
      return 401;
    }
    case ErrorType.AUTHORIZATION_ERROR: {
      return 403;
    }
    case ErrorType.RATE_LIMIT_ERROR: {
      return 429;
    }
    case ErrorType.VALIDATION_ERROR: {
      return 400;
    }
    case ErrorType.CLIENT_ERROR: {
      return originalError &&
        typeof originalError === 'object' &&
        'statusCode' in originalError &&
        typeof originalError.statusCode === 'number'
        ? originalError.statusCode
        : 400;
    }
    default: {
      return 500;
    }
  }
}

/**
 * Get error code string for response
 */
function getErrorCode(errorType: ErrorType): string {
  switch (errorType) {
    case ErrorType.AUTHENTICATION_ERROR: {
      return 'unauthorized';
    }
    case ErrorType.AUTHORIZATION_ERROR: {
      return 'forbidden';
    }
    case ErrorType.RATE_LIMIT_ERROR: {
      return 'rate_limit_exceeded';
    }
    case ErrorType.VALIDATION_ERROR: {
      return 'validation_failed';
    }
    case ErrorType.CLIENT_ERROR: {
      return 'client_error';
    }
    default: {
      return 'internal_error';
    }
  }
}

/**
 * Get safe error message that doesn't leak sensitive information
 */
function getSafeErrorMessage(error: unknown, errorType: ErrorType): string {
  // For server errors, always use generic message
  if (errorType === ErrorType.SERVER_ERROR) {
    return 'An internal server error occurred';
  }

  // For authentication/authorization errors, use safe messages
  if (errorType === ErrorType.AUTHENTICATION_ERROR || errorType === ErrorType.AUTHORIZATION_ERROR) {
    return error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
      ? error.message
      : 'Access denied';
  }

  // For validation errors, use the error message but sanitize if needed
  if (errorType === ErrorType.VALIDATION_ERROR) {
    return error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof error.message === 'string'
      ? error.message
      : 'Validation failed';
  }

  // For rate limiting, use standard message
  if (errorType === ErrorType.RATE_LIMIT_ERROR) {
    return 'Rate limit exceeded';
  }

  // For other client errors, use the original message if safe
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.length < 200
  ) {
    return error.message;
  }

  return 'An error occurred';
}

/**
 * Redact sensitive data from error context
 */
function redactSensitiveData(context: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'authorization'];
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(context)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

/**
 * Log error with appropriate level and context
 */
function logError(error: unknown, request: FastifyRequest, errorType: ErrorType): void {
  const logContext = {
    event: 'http_error',
    errorType,
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    requestId: (request as { id?: string }).id,
    userId: (request as { user?: { id?: string } }).user?.id,
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
export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
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
      requestId: (request as { id?: string }).id,
      method: request.method,
      url: request.url,
    });

    reply.code(500).send({
      error: 'internal_error',
      message: 'An internal server error occurred',
      timestamp: new Date().toISOString(),
      requestId: (request as { id?: string }).id,
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
    (request as { id?: string }).id =
      request.id || `req_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    done();
  });
}
