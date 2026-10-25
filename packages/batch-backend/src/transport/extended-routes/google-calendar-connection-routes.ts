import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { CalendarSelectRequestSchema } from '@esl-pipeline/contracts';

import {
  disconnectGoogleLessonCalendar,
  getCalendarConnectionStatus,
  listGoogleLessonCalendars,
  selectGoogleLessonCalendar,
} from '../../application/google-calendar-connection.js';
import {
  beginCalendarAttempt,
  CalendarConnectionError,
  completeCalendarAttempt,
  invalidateCalendarBrowserAttempts,
} from '../../domain/google-connection-repository.js';
import { getUserById } from '../../domain/user-repository.js';
import { withSanitizedPgLogging } from '../../infrastructure/db.js';
import { GoogleOAuthError } from '../../infrastructure/google-oauth-client.js';
import { logger } from '../../infrastructure/logger.js';
import { getAuthenticatedUser } from '../auth-middleware.js';
import {
  CALENDAR_ATTEMPT_COOKIE,
  calendarAttemptCookieOptions,
} from '../calendar-attempt-cookie.js';
import type { ExtendedRoutesContext } from './context.js';

export function registerGoogleCalendarConnectionRoutes(
  app: FastifyInstance,
  context: ExtendedRoutesContext,
): void {
  const { config, authService, authenticate, uploadRateLimitMiddleware } = context;
  const workspaceSchema = z.object({ workspaceId: z.string().uuid() });
  const prefix = '/workspaces/:workspaceId/calendar';
  for (const [suffix, method] of [
    ['connection', 'GET'],
    ['connect', 'POST'],
    ['calendars', 'GET'],
    ['select', 'POST'],
    ['disconnect', 'POST'],
  ] as const) {
    app.route({
      method,
      url: `${prefix}/${suffix}`,
      // Status is a local authenticated read polled by every scheduling panel.
      // Keep the provider-action budget for explicit connection/provider actions.
      preHandler:
        suffix === 'connection' ? [authenticate] : [authenticate, uploadRateLimitMiddleware],
      handler: async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        try {
          const { workspaceId } = workspaceSchema.parse(request.params);
          const user = getAuthenticatedUser(request);
          if (!user) return reply.code(401).send({ error: 'unauthorized' });
          if (suffix === 'connection')
            return reply.send(await getCalendarConnectionStatus(workspaceId, user.id));
          if (suffix === 'connect') {
            const refresh = request.cookies?.[config.auth.refreshCookieName];
            let cookieUserId: string | null = null;
            try {
              cookieUserId = refresh ? authService.verifyRefreshToken(refresh).sub : null;
            } catch {
              /* fixed session classification below */
            }
            if (cookieUserId !== user.id)
              throw new CalendarConnectionError('calendar_session_required', 401);
            const attempt = await beginCalendarAttempt(
              user.id,
              workspaceId,
              request.cookies?.[CALENDAR_ATTEMPT_COOKIE],
            );
            reply.setCookie(CALENDAR_ATTEMPT_COOKIE, attempt.binding, {
              ...calendarAttemptCookieOptions(config),
              maxAge: 600,
            });
            return reply.send({ authorizationUrl: attempt.authorizationUrl });
          }
          if (suffix === 'calendars')
            return reply.send({ calendars: await listGoogleLessonCalendars(workspaceId, user.id) });
          if (suffix === 'select') {
            const body = CalendarSelectRequestSchema.parse(request.body);
            return reply.send({
              connection: await selectGoogleLessonCalendar(
                workspaceId,
                user.id,
                body.calendarId,
                body.confirmReplacement,
              ),
            });
          }
          await disconnectGoogleLessonCalendar(workspaceId, user.id);
          return reply.code(204).send();
        } catch (error) {
          const status =
            error instanceof CalendarConnectionError
              ? error.status
              : error instanceof z.ZodError
                ? 400
                : 503;
          return reply.code(status).send({
            error:
              error instanceof CalendarConnectionError || error instanceof GoogleOAuthError
                ? error.code
                : error instanceof z.ZodError
                  ? 'validation_failed'
                  : 'google_unavailable',
          });
        }
      },
    });
  }

  app.get('/google/calendar/callback', async (request, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer');
    let classification = 'calendar_attempt_invalid';
    try {
      await withSanitizedPgLogging(async () => {
        const query = z
          .object({ state: z.string().min(32).max(256), code: z.string().min(1).max(8192) })
          .passthrough()
          .refine((q) => !('error' in q))
          .parse(request.query);
        const binding = request.cookies?.[CALENDAR_ATTEMPT_COOKIE];
        const refresh = request.cookies?.[config.auth.refreshCookieName];
        if (!binding || !refresh)
          throw new CalendarConnectionError('calendar_session_required', 401);
        const payload = authService.verifyRefreshToken(refresh);
        const user = await getUserById(payload.sub);
        if (!user?.isActive) throw new CalendarConnectionError('calendar_session_required', 401);
        await completeCalendarAttempt({
          state: query.state,
          code: query.code,
          binding,
          userId: user.id,
        });
      });
      classification = 'calendar_connected_pending_selection';
    } catch (error) {
      classification =
        error instanceof CalendarConnectionError || error instanceof GoogleOAuthError
          ? error.code
          : 'calendar_callback_rejected';
      // Provider errors, descriptions, request/query/header values never enter a log or redirect.
      try {
        await invalidateCalendarBrowserAttempts(request.cookies?.[CALENDAR_ATTEMPT_COOKIE]);
      } catch {
        classification = 'calendar_callback_unavailable';
      }
    }
    reply.clearCookie(CALENDAR_ATTEMPT_COOKIE, calendarAttemptCookieOptions(config));
    logger.info('Google Calendar callback completed', {
      event: 'google_calendar_callback',
      route: 'google_calendar_callback',
      method: 'GET',
      statusCode: 303,
      requestId: request.id,
      classification,
    });
    return reply.code(303).redirect('/calendar/connection-result');
  });
}
