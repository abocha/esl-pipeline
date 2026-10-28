import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useWorkspaceTimezone,
  WorkspaceTimezoneProvider,
} from '../../context/WorkspaceTimezoneContext';
import { CalendarSchedulingPanel } from './CalendarSchedulingPanel';

const api = vi.hoisted(() => ({
  getBusinessSettings: vi.fn(),
  getCalendarConnection: vi.fn(),
  getCalendarSchedulingStatus: vi.fn(),
  getCalendarSetup: vi.fn(),
  createCalendarSetup: vi.fn(),
  retryCalendarOperation: vi.fn(),
  beginCalendarConnect: vi.fn(),
  getLessonCalendars: vi.fn(),
  selectLessonCalendar: vi.fn(),
  disconnectLessonCalendar: vi.fn(),
  requestCalendarSync: vi.fn(),
  getCalendarUnlinkedEvents: vi.fn(),
  bindCalendarEvent: vi.fn(),
  updateStudentProfile: vi.fn(),
  reviewCalendarOperation: vi.fn(),
  adoptCalendarOperation: vi.fn(),
}));
vi.mock('../../utils/api', () => api);
const refreshLedger = vi.fn().mockResolvedValue(undefined);
const child = (id: string, slotIndex: number, state = 'succeeded') => ({
  id,
  parentId: 'setup-1',
  kind: 'create',
  state,
  errorCode: state === 'needs_review' ? 'membership_lost' : null,
  slotIndex,
  eventUrl:
    state === 'succeeded' ? 'https://calendar.google.com/calendar/event?eid=synthetic' : null,
});
const props = {
  workspaceId: 'workspace-1',
  studentId: 'student-1',
  studentName: 'Alex',
  timezone: 'Asia/Bangkok',
  defaultDurationMinutes: 50,
  onLedgerRefresh: refreshLedger,
};

