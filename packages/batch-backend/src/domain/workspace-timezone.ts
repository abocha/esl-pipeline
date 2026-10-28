import type { PoolClient } from 'pg';

/** Shared tutor-clock spelling for both PostgreSQL AT TIME ZONE and Intl. */
export function normalizeWorkspaceTimezone(value: string): string {
  const trimmed = value.trim();
  if (/^(?:UTC|GMT)$/i.test(trimmed)) return 'UTC';
  const offset = /^(?:UTC|GMT)([+-])(\d{1,2})(?::?00)?$/i.exec(trimmed);
  if (offset) {
    const hours = Number(offset[2]);
    if (hours > 14) throw new RangeError('Invalid timezone');
    const normalized = hours === 0 ? 'UTC' : `Etc/GMT${offset[1] === '+' ? '-' : '+'}${hours}`;
    new Intl.DateTimeFormat('en', { timeZone: normalized });
    return normalized;
  }
  // ICU versions may canonicalize Vietnam to the legacy Saigon name. PostgreSQL
  // installations need the modern spelling consistently, regardless of that ICU choice.
  const canonical = new Intl.DateTimeFormat('en', { timeZone: trimmed }).resolvedOptions().timeZone;
  return canonical.toLowerCase() === 'asia/saigon' ? 'Asia/Ho_Chi_Minh' : canonical;
}

export async function readWorkspaceTimezone(
  client: PoolClient,
  workspaceId: string,
): Promise<string> {
  const { rows } = await client.query<{ timezone: string }>(
    'SELECT timezone FROM workspace_business_settings WHERE workspace_id=$1 FOR SHARE',
    [workspaceId],
  );
  return normalizeWorkspaceTimezone(rows[0]?.timezone ?? 'UTC');
}

/** PostgreSQL string offsets use POSIX signs; Intl offsets use ISO signs. */
export function postgresWorkspaceTimezone(timezone: string): string {
  return /^[+-]\d{2}:\d{2}$/.test(timezone)
    ? `UTC${timezone[0] === '+' ? '-' : '+'}${timezone.slice(1)}`
    : timezone;
}
