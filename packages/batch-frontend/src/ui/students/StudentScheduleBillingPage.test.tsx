import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentScheduleBillingPage } from './StudentScheduleBillingPage';

const apiMocks = vi.hoisted(() => ({
  addStudentPackage: vi.fn(),
  createStudentLesson: vi.fn(),
  getStudentScheduleBillingSurface: vi.fn(),
  recordStudentPayment: vi.fn(),
  updateStudentLesson: vi.fn(),
  updateStudentLessonPlan: vi.fn(),
  upsertPrimaryStudentLessonRecurrence: vi.fn(),
}));

const useStudentAreaContextMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/api', () => apiMocks);

vi.mock('./StudentAreaContext', () => ({
  useStudentAreaContext: useStudentAreaContextMock,
}));

function makeSurface(overrides: Record<string, unknown> = {}) {
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
    nextLesson: {
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
      createdAt: '2026-05-06T10:00:00.000Z',
      updatedAt: '2026-05-06T10:00:00.000Z',
    },
    lessons: [
      {
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
        createdAt: '2026-05-06T10:00:00.000Z',
        updatedAt: '2026-05-06T10:00:00.000Z',
      },
    ],
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
  beforeEach(() => {
    vi.clearAllMocks();
    useStudentAreaContextMock.mockReturnValue({
      student: {
        id: 'student-alex',
        student: 'Alex',
        profileId: 'profiles/students/alex.md',
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(),
    });
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(makeSurface());
    apiMocks.addStudentPackage.mockResolvedValue(makeSurface());
    apiMocks.createStudentLesson.mockResolvedValue(makeSurface());
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
    apiMocks.upsertPrimaryStudentLessonRecurrence.mockResolvedValue(makeSurface());
  });

  it('renders real schedule and billing state from the backend surface', async () => {
    renderPage();

    expect(await screen.findByText('Lesson credits')).toBeTruthy();
    expect(screen.getByText('5 lesson credits')).toBeTruthy();
    expect(screen.getAllByText('USD 120.00')).toHaveLength(2);
    expect(screen.getByText('Package And Payment')).toBeTruthy();
    expect(screen.getByText('Payment History')).toBeTruthy();
    expect(screen.getByText(/Bank transfer/)).toBeTruthy();
    expect(
      screen.getByText('Credits are consumed only when a completed lesson is marked chargeable.'),
    ).toBeTruthy();
  });

  it('adds packages through the schedule and billing API', async () => {
    renderPage();

    await screen.findByText('Package And Payment');
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

  it('saves structured weekly recurrence rules', async () => {
    renderPage();

    expect(await screen.findByText('Lesson Planning')).toBeTruthy();
    fireEvent.change(screen.getAllByLabelText('Timezone')[0] as HTMLElement, {
      target: { value: 'Asia/Kolkata' },
    });
    fireEvent.change(screen.getByLabelText('Starts on'), { target: { value: '2026-05-11' } });
    fireEvent.change(screen.getAllByLabelText('Time')[0] as HTMLElement, {
      target: { value: '09:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Wed' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(() => {
      expect(apiMocks.upsertPrimaryStudentLessonRecurrence).toHaveBeenCalledWith(
        'student-alex',
        expect.objectContaining({
          timezone: 'Asia/Kolkata',
          startsOn: '2026-05-11',
          slots: expect.arrayContaining([
            { isoWeekday: 1, localStartTime: '09:30', durationMinutes: 60 },
            { isoWeekday: 3, localStartTime: '09:30', durationMinutes: 60 },
          ]),
        }),
      );
    });
  });

  it('offers the shared timezone picker shape used by business settings', async () => {
    renderPage();

    const picker = (await screen.findAllByLabelText('Timezone'))[0] as HTMLSelectElement;
    const options = Array.from(picker.querySelectorAll('option')).map((option) => ({
      label: option.textContent,
      value: option.value,
    }));

    expect(options.map((option) => option.value)).toEqual([
      'America/Los_Angeles',
      'America/Denver',
      'America/Chicago',
      'America/New_York',
      'UTC',
      'Europe/London',
      'Europe/Berlin',
      'Europe/Moscow',
      'Asia/Dubai',
      'Asia/Tbilisi',
      'Asia/Almaty',
      'Asia/Kolkata',
      'Asia/Bishkek',
      'Asia/Bangkok',
      'Asia/Singapore',
      'Asia/Tokyo',
      'Australia/Sydney',
    ]);
    expect(options).toEqual(
      expect.arrayContaining([
        { value: 'Asia/Kolkata', label: 'India (UTC+5:30)' },
        { value: 'Asia/Bishkek', label: 'Bishkek (UTC+6)' },
        { value: 'Asia/Singapore', label: 'Singapore / Shanghai (UTC+8)' },
      ]),
    );
  });

  it('preserves distinct times and durations for existing recurrence slots', async () => {
    apiMocks.getStudentScheduleBillingSurface.mockResolvedValue(
      makeSurface({
        recurrenceRule: {
          id: 'rule-1',
          studentId: 'student-alex',
          workspaceId: 'workspace-1',
          timezone: 'Asia/Bangkok',
          frequency: 'weekly',
          startsOn: '2026-05-04',
          endsOn: null,
          status: 'active',
          generationHorizonDays: 56,
          materializedThrough: '2026-06-29',
          updatedAt: '2026-05-06T10:00:00.000Z',
          slots: [
            {
              id: 'slot-1',
              ruleId: 'rule-1',
              isoWeekday: 1,
              localStartTime: '11:00',
              durationMinutes: 50,
              sortOrder: 0,
            },
            {
              id: 'slot-2',
              ruleId: 'rule-1',
              isoWeekday: 3,
              localStartTime: '15:30',
              durationMinutes: 60,
              sortOrder: 1,
            },
          ],
        },
      }),
    );
    renderPage();

    expect(await screen.findByDisplayValue('15:30')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));

    await waitFor(() => {
      expect(apiMocks.upsertPrimaryStudentLessonRecurrence).toHaveBeenCalledWith(
        'student-alex',
        expect.objectContaining({
          slots: [
            { isoWeekday: 1, localStartTime: '11:00', durationMinutes: 50 },
            { isoWeekday: 3, localStartTime: '15:30', durationMinutes: 60 },
          ],
        }),
      );
    });
  });

  it('supports no-show, cancel, edit, and standalone payment actions', async () => {
    renderPage();

    await screen.findByRole('button', { name: 'No-show' });
    fireEvent.click(screen.getByRole('button', { name: 'No-show' }));
    await waitFor(() => {
      expect(apiMocks.updateStudentLesson).toHaveBeenCalledWith('student-alex', 'lesson-1', {
        status: 'no_show',
        consumesCredit: false,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(apiMocks.updateStudentLesson).toHaveBeenCalledWith('student-alex', 'lesson-1', {
        status: 'canceled',
        consumesCredit: false,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const durationInputs = screen.getAllByLabelText('Duration');
    fireEvent.change(durationInputs[durationInputs.length - 1] as HTMLElement, {
      target: { value: '75' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(apiMocks.updateStudentLesson).toHaveBeenCalledWith(
        'student-alex',
        'lesson-1',
        expect.objectContaining({ durationMinutes: 75 }),
      );
    });

    const paymentAmountInput = screen.getAllByLabelText('Amount')[1];
    expect(paymentAmountInput).toBeDefined();
    fireEvent.change(paymentAmountInput as HTMLElement, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => {
      expect(apiMocks.recordStudentPayment).toHaveBeenCalledWith(
        'student-alex',
        expect.objectContaining({ amountMinor: 9000, currency: 'USD' }),
      );
    });
  });
});
