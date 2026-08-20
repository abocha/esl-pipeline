const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatDate(value: string): string {
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnlyMatch) {
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${MONTH_NAMES[month - 1]} ${day}`;
    }
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateRange(from: string, to: string): string {
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-US', {
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

export function todayInput(): string {
  return toLocalDateInput(new Date());
}

export function addDaysInput(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toLocalDateInput(date);
}

export function currentMonthInput(): string {
  return todayInput().slice(0, 7);
}

function toLocalDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}
