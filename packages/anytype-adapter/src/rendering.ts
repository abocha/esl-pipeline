import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import container from 'markdown-it-container';
import toc from 'markdown-it-toc-done-right';

export interface RenderOptions {
  title?: string;
  css?: string;
  headingTheme?: {
    h1?: string;
    h2?: string;
    h3?: string;
  };
}

const DEFAULT_CSS = `
:root {
  --theme-h1: #e7def6;
  --theme-h2: #dbe6ff;
  --theme-h3: #efe3ff;
  --page-bg: #f6f2ec;
  --page-card: #ffffff;
  --page-text: #1f1f1f;
  --page-muted: #5f5f5f;
  --page-line: #e7e2d8;
  --callout-bg: #f8f5ed;
  --callout-border: #f1d6a3;
  --toc-bg: #f8f5ed;
  --toc-border: #eadfcf;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  padding: 0;
  font-family: 'Inter', 'SF Pro Text', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.6;
  color: var(--page-text);
  background: var(--page-bg);
}
.page {
  max-width: 880px;
  margin: 32px auto 64px;
  background: var(--page-card);
  border-radius: 18px;
  padding: 32px 40px 48px;
  box-shadow: 0 14px 32px rgba(40, 30, 18, 0.08);
}
.page-header {
  margin-bottom: 20px;
}
.page-icon {
  font-size: 40px;
  line-height: 1;
  margin-bottom: 8px;
}
.page-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.tag {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: #efe8dd;
  color: var(--page-text);
  font-size: 13px;
  font-weight: 600;
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3 {
  display: block;
  margin: 0;
  padding: 0;
  letter-spacing: -0.01em;
  line-height: 1.3;
}
.markdown-body h1 {
  font-size: 34px;
  margin: 0 0 12px;
  letter-spacing: -0.02em;
}
.markdown-body h2 {
  font-size: 22px;
  margin: 26px 0 12px;
}
.markdown-body h3 {
  font-size: 18px;
  margin: 20px 0 10px;
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
  color: var(--theme-h2);
  text-decoration: none;
}
.markdown-body a:hover {
  text-decoration: underline;
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
.markdown-body audio {
  width: 100%;
  margin: 12px 0 20px;
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
  background: #f8f5ed;
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--page-line);
  margin: 16px 0;
}
.study-text summary {
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--page-muted);
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 8px;
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
.column { flex: 1; min-width: 240px; }
.video-embed { position: relative; padding-top: 56.25%; margin: 16px 0; }
.video-embed iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; }
.table-of-contents {
  background: var(--toc-bg);
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--toc-border);
  margin: 16px 0;
  color: var(--page-muted);
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
  color: var(--page-muted);
}
.table-of-contents a:hover {
  color: var(--page-text);
}
details:not(.study-text) {
  margin: 12px 0;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--page-line);
  background: #fbf8f1;
}
details:not(.study-text) summary {
  cursor: pointer;
  font-weight: 600;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0 18px;
  font-size: 14px;
}
th,
td {
  border: 1px solid var(--page-line);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}
th {
  background: #f4efe6;
  font-weight: 600;
}
`;

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;
type ContainerPlugin = (md: MarkdownItInstance, name: string, options: unknown) => void;

export async function renderToHtml(markdown: string, title: string, options: RenderOptions = {}): Promise<string> {
  const md = createRenderer();
  const frontmatter = extractFrontmatter(markdown);
  const resolvedTitle = resolveTitle(markdown, title, frontmatter);
  const prepared = preprocessMarkdown(markdown);
  const bodyHtml = replaceColumnMarkers(md.render(prepared));
  const css = buildCss(options);
  const withAudio = replaceAudioLinks(bodyHtml);
  const header = renderHeader(resolvedTitle, frontmatter);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(resolvedTitle)}</title>
  <style>${css}</style>
</head>
<body class="markdown-body">
  <div class="page markdown-body">
    ${header}
    ${withAudio}
  </div>
