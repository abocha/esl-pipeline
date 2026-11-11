import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useWorkspaceTimezone,
  WorkspaceTimezoneProvider,
} from '../../context/WorkspaceTimezoneContext';
import { StudioV2Provider } from '../studio-v2/StudioV2Context';
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

  it('keeps the sync action busy until Calendar reports success separately', async () => {
    vi.useFakeTimers();
    try {
      const previous = new Date(Date.now() - 600_000).toISOString();
      const calendarStatus = { connectionId: 'connection-1', errorCode: null };
      api.getCalendarSchedulingStatus.mockResolvedValue({
        ...calendarStatus,
        state: 'synced',
        lastSyncedAt: previous,
        operations: [],
      });
      let acceptSync!: () => void;
      api.requestCalendarSync.mockImplementationOnce(
        () => new Promise<void>((resolve) => (acceptSync = resolve)),
      );
      const page = render(<CalendarSchedulingPanel {...props} />);
      await act(async () => {});

      fireEvent.click(screen.getByRole('button', { name: 'Sync now' }));
      expect(screen.getByRole('button', { name: 'Syncing…' })).toHaveProperty('disabled', true);
      expect(screen.getByRole('status').textContent).toBe('Synced 10m ago');

      api.getCalendarSchedulingStatus.mockResolvedValue({
        ...calendarStatus,
        state: 'syncing',
        lastSyncedAt: previous,
        operations: [{ id: 'manual-sync', kind: 'sync', state: 'pending' }],
      });
      await act(async () => acceptSync());
      expect(screen.getByRole('button', { name: 'Syncing…' })).toHaveProperty('disabled', true);
      expect(screen.getByRole('status').textContent).toBe('Syncing');

      const completedAt = new Date().toISOString();
      api.getCalendarSchedulingStatus.mockImplementation(async () => ({
        ...calendarStatus,
        state: 'synced',
        lastSyncedAt: completedAt,
        operations: [],
      }));
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(screen.getByRole('button', { name: 'Sync now' })).toHaveProperty('disabled', false);
      expect(screen.getByRole('status').textContent).toBe('Synced just now');
      await act(async () => vi.advanceTimersByTimeAsync(115_000));
      expect(screen.getByRole('status').textContent).toBe('Synced 2m ago');

      api.getCalendarSchedulingStatus.mockResolvedValue({
        ...calendarStatus,
        state: 'synced',
        lastSyncedAt: '2020-01-01T00:00:00.000Z',
        operations: [],
      });
      await act(async () => vi.advanceTimersByTimeAsync(5000));
      expect(screen.getByRole('status').textContent).toBe('Synced');
      expect(api.requestCalendarSync).toHaveBeenCalledOnce();
      page.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps the v2 scheduling draft across drawer dismissals', async () => {
    render(
      <StudioV2Provider enabled>
        <CalendarSchedulingPanel {...props} />
      </StudioV2Provider>,
    );
    await screen.findByText('Synced');
    fireEvent.click(screen.getByRole('button', { name: 'Schedule lesson for Alex' }));
    fireEvent.change(screen.getByLabelText('Invitation title'), {
      target: { value: 'Friday practice' },
    });
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Calendar settings' }));
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
    expect(screen.queryByLabelText('Invitation title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule lesson' }));
    expect((screen.getByLabelText('Invitation title') as HTMLInputElement).value).toBe(
      'Friday practice',
    );
    fireEvent.click(screen.getByRole('button', { name: /Close/ }));
    expect(screen.queryByLabelText('Invitation title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Manage/ }));
    expect((screen.getByLabelText('Invitation title') as HTMLInputElement).value).toBe(
      'Friday practice',
    );
    expect(api.createCalendarSetup).not.toHaveBeenCalled();
  });
  it('opens the v2 event picker directly and links only the chosen event', async () => {
    api.getCalendarUnlinkedEvents.mockResolvedValue({
      events: [
        { id: 'event-a', title: 'Conversation practice', startsAt: '2030-01-08T03:00:00Z' },
        { id: 'event-b', title: 'Weekly English lesson', startsAt: '2030-01-09T03:00:00Z' },
      ],
      nextPageToken: null,
    });
    api.bindCalendarEvent.mockResolvedValue(undefined);
    render(
      <StudioV2Provider enabled>
        <CalendarSchedulingPanel {...props} />
      </StudioV2Provider>,
    );
    await screen.findByText('Synced');
    fireEvent.click(screen.getByRole('button', { name: /Manage/ }));
    expect(api.getCalendarUnlinkedEvents).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Link existing event' }));
    expect(screen.queryByLabelText('Invitation title')).toBeNull();
    const event = await screen.findByRole('button', { name: 'Link Weekly English lesson to Alex' });
    expect(api.bindCalendarEvent).not.toHaveBeenCalled();
    fireEvent.click(event);
    expect(await screen.findByText('Linked “Weekly English lesson” to Alex.')).toBeTruthy();
    expect(api.bindCalendarEvent).toHaveBeenCalledWith('workspace-1', 'student-1', 'event-b');
    expect(screen.getByRole('button', { name: 'Link Conversation practice to Alex' })).toBeTruthy();
  });
  it('shows the v2 unavailable state without unusable scheduling and linking controls', async () => {
    api.getCalendarConnection.mockResolvedValue({
      enabled: false,
      canManage: true,
      canSchedule: true,
      unavailableReason: 'google_calendar_disabled',
      connection: null,
      grant: null,
    });
    api.getCalendarSchedulingStatus.mockResolvedValue({ state: 'disconnected', operations: [] });
    render(
      <StudioV2Provider enabled>
        <CalendarSchedulingPanel {...props} />
      </StudioV2Provider>,
    );
    await screen.findByText('Unavailable');
    fireEvent.click(screen.getByRole('button', { name: /Manage/ }));
    const drawer = within(screen.getByRole('dialog', { name: 'Teaching calendar' }));
    expect(drawer.getByText('Unavailable')).toBeTruthy();
    expect(drawer.getByText('Google Calendar is turned off in this environment.')).toBeTruthy();
    expect(drawer.queryByRole('button', { name: 'Connect Google' })).toBeNull();
    expect(drawer.queryByText('Connection settings')).toBeNull();
    expect(drawer.queryByLabelText('Invitation title')).toBeNull();
    expect(drawer.queryByText('Associate an existing Google event')).toBeNull();
    fireEvent.click(drawer.getByText('Calendar access and privacy'));
    expect(drawer.getByRole('link', { name: 'Privacy Policy (opens in a new tab)' })).toBeTruthy();
  });
  it('moves from connecting Google to choosing the lesson calendar in v2', async () => {
    const user = userEvent.setup();
    const disconnected = {
      enabled: true,
      canManage: true,
      canSchedule: true,
      connection: null,
      grant: null,
    };
    api.getCalendarConnection.mockResolvedValue(disconnected);
    api.getCalendarSchedulingStatus.mockResolvedValue({ state: 'disconnected', operations: [] });
    api.getLessonCalendars.mockResolvedValue({
      calendars: [
        { id: 'lessons', summary: 'Lessons', timeZone: 'Asia/Bangkok', accessRole: 'owner' },
        {
          id: 'shared',
          summary: 'Shared lessons',
          timeZone: 'Europe/London',
          accessRole: 'writer',
        },
      ],
    });
    const beforeOAuth = render(
      <StudioV2Provider enabled>
        <CalendarSchedulingPanel {...props} />
      </StudioV2Provider>,
    );
    await screen.findByText('Disconnected');
    fireEvent.click(screen.getByRole('button', { name: /Manage/ }));
    expect(screen.getByRole('button', { name: 'Connect Google' })).toBeTruthy();
    expect(screen.getByText(/Google grants access to events across your calendars/)).toBeTruthy();
    api.getCalendarConnection.mockResolvedValue({
      ...disconnected,
      grant: { id: 'grant-1', googleEmail: 'tutor@example.test' },
    });
    // Returning from Google remounts the Calendar panel with the new grant.
    beforeOAuth.unmount();
    const afterOAuth = render(
      <StudioV2Provider enabled>
        <CalendarSchedulingPanel {...props} routeHash="#teaching-calendar" />
      </StudioV2Provider>,
    );
    const drawer = within(afterOAuth.getByRole('dialog', { name: 'Teaching calendar' }));
    fireEvent.click(await drawer.findByRole('button', { name: 'Choose lesson calendar' }));
    const picker = within(await drawer.findByRole('group', { name: 'Lesson calendar' }));
    const firstCalendar = picker.getByRole('radio', { name: /^Lessons / });
    const secondCalendar = picker.getByRole('radio', { name: /Shared lessons.*London/ });
    const confirm = drawer.getByRole('button', { name: 'Use this calendar' });
    await waitFor(() => expect(document.activeElement).toBe(firstCalendar));
    expect(confirm).toHaveProperty('disabled', true);
    await user.keyboard('{ArrowDown}');
    expect(secondCalendar).toHaveProperty('checked', true);
    expect(api.selectLessonCalendar).not.toHaveBeenCalled();
    await user.click(confirm);
    await waitFor(() =>
      expect(api.selectLessonCalendar).toHaveBeenCalledWith('workspace-1', 'shared', false),
    );
  });
  it('opens the v2 drawer for the teaching calendar deep link', async () => {
    window.history.replaceState(null, '', '#teaching-calendar');
    try {
      render(
        <StudioV2Provider enabled>
          <CalendarSchedulingPanel {...props} />
        </StudioV2Provider>,
      );
      expect(screen.getByRole('dialog', { name: 'Teaching calendar' })).toBeTruthy();
      expect(await screen.findByLabelText('Invitation title')).toBeTruthy();
    } finally {
      window.history.replaceState(null, '', window.location.pathname);
    }
  });
  it('does not open a hidden drawer for attention or a deep link', async () => {
    api.getCalendarSchedulingStatus.mockResolvedValue({
      state: 'reconnect_required',
      operations: [],
    });
    const view = render(
      <StudioV2Provider enabled>
        <CalendarSchedulingPanel
          {...props}
          presentationActive={false}
          routeHash="#teaching-calendar"
        />
      </StudioV2Provider>,
    );
    await screen.findByText('Reconnect required');
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(
      <StudioV2Provider enabled>
        <CalendarSchedulingPanel {...props} presentationActive routeHash="" />
      </StudioV2Provider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not retain an inactive deep link after its hash is removed', async () => {
    const view = render(
      <StudioV2Provider enabled>
        <CalendarSchedulingPanel
          {...props}
          presentationActive={false}
          routeHash="#teaching-calendar"
        />
      </StudioV2Provider>,
    );
    await screen.findByText('Synced');
    view.rerender(
      <StudioV2Provider enabled>
        <CalendarSchedulingPanel {...props} presentationActive routeHash="" />
      </StudioV2Provider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
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
    expect(screen.getByText('Time zone: Bangkok (Asia) · No invitation requested')).toBeTruthy();
    expect(screen.queryByLabelText('Invitation title')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create in Google' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry submitted setup' }));
    await waitFor(() => expect(api.createCalendarSetup).toHaveBeenCalledTimes(2));
    expect(api.createCalendarSetup.mock.calls[1]).toEqual(submitted);
  });
  it('requires review of a changed draft clock without changing fields or frozen retry payloads', async () => {
    api.createCalendarSetup.mockRejectedValueOnce(new Error('Response lost'));
    const view = render(<CalendarSchedulingPanel {...props} />);
    await screen.findByText('Synced');
    fireEvent.change(screen.getByLabelText('Invitation title'), {
      target: { value: 'Review draft wall times' },
    });
    fireEvent.change(screen.getByLabelText('Local time'), { target: { value: '14:30' } });
    const enteredDate = (screen.getByLabelText('Start date') as HTMLInputElement).value;
    view.rerender(<CalendarSchedulingPanel {...props} timezone="Europe/London" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create in Google' }));
    await screen.findByText(
      'Tutor timezone changed. Review the lesson times and create the setup again.',
    );
    expect(api.createCalendarSetup).not.toHaveBeenCalled();
    expect(localStorage.getItem('calendar-setup:workspace-1:student-1')).toBeNull();
    expect((screen.getByLabelText('Invitation title') as HTMLInputElement).value).toBe(
      'Review draft wall times',
    );
    expect((screen.getByLabelText('Local time') as HTMLInputElement).value).toBe('14:30');
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe(enteredDate);
    fireEvent.click(screen.getByRole('button', { name: 'Create in Google' }));
    await screen.findByText('Response lost');
    const captured = api.createCalendarSetup.mock.calls[0]!;
    expect(captured[2]).toMatchObject({
      timezone: 'Europe/London',
      title: 'Review draft wall times',
      slots: [expect.objectContaining({ localTime: '14:30', startDate: enteredDate })],
    });
    view.rerender(<CalendarSchedulingPanel {...props} timezone="America/New_York" />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry submitted setup' }));
    await waitFor(() => expect(api.createCalendarSetup).toHaveBeenCalledTimes(2));
    expect(api.createCalendarSetup.mock.calls[1]).toEqual(captured);
  });
  it('does not require draft review for an equivalent timezone alias', async () => {
    const view = render(<CalendarSchedulingPanel {...props} timezone="Asia/Saigon" />);
    await screen.findByText('Synced');
    view.rerender(<CalendarSchedulingPanel {...props} timezone="Asia/Ho_Chi_Minh" />);
    fireEvent.click(screen.getByRole('button', { name: 'Create in Google' }));
    await waitFor(() => expect(api.createCalendarSetup).toHaveBeenCalledOnce());
    expect(api.createCalendarSetup.mock.calls[0]?.[2]).toMatchObject({
      timezone: 'Asia/Ho_Chi_Minh',
    });
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
    expect(screen.getByText('London (Europe)')).toBeTruthy();
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
    expect(screen.getByText(/The teaching calendar has lesson issues/)).toBeTruthy();
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
  it('keeps the schedule visible until the tutor chooses to review a workspace calendar issue', async () => {
    const eventUrl = 'https://calendar.google.com/calendar/event?eid=declined';
    api.getCalendarSchedulingStatus.mockResolvedValue({
      state: 'needs_attention',
      errorCode: 'lesson_attention_required',
      operations: [],
      issues: {
        items: [
          {
            id: 'lesson-2',
            studentName: 'Jordan',
            kind: 'lesson',
            startsAt: '2026-11-02T08:00:00Z',
            errorCode: 'invitation_declined',
            eventUrl,
          },
        ],
        hasMore: false,
      },
    });
    render(
      <StudioV2Provider enabled>
        <CalendarSchedulingPanel {...props} />
      </StudioV2Provider>,
    );
    const review = await screen.findByRole('button', { name: 'Review calendar issues' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Schedule lesson for Alex' })).toBeTruthy();
    fireEvent.click(review);
    const drawer = within(screen.getByRole('dialog', { name: 'Calendar settings' }));
    const issues = within(drawer.getByRole('region', { name: 'Teaching calendar issues' }));
    expect(issues.getByText('Jordan')).toBeTruthy();
    expect(issues.getByText(/Nov 2, 2026, 3:00 PM/)).toBeTruthy();
    expect(issues.getByText('The lesson invitation was declined in Google Calendar.')).toBeTruthy();
    expect(issues.getByRole('link', { name: 'Open in Google' }).getAttribute('href')).toBe(
      eventUrl,
    );
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
