import { describe, expect, it } from 'vitest';

import { renderToHtml } from '../src/rendering.js';

describe('rendering', () => {
  it('renders toggles and audio links', async () => {
    const markdown = `# Title\n\n::: toggle Reveal answer\nAnswer is 42.\n:::\n\n[Audio](https://example.com/audio.mp3)`;
    const html = await renderToHtml(markdown, 'Lesson');
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>Reveal answer</summary>');
    expect(html).toContain('<audio controls src="https://example.com/audio.mp3"></audio>');
  });

  it('renders video directive', async () => {
    const markdown = `:::video https://youtu.be/dQw4w9WgXcQ`;
    const html = await renderToHtml(markdown, 'Video');
    expect(html).toContain('youtube.com/embed');
  });
});
