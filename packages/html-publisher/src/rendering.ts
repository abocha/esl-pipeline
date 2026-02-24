import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import container from 'markdown-it-container';
import toc from 'markdown-it-toc-done-right';

export interface ThemeTokens {
  pageBg?: string;
  pageCard?: string;
  pageText?: string;
  pageMuted?: string;
  pageLine?: string;
  calloutBg?: string;
  calloutBorder?: string;
  tocBg?: string;
  tocBorder?: string;
  h1?: string;
  h2?: string;
  h3?: string;
}

export interface FeatureFlags {
  stickyToc?: boolean;
  copyCode?: boolean;
}

export interface RenderOptions {
  title?: string;
  css?: string;
  headingTheme?: {
    h1?: string;
    h2?: string;
    h3?: string;
  };
  theme?: ThemeTokens;
  features?: FeatureFlags;
  allowRawHtml?: boolean;
  showGeneratedDate?: boolean;
}

interface ResolvedFeatures {
  stickyToc: boolean;
  copyCode: boolean;
}

interface ResolvedRenderOptions {
  css?: string;
  theme: ThemeTokens;
  features: ResolvedFeatures;
  allowRawHtml: boolean;
  showGeneratedDate: boolean;
}

const DEFAULT_THEME: Required<ThemeTokens> = {
  h1: '#e6ddcc',
  h2: '#d8e5f2',
  h3: '#e7dbe9',
  pageBg: '#f5f1e8',
  pageCard: '#ffffff',
  pageText: '#1f1f1f',
  pageMuted: '#565656',
  pageLine: '#ddd6c8',
  calloutBg: '#f8f4eb',
  calloutBorder: '#d7b98f',
  tocBg: '#f7f3ea',
  tocBorder: '#e5dac8',
};

