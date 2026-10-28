import { describe, expect, it, vi } from 'vitest';

import {
  buildTimezoneOptions,
  detectDeviceTimezone,
  normalizeTimezone,
  timezoneLabel,
} from './timezones';
import { formatPlainDate, formatTutorTime } from './tutor-time';

describe('tutor timezone presentation', () => {
  it('retains saved aliases, deduplicates equivalent choices and marks only the device region', () => {
    const choices = buildTimezoneOptions('Asia/Saigon', 'Asia/Ho_Chi_Minh');
    expect(choices.filter((choice) => choice.label.includes('Ho Chi Minh City'))).toEqual([
      { value: 'Asia/Saigon', label: 'Ho Chi Minh City · UTC+07:00 · Device time' },
    ]);
    expect(choices.find((choice) => choice.value === 'Asia/Bangkok')?.label).not.toContain(
      'Device time',
    );
    expect(
      buildTimezoneOptions('UTC', 'Pacific/Chatham').find(
        (choice) => choice.value === 'Pacific/Chatham',
      )?.label,
    ).toContain('Device time');
    expect(
      buildTimezoneOptions('Asia/Ho_Chi_Minh', null).some((choice) =>
        choice.label.includes('Device time'),
      ),
    ).toBe(false);
  });
  it('preserves fixed offset meaning and distinct regional identities', () => {
    expect(normalizeTimezone('GMT+7')).toBe('Etc/GMT-7');
    expect(normalizeTimezone('UTC-03:00')).toBe('Etc/GMT+3');
    expect(normalizeTimezone('UTC+15')).toBeNull();
    expect(normalizeTimezone('Asia/Saigon')).toBe(normalizeTimezone('Asia/Ho_Chi_Minh'));
    expect(normalizeTimezone('Europe/Moscow')).not.toBe(normalizeTimezone('Europe/Istanbul'));
    expect(timezoneLabel('Asia/Kathmandu')).toContain('UTC+05:45');
    expect(timezoneLabel('Europe/London', new Date('2026-01-01T00:00:00Z'))).toContain('UTC+00:00');
    expect(timezoneLabel('Europe/London', new Date('2026-07-01T00:00:00Z'))).toContain('UTC+01:00');
  });
  it('leaves detection optional when the device cannot report a zone', () => {
    const formatter = vi.spyOn(Intl, 'DateTimeFormat').mockImplementationOnce(() => {
      throw new Error('unavailable');
    });
    expect(detectDeviceTimezone()).toBeNull();
    formatter.mockRestore();
  });
  it('formats instants only with authority and leaves payment dates independent of browser time', () => {
    expect(formatTutorTime('2026-10-28T03:00:00Z', null)).toBe('—');
    expect(formatTutorTime('2026-10-28T03:00:00Z', 'Asia/Saigon')).toBe('Oct 28, 2026, 10:00 AM');
    expect(formatTutorTime('2026-10-31T18:30:00Z', 'Asia/Kathmandu')).toBe('Nov 1, 2026, 12:15 AM');
    expect(formatPlainDate('2026-10-28')).toBe('Oct 28');
  });
});
