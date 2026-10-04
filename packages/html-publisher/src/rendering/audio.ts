import { sanitizeMediaUrl } from './safety.js';
import { escapeHtml, escapeHtmlAttribute } from './shared.js';

export function renderAudioPlaceholder(): string {
  return `<div class="audio-placeholder">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
<span>Audio track generating...</span>
</div>`;
}

export function renderAudioFigure(url: string, fallbackLabel = 'Open audio in a new tab'): string {
  const safeUrl = sanitizeMediaUrl(url);
  if (!safeUrl) {
    return renderAudioPlaceholder();
  }

  const escapedUrl = escapeHtmlAttribute(safeUrl);
  return `<figure class="audio-figure"><audio controls preload="metadata" src="${escapedUrl}"></audio><figcaption><a data-audio-fallback="true" href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(fallbackLabel)}</a></figcaption></figure>`;
}
