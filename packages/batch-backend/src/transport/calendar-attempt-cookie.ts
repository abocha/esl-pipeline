import type { FastifyReply, FastifyRequest } from 'fastify';

import type { BatchBackendConfig } from '../config/env.js';
import { invalidateCalendarBrowserAttempts } from '../domain/google-connection-repository.js';

export const CALENDAR_ATTEMPT_COOKIE = 'esl_calendar_attempt';
/** Shared path includes both /api callback/auth routes and direct backend auth routes. */
export function calendarAttemptCookieOptions(config: BatchBackendConfig) {
  return {
    httpOnly: true,
    secure: config.auth.refreshCookieSecure,
    sameSite: 'lax' as const,
    path: '/',
    domain: config.auth.refreshCookieDomain,
  };
}
export async function invalidateCalendarAttemptCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  config: BatchBackendConfig,
): Promise<void> {
  await invalidateCalendarBrowserAttempts(request.cookies?.[CALENDAR_ATTEMPT_COOKIE]);
  reply.clearCookie(CALENDAR_ATTEMPT_COOKIE, calendarAttemptCookieOptions(config));
}
