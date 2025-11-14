// packages/batch-backend/src/transport/http-server.ts
//
// Fastify HTTP server exposing a minimal API:
// - POST /jobs      -> submit a new ESL pipeline job
// - GET /jobs/:id   -> fetch job status
// Designed to be run as a containerized service.

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { loadConfig } from '../config/env';
import { logger } from '../infrastructure/logger';
import { registerErrorHandler } from './error-handler';
import { registerSecurityHeaders } from './security-headers';
import { submitJob, ValidationError, type SubmitJobRequest } from '../application/submit-job';
import { getJobStatus } from '../application/get-job-status';
import {
  authenticate,
  requireRole,
  optionalAuth,
  getAuthenticatedUser,
  AuthenticationError,
  AuthorizationError,
  type AuthenticatedRequest
} from './auth-middleware';
import {
  createAuthService
} from '../infrastructure/auth-service';
import {
  createUser,
  getUserByEmail,
  updateUser,
  updateUserLastLogin,
  getUserById,
  getAllUsers,
  countUsers
} from '../domain/user-repository';
import {
  UserRegistration,
  UserLogin,
  UserRole,
  isValidRole,
  sanitizeUser
} from '../domain/user-model';
import {
  createFileValidationService,
  FileValidationError
} from '../infrastructure/file-validation-service';
import {
  createFileSanitizationService,
  FileSanitizationError
} from '../infrastructure/file-sanitization-service';
import {
  createRateLimiterService,
  createUploadRateLimitMiddleware,
  RateLimitError,
  RateLimiterService
} from './rate-limit-middleware';
import {
  createStorageConfigService,
  type StorageConfig
} from '../infrastructure/storage-config';
import {
  createFileStorageService
} from '../infrastructure/file-storage-service';
import {
  createRedisClient
} from '../infrastructure/redis';

function errorResponse(
  reply: import('fastify').FastifyReply,
  type: 'validation_failed' | 'not_found' | 'internal_error',
  extras?: Record<string, any>
) {
  if (type === 'validation_failed') {
    const { message, code } = extras ?? {};
    return reply.code(400).send({
      error: 'validation_failed',
      message: String(message ?? 'Validation failed'),
      code: String(code ?? 'validation_failed'),
    });
  }

  if (type === 'not_found') {
    return reply.code(404).send({ error: 'not_found' });
  }

  // internal_error is always 500 with a stable shape
  return reply.code(500).send({ error: 'internal_error' });
}

/**
 * Helper function to read file stream into buffer
 */
async function readFileBuffer(fileStream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  
  return new Promise((resolve, reject) => {
    fileStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    fileStream.on('end', () => resolve(Buffer.concat(chunks)));
    fileStream.on('error', reject);
  });
}

/**
 * createHttpServer.declaration()
 *
 * Creates a Fastify instance with the canonical HTTP routes registered.
 * - Does NOT call listen.
 * - Intended for tests and programmatic embedding.
 *
 * Canonical HTTP behavior (must remain stable):
 * - POST /jobs
 *   - 202: { jobId }
 *   - 400: { error: "validation_failed", message, code }
 *   - 500: { error: "internal_error" }
 * - GET /jobs/:jobId
 *   - 200: DTO
 *   - 404: { error: "not_found" }
 *   - 500: { error: "internal_error" }
 */
