import { describe, expect, it } from 'vitest';

import { createStaticPageHtml, renderToHtml } from '../src/rendering.js';

describe('rendering', () => {
  it('renders toggles and audio links', async () => {
    const markdown = `# Title\n\n::: toggle Reveal answer\nAnswer is 42.\n:::\n\n[Audio](https://example.com/audio.mp3)`;
    const html = await renderToHtml(markdown, 'Lesson');
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>Reveal answer</summary>');
    expect(html).toContain('<figure class="audio-figure">');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('data-audio-fallback="true"');
  });

  it('renders video directive', async () => {
    const markdown = `:::video https://youtu.be/dQw4w9WgXcQ`;
    const html = await renderToHtml(markdown, 'Video');
    expect(html).toContain('youtube.com/embed');
  });

  it('keeps columns and inner formatting intact', async () => {
    const markdown = `## Section\n\n:::column-list\n:::column\n**Bold** *Italic*\n\n:::callout 💡\nCallout text\n:::\n\n:::\n:::column\nLine two\n:::\n:::`;
    const html = await renderToHtml(markdown, 'Columns');
    expect(html).toContain('<div class="column-list">');
    expect(html).toContain('<div class="column">');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<em>Italic</em>');
    expect(html).toContain('<aside class="callout">');
    expect(html).not.toContain('<p>:::</p>');
  });

  it('renders preview and main renderer consistently', async () => {
    const markdown = `---\ntitle: \"Homework Assignment: Demo\"\nstudent: \"Vadim\"\ntopic: \"Past Continuous\"\nicon: ⏳\n---\n\n## A Title`;
    const html = await renderToHtml(markdown, '');
    const preview = await createStaticPageHtml(markdown, '');
    expect(preview).toEqual(html);
    expect(html).toContain('Homework Assignment: Demo');
    expect(html).toContain('<span class="tag">Vadim</span>');
  });

  it('does not process column directives inside fenced code blocks', async () => {
    const markdown = `\`\`\`\n:::column-list\n:::column\ncontent\n:::\n:::\n\`\`\``;
    const html = await renderToHtml(markdown, 'Fence');
    expect(html).toContain('::: column-list');
    expect(html).not.toContain('<div class="column-list">');
    expect(html).not.toContain('<!--COLUMN_LIST_START-->');
  });

  it('treats single line breaks as soft breaks', async () => {
    const markdown = `Line one\nLine two\n\nLine three`;
    const html = await renderToHtml(markdown, 'Breaks');
    expect(html).toContain('Line one<br>');
    expect(html).toContain('Line two');
    expect(html).toContain('<p>Line three</p>');
  });

  it('renders rich header without skip link or study controls', async () => {
    const markdown = `---\nicon: \"🎯\"\n---\n\n# Demo\n\n:::study-text\nHello\n:::\n\n\`\`\`ts\nconst x = 1;\n\`\`\``;
    const html = await renderToHtml(markdown, 'Accessibility');
    expect(html).toContain('<main id="content"');
    expect(html).toContain('class="hero"');
    expect(html).toContain('class="hero-emoji"');
    expect(html).not.toContain('class="skip-link"');
    expect(html).not.toContain('data-study-controls');
    expect(html).toContain('copy-code-button');
  });

  it('wraps table of contents in a collapsed details shell', async () => {
    const markdown = `:::toc\n\n## One\n\n## Two`;
    const html = await renderToHtml(markdown, 'Toc');
    expect(html).toContain('<details class="toc-shell"><summary>Contents</summary>');
    expect(html).toContain('class="table-of-contents"');
  });

  it('styles inline code as soft pills without borders', async () => {
    const markdown = `Line with \`Target_Time = 5:00 PM\` inside.`;
    const html = await renderToHtml(markdown, 'Inline Code');
    expect(html).toContain('Line with <code>Target_Time = 5:00 PM</code> inside.');
    expect(html).toContain('.markdown-body p code');
    expect(html).toContain('background: var(--inline-code-bg);');
    expect(html).toContain('border-radius: 7px;');
  });

  it('styles table headers with theme variables for dark mode compatibility', async () => {
    const markdown = `| H1 | H2 |\n| --- | --- |\n| A | B |`;
    const html = await renderToHtml(markdown, 'Table');
    expect(html).toContain('--table-head-bg: color-mix');
    expect(html).toContain('th {\n  background: var(--table-head-bg);');
    expect(html).not.toContain('background: #f4efe6;');
  });

  it('escapes raw html by default but allows it when opted in', async () => {
    const markdown = `<script>alert(\"x\")</script>\n<div>Unsafe block</div>`;
    const safeHtml = await renderToHtml(markdown, 'Safe');
    const rawHtml = await renderToHtml(markdown, 'Raw', { allowRawHtml: true });

    expect(safeHtml).not.toContain('<script>alert("x")</script>');
    expect(safeHtml).toContain('&lt;div&gt;Unsafe block&lt;/div&gt;');
    expect(rawHtml).toContain('<div>Unsafe block</div>');
  });

  it('allows hiding generated date tag', async () => {
    const markdown = `---\nstudent: \"Nika\"\n---\n\n# Lesson`;
    const html = await renderToHtml(markdown, 'No Date', { showGeneratedDate: false });
    expect(html).toContain('<span class="tag">Nika</span>');
    expect(html).not.toContain(formatCurrentDateForAssertion());
  });
});

function formatCurrentDateForAssertion(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
}