describe('Google Calendar scheduling panel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    api.getCalendarConnection.mockResolvedValue({
      enabled: true,
      canManage: true,
      canSchedule: true,
      unavailableReason: null,
      grant: { id: 'grant-1', googleEmail: 'tutor@example.test' },
      connection: {
        id: 'connection-1',
        workspaceId: 'workspace-1',
        calendarId: 'calendar-1',
        calendarName: 'Lessons',
        calendarTimezone: 'Asia/Bangkok',
        googleEmail: 'tutor@example.test',
        generation: 1,
        status: 'connected',
        lastSyncedAt: null,
        errorCode: null,
      },
    });
    api.getCalendarSchedulingStatus.mockResolvedValue({
      state: 'synced',
      connectionId: 'connection-1',
      calendarName: 'Lessons',
      googleEmail: 'tutor@example.test',
      lastSyncedAt: null,
      errorCode: null,
      operations: [],
    });
    const setup = {
      id: 'setup-1',
      operations: [child('monday', 0), child('friday', 1, 'needs_review')],
    };
    api.createCalendarSetup.mockResolvedValue(setup);
    api.getCalendarSetup.mockResolvedValue(setup);
  });
  it('creates Monday and Friday independently with email invitations on by default and opt-out available', async () => {
    render(<CalendarSchedulingPanel {...props} email="student@example.test" />);
    await screen.findByText('Synced');
    expect(
      (screen.getByRole('checkbox', { name: /Send invitation/ }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Add weekly row' }));
    const rows = screen.getAllByRole('group', { name: /Lesson row/ });
    expect(rows).toHaveLength(2);
    expect((within(rows[0]!).getByLabelText('Weekday') as HTMLSelectElement).value).toBe('1');
    expect((within(rows[0]!).getByLabelText('Local time') as HTMLInputElement).value).toBe('11:00');
    expect((within(rows[1]!).getByLabelText('Weekday') as HTMLSelectElement).value).toBe('5');
    expect((within(rows[1]!).getByLabelText('Local time') as HTMLInputElement).value).toBe('09:00');
    fireEvent.click(screen.getByRole('checkbox', { name: /Send invitation/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create in Google' }));
    await waitFor(() => expect(api.createCalendarSetup).toHaveBeenCalledOnce());
    expect(api.createCalendarSetup.mock.calls[0]?.slice(0, 3)).toEqual([
      'workspace-1',
      'student-1',
      expect.objectContaining({
        timezone: 'Asia/Bangkok',
        sendInvitation: false,
        slots: [
          expect.objectContaining({
            kind: 'weekly',
            weekday: 1,
            localTime: '11:00',
            durationMinutes: 50,
          }),
          expect.objectContaining({
            kind: 'weekly',
            weekday: 5,
            localTime: '09:00',
            durationMinutes: 50,
          }),
        ],
      }),
    ]);
    await screen.findByText(/Lesson row 2: Needs review/);
    expect(screen.getByRole('link', { name: 'Open in Google' }).getAttribute('href')).toContain(
      'calendar.google.com',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry row 2' }));
    await waitFor(() =>
      expect(api.retryCalendarOperation).toHaveBeenCalledWith('workspace-1', 'friday'),
    );
    expect(api.createCalendarSetup).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Retry row 1' })).toBeNull();
  });
  it('preserves the immutable request and idempotency key across an uncertain response and reload', async () => {
    api.createCalendarSetup.mockRejectedValueOnce(new Error('Response lost'));
    const first = render(<CalendarSchedulingPanel {...props} />);
    await screen.findByText('Synced');
    const invitation = screen.getByRole('checkbox', {
      name: /Send invitation/,
    }) as HTMLInputElement;
    expect(invitation.checked).toBe(false);
    expect(invitation.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Invitation title'), {
      target: { value: 'Captured Tuesday lesson' },
    });
    fireEvent.change(screen.getByLabelText('Weekday'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Local time'), { target: { value: '14:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create in Google' }));
    await screen.findByText('Response lost');
    const submitted = api.createCalendarSetup.mock.calls[0];
    first.unmount();
    render(
      <CalendarSchedulingPanel
        {...props}
        timezone="Europe/London"
        defaultDurationMinutes={90}
        email="later@example.test"
      />,
    );
    await screen.findByText('Synced');
    expect(screen.getByText('Captured Tuesday lesson')).toBeTruthy();
    expect(screen.getByText('Tuesday · 14:30')).toBeTruthy();
    expect(screen.getByText(/50 min · From/)).toBeTruthy();
    expect(screen.getByText('Asia/Bangkok · No invitation requested')).toBeTruthy();
    expect(screen.queryByLabelText('Invitation title')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create in Google' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry submitted setup' }));
    await waitFor(() => expect(api.createCalendarSetup).toHaveBeenCalledTimes(2));
    expect(api.createCalendarSetup.mock.calls[1]).toEqual(submitted);
  });
  it('reopens only a definitively rejected stale setup with a refreshed clock and a new request key', async () => {
    api.getBusinessSettings
      .mockResolvedValueOnce({ workspaceId: 'workspace-1', timezone: 'Asia/Bangkok' })
      .mockResolvedValue({ workspaceId: 'workspace-1', timezone: 'Europe/London' });
    api.createCalendarSetup.mockRejectedValueOnce(
      Object.assign(new Error('stale timezone'), {
        isAxiosError: true,
        response: { status: 409, data: { error: 'workspace_timezone_changed' } },
      }),
    );
    function Panel() {
      const timezone = useWorkspaceTimezone();
      return <CalendarSchedulingPanel {...props} timezone={timezone!} />;
    }
    render(
      <WorkspaceTimezoneProvider onLogout={vi.fn()}>
        <Panel />
      </WorkspaceTimezoneProvider>,
    );
    await screen.findByText('Synced');
    fireEvent.change(screen.getByLabelText('Invitation title'), {
      target: { value: 'Review these local times' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create in Google' }));
    await screen.findByText(
      'Tutor timezone changed. Review the lesson times and create the setup again.',
    );
    expect(localStorage.getItem('calendar-setup:workspace-1:student-1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry submitted setup' })).toBeNull();
    expect((screen.getByLabelText('Invitation title') as HTMLInputElement).value).toBe(
      'Review these local times',
    );
    expect(screen.getByText('Europe/London')).toBeTruthy();
    const rejected = api.createCalendarSetup.mock.calls[0]!;
    fireEvent.click(screen.getByRole('button', { name: 'Create in Google' }));
    await waitFor(() => expect(api.createCalendarSetup).toHaveBeenCalledTimes(2));
    const fresh = api.createCalendarSetup.mock.calls[1]!;
    expect(fresh[2]).toMatchObject({
      timezone: 'Europe/London',
      title: 'Review these local times',
    });
    expect(fresh[3]).not.toBe(rejected[3]);
  });
  it('keeps attention visible and connection management behind a keyboard accessible disclosure', async () => {
    api.getCalendarSchedulingStatus.mockResolvedValue({
      state: 'needs_attention',
      connectionId: 'connection-1',
      calendarName: 'Lessons',
      googleEmail: 'tutor@example.test',
      lastSyncedAt: null,
      errorCode: 'lesson_attention_required',
      operations: [],
    });
    render(<CalendarSchedulingPanel {...props} />);
    await screen.findByText('Needs attention');
    expect(screen.getByText(/Some Google changes need review/)).toBeTruthy();
    expect(screen.queryByText('lesson_attention_required')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
    const summary = screen.getByText('Connection settings');
    const details = summary.closest('details')!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(screen.getByRole('button', { name: 'Disconnect Google' })).toBeTruthy();
    expect(api.disconnectLessonCalendar).not.toHaveBeenCalled();
  });
  it('requires review of captured recipient and time before explicit operation adoption', async () => {
    api.reviewCalendarOperation.mockResolvedValue({
      id: 'friday',
      requestHash: 'fixed-hash',
      title: 'Captured lesson',
      startsAt: '2026-10-23T09:00:00+07:00',
      endsAt: '2026-10-23T10:00:00+07:00',
      timezone: 'Asia/Bangkok',
      recurrence: ['RRULE:FREQ=WEEKLY'],
      invitationRecipient: 'captured@example.test',
    });
    render(<CalendarSchedulingPanel {...props} />);
    await screen.findByText('Synced');
    fireEvent.click(screen.getByRole('button', { name: 'Create in Google' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Review row 2 for adoption' }));
    await screen.findByText('Invitation recipient: captured@example.test');
    expect(screen.getByText('Oct 23, 2026, 9:00 AM – Oct 23, 2026, 10:00 AM')).toBeTruthy();
    expect(api.adoptCalendarOperation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and adopt operation' }));
    await waitFor(() =>
      expect(api.adoptCalendarOperation).toHaveBeenCalledWith(
        'workspace-1',
        'friday',
        'fixed-hash',
      ),
    );
  });
  it('disables scheduling for a viewer and keeps Calendar failure separate from other teaching tools', async () => {
    api.getCalendarConnection.mockResolvedValue({
      enabled: false,
      canManage: false,
      canSchedule: false,
      unavailableReason: 'google_calendar_disabled',
      connection: null,
      grant: null,
    });
    api.getCalendarSchedulingStatus.mockRejectedValue(new Error('Calendar unavailable'));
    render(<CalendarSchedulingPanel {...props} />);
    await screen.findByText('Calendar unavailable');
    expect(
      (screen.getByRole('button', { name: 'Create in Google' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Connect Google' })).toBeNull();
    expect(
      screen.getByText(/Teaching history, homework and billing remain available/),
    ).toBeTruthy();
  });
  it('loads later discovery pages on demand, deduplicates events and associates the exact later event', async () => {
    const first = {
      id: 'first-event',
      title: 'First synthetic event',
      startsAt: '2030-01-07T04:00:00Z',
      recurring: false,
      eventUrl: null,
    };
    const later = { ...first, id: 'later-exact-id', title: 'Later synthetic event' };
    api.getCalendarUnlinkedEvents
      .mockResolvedValueOnce({ events: [first], nextPageToken: 'protected-cursor' })
      .mockResolvedValueOnce({ events: [first, later], nextPageToken: null });
    render(<CalendarSchedulingPanel {...props} />);
    await screen.findByText('Synced');
    fireEvent.click(screen.getByText('Associate an existing Google event'));
    fireEvent.click(screen.getByRole('button', { name: 'Load unlinked events' }));
    await screen.findByText('First synthetic event · Jan 7, 2030, 11:00 AM');
    expect(api.getCalendarUnlinkedEvents).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Load more events' }));
    await screen.findByText(/Later synthetic event/);
    expect(api.getCalendarUnlinkedEvents).toHaveBeenLastCalledWith(
      'workspace-1',
      'protected-cursor',
    );
    expect(screen.getAllByText(/First synthetic event/)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more events' })).toBeNull();
    const row = screen.getByText(/Later synthetic event/).parentElement!;
    fireEvent.click(within(row).getByRole('button', { name: 'Associate with Alex' }));
    await waitFor(() =>
      expect(api.bindCalendarEvent).toHaveBeenCalledWith(
        'workspace-1',
        'student-1',
        'later-exact-id',
      ),
    );
  });
});
