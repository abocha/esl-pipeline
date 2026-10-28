import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { HistoricalAssignmentReadOnlyError } from '../../application/historical-assignment.js';
import {
  InitializeStudentProfileDraftError,
  initializeStudentProfileDraft,
} from '../../application/initialize-student-profile-draft.js';
import {
  ProfileCandidatePromotionError,
  promoteStudentProfileCandidates,
} from '../../application/profile-candidate-promotion.js';
import {
  getProfileContent,
  listProfileRevisionsForStudent,
} from '../../application/profile-content.js';
import {
  ProfileDraftRefreshError,
  refreshProfileDraftFromApprovedCandidates,
} from '../../application/profile-draft-refresh.js';
import { ProfileRevisionDraftingError } from '../../application/profile-revision-drafting.js';
import {
  getStudentActivity,
  StudentActivityQueryError,
} from '../../application/student-activity.js';
import {
  getStudentMemoryHealth,
  getStudentMemoryOverview,
  listStudentHomeworkMemory,
  listStudentLessonMemory,
  listStudentMemorySnapshotsForStudent,
  listStudentProfileCandidatesForStudent,
} from '../../application/student-memory-inspection.js';
import {
  approveStudentProfileCandidate,
  deferStudentProfileCandidate,
  rejectStudentProfileCandidate,
  StudentProfileCandidateServiceError,
} from '../../application/student-profile-candidates.js';
import {
  archiveStudentProfile,
  createStudentProfile,
  getStudentProfileById,
  listStudentProfiles,
  restoreStudentProfile,
  StudentProfileStoreError,
  updateStudentProfile,
} from '../../application/student-profiles-store.js';
import {
  addStudentPackage,
  adjustStudentCredits,
  getStudentLesson,
  getStudentLessonPage,
  getStudentScheduleBillingSurface,
  hideStudentLessonFollowupReminder,
  recordStudentPayment,
  StudentScheduleBillingError,
  undoLatestHiddenStudentReminder,
  updateStudentLesson,
  updateStudentLessonPlan,
} from '../../application/student-schedule-billing.js';
import { getStudentSummaryWithDefaults } from '../../application/student-summary.js';
import {
  getStudentTimeline,
  type StudentTimelineType,
} from '../../application/student-timeline.js';
import {
  resolvePrimaryWorkspaceIdForUser,
  WorkspaceContextError,
} from '../../application/workspace-context.js';
import { HomeworkMemoryEntryStatusSchema } from '../../domain/homework-memory-model.js';
import { LessonMemoryEntryStatusSchema } from '../../domain/lesson-memory-model.js';
import { StudentMemorySnapshotStatusSchema } from '../../domain/student-memory-snapshot-model.js';
import {
  StudentProfileCandidateReviewStateSchema,
  StudentProfileCandidateStatusSchema,
} from '../../domain/student-profile-candidate-model.js';
import { logger } from '../../infrastructure/logger.js';
import { getAuthenticatedUser } from '../auth-middleware.js';
import { errorResponse, resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';
import { registerStudentProfileRoutes } from './student-profile-routes.js';

async function resolveWorkspaceIdForRequest(request: FastifyRequest): Promise<string> {
  const authenticatedUser = getAuthenticatedUser(request);
  if (!authenticatedUser) {
    throw new WorkspaceContextError('Authentication required');
  }
  return resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
}

function workspaceContextErrorResponse(reply: FastifyReply, error: unknown) {
  if (!(error instanceof WorkspaceContextError)) return null;
  return reply.code(error.status).send({
    error: error.code,
    message: error.message,
    code: error.code,
  });
}

export function registerStudentRoutes(app: FastifyInstance, context: ExtendedRoutesContext): void {
  const { authenticate } = context;
  // Student-owned handlers below may use unscoped internal helpers only after this
  // boundary proves ownership in SQL. Keep this after authenticate and before
  // any profile revision, memory, candidate, draft, or timeline access.
  async function authorizeStudent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      errorResponse(reply, 'not_found');
      return;
    }
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(request);
      const student = await getStudentProfileById(params.data.id, {
        workspaceId,
        config: context.config,
      });
      if (!student) errorResponse(reply, 'not_found');
    } catch (error) {
      if (error instanceof HistoricalAssignmentReadOnlyError)
        return reply
          .code(410)
          .send({ error: error.code, code: error.code, message: error.message });
      if (workspaceContextErrorResponse(reply, error)) return;
      logger.error(error instanceof Error ? error : String(error), {
        event: 'http_request',
        route: request.routeOptions.url,
        statusCode: 500,
        error: 'internal_error',
      });
      errorResponse(reply, 'internal_error');
    }
  }

  registerStudentProfileRoutes(app, context, authorizeStudent);

  const starterProfileSchema = z.object({
    overallLevel: z.string().nullable().optional(),
    primaryGoals: z.string().nullable().optional(),
    communicationContexts: z.string().nullable().optional(),
    interestsAndUsefulThemes: z.string().nullable().optional(),
    stableStrengths: z.string().nullable().optional(),
    persistentChallenges: z.string().nullable().optional(),
    studyPreferences: z.string().nullable().optional(),
    durableConstraints: z.string().nullable().optional(),
    teacherNotes: z.string().nullable().optional(),
    level: z.string().nullable().optional(),
    goals: z.string().nullable().optional(),
    professionOrContext: z.string().nullable().optional(),
    interests: z.string().nullable().optional(),
    longRunningChallenges: z.string().nullable().optional(),
    studyPreferencesOrConstraints: z.string().nullable().optional(),
  });
  const lessonStatusSchema = z.enum(['completed', 'no_show']);
  const optionalTextSchema = z.string().trim().max(2000).nullable().optional();
  const currencySchema = z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/);
  const paymentSchema = z.object({
    amountMinor: z.number().int().positive(),
    currency: currencySchema,
    method: z.string().trim().max(100).nullable().optional(),
    receivedAt: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    externalUrl: z.string().trim().url().max(2000).nullable().optional(),
    note: optionalTextSchema,
  });
  const lessonPlanBodySchema = z.object({
    timezone: z.string().trim().min(1).max(100).optional(),
    defaultDurationMinutes: z
      .number()
      .int()
      .positive()
      .max(24 * 60)
      .optional(),
    schedulingNotes: optionalTextSchema,
  });
  const updateLessonBodySchema = z
    .object({
      status: lessonStatusSchema.optional(),
      consumesCredit: z.boolean().optional(),
      notes: optionalTextSchema,
    })
    .strict()
    .refine((value) => Object.keys(value).length > 0, 'At least one lesson field is required');
  const packageBodySchema = z.object({
    lessons: z.number().int().positive().max(500),
    note: optionalTextSchema,
    payment: paymentSchema.nullable().optional(),
  });
  const creditAdjustmentBodySchema = z.object({
    quantityDelta: z
      .number()
      .int()
      .min(-500)
      .max(500)
      .refine((value) => value !== 0, {
        message: 'Credit adjustment must not be zero',
      }),
    note: optionalTextSchema,
  });

  const emptyProfileRevisions = {
    items: [],
    total: 0,
    limit: 0,
    offset: 0,
    order: 'desc' as const,
  };

  async function resolveStudentSurfaceProfile(studentId: string) {
    const student = await getStudentProfileById(studentId, { config: context.config });
    if (!student) return null;

    const [profile, revisions] = await Promise.all([
      getProfileContent(student.id),
      listProfileRevisionsForStudent(student.id, { limit: 20, offset: 0, order: 'desc' }),
    ]);

    return {
      profile,
      revisions: revisions ?? emptyProfileRevisions,
    };
  }

  app.get(
    '/students/:id/surfaces/overview',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/surfaces/overview');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const profilePayload = await resolveStudentSurfaceProfile(params.id);
        if (!profilePayload) {
          return errorResponse(reply, 'not_found');
        }

        const [memory, pendingCandidates, recentTimeline, scheduleBilling] = await Promise.all([
          getStudentMemoryOverview({
            studentId: params.id,
            lessonLimit: 3,
            homeworkLimit: 2,
            config: context.config,
          }),
          listStudentProfileCandidatesForStudent({
            studentId: params.id,
            statuses: ['pending_review'],
            reviewStates: ['unreviewed', 'deferred'],
            limit: 10,
            offset: 0,
            order: 'desc',
            config: context.config,
          }),
          getStudentTimeline(params.id, {
            limit: 8,
            offset: 0,
            order: 'desc',
          }),
          getStudentScheduleBillingSurface(workspaceId, params.id),
        ]);

        if (!memory || !pendingCandidates || !scheduleBilling) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send({
          ...profilePayload,
          memory,
          pendingCandidates,
          recentTimeline,
          scheduleBilling,
        });
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid student id',
            details: error.issues,
          });
        }

        const workspaceError = workspaceContextErrorResponse(reply, error);
        if (workspaceError) return workspaceError;

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

  app.get(
    '/students/:id/surfaces/learning',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/surfaces/learning');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const profilePayload = await resolveStudentSurfaceProfile(params.id);
        if (!profilePayload) {
          return errorResponse(reply, 'not_found');
        }

        const [memory, memoryHealth, candidates] = await Promise.all([
          getStudentMemoryOverview({
            studentId: params.id,
            lessonLimit: 5,
            homeworkLimit: 3,
            config: context.config,
          }),
          getStudentMemoryHealth({
            studentId: params.id,
            config: context.config,
          }),
          listStudentProfileCandidatesForStudent({
            studentId: params.id,
            limit: 50,
            offset: 0,
            order: 'desc',
            config: context.config,
          }),
        ]);

        if (!memory || !candidates) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send({
          ...profilePayload,
          memory,
          memoryHealth,
          candidates,
        });
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid student id',
            details: error.issues,
          });
        }

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

  app.get(
    '/students/:id/surfaces/history',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/surfaces/history');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const student = await getStudentProfileById(params.id, { config: context.config });
        if (!student) {
          return errorResponse(reply, 'not_found');
        }

        const [timeline, lessonMemory, homeworkMemory] = await Promise.all([
          getStudentTimeline(params.id, {
            limit: 80,
            offset: 0,
            order: 'desc',
          }),
          listStudentLessonMemory({
            studentId: params.id,
            statuses: ['ready'],
            limit: 50,
            offset: 0,
            order: 'desc',
            config: context.config,
          }),
          listStudentHomeworkMemory({
            studentId: params.id,
            statuses: ['ready'],
            limit: 50,
            offset: 0,
            order: 'desc',
            config: context.config,
          }),
        ]);

        if (!lessonMemory || !homeworkMemory) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send({
          timeline,
          lessonMemory,
          homeworkMemory,
        });
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid student id',
            details: error.issues,
          });
        }

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

  app.get(
    '/students/:id/surfaces/schedule-billing',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/surfaces/schedule-billing');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const surface = await getStudentScheduleBillingSurface(workspaceId, params.id);
        if (!surface) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(surface);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid student id',
            details: error.issues,
          });
        }

        const workspaceError = workspaceContextErrorResponse(reply, error);
        if (workspaceError) return workspaceError;

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

  app.get('/students/:id/lessons', { preHandler: [authenticate] }, async (request, reply) => {
    const routePath = resolveRoutePath(request, 'GET /students/:id/lessons');
    try {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const query = z
        .object({
          window: z.enum(['recent', 'upcoming']),
          cursor: z.string().min(1).max(2048),
        })
        .parse(request.query);
      const workspaceId = await resolveWorkspaceIdForRequest(request);
      const page = await getStudentLessonPage(workspaceId, params.id, query.window, query.cursor);
      return page ? reply.send(page) : errorResponse(reply, 'not_found');
    } catch (error) {
      return handleScheduleBillingRouteError(reply, routePath, error);
    }
  });

  app.get(
    '/students/:id/lessons/:lessonId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/lessons/:lessonId');
      try {
        const params = z
          .object({ id: z.string().min(1), lessonId: z.string().uuid() })
          .parse(request.params);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const lesson = await getStudentLesson(workspaceId, params.id, params.lessonId);
        return lesson ? reply.send(lesson) : errorResponse(reply, 'not_found');
      } catch (error) {
        return handleScheduleBillingRouteError(reply, routePath, error);
      }
    },
  );

  app.put(
    '/students/:id/operations/lesson-plan',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PUT /students/:id/operations/lesson-plan');
      const paramsSchema = z.object({ id: z.string().min(1) });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = lessonPlanBodySchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        return reply.send(
          await updateStudentLessonPlan(
            workspaceId,
            params.id,
            body,
            authenticatedUser?.id ?? null,
          ),
        );
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        return handleScheduleBillingRouteError(reply, routePath, error);
      }
    },
  );

  app.patch(
    '/students/:id/lessons/:lessonId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PATCH /students/:id/lessons/:lessonId');
      const paramsSchema = z.object({
        id: z.string().min(1),
        lessonId: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = updateLessonBodySchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        return reply.send(
          await updateStudentLesson(
            workspaceId,
            params.id,
            params.lessonId,
            body,
            authenticatedUser?.id ?? null,
          ),
        );
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        return handleScheduleBillingRouteError(reply, routePath, error);
      }
    },
  );

  app.put(
    '/students/:id/operations/reminders/lesson-followup/:lessonId/hide',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'PUT /students/:id/operations/reminders/lesson-followup/:lessonId/hide',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        lessonId: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        return reply.send(
          await hideStudentLessonFollowupReminder(
            workspaceId,
            params.id,
            params.lessonId,
            authenticatedUser?.id ?? null,
          ),
        );
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        return handleScheduleBillingRouteError(reply, routePath, error);
      }
    },
  );

  app.put(
    '/students/:id/operations/reminders/latest-hidden/undo',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'PUT /students/:id/operations/reminders/latest-hidden/undo',
      );
      const paramsSchema = z.object({ id: z.string().min(1) });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        return reply.send(
          await undoLatestHiddenStudentReminder(
            workspaceId,
            params.id,
            authenticatedUser?.id ?? null,
          ),
        );
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        return handleScheduleBillingRouteError(reply, routePath, error);
      }
    },
  );

  app.post(
    '/students/:id/packages',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/packages');
      const paramsSchema = z.object({ id: z.string().min(1) });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = packageBodySchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        return reply
          .code(201)
          .send(
            await addStudentPackage(workspaceId, params.id, body, authenticatedUser?.id ?? null),
          );
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        return handleScheduleBillingRouteError(reply, routePath, error);
      }
    },
  );

  app.post(
    '/students/:id/credits/adjustments',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/credits/adjustments');
      const paramsSchema = z.object({ id: z.string().min(1) });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = creditAdjustmentBodySchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        return reply
          .code(201)
          .send(
            await adjustStudentCredits(workspaceId, params.id, body, authenticatedUser?.id ?? null),
          );
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        return handleScheduleBillingRouteError(reply, routePath, error);
      }
    },
  );

  app.post(
    '/students/:id/payments',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/payments');
      const paramsSchema = z.object({ id: z.string().min(1) });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = paymentSchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        return reply
          .code(201)
          .send(
            await recordStudentPayment(workspaceId, params.id, body, authenticatedUser?.id ?? null),
          );
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        return handleScheduleBillingRouteError(reply, routePath, error);
      }
    },
  );

  app.get(
    '/students/:id/profile-candidates',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/profile-candidates');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        status: z.string().optional(),
        reviewState: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const statuses = query.status
          ? z.array(StudentProfileCandidateStatusSchema).parse(
              query.status
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            )
          : undefined;
        const reviewStates = query.reviewState
          ? z.array(StudentProfileCandidateReviewStateSchema).parse(
              query.reviewState
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            )
          : undefined;
        const result = await listStudentProfileCandidatesForStudent({
          studentId: params.id,
          statuses,
          reviewStates,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
          config: context.config,
        });

        if (!result) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(result);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }

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

  app.post(
    '/students/:id/profile-candidates/:candidateId/approve',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'POST /students/:id/profile-candidates/:candidateId/approve',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        candidateId: z.string().min(1),
      });
      const bodySchema = z.object({
        approvedFactText: z.string().min(1).optional(),
        approvedFact: z.string().min(1).optional(),
        reviewerNote: z.string().trim().min(1).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = bodySchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const candidate = await approveStudentProfileCandidate({
          studentId: params.id,
          candidateId: params.candidateId,
          reviewerId: authenticatedUser?.id ?? null,
          reviewerNote: body.reviewerNote ?? null,
          approvedFact: body.approvedFactText ?? body.approvedFact ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
          candidateId: params.candidateId,
        });

        return reply.send(candidate);
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
        if (error instanceof StudentProfileCandidateServiceError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }

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

  app.post(
    '/students/:id/profile-candidates/:candidateId/reject',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'POST /students/:id/profile-candidates/:candidateId/reject',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        candidateId: z.string().min(1),
      });
      const bodySchema = z.object({
        reviewerNote: z.string().trim().min(1).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = bodySchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const candidate = await rejectStudentProfileCandidate({
          studentId: params.id,
          candidateId: params.candidateId,
          reviewerId: authenticatedUser?.id ?? null,
          reviewerNote: body.reviewerNote ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
          candidateId: params.candidateId,
        });

        return reply.send(candidate);
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
        if (error instanceof StudentProfileCandidateServiceError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }

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

  app.post(
    '/students/:id/profile-candidates/:candidateId/defer',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'POST /students/:id/profile-candidates/:candidateId/defer',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        candidateId: z.string().min(1),
      });
      const bodySchema = z.object({
        reviewerNote: z.string().trim().min(1).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = bodySchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const candidate = await deferStudentProfileCandidate({
          studentId: params.id,
          candidateId: params.candidateId,
          reviewerId: authenticatedUser?.id ?? null,
          reviewerNote: body.reviewerNote ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
          candidateId: params.candidateId,
        });

        return reply.send(candidate);
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
        if (error instanceof StudentProfileCandidateServiceError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }

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

  app.post(
    '/students/:id/profile-candidates/promote',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/profile-candidates/promote');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const bodySchema = z.object({
        candidateIds: z.array(z.string().min(1)).min(1),
        baseRevisionId: z.string().min(1).optional(),
        reviewerNote: z.string().trim().min(1).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = bodySchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const result = await promoteStudentProfileCandidates({
          request: {
            studentId: params.id,
            candidateIds: body.candidateIds,
            baseRevisionId: body.baseRevisionId ?? null,
            reviewerId: authenticatedUser?.id ?? null,
            reviewerNote: body.reviewerNote ?? null,
          },
          overrides: {
            config: context.config,
          },
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send({
          draftRevisionId: result.draftRevision.id,
          includedCandidateIds: result.includedCandidateIds,
          omittedCandidates: result.omittedCandidates,
          excludedCandidateIds: body.candidateIds.filter(
            (candidateId) => !result.includedCandidateIds.includes(candidateId),
          ),
          contentHash: result.draftRevision.contentHash,
          draftRevision: result.draftRevision,
        });
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
        if (error instanceof ProfileRevisionDraftingError && error.category === 'budget_exceeded') {
          return reply.code(429).send({
            error: 'budget_exceeded',
            code: 'budget_exceeded',
            message: error.message,
            provider: error.provider,
            model: error.model,
            limitType: error.limitType,
            limit: error.limit,
            used: error.used,
            window: error.window,
          });
        }
        if (error instanceof ProfileCandidatePromotionError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }

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

  app.post(
    '/students/:id/profile-drafts/refresh-from-approved-candidates',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'POST /students/:id/profile-drafts/refresh-from-approved-candidates',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const bodySchema = z.object({
        candidateIds: z.array(z.string().min(1)).min(1),
        baseRevisionId: z.string().min(1).optional(),
        reviewerNote: z.string().trim().min(1).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = bodySchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const result = await refreshProfileDraftFromApprovedCandidates({
          request: {
            studentId: params.id,
            candidateIds: body.candidateIds,
            baseRevisionId: body.baseRevisionId ?? null,
            reviewerId: authenticatedUser?.id ?? null,
            reviewerNote: body.reviewerNote ?? null,
          },
          overrides: {
            config: context.config,
          },
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send({
          draftRevisionId: result.draftRevision.id,
          baseRevisionId: result.baseRevisionId,
          includedCandidateIds: result.includedCandidateIds,
          omittedCandidates: result.omittedCandidates,
          contentHash: result.draftRevision.contentHash,
          draftRevision: result.draftRevision,
          provider: result.provider,
          model: result.model,
          providerRequestId: result.providerRequestId,
          usage: result.usage,
        });
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
        if (error instanceof ProfileRevisionDraftingError && error.category === 'budget_exceeded') {
          return reply.code(429).send({
            error: 'budget_exceeded',
            code: 'budget_exceeded',
            message: error.message,
            provider: error.provider,
            model: error.model,
            limitType: error.limitType,
            limit: error.limit,
            used: error.used,
            window: error.window,
          });
        }
        if (error instanceof ProfileDraftRefreshError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }

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

  app.post(
    '/students/:id/profile-drafts/initialize',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/profile-drafts/initialize');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const result = await initializeStudentProfileDraft({
          request: {
            studentId: params.id,
            reviewerId: authenticatedUser?.id ?? null,
          },
          overrides: {
            config: context.config,
          },
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send({
          draftRevisionId: result.draftRevision.id,
          draftRevision: result.draftRevision,
        });
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof InitializeStudentProfileDraftError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }

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

  app.get(
    '/students',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students');
      const querySchema = z.object({
        q: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
        status: z.enum(['active', 'archived', 'all']).optional(),
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const result = await listStudentProfiles({
          search: query.q,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
          status: query.status,
          workspaceId,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(result);
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
        if (error instanceof StudentProfileStoreError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }
        const workspaceError = workspaceContextErrorResponse(reply, error);
        if (workspaceError) return workspaceError;

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

  app.get(
    '/students/summary',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/summary');
      const querySchema = z.object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const result = await getStudentSummaryWithDefaults({
          limit: query.limit,
          offset: query.offset,
          order: query.order,
          workspaceId,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(result);
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
        const workspaceError = workspaceContextErrorResponse(reply, error);
        if (workspaceError) return workspaceError;

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

  app.get(
    '/students/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const profile = await getStudentProfileById(params.id, { workspaceId });
        if (!profile) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(profile);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid student id',
            details: error.issues,
          });
        }
        if (error instanceof StudentProfileStoreError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }
        const workspaceError = workspaceContextErrorResponse(reply, error);
        if (workspaceError) return workspaceError;

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

  app.get(
    '/students/:id/memory',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/memory');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        lessonLimit: z.coerce.number().int().min(1).max(100).optional(),
        homeworkLimit: z.coerce.number().int().min(1).max(100).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const overview = await getStudentMemoryOverview({
          studentId: params.id,
          lessonLimit: query.lessonLimit,
          homeworkLimit: query.homeworkLimit,
          config: context.config,
        });

        if (!overview) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(overview);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }

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

  app.get(
    '/students/:id/memory/health',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/memory/health');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const health = await getStudentMemoryHealth({
          studentId: params.id,
          config: context.config,
        });

        if (!health) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(health);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }

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

  app.get(
    '/students/:id/lesson-memory',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/lesson-memory');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const statuses = query.status
          ? z.array(LessonMemoryEntryStatusSchema).parse(
              query.status
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            )
          : undefined;
        const result = await listStudentLessonMemory({
          studentId: params.id,
          statuses,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
          config: context.config,
        });

        if (!result) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(result);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }

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

  app.get(
    '/students/:id/homework-memory',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/homework-memory');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const statuses = query.status
          ? z.array(HomeworkMemoryEntryStatusSchema).parse(
              query.status
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            )
          : undefined;
        const result = await listStudentHomeworkMemory({
          studentId: params.id,
          statuses,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
          config: context.config,
        });

        if (!result) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(result);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }

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

  app.get(
    '/students/:id/memory-snapshots',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/memory-snapshots');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const statuses = query.status
          ? z.array(StudentMemorySnapshotStatusSchema).parse(
              query.status
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean),
            )
          : undefined;
        const result = await listStudentMemorySnapshotsForStudent({
          studentId: params.id,
          statuses,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
          config: context.config,
        });

        if (!result) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(result);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }

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

  app.post(
    '/students',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students');
      const schema = z.object({
        student: z.string().min(1),
        email: z.string().trim().email().max(320).nullable().optional(),
        dbId: z.string().nullable().optional(),
        pageParentId: z.string().nullable().optional(),
        voices: z.record(z.string(), z.string()).optional(),
        starterProfile: starterProfileSchema.nullable().optional(),
        profileId: z.never().optional(),
      });

      try {
        const body = schema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const created = await createStudentProfile(body, {
          workspaceId,
          audit: {
            reason: 'student_create',
            changedBy: authenticatedUser?.id ?? null,
          },
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 201,
          studentId: created.id,
        });

        return reply.code(201).send(created);
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
        if (error instanceof StudentProfileStoreError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }
        const workspaceError = workspaceContextErrorResponse(reply, error);
        if (workspaceError) return workspaceError;

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

  app.put(
    '/students/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PUT /students/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const schema = z
        .object({
          student: z.string().min(1).optional(),
          email: z.string().trim().email().max(320).nullable().optional(),
          dbId: z.string().nullable().optional(),
          pageParentId: z.string().nullable().optional(),
          voices: z.record(z.string(), z.string()).optional(),
          profileId: z.never().optional(),
        })
        .partial();

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = schema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const updated = await updateStudentProfile(params.id, body, {
          workspaceId,
          audit: {
            reason: 'student_update',
            changedBy: authenticatedUser?.id ?? null,
          },
        });

        if (!updated) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(updated);
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
        if (error instanceof StudentProfileStoreError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }
        const workspaceError = workspaceContextErrorResponse(reply, error);
        if (workspaceError) return workspaceError;

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

  app.post(
    '/students/:id/archive',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/archive');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const bodySchema = z.object({
        reason: z.string().trim().min(1).max(500).nullable().optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = bodySchema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const archived = await archiveStudentProfile(
          params.id,
          {
            archivedBy: authenticatedUser?.id ?? null,
            archiveReason: body.reason ?? null,
          },
          { workspaceId },
        );

        if (!archived) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(archived);
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
        if (error instanceof StudentProfileStoreError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }
        const workspaceError = workspaceContextErrorResponse(reply, error);
        if (workspaceError) return workspaceError;

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

  app.post(
    '/students/:id/restore',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/restore');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const restored = await restoreStudentProfile(
          params.id,
          {
            restoredBy: authenticatedUser?.id ?? null,
          },
          { workspaceId },
        );

        if (!restored) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(restored);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid student id',
            details: error.issues,
          });
        }
        if (error instanceof StudentProfileStoreError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }
        const workspaceError = workspaceContextErrorResponse(reply, error);
        if (workspaceError) return workspaceError;

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

  app.delete(
    '/students/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'DELETE /students/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const removed = await archiveStudentProfile(
          params.id,
          {
            archivedBy: authenticatedUser?.id ?? null,
            archiveReason: 'Archived through legacy DELETE /students/:id route.',
          },
          { workspaceId },
        );

        if (!removed) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 204,
          studentId: params.id,
        });

        return reply.code(204).send();
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid student id',
            details: error.issues,
          });
        }
        if (error instanceof StudentProfileStoreError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }
        const workspaceError = workspaceContextErrorResponse(reply, error);
        if (workspaceError) return workspaceError;

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

  app.get(
    '/students/:id/activity',
    { preHandler: [authenticate, authorizeStudent] },
    async (request, reply) => {
      try {
        const params = z.object({ id: z.string().uuid() }).parse(request.params);
        const query = z
          .object({
            category: z.enum(['all', 'lessons', 'profile', 'billing']).optional(),
            from: z.string().optional(),
            to: z.string().optional(),
            limit: z.coerce.number().int().min(1).max(100).optional(),
            cursor: z.string().max(4096).optional(),
          })
          .parse(request.query ?? {});
        const user = getAuthenticatedUser(request);
        if (!user) return reply.code(401).send({ error: 'unauthorized' });
        const workspaceId = await resolveWorkspaceIdForRequest(request);
        const activity = await getStudentActivity(workspaceId, params.id, user.id, query);
        if (!activity) return errorResponse(reply, 'not_found');
        return reply.send(activity);
      } catch (error) {
        if (error instanceof z.ZodError || error instanceof StudentActivityQueryError)
          return reply
            .code(400)
            .send({ error: 'validation_failed', message: 'Invalid activity filters or cursor' });
        if (workspaceContextErrorResponse(reply, error)) return;
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: 'GET /students/:id/activity',
          statusCode: 500,
        });
        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/students/:id/timeline',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/timeline');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        type: z.string().optional(),
        status: z.string().optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const student = await getStudentProfileById(params.id);
        if (!student) {
          return errorResponse(reply, 'not_found');
        }

        const types = query.type
          ? (query.type
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean) as StudentTimelineType[])
          : undefined;
        const statuses = query.status
          ? query.status
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : undefined;

        const timeline = await getStudentTimeline(params.id, {
          types,
          statuses,
          from: query.from ? new Date(query.from) : undefined,
          to: query.to ? new Date(query.to) : undefined,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(timeline);
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
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );
}

function handleScheduleBillingRouteError(reply: FastifyReply, routePath: string, error: unknown) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: 'validation_failed',
      message: 'Invalid schedule and billing request',
      details: error.issues,
    });
  }

  const workspaceError = workspaceContextErrorResponse(reply, error);
  if (workspaceError) return workspaceError;

  if (error instanceof StudentScheduleBillingError) {
    return reply.code(error.status).send({
      error: error.code,
      message: error.message,
      code: error.code,
    });
  }

  logger.error(error instanceof Error ? error : String(error), {
    event: 'http_request',
    route: routePath,
    statusCode: 500,
    error: 'internal_error',
  });

  return errorResponse(reply, 'internal_error');
}
