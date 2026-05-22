import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  FOUNDATIONAL_PROFILE_SCHEMA_VERSION,
  renderFoundationalProfileContent,
} from '../../application/foundational-profile.js';
import {
  activateProfileRevisionForProfile,
  deleteProfileContent,
  getProfileContent,
  getProfileRevisionForProfile,
  listProfileContents,
  listProfileRevisionsForProfile,
  ProfileContentError,
  restoreProfileRevision,
  saveProfileRevisionContent,
  upsertProfileContent,
} from '../../application/profile-content.js';
import {
  activateTemplateRevisionForTemplate,
  deleteTemplateContent,
  getTemplateContent,
  getTemplateRevisionForTemplate,
  listTemplateContents,
  listTemplateRevisionsForTemplate,
  restoreTemplateRevision,
  setDefaultTemplateContent,
  TemplateContentError,
  upsertTemplateContent,
} from '../../application/template-content.js';
import { logger } from '../../infrastructure/logger.js';
import { getAuthenticatedUser } from '../auth-middleware.js';
import { errorResponse, resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';

export function registerProfileTemplateRoutes(
  app: FastifyInstance,
  context: ExtendedRoutesContext,
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
    '/profiles',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /profiles');
      try {
        const profiles = await listProfileContents();

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(profiles);
      } catch (error: unknown) {
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
    '/profiles/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /profiles/:id');
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
          profileId: params.id,
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
    '/profiles/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PUT /profiles/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const schema = z.object({
        content: z.string(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = schema.parse(request.body ?? {});
        const updated = await upsertProfileContent(params.id, body.content, {
          createdBy: getAuthenticatedUser(request)?.id ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          profileId: params.id,
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
    '/profiles/:id/revisions',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /profiles/:id/revisions');
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
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 201,
          profileId: params.id,
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

  app.delete(
    '/profiles/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'DELETE /profiles/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const removed = await deleteProfileContent(params.id);

        if (!removed) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 204,
          profileId: params.id,
        });

        return reply.code(204).send();
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

  app.get(
    '/profiles/:id/revisions',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /profiles/:id/revisions');
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
        const revisions = await listProfileRevisionsForProfile(params.id, query);
        if (!revisions) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          profileId: params.id,
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
    '/profiles/:id/revisions/:revisionId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /profiles/:id/revisions/:revisionId');
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const revision = await getProfileRevisionForProfile(params.id, params.revisionId);
        if (!revision) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          profileId: params.id,
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
    '/profiles/:id/revisions/:revisionId/restore',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'POST /profiles/:id/revisions/:revisionId/restore',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
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
          profileId: params.id,
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
    '/profiles/:id/revisions/:revisionId/activate',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'POST /profiles/:id/revisions/:revisionId/activate',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const activated = await activateProfileRevisionForProfile(params.id, params.revisionId);
        if (!activated) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          profileId: params.id,
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

  app.get(
    '/templates',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /templates');
      try {
        const templates = await listTemplateContents();

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(templates);
      } catch (error: unknown) {
        if (error instanceof TemplateContentError) {
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
    '/templates/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /templates/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const template = await getTemplateContent(params.id);
        if (!template) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
        });

        return reply.send(template);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid template id',
            details: error.issues,
          });
        }
        if (error instanceof TemplateContentError) {
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
    '/templates/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PUT /templates/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const schema = z.object({
        content: z.string(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = schema.parse(request.body ?? {});
        const updated = await upsertTemplateContent(params.id, body.content, {
          createdBy: getAuthenticatedUser(request)?.id ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
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
        if (error instanceof TemplateContentError) {
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
    '/templates/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'DELETE /templates/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const removed = await deleteTemplateContent(params.id);

        if (!removed) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 204,
          templateId: params.id,
        });

        return reply.code(204).send();
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid template id',
            details: error.issues,
          });
        }
        if (error instanceof TemplateContentError) {
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
    '/templates/:id/revisions',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /templates/:id/revisions');
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
        const revisions = await listTemplateRevisionsForTemplate(params.id, query);
        if (!revisions) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
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
        if (error instanceof TemplateContentError) {
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
    '/templates/:id/revisions/:revisionId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /templates/:id/revisions/:revisionId');
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const revision = await getTemplateRevisionForTemplate(params.id, params.revisionId);
        if (!revision) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
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
        if (error instanceof TemplateContentError) {
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
    '/templates/:id/default',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /templates/:id/default');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const updated = await setDefaultTemplateContent(params.id);
        if (!updated) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
        });

        return reply.send(updated);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid template id',
            details: error.issues,
          });
        }
        if (error instanceof TemplateContentError) {
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
    '/templates/:id/revisions/:revisionId/restore',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'POST /templates/:id/revisions/:revisionId/restore',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const restored = await restoreTemplateRevision(params.id, params.revisionId, {
          createdBy: getAuthenticatedUser(request)?.id ?? null,
        });
        if (!restored) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
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
        if (error instanceof TemplateContentError) {
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
    '/templates/:id/revisions/:revisionId/activate',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(
        request,
        'POST /templates/:id/revisions/:revisionId/activate',
      );
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const activated = await activateTemplateRevisionForTemplate(params.id, params.revisionId);
        if (!activated) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
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
        if (error instanceof TemplateContentError) {
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
