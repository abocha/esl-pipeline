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
      timezone: 'Asia/Bangkok',
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
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Asia/Bangkok' } });
    fireEvent.change(screen.getByLabelText('No-show correction %'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(apiMocks.updateBusinessSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultCurrency: 'USD',
          defaultLessonRateMinor: 4500,
          timezone: 'Asia/Bangkok',
          noShowRateBasisPoints: 1000,
        }),
      );
    });
    expect(await screen.findByText('Business settings saved.')).toBeTruthy();
  });

  it('offers a timezone picker sorted west-to-east by UTC offset', async () => {
    render(<BusinessSettingsPage />);

    const picker = await screen.findByLabelText('Timezone');
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
});
