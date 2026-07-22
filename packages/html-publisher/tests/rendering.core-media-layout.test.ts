// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { createStaticPageHtml, renderToHtml } from '../src/rendering.js';
import { createRenderedDocument } from './rendering.test-harness.js';

describe('rendering', () => {
  it('renders toggles and audio links', async () => {
    const markdown = `# Title\n\n::: toggle Reveal answer\nAnswer is 42.\n:::\n\n[Audio](https://example.com/audio.mp3)`;
    const html = await renderToHtml(markdown, 'Lesson');
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>Reveal answer</summary>');
    expect(html).toContain('<figure class="audio-figure">');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('data-audio-fallback="true"');
    expect(html).toContain('details > .content {');
    expect(html).toContain('overflow: hidden;');
    expect(html).toContain('.content-inner {');
    expect(html).toContain('min-height: 0;');
    expect(html).toContain('overflow: hidden;');
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

  it('uses Calm Studio-derived default colors in light and dark themes', async () => {
    const html = await renderToHtml('## Practice\n\nStudent content.', 'Calm handout');

    expect(html).toContain('--page-bg: #fafbfc;');
    expect(html).toContain('--page-text: #1d2935;');
    expect(html).toContain('--page-muted: #596777;');
    expect(html).toContain('--page-line: #d6dde4;');
    expect(html).toContain('--audio-accent: #214f80;');
    expect(html).toContain('--link: #214f80;');
    expect(html).toContain('--page-bg: #17212b;');
    expect(html).toContain('--page-card: #202c37;');
    expect(html).toContain('--toc-link: #9fc3e8;');
    expect(html).toContain('--link: #9fc3e8;');
    expect(html).toContain('color: var(--link);');
    expect(html).toContain('outline: 3px solid var(--focus-color);');
    expect(html).not.toContain('--page-bg: #f5f1e8;');
    expect(html).not.toContain('--page-bg: #1a1714;');
  });

  it('keeps light-theme list markers and inline code distinct on tinted surfaces', async () => {
    const markdown = `:::callout 💡\n1. Read the \`target phrase\`.\n\n- Repeat it aloud.\n:::`;
    const html = await renderToHtml(markdown, 'Readable lesson details');
    const markerRule = html.match(/\.markdown-body li::marker\s*\{([\s\S]*?)\n\}/)?.[1];
    const inlineCodeRule = html.match(
      /\.markdown-body p code,[\s\S]*?\.markdown-body h4 code\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(markerRule).toContain('color: var(--page-muted);');
    expect(html).toContain('--inline-code-bg: #e1e9f1;');
    expect(html).toContain('--inline-code-border: #b5c5d4;');
    expect(html).toContain('--inline-code-border: #3b4a58;');
    expect(inlineCodeRule).toContain('background: var(--inline-code-bg);');
    expect(inlineCodeRule).toContain('box-shadow: inset 0 0 0 1px var(--inline-code-border);');
  });

  it('uses editorial headings and a flat grammar comparison', async () => {
    const html = await renderToHtml(
      '## Toolkit\n\n### Grammar\n\n:::column-list\n:::column\nOne\n:::\n:::column\nTwo\n:::\n:::',
      'Editorial hierarchy',
    );
    const levelTwoHeadingRule = html.match(
      /\.markdown-body h2 \.heading-text\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    const levelThreeHeadingRule = html.match(
      /\.markdown-body h3 \.heading-text\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    const grammarMatrixRule = html.match(
      /\.column-list\.grammar-matrix-grid\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(levelTwoHeadingRule).toContain('background: transparent;');
    expect(levelTwoHeadingRule).toContain('border: 0;');
    expect(levelThreeHeadingRule).toContain('background: transparent;');
    expect(levelThreeHeadingRule).toContain('border: 0;');
    expect(grammarMatrixRule).toContain('padding: 0;');
    expect(grammarMatrixRule).toContain('border: 0;');
    expect(grammarMatrixRule).toContain('background: transparent;');
    expect(html).not.toContain('border-left: 5px solid var(--audio-accent);');
  });

  it('uses a compact hierarchical desktop table of contents with touch-friendly mobile links', async () => {
    const html = await renderToHtml(
      ':::toc\n\n## One\n\n### One detail\n\n## Two',
      'Disclosure controls',
    );
    const disclosureRule = html.match(
      /\.study-text summary,[\s\S]*?details:not\(\.study-text\) summary\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    const tocLinkRule = html.match(/\.table-of-contents a\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(html).toContain('<summary>Jump to section</summary>');
    expect(disclosureRule).toContain('font-size: 14px;');
    expect(disclosureRule).toContain('letter-spacing: 0;');
    expect(disclosureRule).toContain('text-transform: none;');
    expect(disclosureRule).toContain('min-height: 44px;');
    expect(tocLinkRule).toContain('min-height: 32px;');
    expect(tocLinkRule).toContain('padding: 4px 0;');
    expect(html).toContain('.table-of-contents ul ul {\n  padding-left: 20px;');
    expect(html).toContain(
      '@media (max-width: 840px) {\n  .table-of-contents a {\n    min-height: 44px;\n    padding: 8px 0;\n  }',
    );
  });

  it('keeps details open until the closing transition finishes', async () => {
    const html = await renderToHtml(':::toc\n\n## One\n\n### One detail', 'Disclosure motion');
    const renderedDocument = createRenderedDocument(html);
    const details = renderedDocument.querySelector('details.toc-shell');
    const summary = details?.querySelector(':scope > summary');
    const content = details?.querySelector(':scope > .content');

    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect(summary).toBeInstanceOf(HTMLElement);
    expect(content).toBeInstanceOf(HTMLElement);

    summary?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect((details as HTMLDetailsElement).open).toBe(true);
    expect(details?.classList.contains('is-open')).toBe(true);

    summary?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect((details as HTMLDetailsElement).open).toBe(true);
    expect(details?.classList.contains('is-open')).toBe(false);

    const transitionEnd = new Event('transitionend', { bubbles: true });
    Object.defineProperty(transitionEnd, 'propertyName', { value: 'grid-template-rows' });
    content?.dispatchEvent(transitionEnd);

    expect((details as HTMLDetailsElement).open).toBe(false);
  });

  it('honors reduced motion and keeps fixed controls touch-friendly', async () => {
    const html = await renderToHtml('## Practice', 'Motion preferences');
    const themeToggleRule = html.match(/\.theme-toggle\s*\{([\s\S]*?)\n\}/)?.[1];
    const detailsContentRule = html.match(/details > \.content\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(themeToggleRule).toContain('width: 44px;');
    expect(themeToggleRule).toContain('height: 44px;');
    expect(detailsContentRule).not.toContain('padding 0.3s ease');
    expect(html).toContain('@media (prefers-reduced-motion: reduce) {');
    expect(html).toContain('scroll-behavior: auto;');
  });

  it('balances desktop gutters and aligns the editorial rail markers', async () => {
    const html = await renderToHtml('## Practice', 'Balanced page');
    const pageRule = html.match(/\.page\s*\{([\s\S]*?)\n\}/)?.[1];
    const railRule = html.match(/\.page::before\s*\{([\s\S]*?)\n\}/)?.[1];
    const markerRule = html.match(/\.markdown-body > h2::before\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(pageRule).toContain('padding: 28px 52px 48px 72px;');
    expect(railRule).toContain('left: 36px;');
    expect(markerRule).toContain('left: -21px;');
  });

  it('avoids pill-shaped multi-line metadata on mobile', async () => {
    const html = await renderToHtml('## Practice', 'Responsive metadata');

    expect(html).toContain('.tag {\n    border-radius: 8px;\n    line-height: 1.35;\n  }');
  });

  it('keeps only the structural editorial-rail gradient', async () => {
    const html = await renderToHtml(
      ':::toc\n\n## Practice\n\n:::callout 💡\nTry one example.\n:::',
      'Flat handout',
    );
    const gradients = html.match(/(?:linear|radial)-gradient\(/g) ?? [];
    const editorialRailRule = html.match(/\.page::before\s*\{([\s\S]*?)\n\}/)?.[1];
    const levelTwoMarkerRule = html.match(/\.markdown-body > h2::before\s*\{([\s\S]*?)\n\}/)?.[1];
    const levelTwoHeadingRule = html.match(
      /\.markdown-body h2 \.heading-text\s*\{([\s\S]*?)\n\}/,
    )?.[1];

    expect(gradients).toHaveLength(1);
    expect(editorialRailRule).toContain('linear-gradient(');
    expect(levelTwoMarkerRule).toContain('border-radius: 999px;');
    expect(levelTwoHeadingRule).toContain('background: transparent;');
    expect(html).toContain('border-radius: 12px;');
    expect(html).not.toContain('border-radius: 14px;');
    expect(html).not.toContain('border-radius: 16px;');
    expect(html).not.toContain('border-radius: 18px;');
    expect(html).not.toContain('0 18px 42px');
  });

  it('wraps table of contents in a collapsed details shell', async () => {
    const markdown = `:::toc\n\n## One\n\n## Two`;
    const html = await renderToHtml(markdown, 'Toc');
    expect(html).toContain('<details class="toc-shell"><summary>Jump to section</summary>');
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
