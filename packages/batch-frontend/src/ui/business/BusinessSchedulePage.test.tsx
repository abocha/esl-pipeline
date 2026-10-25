import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessSchedulePage } from './BusinessSchedulePage';

const apiMocks = vi.hoisted(() => ({
  getBusinessScheduleSurface: vi.fn(),
  hideStudentLessonFollowupReminder: vi.fn(),
  undoLatestHiddenStudentReminder: vi.fn(),
  updateStudentLesson: vi.fn(),
}));
const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/api', () => apiMocks);
vi.mock('../calendar/CalendarSchedulingPanel', () => ({
  CalendarSchedulingPanel: () => <div>Calendar scheduling</div>,
}));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});
function makeHomework(overrides: Record<string, unknown> = {}) {
  return {
    status: 'not_started',
    assignmentSessionId: null,
    promptPackageId: null,
    draftId: null,
    jobId: null,
    homeworkMemoryEntryId: null,
    transcriptResultSessionId: null,
    htmlUrl: null,
    updatedAt: null,
    ...overrides,
  };
}
function makeSurface(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'workspace-1',
    from: '2026-05-07',
    to: '2026-05-14',
    generatedAt: '2026-05-07T00:00:00.000Z',
    settings: {
      workspaceId: 'workspace-1',
      defaultCurrency: 'USD',
      defaultLessonRateMinor: 4000,
      defaultLessonDurationMinutes: 60,
      timezone: 'UTC',
      forecastHorizonDays: 45,
      noShowRateBasisPoints: 0,
      cancellationRateBasisPoints: 0,
      topUpThreshold: 2,
      updatedAt: null,
    },
    today: [],
    lessons: [
      {
        id: 'lesson-1',
        studentId: 'student-alex',
        studentName: 'Alex',
        studentScheduleBillingPath: '/students/student-alex/schedule-billing',
        workspaceId: 'workspace-1',
        startsAt: '2026-05-08T10:00:00.000Z',
        timezone: 'UTC',
        durationMinutes: 60,
        status: 'scheduled',
        consumesCredit: true,
        title: null,
        notes: null,
        creditEventId: null,
        recurrenceRuleId: null,
        recurrenceSlotId: null,
        recurrenceOccurrenceKey: null,
        recurrenceOrigin: 'manual',
        recurrenceOverrideKind: null,
        homework: makeHomework(),
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
      },
    ],
    reminders: [
      {
        studentId: 'student-bea',
        studentName: 'Bea',
        studentScheduleBillingPath: '/students/student-bea/schedule-billing',
        remainingCredits: -1,
        type: 'payment_followup',
        channel: 'manual',
        actionIntent: 'copy_text',
        severity: 'urgent',
        title: 'Balance is negative',
        message: '-1 lesson credit remaining.',
        copyText: 'Please top up.',
      },
    ],
    creditAlerts: [
      {
        studentId: 'student-bea',
        studentName: 'Bea',
        studentScheduleBillingPath: '/students/student-bea/schedule-billing',
        remainingCredits: -1,
        lowBalanceThreshold: 2,
        severity: 'urgent',
        upcomingChargeableLessons: 1,
      },
    ],
    recentPayments: [
      {
        studentId: 'student-alex',
        studentName: 'Alex',
        studentScheduleBillingPath: '/students/student-alex/schedule-billing',
        amountMinor: 12000,
        currency: 'USD',
        receivedAt: '2026-05-07',
        method: null,
      },
    ],
    latestHiddenReminder: null,
    ...overrides,
  };
}
describe('BusinessSchedulePage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMocks.getBusinessScheduleSurface.mockResolvedValue(makeSurface());
    apiMocks.updateStudentLesson.mockResolvedValue({});
  });
  it('opens completed transcript-only lessons without a homework or billing mutation', async () => {
    const original = makeSurface();
    apiMocks.getBusinessScheduleSurface.mockResolvedValue(
      makeSurface({
        lessons: [
          {
            ...original.lessons[0],
            status: 'completed',
            homework: makeHomework({
              status: 'not_planned',
              transcriptResultSessionId: 'transcript-result',
            }),
          },
        ],
        reminders: [],
      }),
    );
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    const result = await screen.findByRole('link', { name: 'View transcript' });
    expect(result.getAttribute('href')).toBe('/?sessionId=transcript-result');
    expect(screen.getByText(/No homework planned/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add homework' })).toBeNull();
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
  });
  it('shows the agenda and keeps credit suggestions and payments in disclosures', async () => {
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('region', { name: 'Lesson agenda' })).toBeTruthy();
    fireEvent.click(screen.getByText(/Credits & bookings/));
    fireEvent.click(screen.getByText(/Recent payments/));
    expect(screen.getAllByText('Alex').length).toBeGreaterThan(0);
    expect(screen.getByText('-1 lesson credits remaining')).toBeTruthy();
    expect(screen.getByText('USD 120.00')).toBeTruthy();
    expect(screen.getByText('Unfinished lesson follow-up')).toBeTruthy();
    expect(screen.queryByText('Credit alerts')).toBeNull();
    expect(screen.queryByText('Week Agenda')).toBeNull();
    expect(screen.queryByText(/ready to send/i)).toBeNull();
    expect(screen.queryByText('Payment And Credit Alerts')).toBeNull();
    expect(apiMocks.getBusinessScheduleSurface).toHaveBeenCalledWith({});
    expect(screen.getByLabelText(/From/i)).toHaveProperty('value', '2026-05-07');
    expect(screen.getByLabelText(/^To$/i)).toHaveProperty('value', '2026-05-14');
  });
  it('shows lesson and reminder datetimes in the workspace timezone across midnight', async () => {
    apiMocks.getBusinessScheduleSurface.mockResolvedValue(
      makeSurface({
        settings: { ...makeSurface().settings, timezone: 'America/Los_Angeles' },
        lessons: [{ ...makeSurface().lessons[0], startsAt: '2026-05-08T06:30:00.000Z' }],
        reminders: [
          {
            studentId: 'student-alex',
            studentName: 'Alex',
            studentScheduleBillingPath: '/students/student-alex/schedule-billing',
            remainingCredits: 0,
            type: 'lesson_followup',
            channel: 'manual',
            actionIntent: 'complete_lesson_and_start_assignment',
            lessonId: 'lesson-1',
            lessonStatus: 'scheduled',
            lessonConsumesCredit: true,
            severity: 'attention',
            title: 'Finish lesson follow-up',
            message: 'The scheduled lesson time has passed and homework is not published yet.',
            lessonSummary: {
              lessonId: 'lesson-1',
              startsAt: '2026-05-08T06:30:00.000Z',
              title: 'Present perfect review',
            },
            copyText: 'Complete Alex lesson and start homework.',
          },
        ],
      }),
    );
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('link', {
        name: 'Timezone: America/Los_Angeles. Change in Business settings.',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Alex, May 7, 11:30 PM' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Thursday, May 7' })).toBeTruthy();
    expect(screen.getByText('11:30 PM')).toBeTruthy();
    expect(screen.getByText('May 7, 11:30 PM · Present perfect review')).toBeTruthy();
  });
  it('identifies retained lessons while another range loads or fails, then clears the notice on recovery', async () => {
    let rejectLoad: (error: Error) => void = () => {};
    apiMocks.getBusinessScheduleSurface
      .mockResolvedValueOnce(makeSurface())
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectLoad = reject;
          }),
      )
      .mockResolvedValueOnce(makeSurface({ to: '2026-05-21', lessons: [] }));
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    await screen.findByRole('article', { name: /Alex,/ });
    fireEvent.change(screen.getByLabelText(/^To$/i), { target: { value: '2026-05-21' } });
    const loadedPeriod = 'Showing lessons for 2026-05-07 – 2026-05-14.';
    expect((await screen.findByRole('status')).textContent).toContain(loadedPeriod);
    expect(screen.getByRole('article', { name: /Alex,/ })).toBeTruthy();
    rejectLoad(new Error('Range request failed'));
    expect((await screen.findByRole('alert')).textContent).toContain(loadedPeriod);
    expect(screen.getByLabelText(/^To$/i)).toHaveProperty('value', '2026-05-21');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('No lessons in this range.')).toBeTruthy();
    expect(screen.queryByText(/Showing lessons for/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('keeps newer range results when an older schedule load resolves later', async () => {
    let resolveInitialLoad: (value: ReturnType<typeof makeSurface>) => void = () => {};
    apiMocks.getBusinessScheduleSurface
      .mockResolvedValueOnce(makeSurface())
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitialLoad = resolve;
          }),
      )
      .mockResolvedValueOnce(
        makeSurface({
          from: '2026-05-20',
          to: '2026-05-27',
          lessons: [
            {
              ...(makeSurface().lessons[0] as Record<string, unknown>),
              id: 'lesson-newer',
              studentName: 'Newer Range Student',
            },
          ],
          reminders: [],
          creditAlerts: [],
          recentPayments: [],
        }),
      );
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    await screen.findAllByText('Alex');
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    fireEvent.change(screen.getByLabelText(/From/i), { target: { value: '2026-05-20' } });
    expect(await screen.findByText('Newer Range Student')).toBeTruthy();
    resolveInitialLoad(
      makeSurface({
        lessons: [
          {
            ...(makeSurface().lessons[0] as Record<string, unknown>),
            id: 'lesson-older',
            studentName: 'Older Range Student',
          },
        ],
        reminders: [],
        creditAlerts: [],
        recentPayments: [],
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('Newer Range Student')).toBeTruthy();
    });
    expect(screen.queryByText('Older Range Student')).toBeNull();
  });
  it('dismisses lesson actions on an outside pointer, Escape, or focus leaving the menu', async () => {
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    const toggle = await screen.findByText('Actions');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const info = screen.getByRole('button', { name: 'About completing a lesson' });
    fireEvent.focus(info);
    fireEvent.click(info);
    const creditHint = screen.getByText('Completing uses 1 lesson credit.');
    fireEvent.pointerDown(creditHint);
    fireEvent.click(creditHint);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Schedule' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    fireEvent.blur(toggle, { relatedTarget: screen.getByRole('button', { name: 'Refresh' }) });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
  });

  it('marks scheduled lessons completed and chargeable from the agenda', async () => {
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    await screen.findByText('Actions');
    fireEvent.click(screen.getByText('Actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(apiMocks.updateStudentLesson).toHaveBeenCalledWith('student-alex', 'lesson-1', {
        status: 'completed',
        consumesCredit: true,
      });
    });
  });
  it('opens assignment with lesson context without a billing mutation', async () => {
    apiMocks.getBusinessScheduleSurface.mockResolvedValue(
      makeSurface({
        reminders: [
          {
            studentId: 'student-alex',
            studentName: 'Alex',
            studentScheduleBillingPath: '/students/student-alex/schedule-billing',
            remainingCredits: 0,
            type: 'lesson_followup',
            channel: 'manual',
            actionIntent: 'complete_lesson_and_start_assignment',
            lessonId: 'lesson-1',
            lessonStatus: 'scheduled',
            lessonConsumesCredit: true,
            severity: 'attention',
            title: 'Finish lesson follow-up',
            message: 'The scheduled lesson time has passed and homework is not published yet.',
            lessonSummary: {
              lessonId: 'lesson-1',
              startsAt: '2026-05-08T10:00:00.000Z',
              title: 'Present perfect review',
            },
            copyText: 'Complete Alex lesson and start homework.',
          },
        ],
      }),
    );
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open lesson for Alex' }));
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/?studentId=student-alex&lessonId=lesson-1');
    });
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
  });
  it('shows lesson context, hides business reminders, and undoes the latest hidden reminder', async () => {
    apiMocks.getBusinessScheduleSurface
      .mockResolvedValueOnce(
        makeSurface({
          reminders: [
            {
              studentId: 'student-alex',
              studentName: 'Alex',
              studentScheduleBillingPath: '/students/student-alex/schedule-billing',
              remainingCredits: 0,
              type: 'lesson_followup',
              channel: 'manual',
              actionIntent: 'complete_lesson_and_start_assignment',
              lessonId: 'lesson-1',
              lessonStatus: 'scheduled',
              lessonConsumesCredit: true,
              severity: 'attention',
              title: 'Finish lesson follow-up',
              message: 'The scheduled lesson time has passed and homework is not published yet.',
              lessonSummary: {
                lessonId: 'lesson-1',
                startsAt: '2026-05-08T10:00:00.000Z',
                title: 'Present perfect review',
              },
              copyText: 'Complete Alex lesson and start homework.',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        makeSurface({
          reminders: [],
          latestHiddenReminder: {
            studentId: 'student-alex',
            studentName: 'Alex',
            type: 'lesson_followup',
            lessonId: 'lesson-1',
            lessonSummary: {
              lessonId: 'lesson-1',
              startsAt: '2026-05-08T10:00:00.000Z',
              title: 'Present perfect review',
            },
          },
        }),
      )
      .mockResolvedValueOnce(makeSurface());
    apiMocks.hideStudentLessonFollowupReminder.mockResolvedValue({});
    apiMocks.undoLatestHiddenStudentReminder.mockResolvedValue({});
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Present perfect review/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => {
      expect(apiMocks.hideStudentLessonFollowupReminder).toHaveBeenCalledWith(
        'student-alex',
        'lesson-1',
      );
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Undo hide' }));
    await waitFor(() => {
      expect(apiMocks.undoLatestHiddenStudentReminder).toHaveBeenCalledWith('student-alex');
    });
  });
  it('opens homework without re-billing completed non-credit business follow-ups', async () => {
    apiMocks.getBusinessScheduleSurface.mockResolvedValue(
      makeSurface({
        reminders: [
          {
            studentId: 'student-alex',
            studentName: 'Alex',
            studentScheduleBillingPath: '/students/student-alex/schedule-billing',
            remainingCredits: 0,
            type: 'lesson_followup',
            channel: 'manual',
            actionIntent: 'complete_lesson_and_start_assignment',
            lessonId: 'lesson-1',
            lessonStatus: 'completed',
            lessonConsumesCredit: false,
            severity: 'attention',
            title: 'Finish lesson follow-up',
            message: 'The scheduled lesson time has passed and homework is not published yet.',
            copyText: 'Start homework for Alex lesson.',
          },
        ],
      }),
    );
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Open lesson for Alex' }));
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/?studentId=student-alex&lessonId=lesson-1');
    });
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
  });
  it('reveals older follow-ups without showing internal lesson IDs or invented titles', async () => {
    apiMocks.getBusinessScheduleSurface.mockResolvedValue(
      makeSurface({
        reminders: Array.from({ length: 6 }, (_, index) => ({
          studentId: `student-${index}`,
          studentName: `Follow-up ${index}`,
          studentScheduleBillingPath: `/students/student-${index}/schedule-billing`,
          remainingCredits: 0,
          type: 'lesson_followup',
          channel: 'manual',
          actionIntent: 'complete_lesson_and_start_assignment',
          severity: 'attention',
          lessonId: `internal-lesson-${index}`,
          title: 'Finish lesson follow-up',
          lessonSummary: {
            lessonId: `internal-lesson-${index}`,
            startsAt: '2026-05-06T10:00:00Z',
            title: null,
          },
          message: '',
          copyText: '',
        })),
      }),
    );
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    await screen.findByText('Follow-up 0');
    expect(screen.queryByText('Follow-up 4')).toBeNull();
    expect(screen.queryByText(/internal-lesson/)).toBeNull();
    expect(screen.queryByText(/Untitled lesson/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 older follow-ups' }));
    expect(screen.getByText('Follow-up 5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.queryByText('Follow-up 4')).toBeNull();
  });

  it('does not report an empty agenda when the first request fails', async () => {
    apiMocks.getBusinessScheduleSurface.mockRejectedValue(new Error('Schedule unavailable'));
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );
    expect((await screen.findByRole('alert')).textContent).toContain('Schedule unavailable');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No lessons in this range.')).toBeNull();
    expect(screen.queryByText('No unfinished lesson follow-up.')).toBeNull();
  });
});
