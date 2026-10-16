import { describe, expect, it } from 'vitest';

import { dateInputInTimezone, dateTimeInputInTimezone } from './scheduling-time';

describe('scheduling time formatting', () => {
  it('formats a datetime-local value in the selected workspace timezone', () => {
    expect(dateTimeInputInTimezone('2026-05-08T06:30:00.000Z', 'America/Los_Angeles')).toBe(
      '2026-05-07T23:30',
    );
  });

  it('preserves date-only values without shifting their calendar day', () => {
    expect(dateInputInTimezone('2026-05-08', 'America/Los_Angeles')).toBe('2026-05-08');
  });

  it('uses the workspace calendar day for datetime values', () => {
    expect(dateInputInTimezone('2026-05-08T06:30:00.000Z', 'America/Los_Angeles')).toBe(
      '2026-05-07',
    );
  });
});
