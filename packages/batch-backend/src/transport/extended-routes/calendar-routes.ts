import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { calendarSetupRequestSchema } from '@esl-pipeline/contracts';

import {
  bindCalendarEvent,
  listUnlinkedCalendarEvents,
} from '../../application/calendar-association.js';
import { requestCalendarSync } from '../../application/calendar-dispatcher.js';
import {
  adoptCalendarOperation,
  createCalendarSetup,
  getCalendarSchedulingStatus,
  getCalendarSetup,
  retryCalendarOperation,
  reviewCalendarOperation,
} from '../../application/calendar-scheduling.js';
import { CalendarError } from '../../domain/calendar-repository.js';
import { CalendarConnectionError } from '../../domain/google-connection-repository.js';
import { GoogleCalendarError } from '../../infrastructure/google-calendar-client.js';
import { getAuthenticatedUser } from '../auth-middleware.js';
import type { ExtendedRoutesContext } from './context.js';

export function registerCalendarSchedulingRoutes(
  app: FastifyInstance,
  context: ExtendedRoutesContext,
): void {
  const base = '/workspaces/:workspaceId/calendar';
  const route = (
    method: 'GET' | 'POST',
    path: string,
    action: (
      workspaceId: string,
      userId: string,
      request: import('fastify').FastifyRequest,
    ) => Promise<unknown>,
    status = 200,
  ) => {
    app.route({
      method,
      url: path,
      preHandler: context.authenticate,
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        try {
          const user = getAuthenticatedUser(request);
          if (!user) return reply.code(401).send({ error: 'authentication_required' });
          const workspaceId = z
            .uuid()
            .parse((request.params as { workspaceId: string }).workspaceId);
          const result = await action(workspaceId, user.id, request);
          return reply.code(status).send(result ?? { ok: true });
        } catch (error) {
          if (error instanceof z.ZodError)
            return reply.code(400).send({ error: 'invalid_calendar_request' });
          if (error instanceof CalendarError || error instanceof CalendarConnectionError)
            return reply.code(error.status).send({ error: error.code });
          if (error instanceof GoogleCalendarError)
            return reply.code(503).send({ error: error.code });
          // Provider/event payloads and contacts must never reach the ordinary error logger.
          return reply.code(500).send({ error: 'calendar_internal_error' });
        }
      },
    });
  };
  route('GET', `${base}/scheduling-status`, (workspace, user) =>
    getCalendarSchedulingStatus(workspace, user),
  );
  route(
    'POST',
    '/workspaces/:workspaceId/students/:studentId/calendar/setups',
    (workspace, user, req) =>
      createCalendarSetup(
        workspace,
        z.uuid().parse((req.params as { studentId: string }).studentId),
        user,
        z.string().parse(req.headers['idempotency-key']),
        calendarSetupRequestSchema.parse(req.body),
      ),
    202,
  );
  route('GET', `${base}/setups/:setupId`, (workspace, user, req) =>
    getCalendarSetup(workspace, user, z.uuid().parse((req.params as { setupId: string }).setupId)),
  );
  route(
    'POST',
    `${base}/operations/:operationId/retry`,
    (workspace, user, req) =>
      retryCalendarOperation(
        workspace,
        user,
        z.uuid().parse((req.params as { operationId: string }).operationId),
      ),
    202,
  );
  route('GET', `${base}/operations/:operationId/review`, (workspace, user, req) =>
    reviewCalendarOperation(
      workspace,
      user,
      z.uuid().parse((req.params as { operationId: string }).operationId),
    ),
  );
  route(
    'POST',
    `${base}/operations/:operationId/adopt`,
    (workspace, user, req) => {
      const body = z
        .object({ reviewedRequestHash: z.string().regex(/^[a-f0-9]{64}$/) })
        .strict()
        .parse(req.body);
      return adoptCalendarOperation(
        workspace,
        user,
        z.uuid().parse((req.params as { operationId: string }).operationId),
        body.reviewedRequestHash,
      );
    },
    202,
  );
  route('POST', `${base}/sync`, (workspace, user) => requestCalendarSync(workspace, user), 202);
  route('GET', `${base}/unlinked-events`, async (workspace, user, req) => {
    const query = z
      .object({ pageToken: z.string().min(1).max(8192).optional() })
      .strict()
      .parse(req.query);
    return listUnlinkedCalendarEvents(workspace, user, undefined, query.pageToken);
  });
  route(
    'POST',
    `${base}/bindings`,
    (workspace, user, req) => {
      const body = z
        .object({ studentId: z.uuid(), eventId: z.string().min(1).max(1024) })
        .strict()
        .parse(req.body);
      return bindCalendarEvent(workspace, user, body.studentId, body.eventId);
    },
    202,
  );
}
