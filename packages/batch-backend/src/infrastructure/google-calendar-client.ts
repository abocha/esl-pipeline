import { z } from 'zod';

import { getCalendarAccess } from '../domain/google-connection-repository.js';

const eventTimeSchema = z.object({
  dateTime: z.string().optional(),
  date: z.string().optional(),
  timeZone: z.string().optional(),
});
export const googleCalendarEventSchema = z.object({
  id: z.string().min(1),
  etag: z.string().optional(),
  updated: z.string().datetime({ offset: true }).optional(),
  status: z.string().optional(),
  summary: z.string().optional(),
  htmlLink: z.string().optional(),
  recurringEventId: z.string().optional(),
  originalStartTime: eventTimeSchema.optional(),
  start: eventTimeSchema.optional(),
  end: eventTimeSchema.optional(),
  recurrence: z.array(z.string()).optional(),
  attendees: z
    .array(z.object({ email: z.string().optional(), responseStatus: z.string().optional() }))
    .optional(),
  extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional(),
});
export type GoogleCalendarEvent = z.infer<typeof googleCalendarEventSchema>;
export interface GoogleCalendarPage {
  items: GoogleCalendarEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}
export class GoogleCalendarError extends Error {
  constructor(
    public code:
      | 'not_found'
      | 'conflict'
      | 'cursor_expired'
      | 'permission_denied'
      | 'unauthorized'
      | 'rate_limited'
      | 'provider_unavailable'
      | 'invalid_provider_response'
      | 'invalid_request',
    public retryable = false,
  ) {
    super(code);
  }
}
export interface CalendarProvider {
  get(
    connectionId: string,
    generation: string,
    eventId: string,
  ): Promise<GoogleCalendarEvent | null>;
  insert(
    connectionId: string,
    generation: string,
    event: Record<string, unknown>,
    invite: boolean,
  ): Promise<GoogleCalendarEvent>;
  changes(
    connectionId: string,
    generation: string,
    query: { syncToken?: string; pageToken?: string },
  ): Promise<GoogleCalendarPage>;
  instances(
    connectionId: string,
    generation: string,
    eventId: string,
    query: { timeMin: string; timeMax: string; pageToken?: string },
  ): Promise<GoogleCalendarPage>;
}
const quotaReasons = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
async function isCalendarQuotaResponse(response: Response): Promise<boolean> {
  if (response.status !== 403 || !response.body) return false;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        return false;
      }
      chunks.push(chunk.value);
    }
    const parsed = z
      .object({
        error: z.object({ errors: z.array(z.object({ reason: z.string().max(64) })).max(20) }),
      })
      .safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    return (
      parsed.success && parsed.data.error.errors.some((error) => quotaReasons.has(error.reason))
    );
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }
}
/** Concrete selected-calendar client. Each request has fresh authority; writes never auto-retry. */
export class GoogleCalendarClient implements CalendarProvider {
  constructor(private fetcher: typeof fetch = fetch) {}
  private async request(
    connectionId: string,
    generation: string,
    path: string,
    query: Record<string, string>,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const access = await getCalendarAccess(connectionId, Number(generation));
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(access.calendarId)}/${path}`,
    );
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${access.accessToken}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      });
    } catch {
      throw new GoogleCalendarError('provider_unavailable', true);
    }
    if (!response.ok) {
      const quotaLimited = response.status === 429 || (await isCalendarQuotaResponse(response));
      const code =
        response.status === 404
          ? 'not_found'
          : response.status === 409
            ? 'conflict'
            : response.status === 410
              ? 'cursor_expired'
              : response.status === 401
                ? 'unauthorized'
                : quotaLimited
                  ? 'rate_limited'
                  : response.status === 403
                    ? 'permission_denied'
                    : response.status === 429
                      ? 'rate_limited'
                      : response.status >= 500
                        ? 'provider_unavailable'
                        : 'invalid_request';
      throw new GoogleCalendarError(code, quotaLimited || response.status >= 500);
    }
    try {
      return await response.json();
    } catch {
      throw new GoogleCalendarError('invalid_provider_response');
    }
  }
  async get(c: string, g: string, id: string) {
    try {
      return googleCalendarEventSchema.parse(
        await this.request(c, g, `events/${encodeURIComponent(id)}`, {}),
      );
    } catch (error) {
      if (error instanceof GoogleCalendarError && error.code === 'not_found') return null;
      if (error instanceof z.ZodError) throw new GoogleCalendarError('invalid_provider_response');
      throw error;
    }
  }
  async insert(c: string, g: string, event: Record<string, unknown>, invite: boolean) {
    try {
      return googleCalendarEventSchema.parse(
        await this.request(c, g, 'events', { sendUpdates: invite ? 'all' : 'none' }, event),
      );
    } catch (error) {
      if (error instanceof z.ZodError) throw new GoogleCalendarError('invalid_provider_response');
      throw error;
    }
  }
  private async page(
    c: string,
    g: string,
    path: string,
    query: Record<string, string>,
  ): Promise<GoogleCalendarPage> {
    const value = await this.request(c, g, path, query);
    const parsed = z
      .object({
        items: z.array(googleCalendarEventSchema).default([]),
        nextPageToken: z.string().optional(),
        nextSyncToken: z.string().optional(),
      })
      .safeParse(value);
    if (!parsed.success) throw new GoogleCalendarError('invalid_provider_response');
    return parsed.data;
  }
  changes(c: string, g: string, q: { syncToken?: string; pageToken?: string }) {
    return this.page(c, g, 'events', {
      singleEvents: 'false',
      showDeleted: 'true',
      maxResults: '250',
      ...q,
    });
  }
  instances(
    c: string,
    g: string,
    id: string,
    q: { timeMin: string; timeMax: string; pageToken?: string },
  ) {
    return this.page(c, g, `events/${encodeURIComponent(id)}/instances`, {
      showDeleted: 'true',
      maxResults: '250',
      ...q,
    });
  }
}
