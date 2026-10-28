import { normalizeTimezone } from './timezones';

export function formatTutorTime(
  value: string | null | undefined,

  timezone: string | null | undefined,

  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
): string {
  if (!value || !timezone) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: normalizeTimezone(timezone) ?? timezone,
  }).format(date);
}

// A payment date is a calendar label, never a midnight instant in the device zone.

export function formatPlainDate(value?: string | null): string {
  if (!value) return 'Not recorded yet';

  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);

  return Number.isNaN(date.getTime())
    ? 'Not recorded yet'
    : new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
      }).format(date);
}
