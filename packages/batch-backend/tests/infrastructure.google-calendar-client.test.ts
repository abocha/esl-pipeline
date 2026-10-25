import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalendarSetupRequestDto } from '@esl-pipeline/contracts';

import {
  calendarEventProjection,
  resolveCalendarWallTime,
} from '../src/application/calendar-scheduling.js';
import { calendarEventTiming } from '../src/application/calendar-sync.js';
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from '../src/infrastructure/google-calendar-client.js';

const access = vi.hoisted(() => vi.fn());
vi.mock('../src/domain/google-connection-repository.js', () => ({ getCalendarAccess: access }));
const event = {
  id: 'event123',
  start: { dateTime: '2030-01-07T11:00:00+07:00', timeZone: 'Asia/Bangkok' },
  end: { dateTime: '2030-01-07T12:00:00+07:00' },
};
beforeEach(() => {
  access.mockReset();
  access.mockResolvedValue({
    accessToken: 'test-access',
    calendarId: 'selected@example.test',
    workspaceId: 'workspace',
  });
});

describe('Google Calendar concrete adapter', () => {
  it('restricts calls to the selected calendar, rechecks access per request, and keeps sync queries compatible', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ items: [event], nextSyncToken: 'next' }), { status: 200 }),
      );
    const client = new GoogleCalendarClient(fetcher);
    await client.changes('connection', '3', { syncToken: 'cursor', pageToken: 'page' });
    const url = fetcher.mock.calls[0]![0] as URL;
    expect(decodeURIComponent(url.pathname)).toBe(
      '/calendar/v3/calendars/selected@example.test/events',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      singleEvents: 'false',
      showDeleted: 'true',
      maxResults: '250',
      syncToken: 'cursor',
      pageToken: 'page',
    });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify(event), { status: 200 }));
    await client.get('connection', '3', 'opaque/id');
    expect(access).toHaveBeenNthCalledWith(1, 'connection', 3);
    expect(access).toHaveBeenNthCalledWith(2, 'connection', 3);
    expect((fetcher.mock.calls[1]![0] as URL).pathname).toContain('opaque%2Fid');
  });
  it.each([
    [true, 'all'],
    [false, 'none'],
  ] as const)(
    'uses explicit invitation delivery=%s without replaying uncertain writes',
    async (invite, sendUpdates) => {
      const fetcher = vi.fn().mockRejectedValue(new Error('test timeout containing secret'));
      const client = new GoogleCalendarClient(fetcher);
      await expect(client.insert('connection', '1', event, invite)).rejects.toMatchObject({
        code: 'provider_unavailable',
        retryable: true,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect((fetcher.mock.calls[0]![0] as URL).searchParams.get('sendUpdates')).toBe(sendUpdates);
    },
  );
  it.each([
    [410, 'cursor_expired', false],
    [403, 'permission_denied', false],
    [429, 'rate_limited', true],
    [503, 'provider_unavailable', true],
  ] as const)(
    'classifies HTTP %s without returning provider descriptions',
    async (status, code, retryable) => {
      const client = new GoogleCalendarClient(
        vi.fn().mockResolvedValue(new Response('secret provider description', { status })),
      );
      const error = await client.changes('c', '1', {}).catch((error) => error);
      expect(error).toBeInstanceOf(GoogleCalendarError);
      expect(error).toMatchObject({ code, retryable, message: code });
    },
  );
  it('rejects malformed provider event/page payloads', async () => {
    const client = new GoogleCalendarClient(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [{ summary: 'missing identity' }] }), {
          status: 200,
        }),
      ),
    );
    await expect(client.changes('c', '1', {})).rejects.toMatchObject({
      code: 'invalid_provider_response',
    });
  });
  it.each([
    ['rateLimitExceeded', 'rate_limited', true],
    ['userRateLimitExceeded', 'rate_limited', true],
    ['forbidden', 'permission_denied', false],
    ['unknownFutureReason', 'permission_denied', false],
  ] as const)(
    'classifies structured 403 reason %s without retaining provider text',
    async (reason, code, retryable) => {
      const fetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              message: 'secret provider description',
              errors: [{ reason, message: 'secret provider description' }],
            },
          }),
          { status: 403 },
        ),
      );
      const client = new GoogleCalendarClient(fetcher);
      const error = await client.changes('c', '1', {}).catch((error) => error);
      expect(error).toMatchObject({ code, retryable, message: code });
      expect(String(error)).not.toContain('secret provider description');
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it('does not classify oversized 403 descriptions from unbounded provider content', async () => {
    const client = new GoogleCalendarClient(
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { message: 'x'.repeat(9000), errors: [{ reason: 'rateLimitExceeded' }] },
          }),
          { status: 403 },
        ),
      ),
    );
    await expect(client.changes('c', '1', {})).rejects.toMatchObject({
      code: 'permission_denied',
      retryable: false,
    });
  });
});
describe('Calendar creation and observation semantics', () => {
  it('rejects DST gaps and folds and preserves an unambiguous wall time', () => {
    expect(() => resolveCalendarWallTime('2030-03-10', '02:30', 'America/New_York')).toThrow(
      'nonexistent_local_time',
    );
    expect(() => resolveCalendarWallTime('2030-11-03', '01:30', 'America/New_York')).toThrow(
      'ambiguous_local_time',
    );
    expect(resolveCalendarWallTime('2030-01-07', '11:00', 'Asia/Bangkok').toISOString()).toBe(
      '2030-01-07T04:00:00.000Z',
    );
    expect(() => resolveCalendarWallTime('2030-02-30', '11:00', 'UTC')).toThrow(
      'invalid_local_time',
    );
  });
  it('projects only the allowed title/time/recipient fields with no Meet or private teaching material', () => {
    const request: CalendarSetupRequestDto = {
      title: 'English lesson',
      timezone: 'Asia/Bangkok',
      slots: [
        {
          kind: 'weekly',
          startDate: '2030-01-07',
          localTime: '11:00',
          weekday: 1,
          durationMinutes: 60,
        },
      ],
    };
    const projected = calendarEventProjection(
      request,
      request.slots[0]!,
      'abc123',
      'opaque-marker',
      'hash',
      'student@example.test',
    );
    expect(projected).toEqual({
      id: 'abc123',
      summary: 'English lesson',
      start: { dateTime: '2030-01-07T04:00:00.000Z', timeZone: 'Asia/Bangkok' },
      end: { dateTime: '2030-01-07T05:00:00.000Z', timeZone: 'Asia/Bangkok' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
      guestsCanInviteOthers: false,
      guestsCanModify: false,
      attendees: [{ email: 'student@example.test' }],
      extendedProperties: { private: { eslAssociation: 'opaque-marker', eslRequest: 'hash' } },
    });
    expect(
      calendarEventProjection(request, request.slots[0]!, 'abc123', 'marker', 'hash', null),
    ).not.toHaveProperty('attendees');
  });
  it('rejects all-day, missing-offset, zero and negative-duration lessons', () => {
    expect(
      calendarEventTiming({ id: 'a', start: { date: '2030-01-07' }, end: { date: '2030-01-08' } }),
    ).toBeNull();
    expect(
      calendarEventTiming({ ...event, start: { dateTime: '2030-01-07T11:00:00' } }),
    ).toBeNull();
    expect(calendarEventTiming({ ...event, end: event.start })).toBeNull();
    expect(
      calendarEventTiming({ ...event, end: { dateTime: '2030-01-07T10:00:00+07:00' } }),
    ).toBeNull();
    expect(calendarEventTiming(event)?.duration).toBe(60);
  });
});
