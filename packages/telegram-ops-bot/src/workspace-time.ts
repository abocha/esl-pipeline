import type { CommandContext } from './types.js';

// A command/update owns its resolved clock. Never cache across authenticated contexts.
const commandTimezones = new WeakMap<CommandContext, Promise<string>>();
export function workspaceTimezone(context: CommandContext): Promise<string> {
  let pending = commandTimezones.get(context);
  if (!pending) {
    pending = context.backend.getBusinessSettings().then(({ timezone }) => {
      // Validate before rendering; unavailable settings fail through the normal command error path.
      if (typeof timezone !== 'string' || !timezone.trim())
        throw new Error('Workspace timezone unavailable.');
      new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0);
      return timezone;
    });
    commandTimezones.set(context, pending);
  }
  return pending;
}

export function workspaceDate(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function shiftDate(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

// Locate the first instant of a calendar date, including midnight offset transitions.
// The search uses date ordering, never an assumed 24-hour elapsed day.
export function workspaceDayStart(date: string, timezone: string): Date {
  const anchor = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(anchor) || new Date(anchor).toISOString().slice(0, 10) !== date) {
    throw new Error('Invalid calendar date.');
  }
  let low = anchor - 36 * 60 * 60 * 1000;
  let high = anchor + 36 * 60 * 60 * 1000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (workspaceDate(new Date(middle), timezone) < date) low = middle + 1;
    else high = middle;
  }
  if (workspaceDate(new Date(low), timezone) !== date)
    throw new Error('Calendar date does not exist.');
  return new Date(low);
}
