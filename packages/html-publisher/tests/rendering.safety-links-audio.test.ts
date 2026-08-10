// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderToHtml } from '../src/rendering.js';
import { formatCurrentDateForAssertion } from './rendering.test-harness.js';

describe('rendering', () => {
  it('escapes raw html by default but allows it when opted in', async () => {
    const markdown = `<script>alert(\"x\")</script>\n<div>Unsafe block</div>`;
    const safeHtml = await renderToHtml(markdown, 'Safe');
    const rawHtml = await renderToHtml(markdown, 'Raw', { allowRawHtml: true });

    expect(safeHtml).not.toContain('<script>alert("x")</script>');
    expect(safeHtml).toContain('&lt;div&gt;Unsafe block&lt;/div&gt;');
    expect(rawHtml).toContain('<div>Unsafe block</div>');
  });

  it('preserves safe relative links and source URLs', async () => {
    const markdown = `[Lesson 2](lesson-2.md)\n\n![Alt](images/pic.png)`;
    const html = await renderToHtml(markdown, 'Relative Urls');
    expect(html).toContain('<a href="lesson-2.md">Lesson 2</a>');
    expect(html).toContain('<img src="images/pic.png" alt="Alt">');
  });

  it('preserves fuzzy bare-domain linkification', async () => {
    const html = await renderToHtml('Visit example.com for details.', 'Fuzzy URL');

    expect(html).toContain('<a href="http://example.com/">example.com</a>');
  });

  it('preserves explicit URL linkification', async () => {
    const html = await renderToHtml('Visit https://example.com for details.', 'Explicit URL');

    expect(html).toContain('<a href="https://example.com/">https://example.com</a>');
  });

  it('keeps unsafe javascript links blocked while preserving safe relatives', async () => {
    const markdown = `<a href="javascript:alert(1)">Unsafe</a>\n\n[Safe](./lesson-2.md)`;
    const html = await renderToHtml(markdown, 'Href Sanitization', { allowRawHtml: true });
    expect(html).toContain('<a href="#">Unsafe</a>');
    expect(html).toContain('<a href="./lesson-2.md">Safe</a>');
  });

  it('renders relative audio paths and fragment timestamp links as audio figures', async () => {
    const directiveHtml = await renderToHtml(':::audio audio.mp3', 'Directive Audio');
    expect(directiveHtml).toContain('class="audio-figure"');
    expect(directiveHtml).toContain('src="audio.mp3"');
    expect(directiveHtml).not.toContain('Audio track generating...');

    const relativeLinkHtml = await renderToHtml('[Audio](audio/clip.mp3)', 'Relative Audio Link');
    expect(relativeLinkHtml).toContain('class="audio-figure"');
    expect(relativeLinkHtml).toContain('src="audio/clip.mp3"');

    const timestampLinkHtml = await renderToHtml(
      '[Audio](https://example.com/clip.mp3#t=10)',
      'Timestamp Audio Link',
    );
    expect(timestampLinkHtml).toContain('class="audio-figure"');
    expect(timestampLinkHtml).toContain('src="https://example.com/clip.mp3#t=10"');
  });

  it('allows hiding generated date tag', async () => {
    const markdown = `---\nstudent: \"Nika\"\n---\n\n# Lesson`;
    const html = await renderToHtml(markdown, 'No Date', { showGeneratedDate: false });
    expect(html).toContain('<span class="tag">Nika</span>');
    expect(html).not.toContain(formatCurrentDateForAssertion());
  });
});
