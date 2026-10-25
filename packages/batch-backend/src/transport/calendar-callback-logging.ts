/** Covers callback variants before routing, including percent-encoded and not-found paths. */
export function isGoogleCalendarCallbackUrl(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    /* malformed percent encoding still uses prefix */
  }
  return /^\/(?:api\/)?google\/calendar(?:\/|$)/i.test(decoded);
}
export function safeHttpLogUrl(url: string): string {
  return isGoogleCalendarCallbackUrl(url) ? 'google_calendar_callback' : url;
}