const DEFAULT_CSS = `
:root {
  --theme-h1: ${DEFAULT_THEME.h1};
  --theme-h2: ${DEFAULT_THEME.h2};
  --theme-h3: ${DEFAULT_THEME.h3};
  --page-bg: ${DEFAULT_THEME.pageBg};
  --page-card: ${DEFAULT_THEME.pageCard};
  --page-text: ${DEFAULT_THEME.pageText};
  --page-muted: ${DEFAULT_THEME.pageMuted};
  --page-line: ${DEFAULT_THEME.pageLine};
  --callout-bg: ${DEFAULT_THEME.calloutBg};
  --callout-border: ${DEFAULT_THEME.calloutBorder};
  --toc-bg: ${DEFAULT_THEME.tocBg};
  --toc-border: ${DEFAULT_THEME.tocBorder};
  --tag-bg: #f0e8da;
  --audio-accent: #8b6f47;
  --inline-code-bg: #ece8e1;
  --inline-code-text: #2a2a2a;
  --toc-link: #36475d;
  --table-head-bg: color-mix(in srgb, var(--page-card) 82%, var(--page-bg) 18%);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --theme-h1: #3d3529;
    --theme-h2: #2a3340;
    --theme-h3: #352d38;
    --page-bg: #1a1714;
    --page-card: #252220;
    --page-text: #e8e4dc;
    --page-muted: #a8a098;
    --page-line: #3a342c;
    --callout-bg: #2a2622;
    --callout-border: #5c4a32;
    --toc-bg: #242018;
    --toc-border: #3a3228;
    --tag-bg: #3a3228;
    --audio-accent: #c9a86c;
    --inline-code-bg: #2e2a26;
    --inline-code-text: #d8d4cc;
    --toc-link: #9aa8b8;
  }
}
[data-theme="dark"] {
  --theme-h1: #3d3529;
  --theme-h2: #2a3340;
  --theme-h3: #352d38;
  --page-bg: #1a1714;
  --page-card: #252220;
  --page-text: #e8e4dc;
  --page-muted: #a8a098;
  --page-line: #3a342c;
  --callout-bg: #2a2622;
  --callout-border: #5c4a32;
  --toc-bg: #242018;
  --toc-border: #3a3228;
  --tag-bg: #3a3228;
  --audio-accent: #c9a86c;
  --inline-code-bg: #2e2a26;
  --inline-code-text: #d8d4cc;
  --toc-link: #9aa8b8;
}
html {
  scroll-behavior: smooth;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  padding: 0;
  font-family: 'Inter', 'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.65;
  color: var(--page-text);
  background: radial-gradient(circle at top right, color-mix(in srgb, var(--page-bg) 85%, #d8d0c0 15%) 0%, transparent 40%), var(--page-bg);
  transition: background-color 0.3s ease, color 0.3s ease;
}
.page {
  max-width: 940px;
  margin: 28px auto 56px;
  background: var(--page-card);
  border-radius: 18px;
  padding: 28px 34px 44px;
  border: 1px solid color-mix(in srgb, var(--page-line) 70%, var(--page-card) 30%);
  box-shadow: 0 12px 34px rgba(56, 44, 24, 0.08);
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
.page-header {
  margin-bottom: 18px;
}
.hero {
  position: relative;
  display: flex;
  align-items: center;
  gap: 20px;
  min-height: 140px;
  padding: 24px 26px;
  border-radius: 16px;
  border: 1px solid color-mix(in srgb, var(--page-line) 72%, var(--page-card) 28%);
  background:
    radial-gradient(circle at 22% 24%, color-mix(in srgb, var(--page-card) 70%, transparent 30%), transparent 55%),
    linear-gradient(135deg, var(--theme-h1) 0%, var(--theme-h2) 45%, var(--theme-h3) 100%);
  overflow: hidden;
}
.hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.18) 2px, transparent 2px, transparent 12px);
  opacity: 0.45;
  pointer-events: none;
}
.hero-emoji {
  position: relative;
  z-index: 1;
  font-size: clamp(72px, 10vw, 110px);
  line-height: 1;
  filter: drop-shadow(0 6px 14px rgba(36, 30, 18, 0.18));
  flex-shrink: 0;
}
.hero-content {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 8px;
  flex: 1;
  min-width: 0;
}
.hero-title {
  margin: 0;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  font-size: clamp(30px, 4.4vw, 44px);
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1.08;
  text-wrap: balance;
}
.page-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--tag-bg);
  color: var(--page-text);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  transition: background-color 0.3s ease, color 0.3s ease;
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  margin: 0;
  padding: 0;
  letter-spacing: -0.01em;
  line-height: 1.25;
}
.markdown-body h1 {
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
  font-size: 35px;
  letter-spacing: -0.02em;
  margin-bottom: 12px;
}
.markdown-body h2 {
  font-size: 23px;
  margin: 28px 0 12px;
}
.markdown-body h3 {
  font-size: 19px;
  margin: 21px 0 10px;
}
.markdown-body .heading-text {
  display: inline-block;
  padding: 4px 10px;
  border-radius: 8px;
  color: var(--page-text);
  background: var(--theme-h1);
}
.markdown-body h2 .heading-text {
  background: var(--theme-h2);
}
.markdown-body h3 .heading-text {
  background: var(--theme-h3);
}
.markdown-body p {
  margin: 8px 0 14px;
}
.markdown-body a {
  color: #134278;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.markdown-body a:hover {
  color: #0e335c;
}
.markdown-body a:focus-visible,
.markdown-body summary:focus-visible,
.copy-code-button:focus-visible {
  outline: 3px solid #2b6cb0;
  outline-offset: 2px;
  border-radius: 6px;
}
.markdown-body ul,
.markdown-body ol {
  margin: 8px 0 16px;
  padding-left: 22px;
}
.markdown-body li {
  margin: 6px 0;
}
.markdown-body hr {
  border: none;
  border-top: 1px solid var(--page-line);
  margin: 24px 0;
}
.audio-figure {
  margin: 14px 0 20px;
  padding: 12px 14px;
  border: 1px solid var(--page-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--page-card) 94%, var(--page-bg) 6%);
  transition: border-color 0.2s ease;
}
.audio-figure:hover,
.audio-figure:focus-within {
  border-color: var(--callout-border);
}
.audio-figure audio {
  width: 100%;
  margin: 0;
  accent-color: var(--audio-accent);
}
.audio-figure figcaption {
  margin-top: 8px;
  color: var(--page-muted);
  font-size: 13px;
}
.audio-placeholder {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0 20px;
  padding: 16px 20px;
  border: 1px dashed var(--page-line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--page-card) 60%, var(--page-bg) 40%);
  color: var(--page-muted);
  font-size: 14px;
}
.audio-placeholder svg {
  width: 20px;
  height: 20px;
  opacity: 0.6;
}
.callout {
  background: var(--callout-bg);
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--page-line);
  border-left: 4px solid var(--callout-border);
  display: flex;
  gap: 12px;
  margin: 16px 0;
}
.callout .icon {
  font-size: 22px;
  line-height: 1.2;
  margin-top: 2px;
}
.callout .content > :first-child {
  margin-top: 0;
}
.callout .content > :last-child {
  margin-bottom: 0;
}
.study-text {
  background: color-mix(in srgb, var(--page-card) 94%, var(--page-bg) 6%);
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--page-line);
  margin: 16px 0;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
.study-text summary {
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--page-muted);
  font-weight: 700;
  cursor: pointer;
}
.study-text .content {
  margin-top: 10px;
}
.study-text .content > :first-child {
  margin-top: 0;
}
.study-text .content > :last-child {
  margin-bottom: 0;
}
.column-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 20px;
}
.column {
  min-width: 240px;
}
.video-embed {
  position: relative;
  padding-top: 56.25%;
  margin: 16px 0;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--page-line);
  background: #0f172a;
}
.video-embed iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.table-of-contents {
  background: var(--toc-bg);
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--toc-border);
  margin: 10px 0 0;
  color: var(--page-muted);
}
.toc-shell {
  margin: 16px 0;
  border-radius: 12px;
  border: 1px solid var(--toc-border);
  background: color-mix(in srgb, var(--toc-bg) 72%, #ffffff 28%);
  overflow: hidden;
}
.toc-shell summary {
  cursor: pointer;
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--page-muted);
  padding: 12px 14px;
  background: color-mix(in srgb, var(--toc-bg) 82%, var(--page-card) 18%);
  transition: background-color 0.3s ease, color 0.3s ease;
}
.toc-shell summary:hover {
  color: var(--page-text);
}
.has-sticky-toc .toc-shell {
  position: sticky;
  top: 14px;
  z-index: 5;
  max-height: min(58vh, 420px);
}
.has-sticky-toc .toc-shell[open] .table-of-contents {
  max-height: min(48vh, 320px);
  overflow: auto;
}
.table-of-contents ul {
  list-style: none;
  padding-left: 0;
  margin: 0;
}
.table-of-contents li {
  margin: 6px 0;
}
.table-of-contents a {
  color: var(--toc-link);
  text-decoration: none;
  transition: color 0.2s ease;
}
.table-of-contents a:hover {
  color: var(--page-text);
  text-decoration: underline;
}
details:not(.study-text) {
  margin: 12px 0;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--page-line);
  background: color-mix(in srgb, var(--page-card) 94%, var(--page-bg) 6%);
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
details:not(.study-text) summary {
  cursor: pointer;
  font-weight: 600;
}
pre {
  position: relative;
  margin: 14px 0;
  border-radius: 12px;
  border: 1px solid var(--page-line);
  background: var(--callout-bg);
  padding: 14px 16px;
  overflow-x: auto;
  transition: background-color 0.3s ease, border-color 0.3s ease;
}
pre code {
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 13px;
  line-height: 1.55;
}
.markdown-body p code,
.markdown-body li code,
.markdown-body td code,
.markdown-body th code,
.markdown-body blockquote code,
.markdown-body h1 code,
.markdown-body h2 code,
.markdown-body h3 code {
  background: var(--inline-code-bg);
  color: var(--inline-code-text);
  border-radius: 7px;
  padding: 0.14em 0.46em;
  font-family: 'SFMono-Regular', Menlo, Monaco, Consolas, 'Liberation Mono', monospace;
  font-size: 0.92em;
  line-height: 1.2;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  transition: background-color 0.3s ease, color 0.3s ease;
}
.copy-code-button {
  position: absolute;
  top: 8px;
  right: 8px;
  border: 1px solid var(--page-line);
  background: #fff;
  color: var(--page-text);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 8px;
  cursor: pointer;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0 18px;
  font-size: 14px;
  display: block;
  overflow-x: auto;
}
th,
td {
  border: 1px solid var(--page-line);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
  white-space: nowrap;
}
th {
  background: var(--table-head-bg);
  font-weight: 700;
}
@media (max-width: 840px) {
  .page {
    margin: 10px;
    padding: 20px 18px 30px;
    border-radius: 14px;
  }
  .hero {
    min-height: 148px;
    padding: 16px 14px;
    gap: 12px;
  }
  .hero-emoji {
    font-size: clamp(64px, 20vw, 88px);
  }
  .markdown-body h1 {
    font-size: 30px;
  }
  .markdown-body h2 {
    font-size: 21px;
  }
  .has-sticky-toc .table-of-contents {
    position: static;
  }
  .column-list {
    grid-template-columns: 1fr;
  }
}
.theme-toggle {
  position: fixed;
  top: 20px;
  right: 24px;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: 1px solid var(--page-line);
  border-radius: 50%;
  background: var(--page-card);
  color: var(--page-muted);
  font-size: 18px;
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
  box-shadow: 0 3px 12px rgba(36, 30, 18, 0.1);
}
.theme-toggle:hover {
  border-color: var(--callout-border);
  color: var(--page-text);
  transform: scale(1.05);
}
.theme-toggle .icon-sun,
.theme-toggle .icon-moon {
  position: absolute;
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.theme-toggle .icon-moon {
  opacity: 0;
  transform: rotate(-90deg) scale(0.8);
}
[data-theme="dark"] .theme-toggle .icon-sun {
  opacity: 0;
  transform: rotate(90deg) scale(0.8);
}
[data-theme="dark"] .theme-toggle .icon-moon {
  opacity: 1;
  transform: rotate(0) scale(1);
}
details {
  overflow: hidden;
}
details > .content {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.3s ease-out, opacity 0.3s ease-out, padding 0.3s ease;
  opacity: 0;
}
details.is-open > .content {
  grid-template-rows: 1fr;
  opacity: 1;
}
.content-inner {
  overflow: hidden;
}
.back-to-top {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: 1px solid var(--page-line);
  border-radius: 50%;
  background: var(--page-card);
  color: var(--page-muted);
  font-size: 20px;
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transform: translateY(12px);
  transition: opacity 0.25s ease, visibility 0.25s ease, transform 0.25s ease, border-color 0.2s ease, color 0.2s ease;
  box-shadow: 0 4px 16px rgba(36, 30, 18, 0.12);
}
.back-to-top:hover {
  border-color: var(--callout-border);
  color: var(--page-text);
}
.back-to-top.visible {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
@media print {
  body {
    background: #fff;
  }
  .page {
    box-shadow: none;
    border: none;
    margin: 0;
    max-width: none;
    padding: 0;
  }
  .copy-code-button,
  .back-to-top,
  .theme-toggle {
    display: none !important;
  }
}
`;

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;
type ContainerPlugin = (md: MarkdownItInstance, name: string, options: unknown) => void;

