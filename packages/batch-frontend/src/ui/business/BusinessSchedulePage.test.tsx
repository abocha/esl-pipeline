import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessSchedulePage } from './BusinessSchedulePage';

const apiMocks = vi.hoisted(() => ({
  getBusinessScheduleSurface: vi.fn(),
  updateStudentLesson: vi.fn(),
}));

vi.mock('../../utils/api', () => apiMocks);

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
