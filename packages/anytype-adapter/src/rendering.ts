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
  --theme-h1: #1b1b1d;
  --theme-h2: #2b51ff;
  --theme-h3: #6c4fa3;
}
body {
  max-width: 860px;
  margin: 0 auto;
  padding: 24px;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  line-height: 1.6;
  color: #1b1b1d;
  background: #fdfbf7;
}
.markdown-body h1 { color: var(--theme-h1); }
.markdown-body h2 { color: var(--theme-h2); }
.markdown-body h3 { color: var(--theme-h3); }
.markdown-body audio { width: 100%; margin: 12px 0; }
.callout { background: #f2f2f2; padding: 16px; border-radius: 8px; display: flex; gap: 12px; }
.callout .icon { font-size: 24px; }
.column-list { display: flex; gap: 20px; flex-wrap: wrap; }
.column { flex: 1; min-width: 240px; }
.video-embed { position: relative; padding-top: 56.25%; margin: 16px 0; }
.video-embed iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; }
.table-of-contents { background: #fafafa; padding: 16px; border-radius: 8px; }
.table-of-contents ul { list-style: none; padding-left: 0; }
`;

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;
type ContainerPlugin = (md: MarkdownItInstance, name: string, options: unknown) => void;

export async function renderToHtml(markdown: string, title: string, options: RenderOptions = {}): Promise<string> {
  const md = createRenderer();
  const prepared = preprocessMarkdown(markdown);
  const bodyHtml = md.render(prepared);
  const css = buildCss(options);
  const withAudio = replaceAudioLinks(bodyHtml);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${css}</style>
</head>
<body class="markdown-body">
  <h1>${escapeHtml(title)}</h1>
  ${withAudio}
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

  md.use(containerPlugin, 'column-list', {
    validate: (params: string) => params.trim() === 'column-list',
    render: (tokens: { nesting?: number }[], idx: number) =>
      tokens[idx]?.nesting === 1 ? '<div class="column-list">' : '</div>',
  });

  md.use(containerPlugin, 'column', {
    validate: (params: string) => params.trim() === 'column',
    render: (tokens: { nesting?: number }[], idx: number) =>
      tokens[idx]?.nesting === 1 ? '<div class="column">' : '</div>',
  });

  return md;
}

function preprocessMarkdown(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed === ':::toc') return '[[toc]]';
      if (trimmed.startsWith(':::audio ')) {
        const url = trimmed.replace(':::audio', '').trim();
        return `<audio controls src="${url}"></audio>`;
      }
      if (trimmed.startsWith(':::video ')) {
        const url = trimmed.replace(':::video', '').trim();
        return buildVideoEmbed(url);
      }
      return line;
    })
    .join('\n');
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
