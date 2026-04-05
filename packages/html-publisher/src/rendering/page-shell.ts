import type { Frontmatter } from './frontmatter.js';
import { formatCurrentDate } from './frontmatter.js';
import type { ResolvedRenderOptions } from './options.js';
import { escapeHtml } from './shared.js';

export interface PageShellInput {
  resolvedTitle: string;
  frontmatter: Frontmatter;
  resolved: ResolvedRenderOptions;
  bodyHtml: string;
  css: string;
  behaviorScript: string;
}

export function renderHeader(
  title: string,
  frontmatter: Frontmatter,
  options: ResolvedRenderOptions,
): string {
  const iconValue = frontmatter.icon?.trim() || '📘';
  const icon = `<div class="hero-emoji" aria-hidden="true">${escapeHtml(iconValue)}</div>`;

  const tags: string[] = [];
  if (options.showGeneratedDate) {
    tags.push(formatCurrentDate());
  }
  if (frontmatter.student) tags.push(frontmatter.student);
  if (frontmatter.topic) tags.push(frontmatter.topic);

  const tagHtml =
    tags.length > 0
      ? `<div class="page-tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';

  return `<header class="page-header"><div class="hero">${icon}<div class="hero-content"><h1 class="hero-title">${escapeHtml(title)}</h1>${tagHtml}</div></div></header>`;
}

export function renderPageShell(input: PageShellInput): string {
  const pageClasses = ['page', 'markdown-body'];
  if (input.resolved.features.stickyToc) {
    pageClasses.push('has-sticky-toc');
  }
  const pronunciationAudioData = input.resolved.pronunciationAudio
    ? `<script id="esl-pronunciation-audio" type="application/json">${serializeJsonForHtml(input.resolved.pronunciationAudio)}</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Charis+SIL:ital,wght@0,400;0,700;1,400;1,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <title>${escapeHtml(input.resolvedTitle)}</title>
  <style>${input.css}</style>
</head>
<body class="markdown-body">
  <main id="content" class="${pageClasses.join(' ')}">
    ${renderHeader(input.resolvedTitle, input.frontmatter, input.resolved)}
    ${input.bodyHtml}
  </main>
  <button type="button" class="theme-toggle" aria-label="Toggle dark mode"><span class="icon-sun">☀️</span><span class="icon-moon">🌙</span></button>
  <button type="button" class="back-to-top" aria-label="Back to top">↑</button>
  ${pronunciationAudioData}
  ${input.behaviorScript}
</body>
</html>`;
}

export function serializeJsonForHtml(value: unknown): string {
  return JSON.stringify(value ?? null).replaceAll('<', String.raw`\u003c`);
}
