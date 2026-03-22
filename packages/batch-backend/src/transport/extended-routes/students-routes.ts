import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getActiveStudentProfileBindingForStudent,
  listStudentProfileBindingsForStudent,
  resolveStudentProfileBindingAt,
} from '../../application/student-profile-bindings.js';
import {
  getStudentMemoryOverview,
  listStudentHomeworkMemory,
  listStudentLessonMemory,
  listStudentMemorySnapshotsForStudent,
  listStudentProfileCandidatesForStudent,
} from '../../application/student-memory-inspection.js';
import {
  StudentProfileCandidateServiceError,
  approveStudentProfileCandidate,
  deferStudentProfileCandidate,
  rejectStudentProfileCandidate,
} from '../../application/student-profile-candidates.js';
import {
  ProfileCandidatePromotionError,
  promoteStudentProfileCandidates,
} from '../../application/profile-candidate-promotion.js';
import {
  StudentProfileStoreError,
  createStudentProfile,
  deleteStudentProfile,
  getStudentProfileById,
  listStudentProfiles,
  updateStudentProfile,
} from '../../application/student-profiles-store.js';
import { HomeworkMemoryEntryStatusSchema } from '../../domain/homework-memory-model.js';
import { LessonMemoryEntryStatusSchema } from '../../domain/lesson-memory-model.js';
import { StudentMemorySnapshotStatusSchema } from '../../domain/student-memory-snapshot-model.js';
import {
  StudentProfileCandidateReviewStateSchema,
  StudentProfileCandidateStatusSchema,
} from '../../domain/student-profile-candidate-model.js';
import { getStudentSummaryWithDefaults } from '../../application/student-summary.js';
import { type StudentTimelineType, getStudentTimeline } from '../../application/student-timeline.js';
import { logger } from '../../infrastructure/logger.js';
import { getAuthenticatedUser } from '../auth-middleware.js';
import { errorResponse, resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';

export function registerStudentRoutes(app: FastifyInstance, context: ExtendedRoutesContext): void {
  const { authenticate } = context;
  const starterProfileSchema = z.object({
    level: z.string().nullable().optional(),
    goals: z.string().min(1),
    professionOrContext: z.string().min(1),
    interests: z.string().min(1),
    longRunningChallenges: z.string().min(1),
    studyPreferencesOrConstraints: z.string().min(1),
    teacherNotes: z.string().nullable().optional(),
  });

  app.get(
    '/students/:id/profile-candidates',
    {
      preHandler: [authenticate],
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
          ? z
              .array(StudentProfileCandidateStatusSchema)
              .parse(
                query.status
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean),
              )
          : undefined;
        const reviewStates = query.reviewState
          ? z
              .array(StudentProfileCandidateReviewStateSchema)
              .parse(
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
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/profile-candidates/:candidateId/approve');
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
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/profile-candidates/:candidateId/reject');
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
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/profile-candidates/:candidateId/defer');
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
      preHandler: [authenticate],
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
          profileId: result.profileId,
          includedCandidateIds: result.includedCandidateIds,
          excludedCandidateIds: body.candidateIds.filter(
            (candidateId) => !result.includedCandidateIds.includes(candidateId),
          ),
          contentHash: result.draftRevision.contentHash,
        });
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
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
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const result = await listStudentProfiles({
          search: query.q,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(result);
      } catch (error: unknown) {
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
        const result = await getStudentSummaryWithDefaults({
          limit: query.limit,
          offset: query.offset,
          order: query.order,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(result);
      } catch (error: unknown) {
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
        const profile = await getStudentProfileById(params.id);
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
      preHandler: [authenticate],
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
      preHandler: [authenticate],
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
          ? z
              .array(LessonMemoryEntryStatusSchema)
              .parse(
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
      preHandler: [authenticate],
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
          ? z
              .array(HomeworkMemoryEntryStatusSchema)
              .parse(
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
      preHandler: [authenticate],
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
          ? z
              .array(StudentMemorySnapshotStatusSchema)
              .parse(
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
        dbId: z.string().nullable().optional(),
        pageParentId: z.string().nullable().optional(),
        colorPreset: z.string().nullable().optional(),
        accentPreference: z.string().nullable().optional(),
        voices: z.record(z.string(), z.string()).optional(),
        manifestPreset: z.string().nullable().optional(),
        profileId: z.string().nullable().optional(),
        starterProfile: starterProfileSchema.nullable().optional(),
      });

      try {
        const body = schema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const created = await createStudentProfile(body, {
          bindingAudit: {
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
          dbId: z.string().nullable().optional(),
          pageParentId: z.string().nullable().optional(),
          colorPreset: z.string().nullable().optional(),
          accentPreference: z.string().nullable().optional(),
          voices: z.record(z.string(), z.string()).optional(),
          manifestPreset: z.string().nullable().optional(),
          profileId: z.string().nullable().optional(),
        })
        .partial();

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = schema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const updated = await updateStudentProfile(params.id, body, {
          bindingAudit: {
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
        const removed = await deleteStudentProfile(params.id);

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
    '/students/:id/bindings',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/bindings');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const bindings = await listStudentProfileBindingsForStudent(params.id, query);

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(bindings);
      } catch (error: unknown) {
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
    '/students/:id/bindings/active',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/bindings/active');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        at: z.string().datetime({ offset: true }).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const binding = query.at
          ? await resolveStudentProfileBindingAt(params.id, new Date(query.at))
          : await getActiveStudentProfileBindingForStudent(params.id);
        if (!binding) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
          ...(query.at ? { effectiveAt: query.at } : {}),
        });

        return reply.send(binding);
      } catch (error: unknown) {
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
    '/students/:id/timeline',
    {
      preHandler: [authenticate],
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
