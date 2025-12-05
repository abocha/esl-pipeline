import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { z } from 'zod';

import { getJobOptions } from '../application/get-job-options.js';
import { SubmitJobRequest, submitJob } from '../application/submit-job.js';
import type { BatchBackendConfig } from '../config/env.js';
import {
  UserSettingsInput,
  isValidTtsMode,
  isValidTtsProvider,
  sanitizeSettings,
} from '../domain/settings-model.js';
import {
  createDefaultSettings,
  getSettingsByUserId,
  upsertSettings,
} from '../domain/settings-repository.js';
import {
  UserLogin,
  UserRegistration,
  UserRole,
  isValidRole,
  sanitizeUser,
} from '../domain/user-model.js';
import {
  countUsers,
  createUser,
  getAllUsers,
  getUserByEmail,
  getUserById,
  updateUserLastLogin,
} from '../domain/user-repository.js';
import { createAuthService } from '../infrastructure/auth-service.js';
import {
  FileSanitizationError,
  type FileSanitizationService,
} from '../infrastructure/file-sanitization-service.js';
import { FileStorageService } from '../infrastructure/file-storage-service.js';
import {
  FileValidationError,
  type FileValidationService,
} from '../infrastructure/file-validation-service.js';
import { logger } from '../infrastructure/logger.js';
import { StorageConfigurationService } from '../infrastructure/storage-config.js';
import { getAuthenticatedUser, requireRole } from './auth-middleware.js';
import { errorResponse, resolveRoutePath } from './route-helpers.js';

type AsyncPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface ExtendedRouteOptions {
  config: BatchBackendConfig;
  authenticate: AsyncPreHandler;
  uploadRateLimitMiddleware: AsyncPreHandler;
  fileValidationService: FileValidationService | null;
  fileSanitizationService: FileSanitizationService | null;
  storageConfig: StorageConfigurationService;
  fileStorageService: FileStorageService;
}

