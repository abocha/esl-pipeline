import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  getBusinessScheduleSurface,
  getBusinessSettings,
  getBusinessStatsSurface,
  TeacherBusinessDashboardError,
  updateBusinessSettings,
} from '../../application/teacher-business-dashboard.js';
import {
  resolvePrimaryWorkspaceIdForUser,
  WorkspaceContextError,
} from '../../application/workspace-context.js';
import { getAuthenticatedUser } from '../auth-middleware.js';
import { errorResponse, resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';

export function registerBusinessRoutes(app: FastifyInstance, context: ExtendedRoutesContext): void {
  const { authenticate } = context;
  const currencySchema = z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/);
  const settingsSchema = z.object({
    defaultCurrency: currencySchema.optional(),
    defaultLessonRateMinor: z.number().int().min(0).optional(),
    defaultLessonDurationMinutes: z
      .number()
      .int()
      .positive()
      .max(24 * 60)
      .optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    forecastHorizonDays: z.number().int().min(7).max(180).optional(),
    noShowRateBasisPoints: z.number().int().min(0).max(10000).optional(),
    cancellationRateBasisPoints: z.number().int().min(0).max(10000).optional(),
    topUpThreshold: z.number().int().min(0).optional(),
  });
  const dateQuerySchema = z.object({
    from: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  });
  const statsQuerySchema = z.object({
    month: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
  });

  app.get('/business/settings', { preHandler: [authenticate] }, async (request, reply) => {
    try {
      const workspaceId = await resolveWorkspaceIdForRequest(request);
      return reply.send(await getBusinessSettings(workspaceId));
    } catch (error: unknown) {
      return handleBusinessRouteError(reply, 'GET /business/settings', error);
    }
  });

  app.put('/business/settings', { preHandler: [authenticate] }, async (request, reply) => {
    const routePath = resolveRoutePath(request, 'PUT /business/settings');
    try {
      const body = settingsSchema.parse(request.body ?? {});
      const authenticatedUser = getAuthenticatedUser(request);
      const workspaceId = await resolveWorkspaceIdForRequest(request);
      return reply.send(
        await updateBusinessSettings(workspaceId, body, authenticatedUser?.id ?? null),
      );
    } catch (error: unknown) {
      return handleBusinessRouteError(reply, routePath, error);
    }
  });

  app.get('/business/schedule', { preHandler: [authenticate] }, async (request, reply) => {
    const routePath = resolveRoutePath(request, 'GET /business/schedule');
    try {
      const query = dateQuerySchema.parse(request.query ?? {});
      const workspaceId = await resolveWorkspaceIdForRequest(request);
      return reply.send(await getBusinessScheduleSurface(workspaceId, query));
    } catch (error: unknown) {
      return handleBusinessRouteError(reply, routePath, error);
    }
  });

  app.get('/business/stats', { preHandler: [authenticate] }, async (request, reply) => {
    const routePath = resolveRoutePath(request, 'GET /business/stats');
    try {
      const query = statsQuerySchema.parse(request.query ?? {});
      const workspaceId = await resolveWorkspaceIdForRequest(request);
      return reply.send(await getBusinessStatsSurface(workspaceId, query));
    } catch (error: unknown) {
      return handleBusinessRouteError(reply, routePath, error);
    }
  });
}

async function resolveWorkspaceIdForRequest(
  request: Parameters<typeof getAuthenticatedUser>[0],
): Promise<string> {
  const authenticatedUser = getAuthenticatedUser(request);
  if (!authenticatedUser) {
    throw new WorkspaceContextError('Authentication required');
  }
  return resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
}

function handleBusinessRouteError(
  reply: Parameters<typeof errorResponse>[0],
  _routePath: string,
  error: unknown,
) {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({
      error: 'validation_failed',
      message: 'Invalid business dashboard request',
      details: error.issues,
    });
  }
  if (error instanceof TeacherBusinessDashboardError) {
    return reply.code(error.status).send({
      error: error.code,
      message: error.message,
    });
  }
  if (error instanceof WorkspaceContextError) {
    return reply.code(error.status).send({
      error: error.code,
      message: error.message,
      code: error.code,
    });
  }
  return errorResponse(reply, 'internal_error');
}
