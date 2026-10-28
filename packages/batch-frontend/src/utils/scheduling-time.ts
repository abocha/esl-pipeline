import { normalizeTimezone } from './timezones';
export function dateTimeInputInTimezone(value: Date | string, timezone: string): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: normalizeTimezone(timezone) ?? timezone,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function dateInputInTimezone(value: Date, timezone: string): string {
  return dateTimeInputInTimezone(value, timezone).slice(0, 10);
}
