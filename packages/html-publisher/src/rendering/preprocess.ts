import { sanitizeLinkHref, sanitizeMediaUrl } from './safety.js';
import { escapeHtmlAttribute } from './shared.js';

export function preprocessMarkdown(markdown: string, allowRawHtml: boolean): string {
  const normalizedPronunciation = normalizePronunciationSectionMarkdown(markdown);
  const withoutFrontmatter = stripFrontmatter(normalizedPronunciation);
  const lines = withoutFrontmatter.split('\n');
  const out: string[] = [];
  const stack: string[] = [];
  let fencedBy: '```' | '~~~' | null = null;

  for (const line of lines) {
    const directiveNormalizedLine = normalizeDirectiveLine(line);
    const directiveTrimmed = directiveNormalizedLine.trim();

    if (isFenceLine(directiveTrimmed)) {
      const fence = directiveTrimmed.startsWith('```') ? '```' : '~~~';
      if (fencedBy && fence === fencedBy) {
        fencedBy = null;
      } else if (!fencedBy) {
        fencedBy = fence;
      }
      out.push(directiveNormalizedLine);
      continue;
    }

    if (fencedBy) {
      out.push(directiveNormalizedLine);
      continue;
    }

    const normalizedLine = normalizeBulletedNumberedListLine(directiveNormalizedLine);
    const trimmed = normalizedLine.trim();

    if (/^:::\s*toc$/.test(trimmed)) {
      out.push('[[toc]]');
      continue;
    }

    if (/^:::\s*audio(\s+|$)/.test(trimmed)) {
      const rawUrl = trimmed.replace(/^:::\s*audio(\s+|$)/, '').trim();
      const safeUrl = sanitizeMediaUrl(rawUrl);
      if (safeUrl) {
        out.push(
          `<audio controls preload="metadata" src="${escapeHtmlAttribute(safeUrl)}"></audio>`,
        );
      } else {
        out.push(renderAudioPlaceholder());
      }
      continue;
    }

    if (/^:::\s*video\s+/.test(trimmed)) {
      const rawUrl = trimmed.replace(/^:::\s*video\s+/, '').trim();
      out.push(buildVideoEmbed(rawUrl));
      continue;
    }

    const openMatch = /^:::\s*([A-Za-z0-9_-]+)\b/.exec(trimmed);
    if (openMatch) {
      const name = openMatch[1] ?? '';
      if (!name) {
        out.push(escapeRawHtmlLine(normalizedLine, allowRawHtml));
        continue;
      }

      stack.push(name);
      if (name === 'column-list') {
        out.push('<!--COLUMN_LIST_START-->');
        continue;
      }
      if (name === 'column') {
        out.push('<!--COLUMN_START-->');
        continue;
      }
      out.push(normalizedLine);
      continue;
    }

    if (trimmed === ':::') {
      const last = stack.pop();
      if (last === 'column') {
        out.push('<!--COLUMN_END-->');
        continue;
      }
      if (last === 'column-list') {
        out.push('<!--COLUMN_LIST_END-->');
        continue;
      }
      out.push(normalizedLine);
      continue;
    }

    out.push(escapeRawHtmlLine(normalizedLine, allowRawHtml));
  }

  while (stack.length > 0) {
    const last = stack.pop();
    if (last === 'column') {
      out.push('<!--COLUMN_END-->');
    } else if (last === 'column-list') {
      out.push('<!--COLUMN_LIST_END-->');
    }
  }

  return out.join('\n');
}

export function normalizePronunciationSectionMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const normalized: string[] = [];
  let inPronunciationSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^###\s+.*pronunciation.*micro.*focus/i.test(trimmed)) {
      inPronunciationSection = true;
      normalized.push(line);
      continue;
    }
    if (inPronunciationSection && /^#{2,3}\s+/.test(trimmed)) {
      inPronunciationSection = false;
      normalized.push(line);
      continue;
    }
    if (!inPronunciationSection) {
      normalized.push(line);
      continue;
    }

    let next = trimmed;

    const codeWrappedField =
      /^(?:[-*]\s+)?`(\*\*(?:mode|shadow sentence|natural sentence practice):\*\*.+)`$/i.exec(next);
    if (codeWrappedField?.[1]) {
      normalized.push(codeWrappedField[1]);
      continue;
    }

    const plainBulletField =
      /^(?:[-*]\s+)(\*\*(?:mode|shadow sentence|natural sentence practice):\*\*.+)$/i.exec(next);
    if (plainBulletField?.[1]) {
      normalized.push(plainBulletField[1]);
      continue;
    }

    const bulletedNumbered = /^(?:[-*]\s+)(\d+\.\s+.+)$/.exec(next);
    if (bulletedNumbered?.[1]) {
      next = bulletedNumbered[1];
    }

    normalized.push(line.replace(trimmed, next));
  }

  return normalized.join('\n');
}

export function escapeRawHtmlLine(line: string, allowRawHtml: boolean): string {
  if (allowRawHtml) {
    return line;
  }
  if (!line.includes('<') && !line.includes('>')) {
    return line;
  }

  const breakPlaceholder = '__ESL_HTML_BR_PLACEHOLDER__';
  const withPreservedBreaks = line.replaceAll(/<br\s*\/?>/gi, breakPlaceholder);
  return withPreservedBreaks
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll(breakPlaceholder, '<br>');
}

export function isFenceLine(trimmed: string): boolean {
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

export function stripFrontmatter(markdown: string): string {
  const frontmatterMatch = markdown.match(/^---\n[\s\S]*?\n---\n/);
  if (frontmatterMatch) {
    return markdown.slice(frontmatterMatch[0].length);
  }
  return markdown;
}

export function normalizeDirectiveLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith(':::') && !trimmed.startsWith('::: ')) {
    const match = /^:::(\S+)(.*)$/.exec(trimmed);
    if (match) {
      return line.replace(trimmed, `::: ${match[1]}${match[2] ?? ''}`);
    }
  }
  return line;
}

export function normalizeBulletedNumberedListLine(line: string): string {
  const match = /^(\s*)[*-]\s+(\d+)\.\s+(.+)$/.exec(line);
  if (!match) return line;
  const indent = match[1] ?? '';
  const number = match[2] ?? '';
  const rest = match[3] ?? '';
  if (indent.length > 3) {
    return line;
  }
  return `${indent}${number}. ${rest}`;
}

function buildVideoEmbed(url: string): string {
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

function renderAudioPlaceholder(): string {
  return `<div class="audio-placeholder">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
<span>Audio track generating...</span>
</div>`;
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