export async function renderToHtml(
  markdown: string,
  title: string,
  options: RenderOptions = {},
): Promise<string> {
  const resolved = resolveRenderOptions(options);
  const md = createRenderer();
  const frontmatter = extractFrontmatter(markdown);
  const resolvedTitle = resolveTitle(markdown, title, frontmatter);
  const prepared = preprocessMarkdown(markdown, resolved.allowRawHtml);
  const bodyHtml = replaceColumnMarkers(md.render(prepared));
  const withEmbeddedAudio = replaceAudioLinks(decorateAudioPlayers(bodyHtml));
  const withCollapsibleToc = wrapTableOfContents(withEmbeddedAudio);
  const safeBody = sanitizeRenderedHtml(withCollapsibleToc, resolved.allowRawHtml);
  const css = buildCss(resolved);
  const header = renderHeader(resolvedTitle, frontmatter, resolved);
  const behaviorScript = buildBehaviorScript(resolved.features);
  const pageClasses = ['page', 'markdown-body'];
  if (resolved.features.stickyToc) {
    pageClasses.push('has-sticky-toc');
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <title>${escapeHtml(resolvedTitle)}</title>
  <style>${css}</style>
</head>
<body class="markdown-body">
  <main id="content" class="${pageClasses.join(' ')}">
    ${header}
    ${safeBody}
  </main>
  <button type="button" class="theme-toggle" aria-label="Toggle dark mode"><span class="icon-sun">☀️</span><span class="icon-moon">🌙</span></button>
  <button type="button" class="back-to-top" aria-label="Back to top">↑</button>
  ${behaviorScript}
</body>
</html>`;
}

export async function createStaticPageHtml(
  markdown: string,
  title: string,
  options: RenderOptions = {},
): Promise<string> {
  return renderToHtml(markdown, title, options);
}

function createRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: true,
  });

  md.use(anchor);
  md.use(toc, { listType: 'ul', containerClass: 'table-of-contents' });

  const containerPlugin = container as unknown as ContainerPlugin;

  md.use(containerPlugin, 'toggle', {
    validate: (params: string) => params.trim().startsWith('toggle '),
    render: (tokens: { info?: string; nesting?: number }[], idx: number) => {
      const info = tokens[idx]?.info?.trim() ?? '';
      const match = /^toggle\s+(.*)$/.exec(info);
      const label = match?.[1] ?? 'Details';
      if (tokens[idx]?.nesting === 1) {
        return `<details><summary>${escapeHtml(label)}</summary><div class="content"><div class="content-inner">`;
      }
      return '</div></div></details>';
    },
  });

  md.use(containerPlugin, 'callout', {
    validate: (params: string) => params.trim().startsWith('callout '),
    render: (tokens: { info?: string; nesting?: number }[], idx: number) => {
      const info = tokens[idx]?.info?.trim() ?? '';
      const match = /^callout\s+(.*)$/.exec(info);
      const icon = match?.[1] ?? 'Info';
      if (tokens[idx]?.nesting === 1) {
        return `<aside class="callout"><div class="icon">${escapeHtml(icon)}</div><div class="content">`;
      }
      return '</div></aside>';
    },
  });

  md.use(containerPlugin, 'study-text', {
    validate: (params: string) => params.trim().startsWith('study-text'),
    render: (tokens: { info?: string; nesting?: number }[], idx: number) => {
      const info = tokens[idx]?.info?.trim() ?? '';
      const match = /^study-text\s*(.*)$/.exec(info);
      const label = match?.[1]?.trim();
      const summaryTitle = label ? `Study Text: ${label}` : 'Study Text';
      if (tokens[idx]?.nesting === 1) {
        return `<details class="study-text"><summary>${escapeHtml(summaryTitle)}</summary><div class="content"><div class="content-inner">`;
      }
      return '</div></div></details>';
    },
  });

  md.renderer.rules.heading_open = (tokens, idx, renderOptions, _env, self) => {
    const rendered = self.renderToken(tokens, idx, renderOptions);
    return `${rendered}<span class="heading-text">`;
  };

  md.renderer.rules.heading_close = (tokens, idx, renderOptions, _env, self) => {
    const rendered = self.renderToken(tokens, idx, renderOptions);
    return `</span>${rendered}`;
  };

  return md;
}

function preprocessMarkdown(markdown: string, allowRawHtml: boolean): string {
  const withoutFrontmatter = stripFrontmatter(markdown);
  const lines = withoutFrontmatter.split('\n');
  const out: string[] = [];
  const stack: string[] = [];
  let fencedBy: '```' | '~~~' | null = null;

  for (const line of lines) {
    const normalizedLine = normalizeDirectiveLine(line);
    const trimmed = normalizedLine.trim();

    if (isFenceLine(trimmed)) {
      const fence = trimmed.startsWith('```') ? '```' : '~~~';
      if (fencedBy && fence === fencedBy) {
        fencedBy = null;
      } else if (!fencedBy) {
        fencedBy = fence;
      }
      out.push(normalizedLine);
      continue;
    }

    if (fencedBy) {
      out.push(normalizedLine);
      continue;
    }

    if (/^:::\s*toc$/.test(trimmed)) {
      out.push('[[toc]]');
      continue;
    }

    if (/^:::\s*audio(\s+|$)/.test(trimmed)) {
      const rawUrl = trimmed.replace(/^:::\s*audio(\s+|$)/, '').trim();
      const safeUrl = sanitizeMediaUrl(rawUrl);
      if (safeUrl) {
        out.push(`<audio controls preload="metadata" src="${escapeHtmlAttribute(safeUrl)}"></audio>`);
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

function escapeRawHtmlLine(line: string, allowRawHtml: boolean): string {
  if (allowRawHtml) {
    return line;
  }
  if (!line.includes('<') && !line.includes('>')) {
    return line;
  }
  return line.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function isFenceLine(trimmed: string): boolean {
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

function stripFrontmatter(markdown: string): string {
  const frontmatterMatch = markdown.match(/^---\n[\s\S]*?\n---\n/);
  if (frontmatterMatch) {
    return markdown.slice(frontmatterMatch[0].length);
  }
  return markdown;
}

function normalizeDirectiveLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith(':::') && !trimmed.startsWith('::: ')) {
    const match = /^:::(\S+)(.*)$/.exec(trimmed);
    if (match) {
      return line.replace(trimmed, `::: ${match[1]}${match[2] ?? ''}`);
    }
  }
  return line;
}

function resolveTitle(markdown: string, explicitTitle?: string, frontmatter?: Frontmatter): string {
  if (explicitTitle && explicitTitle.trim().length > 0) {
    return explicitTitle.trim();
  }
  const frontmatterTitle = frontmatter?.title ?? extractFrontmatterTitle(markdown);
  return frontmatterTitle ?? 'Untitled';
}

function extractFrontmatterTitle(markdown: string): string | null {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) return null;
  const titleMatch = match[0].match(/^\s*title:\s*(.+)\s*$/m);
  if (!titleMatch) return null;
  const raw = titleMatch[1] ? titleMatch[1].trim() : '';
  if (!raw) return null;
  return raw.replaceAll(/^['"]|['"]$/g, '');
}

interface Frontmatter {
  title?: string;
  icon?: string;
  student?: string;
  topic?: string;
}

function extractFrontmatter(markdown: string): Frontmatter {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n/);
  if (!match) return {};
  const block = match[0];
  const lines = block.split('\n').slice(1, -1);
  const result: Frontmatter = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(trimmed);
    if (!kv) continue;
    const key = kv[1] ?? '';
    const rawValue = kv[2] ?? '';
    const value = normalizeFrontmatterValue(rawValue);
    if (key === 'title') result.title = value;
    if (key === 'icon') result.icon = value;
    if (key === 'student') result.student = value;
    if (key === 'topic') result.topic = value;
  }

  return result;
}

function normalizeFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replaceAll(/^['"]|['"]$/g, ''))
      .filter(Boolean)
      .join(', ');
  }
  return trimmed.replaceAll(/^['"]|['"]$/g, '');
}

function renderHeader(title: string, frontmatter: Frontmatter, options: ResolvedRenderOptions): string {
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

function formatCurrentDate(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
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
    const src = `https://player.vimeo.com/video/${vimeoId}`;
    return `<div class="video-embed"><iframe src="${src}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
  }

  if (isAllowedEmbedUrl(parsed.href)) {
    return `<div class="video-embed"><iframe src="${escapeHtmlAttribute(parsed.href)}" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`;
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
  const id = url.pathname.replace(/^\//, '').split('/')[0] ?? '';
  return /^\d+$/.test(id) ? id : null;
}

function decorateAudioPlayers(html: string): string {
  return html.replaceAll(
    /<audio\s+controls(?:\s+preload="metadata")?\s+src=("|')([^"']+)\1\s*><\/audio>/gi,
    (_full, _quote, rawUrl) => renderAudioFigure(rawUrl),
  );
}

function replaceAudioLinks(html: string): string {
  return html.replaceAll(
    /<a\b([^>]*)href=("|')([^"']+\.(?:mp3|wav|m4a|aac|ogg|opus)(?:\?[^"']*)?)\2([^>]*)>([\s\S]*?)<\/a>/gi,
    (fullMatch, before, _quote, url, after, labelHtml) => {
      const attrs = `${before ?? ''}${after ?? ''}`;
      if (attrs.toLowerCase().includes('data-audio-fallback')) {
        return fullMatch;
      }
      const label = stripHtml(labelHtml).trim() || 'Open audio in a new tab';
      return renderAudioFigure(url, label);
    },
  );
}

function renderAudioPlaceholder(): string {
  return `<div class="audio-placeholder">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
<span>Audio track generating...</span>
</div>`;
}

function renderAudioFigure(url: string, fallbackLabel = 'Open audio in a new tab'): string {
  const safeUrl = sanitizeMediaUrl(url);
  if (!safeUrl) {
    return renderAudioPlaceholder();
  }

  const escapedUrl = escapeHtmlAttribute(safeUrl);
  return `<figure class="audio-figure"><audio controls preload="metadata" src="${escapedUrl}"></audio><figcaption><a data-audio-fallback="true" href="${escapedUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(fallbackLabel)}</a></figcaption></figure>`;
}

function sanitizeRenderedHtml(html: string, allowRawHtml: boolean): string {
  let sanitized = html;

  sanitized = sanitized.replaceAll(/<script\b[\s\S]*?<\/script>/gi, '');
  sanitized = sanitized.replaceAll(/<style\b[\s\S]*?<\/style>/gi, '');
  sanitized = sanitized.replaceAll(/\son[a-z]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  sanitized = sanitized.replaceAll(/<iframe\b[\s\S]*?<\/iframe>/gi, (iframeBlock) => {
    const srcMatch = iframeBlock.match(/\ssrc=("|')([^"']+)\1/i);
    const src = srcMatch?.[2] ?? '';
    return isAllowedEmbedUrl(src) ? iframeBlock : '';
  });

  sanitized = sanitized.replaceAll(/\s(href|src)=("|')([^"']*)(\2)/gi, (full, attr, quote, value) => {
    const attribute = String(attr).toLowerCase();
    const safeValue = attribute === 'href' ? sanitizeLinkHref(value) : sanitizeMediaUrl(value) ?? '#';
    return ` ${attribute}=${quote}${escapeHtmlAttribute(safeValue)}${quote}`;
  });

  if (!allowRawHtml) {
    sanitized = sanitized.replaceAll(/<object\b[\s\S]*?<\/object>/gi, '');
    sanitized = sanitized.replaceAll(/<embed\b[^>]*>/gi, '');
  }

  return sanitized;
}

function sanitizeMediaUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

function sanitizeLinkHref(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return '#';
  }

  if (trimmed.startsWith('#') || trimmed.startsWith('/')) {
    return trimmed;
  }

  if (trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed;
  }

  if (trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
    return '#';
  } catch {
    return '#';
  }
}

function isAllowedEmbedUrl(url: string): boolean {
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

function replaceColumnMarkers(html: string): string {
  return html
    .replaceAll('<!--COLUMN_LIST_START-->', '<div class="column-list">')
    .replaceAll('<!--COLUMN_LIST_END-->', '</div>')
    .replaceAll('<!--COLUMN_START-->', '<div class="column">')
    .replaceAll('<!--COLUMN_END-->', '</div>');
}

function wrapTableOfContents(html: string): string {
  return html.replaceAll(
    /<(nav|div)\s+class="table-of-contents"[\s\S]*?<\/\1>/gi,
    (tocHtml) => `<details class="toc-shell"><summary>Contents</summary><div class="content"><div class="content-inner">${tocHtml}</div></div></details>`,
  );
}

function buildCss(options: ResolvedRenderOptions): string {
  const theme = options.theme;
  const themeCss = `
:root {
  --theme-h1: ${theme.h1};
  --theme-h2: ${theme.h2};
  --theme-h3: ${theme.h3};
  --page-bg: ${theme.pageBg};
  --page-card: ${theme.pageCard};
  --page-text: ${theme.pageText};
  --page-muted: ${theme.pageMuted};
  --page-line: ${theme.pageLine};
  --callout-bg: ${theme.calloutBg};
  --callout-border: ${theme.calloutBorder};
  --toc-bg: ${theme.tocBg};
  --toc-border: ${theme.tocBorder};
}`;

  return `${DEFAULT_CSS}\n${themeCss}\n${options.css ?? ''}`.trim();
}

function buildBehaviorScript(features: ResolvedFeatures): string {
  const copyCode = features.copyCode ? 'true' : 'false';

  return `<script>
(() => {
  const copyCode = ${copyCode};

  if (copyCode) {
    const codeBlocks = document.querySelectorAll('pre > code');
    codeBlocks.forEach((codeElement) => {
      const pre = codeElement.parentElement;
      if (!(pre instanceof HTMLElement)) {
        return;
      }
      if (pre.querySelector('.copy-code-button')) {
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-code-button';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        const content = codeElement.textContent ?? '';
        if (!content) {
          return;
        }

        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(content);
          } else {
            const area = document.createElement('textarea');
            area.value = content;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.focus();
            area.select();
            document.execCommand('copy');
            document.body.removeChild(area);
          }
          const previousLabel = button.textContent;
          button.textContent = 'Copied';
          window.setTimeout(() => {
            button.textContent = previousLabel ?? 'Copy';
          }, 1400);
        } catch {
          button.textContent = 'Failed';
          window.setTimeout(() => {
            button.textContent = 'Copy';
          }, 1400);
        }
      });

      pre.appendChild(button);
    });
  }

  const backToTop = document.querySelector('.back-to-top');
  if (backToTop instanceof HTMLElement) {
    const showThreshold = 300;
    let ticking = false;

    const updateVisibility = () => {
      if (window.scrollY > showThreshold) {
        backToTop.classList.add('visible');
      } else {
        backToTop.classList.remove('visible');
      }
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateVisibility);
        ticking = true;
      }
    }, { passive: true });

    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  const themeToggle = document.querySelector('.theme-toggle');
  if (themeToggle instanceof HTMLElement) {
    const html = document.documentElement;
    const storageKey = 'theme-preference';

    const getPreference = () => {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'dark' || stored === 'light') {
        return stored;
      }
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const setTheme = (theme) => {
      html.setAttribute('data-theme', theme);
      localStorage.setItem(storageKey, theme);
    };

    setTheme(getPreference());

    themeToggle.addEventListener('click', () => {
      const current = html.getAttribute('data-theme') || getPreference();
      setTheme(current === 'dark' ? 'light' : 'dark');
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem(storageKey)) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    });

    // Force animation replay on details toggle
    document.querySelectorAll('details').forEach((details) => {
      if (details.open) {
        details.classList.add('is-open');
      }
      details.addEventListener('toggle', () => {
        if (details.open) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              details.classList.add('is-open');
            });
          });
        } else {
          details.classList.remove('is-open');
        }
      });
    });
  }
})();
</script>`;
}

function resolveRenderOptions(options: RenderOptions): ResolvedRenderOptions {
  const theme = {
    ...DEFAULT_THEME,
    ...options.theme,
  };

  if (options.headingTheme) {
    if (options.headingTheme.h1) theme.h1 = options.headingTheme.h1;
    if (options.headingTheme.h2) theme.h2 = options.headingTheme.h2;
    if (options.headingTheme.h3) theme.h3 = options.headingTheme.h3;
  }

  return {
    css: options.css,
    theme,
    features: {
      stickyToc: options.features?.stickyToc ?? false,
      copyCode: options.features?.copyCode ?? true,
    },
    allowRawHtml: options.allowRawHtml ?? false,
    showGeneratedDate: options.showGeneratedDate ?? true,
  };
}

function stripHtml(value: string): string {
  return value.replaceAll(/<[^>]+>/g, '');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}
