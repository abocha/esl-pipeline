import { escapeHtmlAttribute } from './shared.js';

export function sanitizeRenderedHtml(html: string, allowRawHtml: boolean): string {
  let sanitized = html;

  sanitized = sanitized.replaceAll(/<script\b[\s\S]*?<\/script>/gi, '');
  sanitized = sanitized.replaceAll(/<style\b[\s\S]*?<\/style>/gi, '');
  sanitized = sanitized.replaceAll(/\son[a-z]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  sanitized = sanitized.replaceAll(/<iframe\b[\s\S]*?<\/iframe>/gi, (iframeBlock) => {
    const srcMatch = iframeBlock.match(/\ssrc=("|')([^"']+)\1/i);
    const src = srcMatch?.[2] ?? '';
    return isAllowedEmbedUrl(src) ? iframeBlock : '';
  });

  sanitized = sanitized.replaceAll(
    /\s(href|src)=("|')([^"']*)(\2)/gi,
    (_full, attr, quote, value) => {
      const attribute = String(attr).toLowerCase();
      const safeValue =
        attribute === 'href' ? sanitizeLinkHref(value) : (sanitizeMediaUrl(value) ?? '#');
      return ` ${attribute}=${quote}${escapeHtmlAttribute(safeValue)}${quote}`;
    },
  );

  if (!allowRawHtml) {
    sanitized = sanitized.replaceAll(/<object\b[\s\S]*?<\/object>/gi, '');
    sanitized = sanitized.replaceAll(/<embed\b[^>]*>/gi, '');
  }

  return sanitized;
}

export function sanitizeMediaUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  if (hasBlockedUrlChars(trimmed)) {
    return null;
  }

  if (isSafeRelativePath(trimmed)) {
    return trimmed;
  }

  const parsed = parseHttpUrl(trimmed);
  return parsed?.href ?? null;
}

export function sanitizeLinkHref(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '#';
  }

  if (hasBlockedUrlChars(trimmed)) {
    return '#';
  }

  if (trimmed.startsWith('#') || isSafeRelativePath(trimmed)) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('mailto:') || lower.startsWith('tel:')) {
    return trimmed;
  }

  const parsed = parseHttpUrl(trimmed);
  return parsed?.href ?? '#';
}

export function hasBlockedUrlChars(value: string): boolean {
  if (/\s/u.test(value)) {
    return true;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? -1;
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function hasExplicitScheme(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

export function isSafeRelativePath(value: string): boolean {
  if (!value) {
    return false;
  }
  if (value.startsWith('//') || value.startsWith('#')) {
    return false;
  }
  if (
    value.startsWith('/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('?')
  ) {
    return true;
  }
  if (hasExplicitScheme(value)) {
    return false;
  }
  return true;
}

export function isAllowedEmbedUrl(url: string): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed || parsed.protocol !== 'https:') {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return (
    host === 'youtube.com' ||
    host.endsWith('.youtube.com') ||
    host === 'youtu.be' ||
    host === 'player.vimeo.com' ||
    host.endsWith('.player.vimeo.com')
  );
}

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
