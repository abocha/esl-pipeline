import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessStatsPage } from './BusinessStatsPage';

const apiMocks = vi.hoisted(() => ({
  getBusinessStatsSurface: vi.fn(),
}));

vi.mock('../../utils/api', () => apiMocks);

function nextMonthInput(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`Expected YYYY-MM month input, received "${month}".`);
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  const nextMonth = new Date(year, monthNumber, 1);
  return `${nextMonth.getFullYear()}-${`${nextMonth.getMonth() + 1}`.padStart(2, '0')}`;
}

function makeStatsSurface(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'workspace-1',
    month: '2026-05',
    generatedAt: '2026-05-07T00:00:00.000Z',
    settings: {
      workspaceId: 'workspace-1',
      defaultCurrency: 'USD',
      defaultLessonRateMinor: 4000,
      defaultLessonDurationMinutes: 60,
      timezone: 'UTC',
      forecastHorizonDays: 45,
      noShowRateBasisPoints: 1000,
      cancellationRateBasisPoints: 500,
      topUpThreshold: 2,
      updatedAt: null,
    },
    currency: 'USD',
    collectedMinor: 12000,
    earnedMinor: 4000,
    scheduledGrossMinor: 8000,
    forecastMinor: 6800,
    riskAdjustmentMinor: 1200,
    completedLessons: 2,
    taughtMinutes: 120,
    scheduledLessons: 2,
    scheduledMinutes: 120,
    noShowLessons: 1,
    canceledLessons: 0,
    forecastFrom: '2026-05-07',
    forecastTo: '2026-06-21',
    excludedCurrencies: [{ currency: 'EUR', amountMinor: 5000, paymentCount: 1 }],
    pipeline: [
      {
        studentId: 'student-bea',
        studentName: 'Bea',
        studentScheduleBillingPath: '/students/student-bea/schedule-billing',
        remainingCredits: 0,
        upcomingChargeableLessons: 2,
        severity: 'urgent',
      },
    ],
    risks: [],
    ...overrides,
  };
}

describe('BusinessStatsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMocks.getBusinessStatsSurface.mockResolvedValue(makeStatsSurface());
  });

  it('renders factual stats labels, scoped values, credit watch, and excluded-currency warnings', async () => {
    render(
      <MemoryRouter>
        <BusinessStatsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Recorded payments')).toBeTruthy();
    expect(screen.getByText('Completed lesson value')).toBeTruthy();
    expect(screen.getByText('Scheduled lesson value')).toBeTruthy();
    expect(screen.getAllByText('USD 120.00').length).toBeGreaterThan(0);
    expect(screen.getByText('USD 40.00')).toBeTruthy();
    expect(screen.getByText('USD 80.00')).toBeTruthy();
    expect(
      screen.getByText('future scheduled chargeable · May 7 – Jun 21 · workspace default rate'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /not payment records, per-student\/package pricing, or revenue projections/i,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/selected month · USD/i)).toBeTruthy();
    expect(screen.getByText(/Planning horizon: May 7 – Jun 21/i)).toBeTruthy();
    expect(screen.getAllByText('2 h').length).toBeGreaterThan(0);
    expect(screen.getByText(/Excluded currencies/i)).toBeTruthy();
    expect(screen.getByText(/EUR 50.00/i)).toBeTruthy();
    expect(screen.getByText('Credit watch')).toBeTruthy();
    expect(screen.getByText('Students nearing their credit threshold')).toBeTruthy();
    expect(screen.getByText('Bea')).toBeTruthy();
    expect(screen.queryByText('Forecast')).toBeNull();
    expect(screen.queryByText('Risk correction')).toBeNull();
    expect(screen.queryByText('Risk')).toBeNull();
    expect(screen.queryByText('Cashflow')).toBeNull();
    expect(screen.queryByText('Likely top-ups')).toBeNull();
    expect(screen.queryByText('No urgent business risks.')).toBeNull();
    expect(apiMocks.getBusinessStatsSurface).toHaveBeenCalledWith({});
    expect(screen.getByLabelText(/Month/i)).toHaveProperty('value', '2026-05');
  });

  it('renders backend planning boundaries as date-only calendar values', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    try {
      apiMocks.getBusinessStatsSurface.mockResolvedValue(
        makeStatsSurface({ forecastFrom: '2026-01-01', forecastTo: '2026-01-02' }),
      );

      render(
        <MemoryRouter>
          <BusinessStatsPage />
        </MemoryRouter>,
      );

      expect(
        await screen.findByText(
          'future scheduled chargeable · Jan 1 – Jan 2 · workspace default rate',
        ),
      ).toBeTruthy();
      expect(screen.getByText(/Planning horizon: Jan 1 – Jan 2/i)).toBeTruthy();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps newer month results when an older stats load resolves later', async () => {
    const initialMonth = makeStatsSurface().month;
    const nextMonth = nextMonthInput(initialMonth);
    let resolveInitialLoad: (value: ReturnType<typeof makeStatsSurface>) => void = () => {};
    apiMocks.getBusinessStatsSurface
      .mockResolvedValueOnce(makeStatsSurface({ month: initialMonth }))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveInitialLoad = resolve;
          }),
      )
      .mockResolvedValueOnce(
        makeStatsSurface({
          month: nextMonth,
          collectedMinor: 99000,
          forecastMinor: 88000,
          pipeline: [
            {
              studentId: 'student-newer',
              studentName: 'Newer Month Student',
              studentScheduleBillingPath: '/students/student-newer/schedule-billing',
              remainingCredits: 1,
              upcomingChargeableLessons: 3,
              severity: 'warning',
            },
          ],
          excludedCurrencies: [],
        }),
      );

    render(
      <MemoryRouter>
        <BusinessStatsPage />
      </MemoryRouter>,
    );

    await screen.findByText('Bea');
    fireEvent.click(screen.getByRole('button', { name: /Refresh/i }));
    fireEvent.change(screen.getByLabelText(/Month/i), { target: { value: nextMonth } });
    await waitFor(() => {
      expect(apiMocks.getBusinessStatsSurface).toHaveBeenCalledTimes(3);
    });
    expect(await screen.findByText('Newer Month Student')).toBeTruthy();

    resolveInitialLoad(
      makeStatsSurface({
        month: initialMonth,
        pipeline: [
          {
            studentId: 'student-older',
            studentName: 'Older Month Student',
            studentScheduleBillingPath: '/students/student-older/schedule-billing',
            remainingCredits: 0,
            upcomingChargeableLessons: 1,
            severity: 'urgent',
          },
        ],
      }),
    );

    await waitFor(() => {
      expect(screen.getByText('Newer Month Student')).toBeTruthy();
    });
    expect(screen.queryByText('Older Month Student')).toBeNull();
  });
});
