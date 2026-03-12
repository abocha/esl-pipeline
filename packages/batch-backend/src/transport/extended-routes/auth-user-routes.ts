import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { JobState } from '@esl-pipeline/contracts';

import { getJobSummaryWithDefaults } from '../../application/job-summary.js';
import { listJobsWithDefaults } from '../../application/list-jobs.js';
import { getReadinessMetricsWithDefaults } from '../../application/readiness-metrics.js';
import { SubmitJobRequest, ValidationError, submitJob } from '../../application/submit-job.js';
import type { BatchBackendConfig } from '../../config/env.js';
import {
  UserSettingsInput,
  isValidTtsProvider,
  isValidTtsStrategy,
  sanitizeSettings,
} from '../../domain/settings-model.js';
import {
  createDefaultSettings,
  getSettingsByUserId,
  upsertSettings,
} from '../../domain/settings-repository.js';
import {
  UserLogin,
  UserRegistration,
  UserRole,
  isValidRole,
  sanitizeUser,
} from '../../domain/user-model.js';
import {
  countUsers,
  createUser,
  getAllUsers,
  getUserByEmail,
  getUserById,
  updateUserLastLogin,
} from '../../domain/user-repository.js';
import { logger } from '../../infrastructure/logger.js';
import { getAuthenticatedUser, requireRole } from '../auth-middleware.js';
import { resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';

export function registerAuthUserRoutes(app: FastifyInstance, context: ExtendedRoutesContext): void {
  const { config, authService, authenticate, uploadRateLimitMiddleware } = context;

  app.post(
    '/auth/register',
    { preHandler: [uploadRateLimitMiddleware] },
    async (request, reply) => {
      const body = request.body as UserRegistration | undefined;

      try {
        if (!body || !body.email || !body.password) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Email and password are required',
            code: 'missing_fields',
          });
        }

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
    },
  );

  app.post('/auth/login', { preHandler: [uploadRateLimitMiddleware] }, async (request, reply) => {
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

      setRefreshCookie(reply, config, tokens.refreshToken, tokens.refreshExpiresIn);

      return reply.code(200).send({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
        },
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
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

  app.post('/auth/refresh', { preHandler: [uploadRateLimitMiddleware] }, async (request, reply) => {
    const body = request.body as { refreshToken?: string } | undefined;
    const cookies = request.cookies as Record<string, string> | undefined;
    const refreshToken = cookies?.[config.auth.refreshCookieName] ?? body?.refreshToken ?? null;

    try {
      if (!refreshToken) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Refresh token is required',
          code: 'missing_refresh_token',
        });
      }

      let refreshPayload;
      try {
        refreshPayload = authService.verifyRefreshToken(refreshToken);
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

      const tokens = authService.refreshTokens(refreshToken);
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

      setRefreshCookie(reply, config, tokens.refreshToken, tokens.refreshExpiresIn);

      return reply.code(200).send({
        message: 'Token refresh successful',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
        },
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
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

  app.post('/auth/logout', { preHandler: [uploadRateLimitMiddleware] }, async (_request, reply) => {
    clearRefreshCookie(reply, config);
    return reply.code(200).send({ message: 'Logout successful' });
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
      const routePath = resolveRoutePath(request, 'GET /admin/jobs');
      const querySchema = z.object({
        state: z.union([z.string(), z.array(z.string())]).optional(),
        studentId: z.string().uuid().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
        userId: z.string().uuid().optional(),
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const states = normalizeJobStateFilter(query.state);
        const jobs = await listJobsWithDefaults({
          states,
          studentId: query.studentId ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
          userId: query.userId ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(200).send(jobs);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid query parameters',
            details: error.issues,
          });
        }

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

      if (body.ttsProvider !== undefined && !isValidTtsProvider(body.ttsProvider)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid TTS provider. Must be one of: elevenlabs, google',
          code: 'invalid_tts_provider',
        });
      }

      if (body.defaultTtsStrategy !== undefined && !isValidTtsStrategy(body.defaultTtsStrategy)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid TTS strategy. Must be one of: auto, dialogue, tts',
          code: 'invalid_tts_strategy',
        });
      }

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
          (key) => body[key as keyof UserSettingsInput] !== undefined,
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

  app.get('/user/jobs/summary', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    const routePath = resolveRoutePath(request, 'GET /user/jobs/summary');
    const querySchema = z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    });

    try {
      const query = querySchema.parse(request.query ?? {});
      const summary = await getJobSummaryWithDefaults({
        from: query.from ?? null,
        to: query.to ?? null,
        userId: authenticatedUser.id,
      });

      logger.info('HTTP request handled', {
        event: 'http_request',
        route: routePath,
        statusCode: 200,
        userId: authenticatedUser.id,
      });

      return reply.code(200).send(summary);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid query parameters',
          details: error.issues,
        });
      }

      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_jobs_summary_failed',
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

    const routePath = resolveRoutePath(request, 'GET /user/jobs');
    const querySchema = z.object({
      state: z.union([z.string(), z.array(z.string())]).optional(),
      studentId: z.string().uuid().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      order: z.enum(['asc', 'desc']).optional(),
    });

    try {
      const query = querySchema.parse(request.query ?? {});
      const states = normalizeJobStateFilter(query.state);
      const jobs = await listJobsWithDefaults({
        states,
        studentId: query.studentId ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
        limit: query.limit,
        offset: query.offset,
        order: query.order,
        userId: authenticatedUser.id,
      });

      logger.info('HTTP request handled', {
        event: 'http_request',
        route: routePath,
        statusCode: 200,
        userId: authenticatedUser.id,
      });

      return reply.code(200).send(jobs);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid query parameters',
          details: error.issues,
        });
      }

      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_jobs_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.get(
    '/metrics/readiness',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /metrics/readiness');
      const querySchema = z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        userId: z.string().uuid().optional(),
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const readiness = await getReadinessMetricsWithDefaults({
          from: query.from ?? null,
          to: query.to ?? null,
          userId: query.userId ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(200).send(readiness);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid query parameters',
            details: error.issues,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'get_readiness_metrics_failed',
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

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
      md: z.string().min(1),
      learningPresetId: z.string().optional(),
      withTts: z.boolean().optional(),
      upload: z.enum(['auto', 's3', 'none']).optional(),
      voiceAccent: z.string().min(1).optional(),
      voiceId: z.string().min(1).optional(),
      forceTts: z.boolean().optional(),
      notionDatabase: z.string().min(1).optional(),
      ttsStrategy: z.enum(['auto', 'dialogue', 'tts']).optional(),
      ttsProvider: z.enum(['elevenlabs', 'google']).optional(),
      googleTtsModel: z.enum(['chirp3_hd', 'studio', 'neural2', 'wavenet']).optional(),
    });

    try {
      const validatedData = jobSchema.parse(body);
      const result = await submitJob({
        md: validatedData.md,
        learningPresetId: validatedData.learningPresetId,
        withTts: validatedData.withTts,
        upload: validatedData.upload,
        voiceId: validatedData.voiceId,
        voiceAccent: validatedData.voiceAccent,
        forceTts: validatedData.forceTts,
        notionDatabase: validatedData.notionDatabase,
        ttsStrategy: validatedData.ttsStrategy,
        ttsProvider: validatedData.ttsProvider,
        googleTtsModel: validatedData.googleTtsModel,
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
      if (error instanceof ValidationError) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: error.message,
          code: error.code,
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

  app.post('/jobs/:jobId/actions', { preHandler: authenticate }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const body = request.body as { type?: string; payload?: unknown };

    try {
      const validActionTypes = ['rerun_audio', 'rerun_publish', 'cancel', 'edit_metadata'];
      if (!body || !body.type || !validActionTypes.includes(body.type)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid or missing action type',
          code: 'invalid_action_type',
        });
      }

      const { executeJobAction } = await import('../../application/job-actions/action-handler.js');
      const authenticatedUser = getAuthenticatedUser(request);

      const action: { type: string; requestedAt: Date; requestedBy?: string; payload: unknown } = {
        type: body.type,
        requestedAt: new Date(),
        requestedBy: authenticatedUser?.id,
        payload: body.payload || {},
      };

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

      if (result.error === 'invalid_state') {
        return reply.code(409).send({
          error: 'invalid_state',
          message: result.message,
          actionType: result.actionType,
        });
      }

      if (result.error === 'validation_failed') {
        return reply.code(400).send({
          error: 'validation_failed',
          message: result.message,
          actionType: result.actionType,
        });
      }

      logger.info('Job action executed', {
        event: 'job_action_executed',
        userId: authenticatedUser?.id,
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

function normalizeJobStateFilter(state?: string | string[] | null): JobState[] | null {
  if (!state) return null;
  const values = Array.isArray(state) ? state : state.split(',');
  const trimmed = values.map((value) => value.trim()).filter(Boolean);
  if (trimmed.length === 0) return null;
  const jobStateSchema = z.enum(['queued', 'running', 'awaiting_approval', 'succeeded', 'failed']);
  return trimmed.map((value) => jobStateSchema.parse(value)) as JobState[];
}

function buildRefreshCookieOptions(
  config: BatchBackendConfig,
  refreshExpiresInSeconds: number,
): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  domain?: string;
  expires: Date;
} {
  return {
    httpOnly: true,
    secure: config.auth.refreshCookieSecure,
    sameSite: config.auth.refreshCookieSameSite,
    path: config.auth.refreshCookiePath,
    domain: config.auth.refreshCookieDomain,
    expires: new Date(Date.now() + refreshExpiresInSeconds * 1000),
  };
}

function setRefreshCookie(
  reply: FastifyReply,
  config: BatchBackendConfig,
  refreshToken: string,
  refreshExpiresInSeconds: number,
): void {
  reply.setCookie(
    config.auth.refreshCookieName,
    refreshToken,
    buildRefreshCookieOptions(config, refreshExpiresInSeconds),
  );
}

function clearRefreshCookie(reply: FastifyReply, config: BatchBackendConfig): void {
  reply.clearCookie(config.auth.refreshCookieName, {
    path: config.auth.refreshCookiePath,
    domain: config.auth.refreshCookieDomain,
  });
}
