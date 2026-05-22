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

  it('renders aggregate agenda, reminders, alerts, and recent payments', async () => {
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Week Agenda')).toBeTruthy();
    expect(screen.getAllByText('Alex').length).toBeGreaterThan(0);
    expect(screen.getByText('Balance is negative')).toBeTruthy();
    expect(screen.getByText('USD 120.00')).toBeTruthy();
    expect(screen.getByText(/-1 credits/i)).toBeTruthy();
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

  it('marks scheduled lessons completed and chargeable from the agenda', async () => {
    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'Complete' });
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));

    await waitFor(() => {
      expect(apiMocks.updateStudentLesson).toHaveBeenCalledWith('student-alex', 'lesson-1', {
        status: 'completed',
        consumesCredit: true,
      });
    });
  });

  it('completes lesson follow-up reminders and opens assignment with lesson context', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: 'Add homework from reminder' }));

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

    fireEvent.click(await screen.findByRole('button', { name: 'Add homework from reminder' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/?studentId=student-alex&lessonId=lesson-1');
    });
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
  });

  it('restores completed lessons from the agenda', async () => {
    apiMocks.getBusinessScheduleSurface.mockResolvedValue(
      makeSurface({
        lessons: [
          {
            ...(makeSurface().lessons[0] as Record<string, unknown>),
            status: 'completed',
            consumesCredit: true,
            creditEventId: 'credit-event-1',
          },
        ],
      }),
    );

    render(
      <MemoryRouter>
        <BusinessSchedulePage />
      </MemoryRouter>,
    );

    await screen.findByRole('button', { name: 'Restore' });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => {
      expect(apiMocks.updateStudentLesson).toHaveBeenCalledWith('student-alex', 'lesson-1', {
        status: 'scheduled',
        consumesCredit: false,
      });
    });
  });
});
