import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { AssignmentSessionDto, JobState } from '@esl-pipeline/contracts';
import { AssignmentArtifactReferenceSchema } from '@esl-pipeline/contracts';

import { AlphaInviteError, registerInvitedUser } from '../../application/alpha-invites.js';
import { getAssignmentLearnerContext } from '../../application/assignment-learner-context.js';
import {
  attachAssignmentSourceForUser,
  confirmStudentAssignmentSessionForUser,
  getAssignmentSessionForUser,
  listAssignmentSessionsForUserDto,
  updateAssignmentSessionRecoveryForUser,
} from '../../application/assignment-sessions.js';
import { confirmAssignmentSessionStep } from '../../application/confirm-assignment-session-step.js';
import {
  finishTranscriptAssignmentSession,
  startHomeworkAssignmentSession,
} from '../../application/finish-transcript-assignment-session.js';
import { HistoricalAssignmentReadOnlyError } from '../../application/historical-assignment.js';
import { getJobSummaryWithDefaults } from '../../application/job-summary.js';
import { listJobsWithDefaults } from '../../application/list-jobs.js';
import { publishAssignmentCorrection } from '../../application/publish-assignment-correction.js';
import {
  publishTtsModelSchema,
  publishTtsProviderSchema,
  publishTtsStrategySchema,
} from '../../application/publish-study-text-overrides.js';
import { getReadinessMetricsWithDefaults } from '../../application/readiness-metrics.js';
import { shareAssignmentSession } from '../../application/share-assignment-session.js';
import { SubmitJobRequest, submitJob, ValidationError } from '../../application/submit-job.js';
import type { BatchBackendConfig } from '../../config/env.js';
import { postgresUuidSchema } from '../../domain/postgres-uuid.js';
import {
  isValidTtsProvider,
  isValidTtsStrategy,
  sanitizeSettings,
  UserSettingsInput,
} from '../../domain/settings-model.js';
import {
  createDefaultSettings,
  getSettingsByUserId,
  upsertSettings,
} from '../../domain/settings-repository.js';
import { sanitizeUser, UserLogin, UserRegistration } from '../../domain/user-model.js';
import {
  countUsers,
  getAllUsers,
  getUserByEmail,
  getUserById,
  updateUserLastLogin,
} from '../../domain/user-repository.js';
import { logger } from '../../infrastructure/logger.js';
import { getAuthenticatedUser, requireRole } from '../auth-middleware.js';
import { resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';

function getErrorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : null;
}

function getConflictSession(error: unknown): AssignmentSessionDto | null {
  return error && typeof error === 'object' && 'session' in error
    ? (error.session as AssignmentSessionDto)
    : null;
}