export function createHttpServer(): import('fastify').FastifyInstance {
  const config = loadConfig();
  const app = Fastify({
    logger: false,
  });

  // Register centralized error handler
  registerErrorHandler(app);

  // Register security headers
  registerSecurityHeaders(app);

  const extendedApiEnabled = config.experimental.extendedApiEnabled;

  const jobRateLimiter =
    config.security.enableRateLimiting && config.security.jobSubmissionRateLimit > 0
      ? new RateLimiterService(createRedisClient(), {
          windowSize: 60 * 1000, // 1 minute
          maxRequests: config.security.jobSubmissionRateLimit,
          burstLimit: config.security.jobSubmissionRateLimit * 2,
          burstWindow: 10 * 1000, // 10 seconds
          keyPrefix: 'rate_limit:job_submit',
        })
      : null;
  const jobRateLimitMiddleware = jobRateLimiter
    ? createUploadRateLimitMiddleware(jobRateLimiter)
    : null;

  const handleSubmitJob: import('fastify').RouteHandlerMethod = async (request, reply) => {
    const body = request.body as SubmitJobRequest | undefined;

    // Validate request with Zod schema
    const jobSchema = z.object({
      md: z.string().min(1, 'md is required'),
      preset: z.string().optional(),
      withTts: z.boolean().optional(),
      upload: z.enum(['s3', 'none']).optional(),
    });

    const validatedData = jobSchema.parse(body);

    const result = await submitJob({
      md: validatedData.md,
      preset: validatedData.preset,
      withTts: validatedData.withTts,
      upload: validatedData.upload,
    });

    logger.info('HTTP request handled', {
      event: 'http_request',
      route: 'POST /jobs',
      statusCode: 202,
      jobId: result.jobId,
    });

    return reply.code(202).send(result);
  };

  if (jobRateLimitMiddleware) {
    app.post('/jobs', { preHandler: [jobRateLimitMiddleware] }, handleSubmitJob);
  } else {
    app.post('/jobs', handleSubmitJob);
  }

  async function handleJobStatusRequest(
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply
  ) {
    const { jobId } = request.params as { jobId: string };

    try {
      const status = await getJobStatus(jobId);
      if (!status) {
        logger.info('HTTP request handled', {
          event: 'http_request',
          route: request.routerPath ?? 'GET /jobs/:jobId',
          statusCode: 404,
          jobId,
        });

        return errorResponse(reply, 'not_found');
      }

      logger.info('HTTP request handled', {
        event: 'http_request',
        route: request.routerPath ?? 'GET /jobs/:jobId',
        statusCode: 200,
        jobId,
        jobState: status.state,
      });

      return reply.send(status);
    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'http_request',
        route: request.routerPath ?? 'GET /jobs/:jobId',
        statusCode: 500,
        error: 'internal_error',
        jobId,
      });

      return errorResponse(reply, 'internal_error');
    }
  }

  app.get('/jobs/:jobId', handleJobStatusRequest);
  app.get('/jobs/:jobId/status', handleJobStatusRequest);

  if (!extendedApiEnabled) {
    logger.info('Extended API disabled; skipping uploads/auth/admin routes');
    return app;
  }

  // Extended API services (uploads/auth/admin) are optional and guarded by env.
  const fileValidationService = config.security.enableFileValidation
    ? createFileValidationService()
    : null;
  const fileSanitizationService = config.security.enableFileSanitization
    ? createFileSanitizationService()
    : null;
  const rateLimiterService = createRateLimiterService();
  const uploadRateLimitMiddleware = createUploadRateLimitMiddleware(rateLimiterService);

  const s3Overrides: Partial<StorageConfig['s3']> = {};
  if (config.storage.provider === 'minio') {
    Object.assign(s3Overrides, {
      endpoint: config.minio.endpoint,
      region: 'us-east-1',
      accessKeyId: config.minio.accessKey,
      secretAccessKey: config.minio.secretKey,
      bucket: config.storage.bucketName || config.minio.bucket,
      pathPrefix: config.storage.pathPrefix,
      forcePathStyle: true,
    });
  } else {
    if (config.storage.bucketName) {
      Object.assign(s3Overrides, { bucket: config.storage.bucketName });
    }
    if (config.storage.pathPrefix) {
      Object.assign(s3Overrides, { pathPrefix: config.storage.pathPrefix });
    }
  }

  const storageConfig = createStorageConfigService({
    provider: config.storage.provider,
    s3: s3Overrides,
    filesystem: {
      uploadDir: process.env.FILESYSTEM_UPLOAD_DIR || './uploads',
    },
    lifecycle: {
      presignedUrlExpiresIn: config.storage.presignedUrlExpiresIn,
      enableMultipartUploads: true,
      maxMultipartSize: 100 * 1024 * 1024, // 100MB
    },
  });
  const fileStorageService = createFileStorageService(storageConfig);

  void app.register(multipart, {
    limits: {
      fileSize: config.security.maxFileSize,
      files: 1,
    },
  });

  app.post('/uploads', {
    preHandler: [authenticate, uploadRateLimitMiddleware]
  }, async (request, reply) => {
    let authenticatedUser;
    try {
      // Check if user is authenticated
      authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Authentication required',
          code: 'not_authenticated',
        });
      }

      const file = await (request as any).file();
      if (!file) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'No file uploaded',
          code: 'no_file',
        });
      }

      const filename: string = file.filename || '';
      
      // Read file buffer for validation and sanitization
      const fileBuffer = await readFileBuffer(file.file);
      
      try {
        // 1. File Validation
        let validationResult;
        if (fileValidationService) {
          validationResult = await fileValidationService.validateFile(fileBuffer, filename);
          if (!validationResult.isValid) {
            logger.warn('File validation failed', {
              event: 'file_validation_failed',
              userId: authenticatedUser.id,
              filename,
              errors: validationResult.errors.map(e => e.code),
              warnings: validationResult.warnings.map(w => w.code),
            });

            return reply.code(400).send({
              error: 'validation_failed',
              message: 'File validation failed',
              code: 'file_validation_failed',
              details: {
                errors: validationResult.errors,
                warnings: validationResult.warnings,
              },
            });
          }
        }

        // 2. File Sanitization
        let sanitizationResult;
        let sanitizedBuffer = fileBuffer;
        let sanitizedFilename = filename;

        if (fileSanitizationService) {
          sanitizationResult = await fileSanitizationService.sanitizeFile(fileBuffer, filename);
          sanitizedBuffer = sanitizationResult.sanitizedContent;
          sanitizedFilename = sanitizationResult.sanitizedFilename;

          if (sanitizationResult.warnings.length > 0) {
            logger.warn('File sanitization completed with warnings', {
              event: 'file_sanitized_with_warnings',
              userId: authenticatedUser.id,
              originalFilename: filename,
              sanitizedFilename: sanitizedFilename,
              warnings: sanitizationResult.warnings.map(w => ({
                code: w.code,
                severity: w.severity,
              })),
            });
          }
        }

        // 3. Store the sanitized file using the storage service
        const id = randomUUID();
        const storageKey = `uploads/${authenticatedUser.id}/${id}_${sanitizedFilename.replace(/[^\w.-]/g, '_')}`;

        const uploadResult = await fileStorageService.uploadFile(
          storageKey,
          sanitizedBuffer,
          validationResult?.mimeType || 'application/octet-stream',
          sanitizedBuffer.length
        );

        // Store file metadata in database (if available)
        // TODO: Implement database storage for file metadata

        logger.info('Secure upload completed', {
          event: 'secure_upload_completed',
          userId: authenticatedUser.id,
          fileId: id,
          originalFilename: filename,
          sanitizedFilename: sanitizedFilename,
          fileSize: sanitizedBuffer.length,
          mimeType: validationResult?.mimeType,
          storageKey,
          storageProvider: fileStorageService.getProvider(),
          hasUrl: !!uploadResult.url,
        });

        return reply.code(201).send({
          id,
          md: storageKey, // Use storage key as the file reference
          url: uploadResult.url, // Include presigned URL if available
          originalFilename: filename,
          sanitizedFilename: sanitizedFilename,
          fileSize: sanitizedBuffer.length,
          mimeType: validationResult?.mimeType,
          storageProvider: fileStorageService.getProvider(),
          warnings: [
            ...(validationResult?.warnings || []),
            ...(sanitizationResult?.warnings || []),
          ],
        });

      } catch (securityError) {
        if (securityError instanceof FileValidationError ||
            securityError instanceof FileSanitizationError) {
          logger.warn('File security processing failed', {
            event: 'file_security_processing_failed',
            userId: authenticatedUser.id,
            filename,
            error: securityError.code,
            message: securityError.message,
          });

          return reply.code(400).send({
            error: 'security_validation_failed',
            message: securityError.message,
            code: securityError.code,
          });
        }
        throw securityError;
      }

    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'upload_failed',
        userId: authenticatedUser?.id,
        error: 'internal_error',
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // Authentication Endpoints

  // POST /auth/register - Register new user
  app.post('/auth/register', async (request, reply) => {
    const body = request.body as UserRegistration | undefined;

    try {
      if (!body || !body.email || !body.password) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Email and password are required',
          code: 'missing_fields',
        });
      }

      // Validate email format
      const authService = createAuthService();
      if (!authService.validateEmail(body.email)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid email format',
          code: 'invalid_email',
        });
      }

      // Validate password strength
      const passwordValidation = authService.validatePassword(body.password);
      if (!passwordValidation.valid) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Password does not meet requirements',
          code: 'weak_password',
          details: passwordValidation.errors,
        });
      }

      // Validate role if provided
      let role: UserRole = 'user';
      if (body.role) {
        if (!isValidRole(body.role)) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid role specified',
            code: 'invalid_role',
          });
        }
        role = body.role;
      }

      // Check if user already exists
      const existingUser = await getUserByEmail(body.email);
      if (existingUser) {
        return reply.code(409).send({
          error: 'conflict',
          message: 'User with this email already exists',
          code: 'email_exists',
        });
      }

      // Hash password and create user
      const passwordHash = await authService.hashPassword(body.password);
      const user = await createUser({
        email: body.email.toLowerCase(),
        passwordHash,
        role,
        isActive: true,
      });

      logger.info('User registered successfully', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      // Return user data without password hash
      const sanitizedUser = sanitizeUser(user);

      return reply.code(201).send({
        message: 'User registered successfully',
        user: sanitizedUser,
      });

    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'http_request',
        route: 'POST /auth/register',
        statusCode: 500,
        error: 'internal_error',
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // POST /auth/login - Authenticate user and return JWT tokens
  app.post('/auth/login', async (request, reply) => {
    const body = request.body as UserLogin | undefined;

    try {
      if (!body || !body.email || !body.password) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Email and password are required',
          code: 'missing_fields',
        });
      }

      // Get user by email
      const user = await getUserByEmail(body.email.toLowerCase());
      if (!user || !user.isActive) {
        // Don't reveal whether user exists or is active for security
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Invalid credentials',
          code: 'invalid_credentials',
        });
      }

      // Verify password
      const authService = createAuthService();
      const isValidPassword = await authService.verifyPassword(body.password, user.passwordHash);
      if (!isValidPassword) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Invalid credentials',
          code: 'invalid_credentials',
        });
      }

      // Generate JWT tokens
      const tokens = authService.generateTokens(user.id, user.email, user.role);

      // Update last login time
      await updateUserLastLogin(user.id);

      logger.info('User logged in successfully', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      return reply.code(200).send({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
        },
        ...tokens,
      });

    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'http_request',
        route: 'POST /auth/login',
        statusCode: 500,
        error: 'internal_error',
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // POST /auth/refresh - Refresh access token using refresh token
  app.post('/auth/refresh', async (request, reply) => {
    const body = request.body as { refreshToken?: string } | undefined;

    try {
      if (!body || !body.refreshToken) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Refresh token is required',
          code: 'missing_refresh_token',
        });
      }

      // Verify refresh token and get new tokens
      const authService = createAuthService();
      
      // First, verify the refresh token to get user info for logging
      let refreshPayload;
      try {
        refreshPayload = authService.verifyRefreshToken(body.refreshToken);
      } catch (error) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Invalid refresh token',
          code: 'invalid_refresh_token',
        });
      }
      
      const tokens = authService.refreshTokens(body.refreshToken);

      // Verify user still exists and is active
      const user = await getUserById(refreshPayload.sub);
      if (!user || !user.isActive) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'User account is inactive or no longer exists',
          code: 'user_inactive',
        });
      }

      logger.info('Token refresh successful', {
        userId: refreshPayload.sub,
        userEmail: refreshPayload.email,
      });

      return reply.code(200).send({
        message: 'Token refresh successful',
        ...tokens,
      });

    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'http_request',
        route: 'POST /auth/refresh',
        statusCode: 500,
        error: 'internal_error',
      });

      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Token refresh failed',
        code: 'refresh_failed',
      });
    }
  });

  // Admin Endpoints

  // GET /admin/users - List all users (admin only)
  app.get('/admin/users', { preHandler: [authenticate, requireRole(['admin'])] }, async (request, reply) => {
    try {
      const users = await getAllUsers();
      const sanitizedUsers = users.map(user => sanitizeUser(user));

      logger.info('Admin listed all users', {
        userId: getAuthenticatedUser(request)?.id,
        userCount: users.length,
      });

      return reply.code(200).send({
        users: sanitizedUsers,
        total: users.length,
      });
    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'admin_list_users_failed',
        userId: getAuthenticatedUser(request)?.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // GET /admin/jobs - List all jobs (admin only)
  app.get('/admin/jobs', { preHandler: [authenticate, requireRole(['admin'])] }, async (request, reply) => {
    try {
      // TODO: Implement getAllJobs function in job-repository.ts
      // const jobs = await getAllJobs();
      const jobs: any[] = []; // Placeholder

      logger.info('Admin listed all jobs', {
        userId: getAuthenticatedUser(request)?.id,
        jobCount: jobs.length,
      });

      return reply.code(200).send({
        jobs,
        total: jobs.length,
      });
    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'admin_list_jobs_failed',
        userId: getAuthenticatedUser(request)?.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // DELETE /admin/jobs/:id - Delete any job (admin only)
  app.delete('/admin/jobs/:jobId', { preHandler: [authenticate, requireRole(['admin'])] }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };

    try {
      // TODO: Implement deleteJob function in job-repository.ts
      // const deleted = await deleteJob(jobId);
      const deleted = false; // Placeholder

      if (!deleted) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'Job not found',
        });
      }

      logger.info('Admin deleted job', {
        userId: getAuthenticatedUser(request)?.id,
        jobId,
      });

      return reply.code(200).send({
        message: 'Job deleted successfully',
      });
    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'admin_delete_job_failed',
        userId: getAuthenticatedUser(request)?.id,
        jobId,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // GET /admin/stats - System statistics (admin only)
  app.get('/admin/stats', { preHandler: [authenticate, requireRole(['admin'])] }, async (request, reply) => {
    try {
      // TODO: Implement system statistics collection
      const stats = {
        totalUsers: await countUsers(),
        // totalJobs: await countJobs(),
        // activeJobs: await countActiveJobs(),
        systemStatus: 'operational',
        timestamp: new Date().toISOString(),
      };

      logger.info('Admin requested system stats', {
        userId: getAuthenticatedUser(request)?.id,
      });

      return reply.code(200).send(stats);
    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'admin_stats_failed',
        userId: getAuthenticatedUser(request)?.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // User Management Endpoints

  // GET /user/profile - Get current user profile
  app.get('/user/profile', { preHandler: authenticate }, async (request, reply) => {
    try {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Authentication required',
        });
      }

      const user = await getUserById(authenticatedUser.id);
      if (!user) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'User not found',
        });
      }

      return reply.code(200).send({
        user: sanitizeUser(user),
      });
    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'get_user_profile_failed',
        userId: getAuthenticatedUser(request)?.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // PUT /user/profile - Update user profile
  app.put('/user/profile', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      const body = request.body as { email?: string; password?: string };

      // Basic input validation
      if (body.email && !body.email.includes('@')) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid email format',
        });
      }

      // TODO: Implement update user profile logic
      // const updatedUser = await updateUserProfile(authenticatedUser.id, body);

      logger.info('User profile update attempted', {
        userId: authenticatedUser.id,
        fields: Object.keys(body || {}),
      });

      return reply.code(200).send({
        message: 'Profile update not yet implemented',
        // user: sanitizeUser(updatedUser),
      });
    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'update_user_profile_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // GET /user/jobs - List user's jobs
  app.get('/user/jobs', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      // TODO: Implement getUserJobs function
      // const jobs = await getUserJobs(authenticatedUser.id);
      const jobs: any[] = []; // Placeholder

      return reply.code(200).send({
        jobs,
        total: jobs.length,
      });
    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'get_user_jobs_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // GET /user/files - List user's uploaded files
  app.get('/user/files', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      // TODO: Implement getUserFiles function
      // const files = await getUserFiles(authenticatedUser.id);
      const files: any[] = []; // Placeholder

      return reply.code(200).send({
        files,
        total: files.length,
      });
    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'get_user_files_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // GET /auth/me - Get current user profile (authenticated)
  app.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    try {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Authentication required',
          code: 'not_authenticated',
        });
      }

      // Get fresh user data from database
      const user = await getUserById(authenticatedUser.id);
      if (!user || !user.isActive) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'User account is inactive or no longer exists',
          code: 'user_inactive',
        });
      }

      logger.info('User profile retrieved', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      return reply.code(200).send({
        user: sanitizeUser(user),
      });

    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
        event: 'http_request',
        route: 'GET /auth/me',
        statusCode: 500,
        error: 'internal_error',
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  return app;
}

// startHttpServer.declaration()
// Public entrypoint used in production; behavior MUST remain unchanged.
export async function startHttpServer(): Promise<void> {
  const config = loadConfig();
  const app = createHttpServer();

  try {
    await app.listen({
      port: config.httpPort,
      host: '0.0.0.0',
    });
    logger.info('HTTP server listening', {
      event: 'http_server_started',
      port: config.httpPort,
    });
  } catch (err: any) {
    logger.error(err instanceof Error ? err : String(err), {
      event: 'http_server_start_failed',
    });
    process.exit(1);
  }
}

// Allow running directly: node dist/transport/http-server.js
if (require.main === module) {
  void startHttpServer();
}
