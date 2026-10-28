import { formatPlainDate, formatTutorTime } from '../../utils/tutor-time';

export function formatDate(value: string): string {
  return formatPlainDate(value);
}

export function formatDateRange(from: string, to: string): string {
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export function formatDateTime(value: string, timezone?: string): string {
  return formatTutorTime(value, timezone, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatMoney(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  return `${hours.toLocaleString('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(hours) ? 0 : 1,
  })} h`;
}
