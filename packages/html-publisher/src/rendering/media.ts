import { sanitizeLinkHref } from './safety.js';
import { escapeHtmlAttribute } from './shared.js';

export function buildVideoEmbed(url: string): string {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return `<p><a href="#">Video link is invalid</a></p>`;
  }

  const youtubeId = extractYouTubeId(parsed);
  if (youtubeId) {
    const src = `https://www.youtube.com/embed/${youtubeId}`;
    return `<div class="video-embed"><iframe src="${src}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }

  const vimeoId = extractVimeoId(parsed);
  if (vimeoId) {
    const src = `https://player.vimeo.com/video/${vimeoId}${parsed.search || ''}`;
    return `<div class="video-embed"><iframe src="${src}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }

  const safeHref = sanitizeLinkHref(parsed.href);
  return `<p><a href="${escapeHtmlAttribute(safeHref)}" target="_blank" rel="noopener noreferrer">Open video</a></p>`;
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

function isHostOrSubdomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function extractYouTubeId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (isHostOrSubdomain(host, 'youtube.com')) {
    const idFromQuery = url.searchParams.get('v');
    if (idFromQuery && /^[\w-]{6,}$/.test(idFromQuery)) {
      return idFromQuery;
    }
    if (url.pathname.startsWith('/embed/')) {
      const id = url.pathname.replace('/embed/', '').split('/')[0] ?? '';
      return /^[\w-]{6,}$/.test(id) ? id : null;
    }
    if (url.pathname.startsWith('/shorts/')) {
      const id = url.pathname.replace('/shorts/', '').split('/')[0] ?? '';
      return /^[\w-]{6,}$/.test(id) ? id : null;
    }
  }

  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\//, '').split('/')[0] ?? '';
    return /^[\w-]{6,}$/.test(id) ? id : null;
  }

  return null;
}

function extractVimeoId(url: URL): string | null {
  if (!isHostOrSubdomain(url.hostname.toLowerCase(), 'vimeo.com')) {
    return null;
  }
  const normalizedPath = url.pathname.replaceAll(/^\/+/g, '').replaceAll(/\/+$/g, '');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const direct = segments[0] ?? '';
  if (/^\d+$/.test(direct)) {
    return direct;
  }

  if (segments[0] === 'video' && /^\d+$/.test(segments[1] ?? '')) {
    return segments[1] ?? null;
  }

  if (segments[0] === 'channels' && /^\d+$/.test(segments[2] ?? '')) {
    return segments[2] ?? null;
  }

  if (segments[0] === 'groups' && segments[2] === 'videos' && /^\d+$/.test(segments[3] ?? '')) {
    return segments[3] ?? null;
  }

  if (segments[0] === 'album' && segments[2] === 'video' && /^\d+$/.test(segments[3] ?? '')) {
    return segments[3] ?? null;
  }

  return null;
}