export function registerExtendedRoutes(app: FastifyInstance, options: ExtendedRouteOptions): void {
  const {
    config,
    authenticate,
    uploadRateLimitMiddleware,
    fileValidationService,
    fileSanitizationService,
    storageConfig,
    fileStorageService,
  } = options;

  app.get(
    '/config/job-options',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /config/job-options');
      try {
        const options = await getJobOptions();
        reply.header('Cache-Control', 'private, max-age=60');

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(options);
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  void app.register(multipart, {
    limits: {
      fileSize: config.security.maxFileSize,
      files: 1,
    },
  });

  app.post(
    '/uploads',
    {
      preHandler: [authenticate, uploadRateLimitMiddleware],
    },
    async (request, reply) => {
      let authenticatedUser;
      try {
        authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) {
          return reply.code(401).send({
            error: 'unauthorized',
            message: 'Authentication required',
            code: 'not_authenticated',
          });
        }

        const file = await (
          request as FastifyRequest & {
            file: () => Promise<{ filename?: string; file: Readable } | undefined>;
          }
        ).file();
        if (!file) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'No file uploaded',
            code: 'no_file',
          });
        }

        const filename: string = file.filename || '';
        const fileBuffer = await readFileBuffer(file.file);

        try {
          let validationResult;
          if (fileValidationService) {
            validationResult = await fileValidationService.validateFile(fileBuffer, filename);
            if (!validationResult.isValid) {
              logger.warn('File validation failed', {
                event: 'file_validation_failed',
                userId: authenticatedUser.id,
                filename,
                errors: validationResult.errors.map((e: { code: string }) => e.code),
                warnings: validationResult.warnings.map((w: { code: string }) => w.code),
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
                warnings: sanitizationResult.warnings.map(
                  (w: { code: string; severity: string }) => ({
                    code: w.code,
                    severity: w.severity,
                  }),
                ),
              });
            }
          }

          const id = randomUUID();
          const storageKey = `${authenticatedUser.id}/${id}_${sanitizedFilename.replaceAll(/[^\w.-]/g, '_')}`;

          const uploadResult = await fileStorageService.uploadFile(
            storageKey,
            sanitizedBuffer,
            validationResult?.mimeType || 'application/octet-stream',
            sanitizedBuffer.length,
          );

          const mdReference =
            fileStorageService.getProvider() === 'filesystem'
              ? buildFilesystemMdReference(
                  storageConfig.getFilesystemConfig().uploadDir,
                  storageKey,
                )
              : storageKey;

          logger.info('Secure upload completed', {
            event: 'secure_upload_completed',
            userId: authenticatedUser.id,
            fileId: id,
            originalFilename: filename,
            sanitizedFilename: sanitizedFilename,
            fileSize: sanitizedBuffer.length,
            mimeType: validationResult?.mimeType,
            storageKey,
            mdReference,
            storageProvider: fileStorageService.getProvider(),
            hasUrl: !!uploadResult.url,
          });

          return reply.code(201).send({
            id,
            md: mdReference,
            url: uploadResult.url,
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
        } catch (securityError: unknown) {
          if (
            securityError instanceof FileValidationError ||
            securityError instanceof FileSanitizationError
          ) {
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
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'upload_failed',
          userId: authenticatedUser?.id,
          error: 'internal_error',
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

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

      const authService = createAuthService();
      if (!authService.validateEmail(body.email)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid email format',
          code: 'invalid_email',
        });
      }

      const passwordValidation = authService.validatePassword(body.password);
      if (!passwordValidation.valid) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Password does not meet requirements',
          code: 'weak_password',
          details: passwordValidation.errors,
        });
      }

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

      const existingUser = await getUserByEmail(body.email);
      if (existingUser) {
        return reply.code(409).send({
          error: 'conflict',
          message: 'User with this email already exists',
          code: 'email_exists',
        });
      }

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

      const sanitizedUser = sanitizeUser(user);

      return reply.code(201).send({
        message: 'User registered successfully',
        user: sanitizedUser,
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
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

      const user = await getUserByEmail(body.email.toLowerCase());
      if (!user || !user.isActive) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Invalid credentials',
          code: 'invalid_credentials',
        });
      }

      const authService = createAuthService();
      const isValidPassword = await authService.verifyPassword(body.password, user.passwordHash);
      if (!isValidPassword) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Invalid credentials',
          code: 'invalid_credentials',
        });
      }

      const tokens = authService.generateTokens(user.id, user.email, user.role);
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
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
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

      const authService = createAuthService();
      let refreshPayload;
      try {
        refreshPayload = authService.verifyRefreshToken(body.refreshToken);
      } catch (error) {
        logger.warn('Invalid refresh token presented', {
          error: error instanceof Error ? error.message : String(error),
        });
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Invalid refresh token',
          code: 'invalid_refresh_token',
        });
      }

      const tokens = authService.refreshTokens(body.refreshToken);
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
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
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

  app.get(
    '/admin/users',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      try {
        const users = await getAllUsers();
        const sanitizedUsers = users.map((user) => sanitizeUser(user));

        logger.info('Admin listed all users', {
          userId: getAuthenticatedUser(request)?.id,
          userCount: users.length,
        });

        return reply.code(200).send({
          users: sanitizedUsers,
          total: users.length,
        });
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'admin_list_users_failed',
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.get(
    '/admin/jobs',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      try {
        const jobs: unknown[] = [];

        logger.info('Admin listed all jobs', {
          userId: getAuthenticatedUser(request)?.id,
          jobCount: jobs.length,
        });

        return reply.code(200).send({
          jobs,
          total: jobs.length,
        });
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'admin_list_jobs_failed',
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.delete(
    '/admin/jobs/:jobId',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };

      try {
        const deleted = false;

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
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'admin_delete_job_failed',
          userId: getAuthenticatedUser(request)?.id,
          jobId,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.get(
    '/admin/stats',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      try {
        const stats = {
          totalUsers: await countUsers(),
          systemStatus: 'operational',
          timestamp: new Date().toISOString(),
        };

        logger.info('Admin requested system stats', {
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(200).send(stats);
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'admin_stats_failed',
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

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
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_profile_failed',
        userId: getAuthenticatedUser(request)?.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

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

      if (body.email && !body.email.includes('@')) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid email format',
        });
      }

      logger.info('User profile update attempted', {
        userId: authenticatedUser.id,
        fields: Object.keys(body || {}),
      });

      return reply.code(200).send({
        message: 'Profile update not yet implemented',
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'update_user_profile_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // GET /user/settings - Get current user settings
  app.get('/user/settings', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      let settings = await getSettingsByUserId(authenticatedUser.id);

      // Create default settings if none exist
      if (!settings) {
        settings = await createDefaultSettings(authenticatedUser.id);
      }

      return reply.code(200).send({
        settings: sanitizeSettings(settings),
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_settings_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // PUT /user/settings - Update user settings
  app.put('/user/settings', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      const body = request.body as UserSettingsInput | undefined;

      if (!body || typeof body !== 'object') {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Request body is required',
          code: 'missing_body',
        });
      }

      // Validate TTS provider if provided
      if (body.ttsProvider !== undefined && !isValidTtsProvider(body.ttsProvider)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid TTS provider. Must be one of: elevenlabs, openai, azure, google',
          code: 'invalid_tts_provider',
        });
      }

      // Validate TTS mode if provided
      if (body.defaultTtsMode !== undefined && !isValidTtsMode(body.defaultTtsMode)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid TTS mode. Must be one of: auto, dialogue, monologue',
          code: 'invalid_tts_mode',
        });
      }

      // Validate API key formats (basic checks)
      if (
        body.elevenLabsKey !== undefined &&
        body.elevenLabsKey !== null &&
        body.elevenLabsKey !== '' &&
        (typeof body.elevenLabsKey !== 'string' || body.elevenLabsKey.length < 10)
      ) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid ElevenLabs API key format',
          code: 'invalid_elevenlabs_key',
        });
      }

      if (
        body.notionToken !== undefined &&
        body.notionToken !== null &&
        body.notionToken !== '' &&
        (typeof body.notionToken !== 'string' || body.notionToken.length < 10)
      ) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid Notion token format',
          code: 'invalid_notion_token',
        });
      }

      const updatedSettings = await upsertSettings(authenticatedUser.id, body);

      logger.info('User settings updated', {
        userId: authenticatedUser.id,
        updatedFields: Object.keys(body).filter(
          (k) => body[k as keyof UserSettingsInput] !== undefined,
        ),
      });

      return reply.code(200).send({
        settings: sanitizeSettings(updatedSettings),
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'update_user_settings_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.get('/user/jobs', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      const jobs: unknown[] = [];

      return reply.code(200).send({
        jobs,
        total: jobs.length,
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_jobs_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.post('/user/jobs', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    const body = request.body as SubmitJobRequest | undefined;

    const jobSchema = z.object({
      md: z.string().min(1, 'md is required'),
      preset: z.string().optional(),
      withTts: z.boolean().optional(),
      upload: z.enum(['auto', 's3', 'none']).optional(),
      voiceAccent: z.string().min(1).optional(),
      voiceId: z.string().min(1).optional(),
      forceTts: z.boolean().optional(),
      notionDatabase: z.string().min(1).optional(),
      mode: z.enum(['auto', 'dialogue', 'monologue']).optional(),
    });

    try {
      const validatedData = jobSchema.parse(body);

      const result = await submitJob({
        md: validatedData.md,
        preset: validatedData.preset,
        withTts: validatedData.withTts,
        upload: validatedData.upload,
        voiceId: validatedData.voiceId,
        voiceAccent: validatedData.voiceAccent,
        forceTts: validatedData.forceTts,
        notionDatabase: validatedData.notionDatabase,
        mode: validatedData.mode,
        userId: authenticatedUser.id,
      });

      logger.info('User submitted job', {
        event: 'user_job_submitted',
        userId: authenticatedUser.id,
        jobId: result.jobId,
      });

      return reply.code(202).send(result);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid request body',
          details: error.issues,
        });
      }

      logger.error(error instanceof Error ? error : String(error), {
        event: 'user_submit_job_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.get('/user/files', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      const files: unknown[] = [];

      return reply.code(200).send({
        files,
        total: files.length,
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_files_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

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
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
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

  // Job actions endpoint
  app.post('/jobs/:jobId/actions', { preHandler: authenticate }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const body = request.body as { type?: string; payload?: unknown };

    try {
      // Validate action type
      const validActionTypes = ['rerun_audio', 'cancel', 'edit_metadata'];
      if (!body || !body.type || !validActionTypes.includes(body.type)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid or missing action type',
          code: 'invalid_action_type',
        });
      }

      // Dynamically import to avoid circular dependencies
      const { executeJobAction } = await import('../application/job-actions/action-handler.js');

      // Construct action object
      const action: { type: string; requestedAt: Date; payload: unknown } = {
        type: body.type,
        requestedAt: new Date(),
        payload: body.payload || {},
      };

      // Execute action (cast to expected type per action-handler contract)
      const result = await executeJobAction(
        jobId,
        action as unknown as Parameters<typeof executeJobAction>[1],
      );

      if (result.error === 'not_found') {
        return reply.code(404).send({
          error: 'not_found',
          message: result.message,
        });
      }

      if (result.error === 'not_implemented') {
        return reply.code(501).send({
          error: 'not_implemented',
          message: result.message,
          actionType: result.actionType,
        });
      }

      logger.info('Job action executed', {
        event: 'job_action_executed',
        userId: getAuthenticatedUser(request)?.id,
        jobId,
        actionType: result.actionType,
        success: result.success,
      });

      return reply.send({
        success: result.success,
        message: result.message,
        jobId: result.jobId,
        actionType: result.actionType,
        timestamp: result.timestamp.toISOString(),
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'job_action_failed',
        userId: getAuthenticatedUser(request)?.id,
        jobId,
        error: 'internal_error',
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });
}

async function readFileBuffer(fileStream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    fileStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    fileStream.on('end', () => resolve(Buffer.concat(chunks)));
    fileStream.on('error', reject);
  });
}

function buildFilesystemMdReference(uploadDir: string, storageKey: string): string {
  const absoluteRoot = path.resolve(uploadDir || '.');
  const absoluteFilePath = path.join(absoluteRoot, storageKey);
  return absoluteFilePath.split(path.sep).join('/');
}
