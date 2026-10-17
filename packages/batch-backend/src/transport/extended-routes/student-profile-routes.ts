import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  FOUNDATIONAL_PROFILE_SCHEMA_VERSION,
  renderFoundationalProfileContent,
} from '../../application/foundational-profile.js';
import {
  activateProfileRevisionForStudent,
  getProfileContent,
  getProfileRevisionForStudent,
  listProfileRevisionsForStudent,
  ProfileContentError,
  restoreProfileRevision,
  saveProfileRevisionContent,
  upsertProfileContent,
} from '../../application/profile-content.js';
import { postgresUuidSchema } from '../../domain/postgres-uuid.js';
import { logger } from '../../infrastructure/logger.js';
import { getAuthenticatedUser } from '../auth-middleware.js';
import { errorResponse, resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';

export function registerStudentProfileRoutes(
  app: FastifyInstance,
  context: ExtendedRoutesContext,
  authorizeStudent: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
): void {
  const { authenticate } = context;
  const foundationalProfileSchema = z.object({
    schemaVersion: z.literal(FOUNDATIONAL_PROFILE_SCHEMA_VERSION),
    overallLevel: z.string().nullable(),
    primaryGoals: z.array(z.string()),
    communicationContexts: z.array(z.string()),
    interestsAndUsefulThemes: z.array(z.string()),
    stableStrengths: z.array(z.string()),
    persistentChallenges: z.array(z.string()),
    studyPreferences: z.array(z.string()),
    durableConstraints: z.array(z.string()),
    teacherNotes: z.string().nullable(),
  });
  app.get(
    '/students/:id/profile',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/profile');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const profile = await getProfileContent(params.id);

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
            message: 'Invalid profile id',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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
    '/students/:id/profile',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PUT /students/:id/profile');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const schema = z
        .object({
          content: z.string().optional(),
          structuredContent: foundationalProfileSchema.optional(),
        })
        .refine((body) => typeof body.content === 'string' || body.structuredContent, {
          message: 'Either content or structuredContent is required.',
          path: ['content'],
        });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = schema.parse(request.body ?? {});
        const content =
          body.content ??
          (body.structuredContent ? renderFoundationalProfileContent(body.structuredContent) : '');
        const updated = await upsertProfileContent(
          params.id,
          content,
          {
            createdBy: getAuthenticatedUser(request)?.id ?? null,
          },
          body.structuredContent ?? null,
        );

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
        if (error instanceof ProfileContentError) {
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
    '/students/:id/profile/revisions',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students/:id/profile/revisions');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const schema = z
        .object({
          content: z.string().optional(),
          structuredContent: foundationalProfileSchema.optional(),
          inheritCandidateLinksFromRevisionId: postgresUuidSchema.nullable().optional(),
        })
        .refine((body) => typeof body.content === 'string' || body.structuredContent, {
          message: 'Either content or structuredContent is required.',
          path: ['content'],
        });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = schema.parse(request.body ?? {});
        const structuredContent = body.structuredContent ?? null;
        const content =
          typeof body.content === 'string'
            ? body.content
            : structuredContent
              ? renderFoundationalProfileContent(structuredContent)
              : '';

        const saved = await saveProfileRevisionContent(params.id, content, {
          source: 'update',
          status: 'draft',
          createdBy: getAuthenticatedUser(request)?.id ?? null,
          structuredContent,
          inheritCandidateLinksFromRevisionId: body.inheritCandidateLinksFromRevisionId ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 201,
          studentId: params.id,
        });

        return reply.code(201).send(saved);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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
    '/students/:id/profile/revisions',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/profile/revisions');
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
        const revisions = await listProfileRevisionsForStudent(params.id, query);
        if (!revisions) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(revisions);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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
    '/students/:id/profile/revisions/:revisionId',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'GET /students/:id/profile/revisions/:revisionId',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: postgresUuidSchema,
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const revision = await getProfileRevisionForStudent(params.id, params.revisionId);
        if (!revision) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
          revisionId: params.revisionId,
        });

        return reply.send(revision);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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
    '/students/:id/profile/revisions/:revisionId/restore',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'POST /students/:id/profile/revisions/:revisionId/restore',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: postgresUuidSchema,
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const restored = await restoreProfileRevision(params.id, params.revisionId, {
          createdBy: getAuthenticatedUser(request)?.id ?? null,
        });
        if (!restored) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
          revisionId: params.revisionId,
        });

        return reply.send(restored);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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
    '/students/:id/profile/revisions/:revisionId/activate',
    {
      preHandler: [authenticate, authorizeStudent],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'POST /students/:id/profile/revisions/:revisionId/activate',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: postgresUuidSchema,
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const activated = await activateProfileRevisionForStudent(params.id, params.revisionId, {
          actorUserId: getAuthenticatedUser(request)?.id ?? null,
        });
        if (!activated) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
          revisionId: params.revisionId,
        });

        return reply.send(activated);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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
}
