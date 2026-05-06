import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentScheduleBillingPage } from './StudentScheduleBillingPage';

const apiMocks = vi.hoisted(() => ({
  addStudentPackage: vi.fn(),
  createStudentLesson: vi.fn(),
  getStudentScheduleBillingSurface: vi.fn(),
  updateStudentLesson: vi.fn(),
  updateStudentLessonPlan: vi.fn(),
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
    expect(screen.getByText('USD 120.00')).toBeTruthy();
    expect(screen.getByText('Package And Payment')).toBeTruthy();
    expect(
      screen.getByText('Credits are consumed only when a completed lesson is marked chargeable.'),
    ).toBeTruthy();
  });

  it('adds packages through the schedule and billing API', async () => {
    renderPage();

    await screen.findByText('Package And Payment');
    fireEvent.change(screen.getByLabelText('Lessons'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '150' } });
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
});
