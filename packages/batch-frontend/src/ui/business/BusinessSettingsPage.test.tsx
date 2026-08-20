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
      defaultLessonDurationMinutes: 90,
      timezone: 'UTC',
      forecastHorizonDays: 45,
      noShowRateBasisPoints: 1000,
      cancellationRateBasisPoints: 500,
      topUpThreshold: 2,
      updatedAt: null,
    });
    apiMocks.updateBusinessSettings.mockResolvedValue({
      workspaceId: 'workspace-1',
      defaultCurrency: 'USD',
      defaultLessonRateMinor: 4500,
      defaultLessonDurationMinutes: 90,
      timezone: 'Asia/Bangkok',
      forecastHorizonDays: 45,
      noShowRateBasisPoints: 1000,
      cancellationRateBasisPoints: 500,
      topUpThreshold: 2,
      updatedAt: '2026-05-07T00:00:00.000Z',
    });
  });

  it('saves visible business defaults without exposing or resetting hidden correction fields', async () => {
    render(<BusinessSettingsPage />);

    expect(await screen.findByText('Business defaults')).toBeTruthy();
    expect(screen.getByLabelText('Default lesson rate')).toBeTruthy();
    expect(screen.getByLabelText('Planning horizon')).toBeTruthy();
    expect(screen.queryByLabelText('Default duration')).toBeNull();
    expect(screen.queryByLabelText('No-show correction %')).toBeNull();
    expect(screen.queryByLabelText('Cancellation correction %')).toBeNull();
    fireEvent.change(screen.getByLabelText('Default lesson rate'), { target: { value: '45' } });
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Asia/Bangkok' } });
    fireEvent.change(screen.getByLabelText('Planning horizon'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(apiMocks.updateBusinessSettings).toHaveBeenCalledWith({
        defaultCurrency: 'USD',
        defaultLessonRateMinor: 4500,
        timezone: 'Asia/Bangkok',
        forecastHorizonDays: 60,
        topUpThreshold: 2,
      });
    });
    expect(await screen.findByText('Business settings saved.')).toBeTruthy();
  });

  it('keeps settings unavailable after a failed load until retry succeeds', async () => {
    apiMocks.getBusinessSettings
      .mockRejectedValueOnce(new Error('Settings unavailable'))
      .mockResolvedValueOnce({
        workspaceId: 'workspace-1',
        defaultCurrency: 'USD',
        defaultLessonRateMinor: 2750,
        defaultLessonDurationMinutes: 90,
        timezone: 'UTC',
        forecastHorizonDays: 45,
        noShowRateBasisPoints: 1000,
        cancellationRateBasisPoints: 500,
        topUpThreshold: 2,
        updatedAt: null,
      });

    render(<BusinessSettingsPage />);

    expect((await screen.findByRole('alert')).textContent).toContain('Settings unavailable');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
    expect(screen.queryByLabelText('Default currency')).toBeNull();
    expect(apiMocks.updateBusinessSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('button', { name: 'Save settings' })).toBeTruthy();
    expect(screen.getByDisplayValue('27.5')).toBeTruthy();
    expect(apiMocks.updateBusinessSettings).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Default lesson rate'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => {
      expect(apiMocks.updateBusinessSettings).toHaveBeenCalledWith({
        defaultCurrency: 'USD',
        defaultLessonRateMinor: 3000,
        timezone: 'UTC',
        forecastHorizonDays: 45,
        topUpThreshold: 2,
      });
    });
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