export function registerAuthUserRoutes(app: FastifyInstance, context: ExtendedRoutesContext): void {
  const { config, authService, authenticate, uploadRateLimitMiddleware } = context;

  app.post(
    '/auth/register',
    { preHandler: [uploadRateLimitMiddleware] },
    async (request, reply) => {
      const body = request.body as UserRegistration | undefined;

      try {
        if (!body || !body.email || !body.password || !body.inviteToken) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Email, password, and invite token are required',
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

        const passwordHash = await authService.hashPassword(body.password);
        const user = await registerInvitedUser({
          email: body.email,
          passwordHash,
          inviteToken: body.inviteToken,
        });

        logger.info('User registered successfully', {
          userId: user.id,
          email: user.email,
          role: user.role,
        });

        const tokens = authService.generateTokens(user.id, user.email, user.role);
        setRefreshCookie(reply, config, tokens.refreshToken, tokens.refreshExpiresIn);

        const sanitizedUser = sanitizeUser(user);

        return reply.code(201).send({
          message: 'User registered successfully',
          user: sanitizedUser,
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn,
        });
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof AlphaInviteError) {
          return reply.code(error.status).send({
            error: error.status === 409 ? 'conflict' : 'validation_failed',
            message: error.message,
            code: error.code,
          });
        }

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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
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
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
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

  app.get(
    '/admin/jobs/summary',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /admin/jobs/summary');
      const querySchema = z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const summary = await getJobSummaryWithDefaults({
          from: query.from ?? null,
          to: query.to ?? null,
          userId: null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(200).send(summary);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid query parameters',
            details: error.issues,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'admin_get_jobs_summary_failed',
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
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
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
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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
          message: 'Invalid TTS provider. Must be one of: elevenlabs, google, inworld',
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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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

  const assignmentRecoveryPatchSchema = z
    .object({
      homeworkIntent: z.enum(['create', 'none']).optional(),
      lessonId: z.string().uuid().nullable().optional(),
      recordingId: z.string().uuid().nullable().optional(),
      transcriptId: z.string().uuid().nullable().optional(),
      promptPackageId: z.string().uuid().nullable().optional(),
      draftId: z.string().uuid().nullable().optional(),
      publishTarget: z.literal('html').nullable().optional(),
      selectedTtsProvider: publishTtsProviderSchema.nullable().optional(),
      selectedTtsStrategy: publishTtsStrategySchema.nullable().optional(),
      selectedTtsModel: z.string().nullable().optional(),
      selectedPreset: z.string().nullable().optional(),
      selectedGenerationProvider: z.enum(['openai']).nullable().optional(),
      selectedGenerationModel: z.string().nullable().optional(),
      teacherNotes: z.string().max(20_000).nullable().optional(),
      selectedProfileRevisionId: postgresUuidSchema.nullable().optional(),
      selectedProfileRevisionHash: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .nullable()
        .optional(),
    })
    .strict()
    .refine((patch) => Object.keys(patch).length > 0, 'Recovery patch must not be empty');

  const confirmStudentSchema = z
    .object({
      requestId: z.string().uuid(),
      studentId: z.string().uuid(),
      lessonId: z.string().uuid().nullable().optional(),
    })
    .strict();

  const assignmentRecoverySchema = z
    .object({
      expectedRevision: z.number().int().positive(),
      patch: assignmentRecoveryPatchSchema,
    })
    .strict();
  const attachAssignmentSourceSchema = z
    .object({
      expectedRevision: z.number().int().positive(),
      recordingId: z.string().uuid(),
      transcriptId: z.string().uuid(),
    })
    .strict();

  const confirmAssignmentStepSchema = z.discriminatedUnion('step', [
    z
      .object({
        step: z.literal('source'),
        expectedRevision: z.number().int().positive(),
        lessonId: z.string().uuid().nullable(),
        recordingId: z.string().uuid(),
        transcriptId: z.string().uuid(),
        transcriptWorkingVersion: z.number().int().positive(),
      })
      .strict(),
    z
      .object({
        step: z.literal('context'),
        expectedRevision: z.number().int().positive(),
        teacherNotes: z.string().max(20_000).nullable(),
        profileRevisionId: postgresUuidSchema.nullable(),
        profileRevisionHash: z
          .string()
          .regex(/^[0-9a-f]{64}$/)
          .nullable(),
      })
      .strict(),
    z
      .object({
        step: z.literal('create'),
        expectedRevision: z.number().int().positive(),
        promptPackageId: z.string().uuid(),
        draftId: z.string().uuid(),
        draftWorkingVersion: z.number().int().positive(),
      })
      .strict(),
  ]);
  const shareAssignmentSchema = z
    .object({
      expectedRevision: z.number().int().positive(),
      requestId: z.string().uuid(),
    })
    .strict();
  const publishAssignmentCorrectionSchema = z
    .object({
      requestId: z.string().uuid(),
      draftId: z.string().uuid(),
      draftWorkingVersion: z.number().int().positive(),
      draftHash: z.string().regex(/^[0-9a-f]{64}$/),
      artifact: AssignmentArtifactReferenceSchema.optional(),
    })
    .strict();

  app.get('/user/assignment-sessions', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    const routePath = resolveRoutePath(request, 'GET /user/assignment-sessions');
    const querySchema = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).optional(),
        scope: z.enum(['active', 'history']).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      })
      .refine((query) => !query.offset || query.scope === 'history', {
        path: ['offset'],
        message: 'Offset pagination is available for history only',
      });

    try {
      const query = querySchema.parse(request.query ?? {});
      const sessions = await listAssignmentSessionsForUserDto(
        authenticatedUser.id,
        query.limit ?? 20,
        query.scope ?? 'active',
        query.offset ?? 0,
      );

      logger.info('HTTP request handled', {
        event: 'http_request',
        route: routePath,
        statusCode: 200,
        userId: authenticatedUser.id,
      });

      return reply.code(200).send(sessions);
    } catch (error: unknown) {
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid query parameters',
          details: error.issues,
        });
      }

      logger.error(error instanceof Error ? error : String(error), {
        event: 'list_assignment_sessions_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.post(
    '/assignment-sessions/confirm-student',
    { preHandler: authenticate },
    async (request, reply) => {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Authentication required',
        });
      }

      const routePath = resolveRoutePath(request, 'POST /assignment-sessions/confirm-student');

      try {
        const body = confirmStudentSchema.parse(request.body ?? {});
        const session = await confirmStudentAssignmentSessionForUser(authenticatedUser.id, body);

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          userId: authenticatedUser.id,
          assignmentSessionId: session.id,
        });

        return reply.code(200).send(session);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (getErrorCode(error) === 'ASSIGNMENT_SESSION_NOT_FOUND') {
          return reply.code(404).send({ error: 'not_found' });
        }
        if (getErrorCode(error) === 'ASSIGNMENT_SESSION_REQUEST_CONFLICT') {
          return reply.code(409).send({
            code: 'assignment_session_request_conflict',
            session: getConflictSession(error),
          });
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'confirm_student_assignment_session_failed',
          userId: authenticatedUser.id,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.get(
    '/assignment-sessions/:id/learner-context',
    { preHandler: authenticate },
    async (request, reply) => {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) return reply.code(401).send({ error: 'unauthorized' });
      try {
        const params = z.object({ id: z.string().uuid() }).parse(request.params ?? {});
        const context = await getAssignmentLearnerContext(authenticatedUser.id, params.id);
        if (!context) return reply.code(404).send({ error: 'not_found' });
        return reply.code(200).send(context);
      } catch (error) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError)
          return reply.code(400).send({ error: 'validation_failed' });
        logger.error(error instanceof Error ? error : String(error), {
          event: 'get_assignment_learner_context_failed',
          userId: authenticatedUser.id,
        });
        return reply.code(500).send({ error: 'internal_error' });
      }
    },
  );

  app.get('/assignment-sessions/:id', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    const routePath = resolveRoutePath(request, 'GET /assignment-sessions/:id');
    const paramsSchema = z.object({ id: z.string().uuid() });

    try {
      const params = paramsSchema.parse(request.params ?? {});
      const session = await getAssignmentSessionForUser(authenticatedUser.id, params.id, config);
      if (!session) {
        return reply.code(404).send({ error: 'not_found' });
      }

      logger.info('HTTP request handled', {
        event: 'http_request',
        route: routePath,
        statusCode: 200,
        userId: authenticatedUser.id,
        assignmentSessionId: params.id,
      });

      return reply.code(200).send(session);
    } catch (error: unknown) {
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid request',
          details: error.issues,
        });
      }

      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_assignment_session_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  for (const command of ['finish-transcript', 'start-homework'] as const) {
    app.post(
      `/assignment-sessions/:id/${command}`,
      { preHandler: authenticate },
      async (request, reply) => {
        const user = getAuthenticatedUser(request);
        if (!user) return reply.code(401).send({ error: 'unauthorized' });
        try {
          const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
          const revisionSchema = z
            .object({ expectedRevision: z.number().int().positive() })
            .strict();
          if (command === 'start-homework') {
            const body = revisionSchema.parse(request.body);
            return reply.send(
              await startHomeworkAssignmentSession({
                userId: user.id,
                sessionId: id,
                request: body,
              }),
            );
          }
          const body = revisionSchema
            .extend({
              lessonId: z.string().uuid().nullable(),
              recordingId: z.string().uuid(),
              transcriptId: z.string().uuid(),
              transcriptWorkingVersion: z.number().int().positive(),
              transcriptHash: z.string().regex(/^[0-9a-f]{64}$/),
            })
            .parse(request.body);
          return reply.send(
            await finishTranscriptAssignmentSession({
              config,
              userId: user.id,
              sessionId: id,
              request: body,
            }),
          );
        } catch (error) {
          if (error instanceof HistoricalAssignmentReadOnlyError)
            return reply.code(410).send({ code: error.code });
          if (error instanceof z.ZodError)
            return reply.code(400).send({ error: 'validation_failed', details: error.issues });
          const code = getErrorCode(error);
          if (code === 'ASSIGNMENT_SESSION_NOT_FOUND')
            return reply.code(404).send({ error: 'not_found' });
          if (code === 'ASSIGNMENT_SESSION_REVISION_CONFLICT')
            return reply.code(409).send({
              code: 'assignment_session_revision_conflict',
              session: getConflictSession(error),
            });
          if (code === 'ASSIGNMENT_SOURCE_ALREADY_OWNED')
            return reply.code(409).send({
              code: 'assignment_source_already_owned',
              session: getConflictSession(error),
            });
          if (isArtifactWorkingConflict(error))
            return reply.code(409).send({
              code: 'artifact_working_conflict',
              artifact: {
                workingVersion: error.latest.workingVersion,
                contentHash: error.latest.contentHash,
              },
            });
          if (code?.startsWith('ASSIGNMENT_') || code === 'SOURCE_IDENTITY_REQUIRED')
            return reply.code(409).send({ code: code.toLowerCase() });
          logger.error(error instanceof Error ? error : String(error), {
            event: 'transcript_session_command_failed',
            command,
            userId: user.id,
          });
          return reply.code(500).send({ error: 'internal_error' });
        }
      },
    );
  }

  app.post(
    '/assignment-sessions/:id/confirm',
    { preHandler: authenticate },
    async (request, reply) => {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({ error: 'unauthorized', message: 'Authentication required' });
      }
      try {
        const params = z.object({ id: z.string().uuid() }).parse(request.params ?? {});
        const body = confirmAssignmentStepSchema.parse(request.body ?? {});
        const result = await confirmAssignmentSessionStep({
          config,
          userId: authenticatedUser.id,
          sessionId: params.id,
          request: body,
        });
        return reply.code(200).send(result);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        const code = getErrorCode(error);
        if (code === 'ASSIGNMENT_SESSION_REVISION_CONFLICT') {
          return reply.code(409).send({
            code: 'assignment_session_revision_conflict',
            session: getConflictSession(error),
          });
        }
        if (code === 'ASSIGNMENT_SOURCE_ALREADY_OWNED') {
          return reply.code(409).send({
            code: 'assignment_source_already_owned',
            session: getConflictSession(error),
          });
        }
        if (code === 'SOURCE_IDENTITY_REQUIRED') {
          return reply.code(409).send({ code: 'source_identity_required' });
        }
        if (code === 'ASSIGNMENT_STEP_PROFILE_STALE') {
          return reply.code(409).send({ code: 'assignment_step_profile_stale' });
        }
        if (code === 'ASSIGNMENT_STEP_PROFILE_PREPARING') {
          return reply.code(409).send({ code: 'assignment_step_profile_preparing' });
        }
        if (isArtifactWorkingConflict(error)) {
          return reply.code(409).send({
            code: 'artifact_working_conflict',
            artifact: {
              workingVersion: error.latest.workingVersion,
              contentHash: error.latest.contentHash,
            },
          });
        }
        if (code === 'ASSIGNMENT_SESSION_NOT_FOUND')
          return reply.code(404).send({ error: 'not_found' });
        if (
          code === 'ASSIGNMENT_SESSION_COMPLETED' ||
          code === 'ASSIGNMENT_SESSION_SHARE_IN_PROGRESS' ||
          code === 'ASSIGNMENT_HOMEWORK_INTENT_CONFLICT'
        ) {
          return reply.code(409).send({ code: code.toLowerCase() });
        }
        if (
          code === 'ASSIGNMENT_STEP_PREREQUISITE_MISSING' ||
          code === 'ASSIGNMENT_STEP_LINEAGE_INVALID' ||
          code === 'ASSIGNMENT_STEP_SPEAKER_ROLE_MAPPING_REQUIRED' ||
          code === 'ASSIGNMENT_STEP_ARTIFACT_NOT_FOUND' ||
          code === 'ASSIGNMENT_STEP_SOURCE_NOT_ATTACHED'
        ) {
          return reply.code(400).send({ code: code.toLowerCase() });
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request',
            details: error.issues,
          });
        }
        logger.error(error instanceof Error ? error : String(error), {
          event: 'confirm_assignment_session_step_failed',
          userId: authenticatedUser.id,
        });
        return reply.code(500).send({ error: 'internal_error' });
      }
    },
  );

  app.post(
    '/assignment-sessions/:id/share',
    { preHandler: authenticate },
    async (request, reply) => {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({ error: 'unauthorized', message: 'Authentication required' });
      }
      try {
        const params = z.object({ id: z.string().uuid() }).parse(request.params ?? {});
        const body = shareAssignmentSchema.parse(request.body ?? {});
        const result = await shareAssignmentSession({
          userId: authenticatedUser.id,
          sessionId: params.id,
          request: body,
        });
        return reply.code(200).send(result);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        const code = getErrorCode(error);
        if (code === 'ASSIGNMENT_SESSION_REVISION_CONFLICT') {
          return reply.code(409).send({
            code: 'assignment_session_revision_conflict',
            session: getConflictSession(error),
          });
        }
        if (code === 'ASSIGNMENT_SESSION_NOT_FOUND') {
          return reply.code(404).send({ error: 'not_found' });
        }
        if (
          code === 'ASSIGNMENT_SHARE_PREREQUISITE_MISSING' ||
          code === 'ASSIGNMENT_SHARE_DIRTY_RECOVERY' ||
          code === 'ASSIGNMENT_SHARE_REQUEST_CONFLICT' ||
          code === 'ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID'
        ) {
          return reply.code(409).send({ code: code.toLowerCase() });
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request',
            details: error.issues,
          });
        }
        logger.error(error instanceof Error ? error : String(error), {
          event: 'share_assignment_session_failed',
          userId: authenticatedUser.id,
        });
        return reply.code(500).send({ error: 'internal_error' });
      }
    },
  );

  app.post(
    '/jobs/:publishedJobId/publish-correction',
    { preHandler: authenticate },
    async (request, reply) => {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({ error: 'unauthorized', message: 'Authentication required' });
      }
      try {
        const params = z.object({ publishedJobId: z.string().uuid() }).parse(request.params ?? {});
        const body = publishAssignmentCorrectionSchema.parse(request.body ?? {});
        const result = await publishAssignmentCorrection({
          userId: authenticatedUser.id,
          publishedJobId: params.publishedJobId,
          request: body,
        });
        return reply.code(202).send(result);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        const code = getErrorCode(error);
        if (code === 'ASSIGNMENT_CORRECTION_NOT_FOUND') {
          return reply.code(404).send({ error: 'not_found' });
        }
        if (
          code === 'ASSIGNMENT_CORRECTION_PARENT_INVALID' ||
          code === 'ASSIGNMENT_CORRECTION_SESSION_LINEAGE_INVALID' ||
          code === 'ASSIGNMENT_CORRECTION_DRAFT_CONFLICT' ||
          code === 'ASSIGNMENT_CORRECTION_REQUEST_CONFLICT'
        ) {
          return reply.code(409).send({ code: code.toLowerCase() });
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request',
            details: error.issues,
          });
        }
        logger.error(error instanceof Error ? error : String(error), {
          event: 'publish_assignment_correction_failed',
          userId: authenticatedUser.id,
          publishedJobId: (request.params as { publishedJobId?: string }).publishedJobId,
        });
        return reply.code(500).send({ error: 'internal_error' });
      }
    },
  );

  app.post(
    '/assignment-sessions/:id/source-attachment',
    { preHandler: authenticate },
    async (request, reply) => {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({ error: 'unauthorized', message: 'Authentication required' });
      }
      const routePath = resolveRoutePath(
        request,
        'POST /assignment-sessions/:id/source-attachment',
      );
      try {
        const params = z.object({ id: z.string().uuid() }).parse(request.params ?? {});
        const body = attachAssignmentSourceSchema.parse(request.body ?? {});
        const result = await attachAssignmentSourceForUser(authenticatedUser.id, params.id, body);
        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          userId: authenticatedUser.id,
          assignmentSessionId: params.id,
          outcome: result.outcome,
        });
        return reply.code(200).send(result);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        const errorCode = getErrorCode(error);
        if (errorCode === 'ASSIGNMENT_SESSION_REVISION_CONFLICT') {
          return reply.code(409).send({
            code: 'assignment_session_revision_conflict',
            session: getConflictSession(error),
          });
        }
        if (errorCode === 'SOURCE_IDENTITY_REQUIRED') {
          return reply.code(409).send({ code: 'source_identity_required' });
        }
        if (errorCode === 'ASSIGNMENT_RECOVERY_LINEAGE_INVALID') {
          return reply.code(409).send({ code: 'assignment_recovery_lineage_invalid' });
        }
        if (errorCode === 'ASSIGNMENT_SESSION_NOT_FOUND') {
          return reply.code(404).send({ error: 'not_found' });
        }
        if (
          errorCode === 'ASSIGNMENT_SESSION_COMPLETED' ||
          errorCode === 'ASSIGNMENT_SESSION_SHARE_IN_PROGRESS'
        ) {
          return reply.code(409).send({ code: errorCode.toLowerCase() });
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request',
            details: error.issues,
          });
        }
        logger.error(error instanceof Error ? error : String(error), {
          event: 'attach_assignment_source_failed',
          userId: authenticatedUser.id,
        });
        return reply.code(500).send({ error: 'internal_error' });
      }
    },
  );

  app.patch(
    '/assignment-sessions/:id/recovery',
    { preHandler: authenticate },
    async (request, reply) => {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Authentication required',
        });
      }

      const routePath = resolveRoutePath(request, 'PATCH /assignment-sessions/:id/recovery');
      const paramsSchema = z.object({ id: z.string().uuid() });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = assignmentRecoverySchema.parse(request.body ?? {});
        const session = await updateAssignmentSessionRecoveryForUser(
          authenticatedUser.id,
          params.id,
          body,
        );

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          userId: authenticatedUser.id,
          assignmentSessionId: params.id,
        });

        return reply.code(200).send(session);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        const errorCode = getErrorCode(error);
        if (errorCode === 'ASSIGNMENT_SESSION_REVISION_CONFLICT') {
          return reply.code(409).send({
            code: 'assignment_session_revision_conflict',
            session: getConflictSession(error),
          });
        }
        if (errorCode === 'ASSIGNMENT_SOURCE_ALREADY_OWNED') {
          return reply.code(409).send({
            code: 'assignment_source_already_owned',
            session: getConflictSession(error),
          });
        }
        if (errorCode === 'ASSIGNMENT_RECOVERY_LINEAGE_INVALID') {
          return reply.code(409).send({ code: 'assignment_recovery_lineage_invalid' });
        }
        if (errorCode === 'ASSIGNMENT_SESSION_NOT_FOUND') {
          return reply.code(404).send({ error: 'not_found' });
        }
        if (
          errorCode === 'ASSIGNMENT_SESSION_COMPLETED' ||
          errorCode === 'ASSIGNMENT_SESSION_SHARE_IN_PROGRESS'
        ) {
          return reply.code(409).send({ code: errorCode.toLowerCase() });
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request',
            details: error.issues,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'update_assignment_session_recovery_failed',
          userId: authenticatedUser.id,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

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
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
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
      ttsStrategy: publishTtsStrategySchema.optional(),
      ttsProvider: publishTtsProviderSchema.optional(),
      ttsModel: publishTtsModelSchema.optional(),
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
        ttsStrategy: validatedData.ttsStrategy,
        ttsProvider: validatedData.ttsProvider,
        ttsModel: validatedData.ttsModel,
        userId: authenticatedUser.id,
      });

      logger.info('User submitted job', {
        event: 'user_job_submitted',
        userId: authenticatedUser.id,
        jobId: result.jobId,
      });

      return reply.code(202).send(result);
    } catch (error: unknown) {
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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
      const validActionTypes = ['rerun', 'cancel', 'edit_metadata'];
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
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
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

function isArtifactWorkingConflict(error: unknown): error is {
  code: 'ARTIFACT_WORKING_CONFLICT';
  latest: { workingVersion: number; contentHash: string };
} {
  if (!error || typeof error !== 'object' || !('code' in error) || !('latest' in error))
    return false;
  const latest = error.latest;
  return (
    error.code === 'ARTIFACT_WORKING_CONFLICT' &&
    !!latest &&
    typeof latest === 'object' &&
    'workingVersion' in latest &&
    typeof latest.workingVersion === 'number' &&
    'contentHash' in latest &&
    typeof latest.contentHash === 'string'
  );
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
