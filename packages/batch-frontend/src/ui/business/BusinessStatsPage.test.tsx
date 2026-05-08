import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessStatsPage } from './BusinessStatsPage';

const apiMocks = vi.hoisted(() => ({
  getBusinessStatsSurface: vi.fn(),
}));

vi.mock('../../utils/api', () => apiMocks);

describe('BusinessStatsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getBusinessStatsSurface.mockResolvedValue({
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
    });
  });

  it('renders income, workload, forecast, and excluded-currency warnings', async () => {
    render(
      <MemoryRouter>
        <BusinessStatsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Collected')).toBeTruthy();
    expect(screen.getAllByText('USD 120.00').length).toBeGreaterThan(0);
    expect(screen.getByText('USD 68.00')).toBeTruthy();
    expect(screen.getAllByText('2 h').length).toBeGreaterThan(0);
    expect(screen.getByText(/Excluded currencies/i)).toBeTruthy();
    expect(screen.getByText(/EUR 50.00/i)).toBeTruthy();
    expect(screen.getByText('Bea')).toBeTruthy();
  });
});
