// @vitest-environment jsdom
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

  it('normalizes known video variants into canonical embeds', async () => {
    const youtubeShorts = await renderToHtml(
      ':::video https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'YouTube Shorts',
    );
    expect(youtubeShorts).toContain('src="https://www.youtube.com/embed/dQw4w9WgXcQ"');

    const vimeoChannel = await renderToHtml(
      ':::video https://vimeo.com/channels/staffpicks/123456789',
      'Vimeo Channel',
    );
    expect(vimeoChannel).toContain('src="https://player.vimeo.com/video/123456789"');

    const vimeoPrivate = await renderToHtml(
      ':::video https://player.vimeo.com/video/123456789?h=privateToken',
      'Vimeo Private',
    );
    expect(vimeoPrivate).toContain('src="https://player.vimeo.com/video/123456789?h=privateToken"');
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

  it('ships editorial rail, calmer hero treatment, and unified panel hooks', async () => {
    const markdown = `## One\n\n### Two\n\n#### Detail Label\n\n:::callout 💡\nCallout text\n:::\n\n:::study-text\nStudy text\n:::\n\n:::toc\n\n## One`;
    const html = await renderToHtml(markdown, 'Editorial');
    expect(html).toContain('.page::before {');
    expect(html).toContain('top: var(--editorial-rail-start, 246px);');
    expect(html).toContain('.markdown-body > h2::before {');
    expect(html).toContain('@media (max-width: 959px) {');
    expect(html).toContain(
      '.callout,\n.study-text,\n.toc-shell,\n.audio-figure,\ndetails:not(.study-text) {',
    );
    expect(html).toContain('.markdown-body h4 {');
    expect(html).toContain('.markdown-body h4 .heading-text {');
    expect(html).toContain("page.style.setProperty('--editorial-rail-start'");
    expect(html).not.toContain('repeating-linear-gradient(135deg');
  });

  it('wraps table of contents in a collapsed details shell', async () => {
    const markdown = `:::toc\n\n## One\n\n## Two`;
    const html = await renderToHtml(markdown, 'Toc');
    expect(html).toContain('<details class="toc-shell"><summary>Contents</summary>');
    expect(html).toContain('class="table-of-contents"');
  });

  it('renders single-backtick snippets as code while allowing inner rich formatting', async () => {
    const markdown = `Line with \`Target_Time = 5:00 PM\` inside.
  
  \`**Bold cue:** *slowly*\``;
    const html = await renderToHtml(markdown, 'Inline Code');
    expect(html).toContain('Line with <code>Target_Time = 5:00 PM</code> inside.');
    expect(html).toContain('<code><strong>Bold cue:</strong> <em>slowly</em></code>');
  });

  it('preserves multi-backtick inline code spans', async () => {
    const markdown = 'Inline ``a`` and nested ``a `b` c`` stay as code.';
    const html = await renderToHtml(markdown, 'Inline Multi Tick');
    expect(html).toContain('<code>a</code>');
    expect(html).toContain('<code>a `b` c</code>');
  });
});
