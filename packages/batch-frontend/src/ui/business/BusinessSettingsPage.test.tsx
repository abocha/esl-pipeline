import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessSettingsPage } from './BusinessSettingsPage';

const apiMocks = vi.hoisted(() => ({
  getBusinessSettings: vi.fn(),
  updateBusinessSettings: vi.fn(),
}));

vi.mock('../../utils/api', () => apiMocks);

describe('BusinessSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getBusinessSettings.mockResolvedValue({
      workspaceId: 'workspace-1',
      defaultCurrency: 'USD',
      defaultLessonRateMinor: 0,
      defaultLessonDurationMinutes: 60,
      timezone: 'UTC',
      forecastHorizonDays: 45,
      noShowRateBasisPoints: 0,
      cancellationRateBasisPoints: 0,
      topUpThreshold: 2,
      updatedAt: null,
    });
    apiMocks.updateBusinessSettings.mockResolvedValue({
      workspaceId: 'workspace-1',
      defaultCurrency: 'USD',
      defaultLessonRateMinor: 4500,
      defaultLessonDurationMinutes: 60,
      timezone: 'UTC',
      forecastHorizonDays: 45,
      noShowRateBasisPoints: 1000,
      cancellationRateBasisPoints: 0,
      topUpThreshold: 2,
      updatedAt: '2026-05-07T00:00:00.000Z',
    });
  });

  it('saves business forecast defaults', async () => {
    render(<BusinessSettingsPage />);

    expect(await screen.findByText('Forecast defaults')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Lesson rate'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('No-show correction %'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(apiMocks.updateBusinessSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultCurrency: 'USD',
          defaultLessonRateMinor: 4500,
          noShowRateBasisPoints: 1000,
        }),
      );
    });
    expect(await screen.findByText('Business settings saved.')).toBeTruthy();
  });
});