</body>
</html>`;
}

export async function createStaticPageHtml(markdown: string, title: string, options: RenderOptions = {}): Promise<string> {
  return renderToHtml(markdown, title, options);
}

function createRenderer(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
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
        return `<details><summary>${escapeHtml(label)}</summary>`;
      }
      return '</details>';
    },
  });

  md.use(containerPlugin, 'callout', {
    validate: (params: string) => params.trim().startsWith('callout '),
    render: (tokens: { info?: string; nesting?: number }[], idx: number) => {
      const info = tokens[idx]?.info?.trim() ?? '';
      const match = /^callout\s+(.*)$/.exec(info);
      const icon = match?.[1] ?? '💡';
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
      const title = label ? `Study Text: ${label}` : 'Study Text';
      if (tokens[idx]?.nesting === 1) {
        return `<details class="study-text"><summary>${escapeHtml(title)}</summary><div class="content">`;
      }
      return '</div></details>';
    },
  });

  md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
    const rendered = self.renderToken(tokens, idx, options);
    return `${rendered}<span class="heading-text">`;
  };

  md.renderer.rules.heading_close = (tokens, idx, options, _env, self) => {
    const rendered = self.renderToken(tokens, idx, options);
    return `</span>${rendered}`;
  };

  return md;
}

function preprocessMarkdown(markdown: string): string {
  const withoutFrontmatter = stripFrontmatter(markdown);
  const lines = withoutFrontmatter.split('\n');
  const out: string[] = [];
  const stack: string[] = [];

  for (const line of lines) {
    const normalizedLine = normalizeDirectiveLine(line);
    const trimmed = normalizedLine.trim();

    if (/^:::\s*toc$/.test(trimmed)) {
      out.push('[[toc]]');
      continue;
    }
    if (/^:::\s*audio\s+/.test(trimmed)) {
      const url = trimmed.replace(/^:::\s*audio\s+/, '').trim();
      out.push(`<audio controls src="${url}"></audio>`);
      continue;
    }
    if (/^:::\s*video\s+/.test(trimmed)) {
      const url = trimmed.replace(/^:::\s*video\s+/, '').trim();
      out.push(buildVideoEmbed(url));
      continue;
    }

    const openMatch = /^:::\s*([A-Za-z0-9_-]+)\b/.exec(trimmed);
    if (openMatch) {
      const name = openMatch[1] ?? '';
      if (!name) {
        out.push(normalizedLine);
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

    out.push(normalizedLine);
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

function renderHeader(title: string, frontmatter?: Frontmatter): string {
  const icon = frontmatter?.icon ? `<div class="page-icon">${escapeHtml(frontmatter.icon)}</div>` : '';
  const tags = [formatCurrentDate()];
  if (frontmatter?.student) tags.push(frontmatter.student);
  if (frontmatter?.topic) tags.push(frontmatter.topic);
  const tagHtml =
    tags.length > 0
      ? `<div class="page-tags">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';

  return `<header class="page-header">${icon}<h1><span class="heading-text">${escapeHtml(
    title,
  )}</span></h1>${tagHtml}</header>`;
}

function formatCurrentDate(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
}

function buildVideoEmbed(url: string): string {
  const normalized = url.trim();
  const youtubeId = extractYouTubeId(normalized);
  if (youtubeId) {
    return `<div class="video-embed"><iframe src="https://www.youtube.com/embed/${youtubeId}" allowfullscreen></iframe></div>`;
  }
  const vimeoId = extractVimeoId(normalized);
  if (vimeoId) {
    return `<div class="video-embed"><iframe src="https://player.vimeo.com/video/${vimeoId}" allowfullscreen></iframe></div>`;
  }
  return `<div class="video-embed"><iframe src="${normalized}" allowfullscreen></iframe></div>`;
}

function extractYouTubeId(url: string): string | null {
  const match = /(?:v=|youtu.be\/)([\w-]{6,})/.exec(url);
  return match?.[1] ?? null;
}

function extractVimeoId(url: string): string | null {
  const match = /vimeo\.com\/(\d+)/.exec(url);
  return match?.[1] ?? null;
}

function replaceAudioLinks(html: string): string {
  return html.replaceAll(/<a\s+href="([^"]+\.(?:mp3|wav|m4a|aac|ogg|opus))"[^>]*>.*?<\/a>/gi, (_match, url) => {
    return `<audio controls src="${url}"></audio>`;
  });
}

function replaceColumnMarkers(html: string): string {
  return html
    .replaceAll('<!--COLUMN_LIST_START-->', '<div class="column-list">')
    .replaceAll('<!--COLUMN_LIST_END-->', '</div>')
    .replaceAll('<!--COLUMN_START-->', '<div class="column">')
    .replaceAll('<!--COLUMN_END-->', '</div>');
}

function buildCss(options: RenderOptions): string {
  const theme = options.headingTheme ?? {};
  const themeCss = [
    theme.h1 ? `--theme-h1: ${theme.h1};` : '',
    theme.h2 ? `--theme-h2: ${theme.h2};` : '',
    theme.h3 ? `--theme-h3: ${theme.h3};` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return `${DEFAULT_CSS}\n:root {${themeCss}}\n${options.css ?? ''}`.trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
