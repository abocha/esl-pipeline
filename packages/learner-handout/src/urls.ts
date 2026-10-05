/** Pure URL admission, independent of any browser origin or process environment. */
export function safeMediaUrl(value?: string | null): string | null {
  if (!value) return null;
  const url = value.trim();
  if (
    !url ||
    /[\s<>"'`\\]/u.test(url) ||
    [...url].some((char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127)
  )
    return null;
  if (url.startsWith('//')) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url.startsWith('#') ? null : url;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

export function safeLinkUrl(value: string): string | null {
  if (/^#[^\s<>"'`\\]*$/u.test(value)) return value;
  return safeMediaUrl(value);
}

export function videoEmbedUrl(value: string): string | null {
  const safe = safeMediaUrl(value);
  if (!safe) return null;
  let url: URL;
  try {
    url = new URL(safe);
  } catch {
    return null;
  }
  const host = url.hostname;
  if (host === 'youtu.be' || host === 'youtube.com' || host === 'www.youtube.com') {
    const id =
      host === 'youtu.be'
        ? url.pathname.slice(1).split('/')[0]
        : (url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1]);
    return id && /^[\w-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${id}` : null;
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.match(
      /^\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/|album\/\d+\/video\/)?(\d+)\/?$/,
    )?.[1];
    return id ? `https://player.vimeo.com/video/${id}${url.search}` : null;
  }
  return null;
}
