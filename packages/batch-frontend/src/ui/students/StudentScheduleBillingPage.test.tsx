import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentScheduleBillingPage } from './StudentScheduleBillingPage';

const apiMocks = vi.hoisted(() => ({
  addStudentPackage: vi.fn(),
  getStudentScheduleBillingSurface: vi.fn(),
  getStudentLessonPage: vi.fn(),
  getBusinessSettings: vi.fn(),
  hideStudentLessonFollowupReminder: vi.fn(),
  recordStudentPayment: vi.fn(),
  undoLatestHiddenStudentReminder: vi.fn(),
  updateStudentLesson: vi.fn(),
  updateStudentLessonPlan: vi.fn(),
}));

const useStudentAreaContextMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const calendarProps = vi.hoisted(() => ({ onLedgerRefresh: async () => {} }));

vi.mock('../../utils/api', () => apiMocks);
vi.mock('../calendar/CalendarSchedulingPanel', () => ({
  CalendarSchedulingPanel: ({ onLedgerRefresh }: { onLedgerRefresh: () => Promise<void> }) => {
    calendarProps.onLedgerRefresh = onLedgerRefresh;
    return <div>Calendar scheduling</div>;
  },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('./StudentAreaContext', () => ({
  useStudentAreaContext: useStudentAreaContextMock,
}));

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
  const lesson = {
    id: 'lesson-1',
    studentId: 'student-alex',
    workspaceId: 'workspace-1',
    startsAt: '2026-05-07T10:00:00.000Z',
    timezone: 'Asia/Bangkok',
    durationMinutes: 60,
    status: 'scheduled',
    consumesCredit: false,
    title: null,
    notes: null,
    creditEventId: null,
    recurrenceRuleId: 'rule-1',
    recurrenceSlotId: 'slot-1',
    recurrenceOccurrenceKey: 'slot-1:2026-05-07',
    recurrenceOrigin: 'generated',
    recurrenceOverrideKind: null,
    homework: makeHomework(),
    createdAt: '2026-05-06T10:00:00.000Z',
    updatedAt: '2026-05-06T10:00:00.000Z',
  };
  return {
    studentId: 'student-alex',
    workspaceId: 'workspace-1',
    lessonPlan: {
      studentId: 'student-alex',
      workspaceId: 'workspace-1',
      timezone: 'Asia/Bangkok',
      defaultDurationMinutes: 60,
      cadence: 'Weekly',
      preferredTimes: 'Thu mornings',
      schedulingNotes: null,
      updatedAt: '2026-05-06T10:00:00.000Z',
    },
    recurrenceRule: null,
    nextLesson: lesson,
    lessons: [lesson],
    lessonWindows: {
      timezone: 'Asia/Bangkok',
      date: '2026-05-08',
      today: [],
      recent: { items: overrides.lessons ?? [lesson], nextCursor: null },
      upcoming: { items: [], nextCursor: null },
    },
    creditSummary: {
      purchased: 8,
      consumed: 3,
      adjustments: 0,
      remaining: 5,
      lowBalanceThreshold: 2,
      isLow: false,
      isNegative: false,
    },
    creditEvents: [],
    payments: [
      {
        id: 'payment-1',
        studentId: 'student-alex',
        workspaceId: 'workspace-1',
        amountMinor: 12000,
        currency: 'USD',
        method: 'Bank transfer',
        receivedAt: '2026-05-06',
        externalUrl: null,
        note: null,
        voidedAt: null,
        createdAt: '2026-05-06T10:00:00.000Z',
      },
    ],
    reminders: [],
    latestHiddenReminder: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/students/student-alex/schedule-billing']}>
      <StudentScheduleBillingPage />
    </MemoryRouter>,
  );
}

describe('StudentScheduleBillingPage', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getBusinessSettings.mockResolvedValue({ timezone: 'Asia/Bangkok' });
    useStudentAreaContextMock.mockReturnValue({
      student: {
        id: 'student-alex',
        student: 'Alex',
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(),
    });
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(makeSurface());
    apiMocks.addStudentPackage.mockResolvedValue(makeSurface());
    apiMocks.recordStudentPayment.mockResolvedValue(makeSurface());
    apiMocks.updateStudentLesson.mockResolvedValue(
      makeSurface({
        creditSummary: {
          purchased: 8,
          consumed: 4,
          adjustments: 0,
          remaining: 4,
          lowBalanceThreshold: 2,
          isLow: false,
          isNegative: false,
        },
      }),
    );
    apiMocks.updateStudentLessonPlan.mockResolvedValue(makeSurface());
  });

  it('renders real schedule and billing state from the backend surface', async () => {
    renderPage();

    expect(await screen.findByText('Lesson credits')).toBeTruthy();
    expect(screen.getByText('5 lesson credits')).toBeTruthy();
    expect(screen.getAllByText('USD 120.00')).toHaveLength(2);
    expect(screen.getByText('Package And Payment')).toBeTruthy();
    expect(screen.getByText('Payment History')).toBeTruthy();
    expect(screen.getByText('Manual follow-ups; some include actions.')).toBeTruthy();
    expect(screen.queryByText('Copyable text only for now.')).toBeNull();
    expect(screen.getByText(/Bank transfer/)).toBeTruthy();
    expect(
      screen.getByText('Credits are consumed only when a completed lesson is marked chargeable.'),
    ).toBeTruthy();
  });

  it('adds packages through the schedule and billing API', async () => {
    renderPage();

    await screen.findByText('Package And Payment');
    fireEvent.click(screen.getByText('Manage schedule, defaults and packages'));
    fireEvent.change(screen.getByLabelText('Lessons'), { target: { value: '10' } });
    fireEvent.change(screen.getAllByLabelText('Amount')[0] as HTMLElement, {
      target: { value: '150' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add package' }));

    await waitFor(() => {
      expect(apiMocks.addStudentPackage).toHaveBeenCalledWith('student-alex', {
        lessons: 10,
        note: null,
        payment: {
          amountMinor: 15000,
          currency: 'USD',
          method: null,
          note: null,
        },
      });
    });
  });

  it('shows upcoming-only and empty windows without inventing a recurring timetable', async () => {
    const lesson = makeSurface().lessons[0];
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        lessonWindows: {
          timezone: 'Asia/Bangkok',
          date: '2026-05-08',
          today: [],
          recent: { items: [], nextCursor: null },
          upcoming: {
            items: [{ ...lesson, title: 'One-off session', status: 'canceled' }],
            nextCursor: null,
          },
        },
      }),
    );
    renderPage();
    await screen.findByText('No lessons today.');
    expect(screen.getByText('No earlier lessons.')).toBeTruthy();
    expect(screen.getByText('One-off session')).toBeTruthy();
    expect(screen.getByText('canceled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load older lessons' })).toBeNull();
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        nextLesson: null,
        lessonWindows: {
          timezone: 'Asia/Bangkok',
          date: '2026-05-08',
          today: [],
          recent: { items: [], nextCursor: null },
          upcoming: { items: [], nextCursor: null },
        },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lessons' }));
    await screen.findByText('No upcoming occurrences.');
    expect(screen.getByText('Not scheduled')).toBeTruthy();
  });

  it('marks scheduled lessons complete and chargeable', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'Complete' });
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));

    await waitFor(() => {
      expect(apiMocks.updateStudentLesson).toHaveBeenCalledWith('student-alex', 'lesson-1', {
        status: 'completed',
        consumesCredit: true,
      });
    });
  });

  it('keeps windows independent, retains rows after failure, retries and deduplicates appended IDs', async () => {
    const lesson = makeSurface().lessons[0];
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        lessonWindows: {
          timezone: 'Asia/Bangkok',
          date: '2026-05-08',
          today: [{ ...lesson, id: 'today', title: 'Today lesson' }],
          recent: { items: [{ ...lesson, title: 'Recent lesson' }], nextCursor: 'older-1' },
          upcoming: {
            items: [{ ...lesson, id: 'next', title: 'Canceled occurrence', status: 'canceled' }],
            nextCursor: 'later-1',
          },
        },
      }),
    );
    apiMocks.getStudentLessonPage.mockRejectedValueOnce(new Error('Older lessons unavailable'));
    const view = renderPage();
    await screen.findByText('Today lesson');
    const panels = [...view.container.querySelectorAll('.student-schedule-billing-panel')];
    expect(panels[0]?.textContent).toContain('Today');
    expect(panels[1]?.textContent).toContain('Recent lessons');
    expect(panels[2]?.textContent).toContain('Next 3 occurrences');
    expect(view.container.querySelector('details')?.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Load older lessons' }));
    await screen.findByText('Older lessons unavailable');
    expect(screen.getByText('Recent lesson')).toBeTruthy();
    apiMocks.getStudentLessonPage.mockResolvedValueOnce({
      items: [{ ...lesson, id: 'later', title: 'Later occurrence' }],
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load more upcoming occurrences' }));
    await screen.findByText('Later occurrence');
    expect(screen.getByText('Older lessons unavailable')).toBeTruthy();
    apiMocks.getStudentLessonPage.mockResolvedValueOnce({
      items: [
        { ...lesson, title: 'Recent lesson' },
        { ...lesson, id: 'old', title: 'Older lesson' },
      ],
      nextCursor: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry older lessons' }));
    await screen.findByText('Older lesson');
    expect(screen.getAllByText('Recent lesson')).toHaveLength(1);
    expect(apiMocks.getStudentLessonPage).toHaveBeenNthCalledWith(
      1,
      'student-alex',
      'recent',
      'older-1',
    );
    expect(apiMocks.getStudentLessonPage).toHaveBeenNthCalledWith(
      2,
      'student-alex',
      'upcoming',
      'later-1',
    );
    expect(apiMocks.getStudentLessonPage).toHaveBeenNthCalledWith(
      3,
      'student-alex',
      'recent',
      'older-1',
    );
  });

  it.each(['refresh', 'mutation', 'student switch'])(
    'ignores an older page after %s',
    async (transition) => {
      const lesson = makeSurface().lessons[0];
      apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
        makeSurface({
          lessonWindows: {
            timezone: 'Asia/Bangkok',
            date: '2026-05-08',
            today: [],
            recent: { items: [lesson], nextCursor: 'older' },
            upcoming: { items: [], nextCursor: null },
          },
        }),
      );
      let resolvePage!: (page: unknown) => void;
      apiMocks.getStudentLessonPage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePage = resolve;
          }),
      );
      const view = renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Load older lessons' }));
      if (transition === 'refresh') {
        apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(makeSurface());
        fireEvent.click(screen.getByRole('button', { name: 'Refresh lessons' }));
        await waitFor(() =>
          expect(apiMocks.getStudentScheduleBillingSurface).toHaveBeenCalledTimes(2),
        );
      } else if (transition === 'mutation') {
        fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
        await screen.findByText('4 lesson credits');
      } else {
        useStudentAreaContextMock.mockReturnValue({
          student: { student: 'Bella' },
          studentId: 'student-bella',
        });
        apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
          makeSurface({
            studentId: 'student-bella',
            lessonWindows: {
              timezone: 'UTC',
              date: '2026-05-08',
              today: [],
              recent: { items: [], nextCursor: null },
              upcoming: { items: [], nextCursor: null },
            },
          }),
        );
        view.rerender(
          <MemoryRouter>
            <StudentScheduleBillingPage />
          </MemoryRouter>,
        );
        await screen.findByText('No earlier lessons.');
      }
      resolvePage({
        items: [{ ...lesson, id: 'stale', title: 'Stale older row' }],
        nextCursor: null,
      });
      await waitFor(() => expect(screen.queryByText('Stale older row')).toBeNull());
      expect(screen.queryByRole('button', { name: 'Loading lessons…' })).toBeNull();
    },
  );

  it('waits for an outstanding mutation before acknowledging Calendar refresh and propagates refresh failure', async () => {
    renderPage();
    await screen.findByText('5 lesson credits');
    let resolveMutation!: (surface: ReturnType<typeof makeSurface>) => void;
    apiMocks.updateStudentLesson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    const calendarRefresh = calendarProps.onLedgerRefresh();
    expect(apiMocks.getStudentScheduleBillingSurface).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveMutation(makeSurface());
      await calendarRefresh;
    });
    expect(apiMocks.getStudentScheduleBillingSurface).toHaveBeenCalledTimes(2);
    expect(
      (screen.getByRole('button', { name: 'Refresh lessons' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    apiMocks.getStudentScheduleBillingSurface.mockRejectedValueOnce(new Error('Refresh failed'));
    await act(async () => {
      await expect(calendarProps.onLedgerRefresh()).rejects.toThrow('Unable to refresh lessons');
    });
  });

  it('serializes surface mutations so a later response cannot hide an earlier committed update', async () => {
    const lesson = makeSurface().lessons[0];
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        lessons: [lesson, { ...lesson, id: 'lesson-2', title: 'Second lesson' }],
      }),
    );
    let resolveMutation!: (surface: ReturnType<typeof makeSurface>) => void;
    apiMocks.updateStudentLesson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        }),
    );
    renderPage();
    await screen.findByText('Second lesson');
    const completeButtons = screen.getAllByRole('button', { name: 'Complete' });
    fireEvent.click(completeButtons[0] as HTMLElement);
    expect((completeButtons[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(completeButtons[1] as HTMLElement);
    expect(apiMocks.updateStudentLesson).toHaveBeenCalledTimes(1);
    resolveMutation(makeSurface());
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it('releases refresh controls when a mutation supersedes an outstanding refresh', async () => {
    renderPage();
    await screen.findByText('5 lesson credits');
    let resolveRefresh!: (surface: ReturnType<typeof makeSurface>) => void;
    apiMocks.getStudentScheduleBillingSurface.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lessons' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Refresh lessons' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    await screen.findByText('4 lesson credits');
    expect(
      (screen.getByRole('button', { name: 'Refresh lessons' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    resolveRefresh(makeSurface());
    await waitFor(() => expect(screen.queryByText('5 lesson credits')).toBeNull());
  });

  it('retains loaded rows on refresh failure and retries an unavailable initial read', async () => {
    apiMocks.getStudentScheduleBillingSurface.mockRejectedValueOnce(
      new Error('Schedule unavailable'),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry schedule' }));
    await screen.findByText('5 lesson credits');
    apiMocks.getStudentScheduleBillingSurface.mockRejectedValueOnce(
      new Error('Refresh unavailable'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh lessons' }));
    await screen.findByText('Refresh unavailable');
    expect(screen.getByText('5 lesson credits')).toBeTruthy();
  });

  it('opens an elapsed lesson follow-up without completing it', async () => {
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        nextLesson: null,
        reminders: [
          {
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
              startsAt: '2026-05-07T10:00:00.000Z',
              title: 'Present perfect review',
            },
            copyText: 'Complete Alex lesson and start homework.',
          },
        ],
      }),
    );
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add homework from reminder' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/?studentId=student-alex&lessonId=lesson-1');
    });
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
  });

  it('shows lesson context, hides follow-up reminders, and offers latest undo', async () => {
    const hiddenSurface = makeSurface({
      reminders: [],
      latestHiddenReminder: {
        type: 'lesson_followup',
        lessonId: 'lesson-1',
        lessonSummary: {
          lessonId: 'lesson-1',
          startsAt: '2026-05-07T10:00:00.000Z',
          title: 'Present perfect review',
        },
      },
    });
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        nextLesson: null,
        reminders: [
          {
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
              startsAt: '2026-05-07T10:00:00.000Z',
              title: 'Present perfect review',
            },
            copyText: 'Complete Alex lesson and start homework.',
          },
        ],
      }),
    );
    apiMocks.hideStudentLessonFollowupReminder.mockResolvedValue(hiddenSurface);
    apiMocks.undoLatestHiddenStudentReminder.mockResolvedValue(makeSurface());
    renderPage();

    expect(await screen.findByText(/Present perfect review/)).toBeTruthy();
    expect(screen.getByText(/Lesson lesson-1/)).toBeTruthy();
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

  it('opens homework without re-billing a completed non-credit lesson follow-up', async () => {
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        nextLesson: null,
        reminders: [
          {
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
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Add homework from reminder' }));

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/?studentId=student-alex&lessonId=lesson-1');
    });
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
  });

  it('shows a completed transcript result instead of a missing-homework action', async () => {
    const original = makeSurface();
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
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
    renderPage();
    const result = await screen.findByRole('link', { name: 'View transcript' });
    expect(result.getAttribute('href')).toBe('/?sessionId=transcript-result');
    expect(screen.getByText('No homework planned')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add homework' })).toBeNull();
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
  });

  it('offers homework row actions for published, completed, and elapsed scheduled lessons only', async () => {
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        lessons: [
          {
            ...makeSurface().lessons[0],
            id: 'published-lesson',
            status: 'completed',
            homework: makeHomework({
              status: 'published',
              htmlUrl: 'https://example.test/published-homework',
            }),
          },
          {
            ...makeSurface().lessons[0],
            id: 'completed-no-homework',
            status: 'completed',
            startsAt: '2026-05-06T10:00:00.000Z',
            homework: makeHomework({ status: 'not_started' }),
          },
          {
            ...makeSurface().lessons[0],
            id: 'elapsed-scheduled',
            status: 'scheduled',
            startsAt: '2000-01-01T10:00:00.000Z',
            durationMinutes: 60,
            homework: makeHomework({ status: 'not_started' }),
          },
          {
            ...makeSurface().lessons[0],
            id: 'future-scheduled',
            status: 'scheduled',
            startsAt: '2999-01-01T10:00:00.000Z',
            durationMinutes: 60,
            title: 'future-scheduled',
            homework: makeHomework({ status: 'not_started' }),
          },
          {
            ...makeSurface().lessons[0],
            id: 'memory-ready',
            status: 'completed',
            homework: makeHomework({
              status: 'memory_ready',
              htmlUrl: 'https://example.test/memory-ready-homework',
            }),
          },
        ],
      }),
    );
    renderPage();

    expect(await screen.findAllByRole('link', { name: 'Open homework' })).toHaveLength(2);
    const addButtons = await screen.findAllByRole('button', { name: 'Add homework' });
    expect(addButtons).toHaveLength(2);

    fireEvent.click(addButtons[0]!);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith(
        '/?studentId=student-alex&lessonId=completed-no-homework',
      );
    });
    fireEvent.click(addButtons[1]!);
    await waitFor(() => {
      expect(navigateMock).toHaveBeenNthCalledWith(
        2,
        '/?studentId=student-alex&lessonId=elapsed-scheduled',
      );
    });
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
    expect(screen.getByText('future-scheduled')).toBeTruthy();
  });
});
