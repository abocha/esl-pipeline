import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

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
import { getAuthenticatedUser, requireRole } from '../auth-middleware.js';
import { errorResponse, resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';

export function registerTemplateRoutes(app: FastifyInstance, context: ExtendedRoutesContext): void {
  const { authenticate } = context;
  const templateManagementPreHandler = [authenticate, requireRole(['admin'])];

  app.get(
    '/templates',
    {
      preHandler: templateManagementPreHandler,
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
      preHandler: templateManagementPreHandler,
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
      preHandler: templateManagementPreHandler,
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
      preHandler: templateManagementPreHandler,
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
      preHandler: templateManagementPreHandler,
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
      preHandler: templateManagementPreHandler,
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
      preHandler: templateManagementPreHandler,
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
      preHandler: templateManagementPreHandler,
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
      preHandler: templateManagementPreHandler,
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
