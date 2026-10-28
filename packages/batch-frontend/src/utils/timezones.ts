export interface TimezoneOption {
  value: string;
  label: string;
}
export function normalizeTimezone(value: string): string | null {
  const zone = value.trim();
  if (/^(UTC|GMT)$/i.test(zone)) return 'UTC';
  const fixed = /^(?:UTC|GMT)([+-])(\d{1,2})(?::00)?$/i.exec(zone);
  if (fixed) {
    const hours = Number(fixed[2]);
    if (hours > 14) return null;
    return normalizeTimezone(
      hours === 0 ? 'UTC' : `Etc/GMT${fixed[1] === '+' ? '-' : '+'}${hours}`,
    );
  }
  try {
    const canonical = new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions()
      .timeZone;
    return canonical === 'Asia/Saigon' ? 'Asia/Ho_Chi_Minh' : canonical;
  } catch {
    return null;
  }
}
const CURATED_ZONES = [
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Tbilisi',
  'Asia/Almaty',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Bishkek',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
];
export function detectDeviceTimezone(): string | null {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && normalizeTimezone(zone) ? zone : null;
  } catch {
    return null;
  }
}
export function timezoneLabel(value: string, now: Date = new Date()): string {
  const zone = normalizeTimezone(value);
  if (!zone) return value;
  const city =
    zone === 'Asia/Ho_Chi_Minh'
      ? 'Ho Chi Minh City'
      : zone === 'UTC'
        ? 'UTC'
        : !zone.includes('/') || zone.startsWith('Etc/GMT')
          ? value
          : `${zone.split('/').at(-1)?.replaceAll('_', ' ')} (${zone.split('/')[0]})`;
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')
      ?.value.replace('GMT', 'UTC') ?? 'UTC';
  return `${city} · ${offset === 'UTC' ? 'UTC+00:00' : offset}`;
}
export function buildTimezoneOptions(
  saved: string,
  device: string | null,
  now: Date = new Date(),
): TimezoneOption[] {
  const supported = Intl.supportedValuesOf?.('timeZone') ?? [];
  const zones = new Set([...CURATED_ZONES, ...supported, saved]);
  if (device && normalizeTimezone(device)) zones.add(device);
  const deviceCanonical = device ? normalizeTimezone(device) : null;
  const unique = new Map<string, string>();
  for (const value of zones) {
    const canonical = normalizeTimezone(value) ?? value;
    if (!unique.has(canonical) || value === saved) unique.set(canonical, value);
  }
  return [...unique.values()]
    .map((value) => ({
      value,
      label: `${timezoneLabel(value, now)}${deviceCanonical && normalizeTimezone(value) === deviceCanonical ? ' · Device time' : ''}`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}
