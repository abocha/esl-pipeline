import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  StudentScheduleBillingLayout,
  StudentScheduleBillingPage,
} from './StudentScheduleBillingPage';

const apiMocks = vi.hoisted(() => ({
  StudentLessonConflictApiError: class extends Error {},
  addStudentPackage: vi.fn(),
  adjustStudentCredits: vi.fn(),
  getStudentScheduleBillingSurface: vi.fn(),
  getStudentLessonPage: vi.fn(),
  getStudentLesson: vi.fn(),
  getBusinessSettings: vi.fn(),
  hideStudentLessonFollowupReminder: vi.fn(),
  recordStudentPayment: vi.fn(),
  undoLatestHiddenStudentReminder: vi.fn(),
  updateStudentLesson: vi.fn(),
  updateStudentLessonPlan: vi.fn(),
}));

const useStudentAreaContextMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const calendarProps = vi.hoisted(() => ({
  onLedgerRefresh: async () => {},
  presentationActive: true,
  routeHash: '',
}));

vi.mock('../../utils/api', () => apiMocks);
vi.mock('../calendar/CalendarSchedulingPanel', () => ({
  CalendarSchedulingPanel: ({
    onLedgerRefresh,
    presentationActive,
    routeHash,
  }: {
    onLedgerRefresh: () => Promise<void>;
    presentationActive?: boolean;
    routeHash?: string;
  }) => {
    calendarProps.onLedgerRefresh = onLedgerRefresh;
    calendarProps.presentationActive = presentationActive ?? true;
    calendarProps.routeHash = routeHash ?? '';
    return (
      <div>
        Calendar scheduling
        <input aria-label="Calendar recovery draft" defaultValue="" />
      </div>
    );
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
    plannedCharge: true,
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

function renderSplitPage(initialTab = 'schedule') {
  return render(
    <MemoryRouter initialEntries={[`/students/student-alex/${initialTab}`]}>
      <nav>
        <Link to="/students/student-alex/schedule">Schedule tab</Link>
        <Link to="/students/student-alex/billing">Billing tab</Link>
        <Link to="/students/student-alex/schedule#teaching-calendar">Teaching calendar tab</Link>
      </nav>
      <Routes>
        <Route element={<StudentScheduleBillingLayout />}>
          <Route path="/students/:id/schedule" element={null} />
          <Route path="/students/:id/billing" element={null} />
        </Route>
      </Routes>
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

  it('hides and restores an individual legacy scheduled lesson alongside a matching Google lesson', async () => {
    const lesson = makeSurface().lessons[0];
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        lessons: [
          { ...lesson, title: 'Old scheduled lesson', schedulingSource: 'unmanaged' },
          { ...lesson, id: 'google-lesson', title: 'Google lesson', schedulingSource: 'calendar' },
        ],
      }),
    );
    const view = renderSplitPage();
    fireEvent.click((await screen.findByText('Old scheduled lesson')).closest('summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Hide from schedule list' }));
    expect(screen.queryByText('Old scheduled lesson')).toBeNull();
    expect(screen.getByText('Google lesson')).toBeTruthy();
    view.unmount();

    renderSplitPage();
    await screen.findByText('Google lesson');
    expect(screen.queryByText('Old scheduled lesson')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show hidden legacy lessons' }));
    fireEvent.click(screen.getByText('Old scheduled lesson').closest('summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Restore to schedule list' }));
    expect(screen.getByText('Old scheduled lesson')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show hidden legacy lessons' })).toBeNull();
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
  });

  it('retains paged windows, drafts and one Calendar owner across sibling tabs without refetching', async () => {
    const lesson = makeSurface().lessons[0];
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        lessonWindows: {
          timezone: 'Asia/Bangkok',
          date: '2026-05-08',
          today: [],
          recent: { items: [lesson], nextCursor: 'older' },
          upcoming: { items: [], nextCursor: 'later' },
        },
      }),
    );
    apiMocks.getStudentLessonPage.mockResolvedValueOnce({
      items: [{ ...lesson, id: 'older-lesson', title: 'Loaded older lesson' }],
      nextCursor: 'older-next',
    });
    renderSplitPage();
    await screen.findByRole('heading', { name: 'Schedule', level: 1 });
    expect(calendarProps.presentationActive).toBe(true);
    expect(calendarProps.routeHash).toBe('');
    const recoveryDraft = screen.getByLabelText('Calendar recovery draft');
    fireEvent.change(recoveryDraft, { target: { value: 'Keep pending setup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load older lessons' }));
    await screen.findByText('Loaded older lesson');
    fireEvent.click(screen.getByRole('link', { name: 'Billing tab' }));
    expect(screen.getByRole('heading', { name: 'Billing', level: 1 })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refresh lessons' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Calendar recovery draft' })).toBeNull();
    expect(calendarProps.presentationActive).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Add billing entry' }));
    const lessonsInput = screen.getByRole('spinbutton', { name: 'Lessons' });
    fireEvent.change(lessonsInput, { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('link', { name: 'Schedule tab' }));
    expect(screen.getByText('Loaded older lesson')).toBeTruthy();
    expect(calendarProps.presentationActive).toBe(true);
    expect(calendarProps.routeHash).toBe('');
    expect(screen.getByLabelText('Calendar recovery draft')).toBe(recoveryDraft);
    expect((recoveryDraft as HTMLInputElement).value).toBe('Keep pending setup');
    fireEvent.click(screen.getByRole('link', { name: 'Billing tab' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add billing entry' }));
    const reopenedLessonsInput = screen.getByRole('spinbutton', { name: 'Lessons' });
    expect(reopenedLessonsInput).not.toBe(lessonsInput);
    expect((reopenedLessonsInput as HTMLInputElement).value).toBe('12');
    expect(apiMocks.getStudentScheduleBillingSurface).toHaveBeenCalledTimes(1);
    expect(apiMocks.getStudentLessonPage).toHaveBeenCalledExactlyOnceWith(
      'student-alex',
      'recent',
      'older',
    );
    expect(screen.getAllByText('Calendar scheduling')).toHaveLength(1);
    fireEvent.click(screen.getByRole('link', { name: 'Teaching calendar tab' }));
    expect(calendarProps.presentationActive).toBe(true);
    expect(calendarProps.routeHash).toBe('#teaching-calendar');
  });

  it('applies a pending schedule mutation to Billing after tab navigation and back to Schedule', async () => {
    let finishMutation!: (surface: ReturnType<typeof makeSurface>) => void;
    apiMocks.updateStudentLesson.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishMutation = resolve;
        }),
    );
    renderSplitPage();
    await screen.findByRole('heading', { name: 'Schedule', level: 1 });
    fireEvent.click(screen.getByText('Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    fireEvent.click(screen.getByRole('link', { name: 'Billing tab' }));
    const completedLesson = {
      ...makeSurface().lessons[0],
      status: 'completed',
      consumesCredit: true,
    };
    await act(async () =>
      finishMutation(
        makeSurface({
          lessons: [completedLesson],
          creditSummary: { ...makeSurface().creditSummary, consumed: 4, remaining: 4 },
        }),
      ),
    );
    const credits = screen.getByRole('region', { name: 'Lesson credits' });
    expect(within(credits).getByText('4')).toBeTruthy();
    expect(
      within(screen.getByRole('table', { name: 'Billing activity' })).getByText('USD 120.00'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Schedule tab' }));
    expect(screen.getByText('completed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    expect(apiMocks.getStudentScheduleBillingSurface).toHaveBeenCalledTimes(1);
    expect(apiMocks.updateStudentLesson).toHaveBeenCalledExactlyOnceWith(
      'student-alex',
      'lesson-1',
      { status: 'completed', expectedStatus: 'scheduled', expectedPlannedCharge: true },
    );
  });

  it('records a real payment date, currency, method and note without adding lesson credits', async () => {
    const payment = {
      ...makeSurface().payments[0],
      id: 'payment-eur',
      amountMinor: 9750,
      currency: 'EUR',
      receivedAt: '2026-05-03',
      method: 'Cash',
      note: 'May payment',
    };
    apiMocks.recordStudentPayment.mockResolvedValueOnce(makeSurface({ payments: [payment] }));
    renderSplitPage('billing/');
    await screen.findByRole('heading', { name: 'Billing', level: 1 });
    const paymentTrigger = screen.getByRole('button', { name: 'Add billing entry' });
    paymentTrigger.focus();
    fireEvent.click(paymentTrigger);
    const dialog = screen.getByRole('dialog', { name: 'Add billing entry' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Payment only' }));
    const form = within(dialog).getByRole('button', { name: 'Save entry' }).closest('form')!;
    fireEvent.change(within(form).getByLabelText('Amount received'), {
      target: { value: '97.50' },
    });
    fireEvent.change(within(form).getByLabelText('Currency'), { target: { value: 'eur' } });
    fireEvent.change(within(form).getByLabelText('Payment date'), {
      target: { value: '2026-05-03' },
    });
    fireEvent.change(within(form).getByLabelText('Method (optional)'), {
      target: { value: 'Cash' },
    });
    fireEvent.change(within(form).getByLabelText('Note (optional)'), {
      target: { value: 'May payment' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Save entry' }));
    const table = screen.getByRole('table', { name: 'Billing activity' });
    await within(table).findByText('EUR 97.50');
    expect(screen.queryByRole('dialog', { name: 'Add billing entry' })).toBeNull();
    expect(document.activeElement).toBe(paymentTrigger);
    expect(within(table).getByText(/Cash/)).toBeTruthy();
    expect(within(table).getByText('May payment')).toBeTruthy();
    expect(table.querySelector('time')?.dateTime).toBe('2026-05-03');
    expect(
      within(screen.getByRole('region', { name: 'Lesson credits' })).getByText('5'),
    ).toBeTruthy();
    expect(apiMocks.addStudentPackage).not.toHaveBeenCalled();
    expect(apiMocks.recordStudentPayment).toHaveBeenCalledExactlyOnceWith('student-alex', {
      amountMinor: 9750,
      currency: 'EUR',
      receivedAt: '2026-05-03',
      method: 'Cash',
      note: 'May payment',
    });
  });

  it('groups a package by its recorded payment link and keeps standalone activity filterable', async () => {
    const payment = makeSurface().payments[0]!;
    const credit = {
      id: 'credit-1',
      studentId: payment.studentId,
      workspaceId: payment.workspaceId,
      eventType: 'credit_added',
      quantityDelta: 8,
      sourcePaymentId: payment.id,
      sourceLessonId: null,
      note: 'Eight lessons',
      voidedAt: null,
      createdAt: '2026-05-07T04:00:00.000Z',
    };
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValueOnce(
      makeSurface({
        payments: [payment, { ...payment, id: 'unlinked-payment', amountMinor: 4500 }],
        creditEvents: [
          credit,
          {
            ...credit,
            id: 'credit-2',
            eventType: 'credit_consumed',
            quantityDelta: -1,
            sourcePaymentId: null,
            sourceLessonId: 'lesson-1',
            note: null,
          },
        ],
      }),
    );
    renderSplitPage('billing');
    const table = await screen.findByRole('table', { name: 'Billing activity' });
    const packageRow = within(table).getByRole('row', { name: /Lesson package/ });
    expect(within(packageRow).getByText('USD 120.00')).toBeTruthy();
    expect(within(packageRow).getByText('+8')).toBeTruthy();
    expect(packageRow.querySelector('time')?.dateTime).toBe('2026-05-06');
    expect(within(table).getByRole('row', { name: /Lesson charged/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Payments$/ }));
    expect(within(table).queryByText('Lesson charged')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Credits$/ }));
    expect(within(table).queryByText('USD 45.00')).toBeNull();
    fireEvent.click(
      within(packageRow).getByRole('button', { name: /View lesson package details/ }),
    );
    const details = within(screen.getByRole('dialog', { name: 'Lesson package' }));
    expect(details.getByText('Eight lessons')).toBeTruthy();
    expect(details.getByText(/May 7, 2026/)).toBeTruthy();
  });

  it('previews a credit correction and records the signed adjustment and reason', async () => {
    const surface = makeSurface();
    apiMocks.adjustStudentCredits.mockResolvedValueOnce(
      makeSurface({
        creditSummary: { ...surface.creditSummary, adjustments: -2, remaining: 3 },
        creditEvents: [
          {
            id: 'adjustment-1',
            studentId: surface.studentId,
            workspaceId: surface.workspaceId,
            eventType: 'credit_adjusted',
            quantityDelta: -2,
            sourcePaymentId: null,
            sourceLessonId: null,
            note: 'Correct a duplicate top-up',
            voidedAt: null,
            createdAt: '2026-05-08T04:00:00.000Z',
          },
        ],
      }),
    );
    renderSplitPage('billing');
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust credits' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Adjust lesson credits' }));
    fireEvent.change(dialog.getByLabelText('Change'), { target: { value: '-1' } });
    fireEvent.change(dialog.getByLabelText('Credits'), { target: { value: '2' } });
    expect(dialog.getByText('After adjustment').textContent).toBe('After adjustment 3');
    fireEvent.change(dialog.getByLabelText('Reason'), {
      target: { value: 'Correct a duplicate top-up' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Save adjustment' }));
    const table = within(screen.getByRole('table', { name: 'Billing activity' }));
    expect(await table.findByText('Correct a duplicate top-up')).toBeTruthy();
    expect(table.getByText('−2')).toBeTruthy();
    expect(apiMocks.adjustStudentCredits).toHaveBeenCalledExactlyOnceWith('student-alex', {
      quantityDelta: -2,
      note: 'Correct a duplicate top-up',
    });
    expect(apiMocks.recordStudentPayment).not.toHaveBeenCalled();
  });

  it('keeps saved lesson defaults visible while editing and updates them after a successful save', async () => {
    apiMocks.updateStudentLessonPlan
      .mockRejectedValueOnce(new Error('Defaults could not be saved.'))
      .mockResolvedValueOnce(
        makeSurface({
          lessonPlan: {
            ...makeSurface().lessonPlan,
            defaultDurationMinutes: 45,
            schedulingNotes: 'Leave five minutes for review.',
          },
        }),
      );
    renderSplitPage('billing');
    const edit = await screen.findByRole('button', { name: 'Edit lesson defaults' });
    expect(within(edit).getByText('60 min')).toBeTruthy();
    edit.focus();
    fireEvent.click(edit);
    let dialog = screen.getByRole('dialog', { name: 'Edit lesson defaults' });
    fireEvent.change(within(dialog).getByLabelText('Default duration (minutes)'), {
      target: { value: '90' },
    });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 200, 200));
    fireEvent(dialog, new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 150 }));
    fireEvent.click(dialog, { clientX: 50, clientY: 150 });
    const keepEditing = within(dialog).getByRole('button', { name: 'Keep editing' });
    expect(document.activeElement).toBe(keepEditing);
    fireEvent.click(keepEditing);
    expect(
      (within(dialog).getByLabelText('Default duration (minutes)') as HTMLInputElement).value,
    ).toBe('90');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard changes' }));
    expect(apiMocks.updateStudentLessonPlan).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(edit);

    fireEvent.click(edit);
    dialog = screen.getByRole('dialog', { name: 'Edit lesson defaults' });
    const duration = within(dialog).getByLabelText(
      'Default duration (minutes)',
    ) as HTMLInputElement;
    expect(duration.value).toBe('60');
    fireEvent.change(duration, { target: { value: '45' } });
    fireEvent.change(within(dialog).getByLabelText('Scheduling notes'), {
      target: { value: 'Leave five minutes for review.' },
    });
    const save = within(dialog).getByRole('button', { name: 'Save defaults' });
    fireEvent.click(save);
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Defaults could not be saved.',
    );
    expect(duration.value).toBe('45');
    expect(within(edit).getByText('60 min')).toBeTruthy();
    fireEvent.click(save);
    await within(edit).findByText('45 min');
    expect(screen.queryByRole('dialog', { name: 'Edit lesson defaults' })).toBeNull();
    expect(apiMocks.updateStudentLessonPlan).toHaveBeenLastCalledWith('student-alex', {
      defaultDurationMinutes: 45,
      schedulingNotes: 'Leave five minutes for review.',
    });
    expect(document.activeElement).toBe(edit);
  });

  it('calculates a payment from lessons and rate and saves the package in one request', async () => {
    const packagePayment = {
      ...makeSurface().payments[0],
      id: 'package-payment',
      amountMinor: 15000,
      receivedAt: '2026-05-04',
      method: 'Bank transfer',
    };
    const nextSurface = makeSurface({
      payments: [packagePayment],
      creditSummary: {
        ...makeSurface().creditSummary,
        purchased: 12,
        remaining: 9,
      },
    });
    apiMocks.addStudentPackage.mockResolvedValueOnce(nextSurface);
    renderSplitPage('billing');
    await screen.findByRole('heading', { name: 'Billing', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Add billing entry' }));
    const dialog = screen.getByRole('dialog', { name: 'Add billing entry' });
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Lessons' }), {
      target: { value: '12' },
    });
    fireEvent.change(within(dialog).getByLabelText('Rate per lesson (optional)'), {
      target: { value: '12.50' },
    });
    expect(within(dialog).getByText('12 × USD 12.50 = USD 150.00')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use amount' }));
    fireEvent.change(within(dialog).getByLabelText('Payment date'), {
      target: { value: '2026-05-04' },
    });
    fireEvent.change(within(dialog).getByLabelText('Method (optional)'), {
      target: { value: 'Bank transfer' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save entry' }));

    expect(await screen.findByText('9')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Add billing entry' })).toBeNull();
    expect(
      screen.getByRole('table', { name: 'Billing activity' }).querySelector('time')?.dateTime,
    ).toBe('2026-05-04');
    expect(apiMocks.addStudentPackage).toHaveBeenCalledExactlyOnceWith('student-alex', {
      lessons: 12,
      note: null,
      payment: {
        amountMinor: 15000,
        currency: 'USD',
        receivedAt: '2026-05-04',
        method: 'Bank transfer',
        note: null,
      },
    });
    expect(apiMocks.recordStudentPayment).not.toHaveBeenCalled();
  });

  it('suggests whole credits from a payment without silently rounding or changing the amount', async () => {
    vi.setSystemTime(new Date('2026-05-08T18:00:00.000Z'));
    renderSplitPage('billing');
    fireEvent.click(await screen.findByRole('button', { name: 'Add billing entry' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add billing entry' }));
    const amount = dialog.getByLabelText('Amount received') as HTMLInputElement;
    const lessons = dialog.getByRole('spinbutton', { name: 'Lessons' }) as HTMLInputElement;
    expect((dialog.getByLabelText('Payment date') as HTMLInputElement).value).toBe('2026-05-09');
    fireEvent.change(dialog.getByLabelText('Rate per lesson (optional)'), {
      target: { value: '20,05' },
    });
    fireEvent.change(amount, { target: { value: '160,41' } });
    expect(dialog.getByText(/does not buy a whole number of lessons/)).toBeTruthy();
    expect(dialog.queryByRole('button', { name: 'Use lesson count' })).toBeNull();
    expect(lessons.value).toBe('');

    fireEvent.change(amount, { target: { value: '160,40' } });
    expect(dialog.getByText('USD 160.40 ÷ USD 20.05 = 8 lessons')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: 'Use lesson count' }));
    expect(lessons.value).toBe('8');
    expect(amount.value).toBe('160,40');
    fireEvent.click(dialog.getByRole('button', { name: 'Save entry' }));
    await waitFor(() =>
      expect(apiMocks.addStudentPackage).toHaveBeenCalledExactlyOnceWith('student-alex', {
        lessons: 8,
        note: null,
        payment: {
          amountMinor: 16040,
          currency: 'USD',
          receivedAt: '2026-05-09',
          method: null,
          note: null,
        },
      }),
    );
    expect(apiMocks.recordStudentPayment).not.toHaveBeenCalled();
  });

  it('shows a single follow-up when two billing rules suggest the same message', async () => {
    const recommendation = {
      channel: 'manual',
      actionIntent: 'copy_text',
      severity: 'attention',
      message: '0 lesson credits remaining.',
      copyText: 'Would you like to discuss a top-up?',
    } as const;
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValueOnce(
      makeSurface({
        reminders: [
          { ...recommendation, type: 'low_balance', title: 'Lesson credits are low' },
          { ...recommendation, type: 'payment_followup', title: 'Review lesson credit balance' },
        ],
      }),
    );
    renderSplitPage('billing');
    expect(await screen.findByText('Lesson credits are low')).toBeTruthy();
    expect(screen.getAllByText(recommendation.message)).toHaveLength(1);
    expect(screen.queryByText('Review lesson credit balance')).toBeNull();
  });

  it('keeps a failed lesson edit in place and saves the same draft on retry', async () => {
    apiMocks.updateStudentLesson
      .mockRejectedValueOnce(new Error('Lesson notes could not be saved.'))
      .mockResolvedValueOnce(makeSurface());
    renderSplitPage();
    const toggle = await screen.findByText('Details');
    const details = toggle.closest('details')!;
    fireEvent.click(toggle);
    const edit = within(details).getByRole('button', { name: 'Edit' });
    fireEvent.click(edit);
    const notes = within(details).getByLabelText('Notes') as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: 'Repeat the speaking exercise.' } });
    fireEvent.click(within(details).getByRole('button', { name: 'Save' }));
    expect((await within(details).findByRole('alert')).textContent).toBe(
      'Lesson notes could not be saved.',
    );
    expect(notes.value).toBe('Repeat the speaking exercise.');
    fireEvent.click(within(details).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(within(details).queryByLabelText('Notes')).toBeNull();
      expect(document.activeElement).toBe(edit);
    });
    expect(apiMocks.updateStudentLesson).toHaveBeenLastCalledWith('student-alex', 'lesson-1', {
      notes: 'Repeat the speaking exercise.',
      plannedCharge: true,
      expectedStatus: 'scheduled',
      expectedPlannedCharge: true,
    });
  });

  it('disables credit dialog dismissal while the package write is pending', async () => {
    let finishPackage!: (surface: ReturnType<typeof makeSurface>) => void;
    apiMocks.addStudentPackage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPackage = resolve;
        }),
    );
    renderSplitPage('billing');
    await screen.findByRole('heading', { name: 'Billing', level: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Add billing entry' }));
    const dialog = screen.getByRole('dialog', { name: 'Add billing entry' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Credits only' }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Lessons' }), {
      target: { value: '12' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save entry' }));

    const submit = await within(dialog).findByRole('button', { name: 'Saving…' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(
      (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(dialog).getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    expect(screen.getByRole('dialog', { name: 'Add billing entry' })).toBe(dialog);

    await act(async () => finishPackage(makeSurface()));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Add billing entry' })).toBeNull(),
    );
    expect(apiMocks.addStudentPackage).toHaveBeenCalledTimes(1);
  });

  it('keeps credit form values and server errors after failure and closes without writing on cancel', async () => {
    renderSplitPage('billing');
    const creditTrigger = await screen.findByRole('button', { name: 'Add billing entry' });
    creditTrigger.focus();
    fireEvent.click(creditTrigger);
    const dialog = screen.getByRole('dialog', { name: 'Add billing entry' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Credits only' }));
    const lessons = within(dialog).getByRole('spinbutton', { name: 'Lessons' });
    const note = within(dialog).getByRole('textbox', { name: 'Note (optional)' });
    fireEvent.change(lessons, { target: { value: '12' } });
    fireEvent.change(note, { target: { value: 'May top-up' } });
    apiMocks.addStudentPackage.mockRejectedValueOnce(new Error('Package could not be saved.'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save entry' }));

    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Package could not be saved.',
    );
    expect((lessons as HTMLInputElement).value).toBe('12');
    expect((note as HTMLTextAreaElement).value).toBe('May top-up');
    expect((screen.getByRole('button', { name: 'Save entry' }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Add billing entry' })).toBeNull();
    expect(document.activeElement).toBe(creditTrigger);
    expect(apiMocks.addStudentPackage).toHaveBeenCalledExactlyOnceWith('student-alex', {
      lessons: 12,
      note: 'May top-up',
      payment: null,
    });
    expect(apiMocks.recordStudentPayment).not.toHaveBeenCalled();
  });

  it('lets Cancel and Escape dismiss the credit dialog without writing', async () => {
    renderSplitPage('billing');
    const creditTrigger = await screen.findByRole('button', { name: 'Add billing entry' });
    creditTrigger.focus();
    fireEvent.click(creditTrigger);
    const cancelDialog = screen.getByRole('dialog', { name: 'Add billing entry' });
    fireEvent.click(within(cancelDialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Add billing entry' })).toBeNull();
    expect(document.activeElement).toBe(creditTrigger);

    fireEvent.click(creditTrigger);
    const escapeDialog = screen.getByRole('dialog', { name: 'Add billing entry' });

    fireEvent(escapeDialog, new Event('cancel', { bubbles: false, cancelable: true }));

    expect(screen.queryByRole('dialog', { name: 'Add billing entry' })).toBeNull();
    expect(document.activeElement).toBe(creditTrigger);
    expect(apiMocks.addStudentPackage).not.toHaveBeenCalled();
    expect(apiMocks.recordStudentPayment).not.toHaveBeenCalled();
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
        expectedStatus: 'scheduled',
        expectedPlannedCharge: true,
      });
    });
  });

  it('requires an explicit first-use charge choice and preserves a free lesson through completion', async () => {
    const lesson = { ...makeSurface().lessons[0], plannedCharge: null };
    const free = { ...lesson, plannedCharge: false };
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(makeSurface({ lessons: [lesson] }));
    apiMocks.getStudentLesson.mockResolvedValue(free);
    apiMocks.updateStudentLesson
      .mockResolvedValueOnce(makeSurface({ lessons: [free] }))
      .mockResolvedValueOnce(makeSurface({ lessons: [{ ...free, status: 'completed' }] }));
    renderSplitPage();
    await screen.findByRole('heading', { name: 'Schedule' });
    fireEvent.click(screen.getByText('Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Complete' }));
    const review = await screen.findByRole('region', { name: 'Review lesson charge' });
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole('radio', { name: 'No charge' }));
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm charge' }));
    await waitFor(() => expect(apiMocks.updateStudentLesson).toHaveBeenCalledTimes(2));
    expect(apiMocks.updateStudentLesson).toHaveBeenNthCalledWith(1, 'student-alex', 'lesson-1', {
      plannedCharge: false,
      expectedStatus: 'scheduled',
      expectedPlannedCharge: null,
    });
    expect(apiMocks.updateStudentLesson).toHaveBeenNthCalledWith(2, 'student-alex', 'lesson-1', {
      status: 'completed',
      expectedStatus: 'scheduled',
      expectedPlannedCharge: false,
    });
    fireEvent.click(screen.getByRole('link', { name: 'Billing tab' }));
    expect(
      within(screen.getByRole('region', { name: 'Lesson credits' })).getByText('5'),
    ).toBeTruthy();
  });

  it('preserves the unknown charge when saving notes on a legacy lesson', async () => {
    const lesson = { ...makeSurface().lessons[0], plannedCharge: null };
    const surface = makeSurface({ lessons: [lesson] });
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(surface);
    apiMocks.updateStudentLesson.mockResolvedValue(surface);
    renderSplitPage();

    fireEvent.click(await screen.findByText('Details'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText('Lesson charge') as HTMLSelectElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Lesson notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(apiMocks.updateStudentLesson).toHaveBeenCalledWith('student-alex', 'lesson-1', {
        notes: 'Lesson notes',
        expectedStatus: 'scheduled',
        expectedPlannedCharge: null,
      });
    });
  });

  it('keeps future lessons preparable while manual completion is disabled', async () => {
    const future = { ...makeSurface().lessons[0], startsAt: '9999-01-01T10:00:00.000Z' };
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(makeSurface({ lessons: [future] }));
    renderSplitPage();
    await screen.findByRole('heading', { name: 'Schedule' });
    fireEvent.click(screen.getByText('Details'));
    const complete = screen.getByRole('button', { name: 'Complete' }) as HTMLButtonElement;
    expect(complete.disabled).toBe(true);
    expect(complete.title).toBe('Available once the lesson starts');
    fireEvent.click(screen.getByRole('button', { name: 'Prepare homework' }));
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('/?studentId=student-alex&lessonId=lesson-1'),
    );
    expect(apiMocks.updateStudentLesson).not.toHaveBeenCalled();
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
