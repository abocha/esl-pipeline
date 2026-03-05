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
    expect(vimeoPrivate).toContain(
      'src="https://player.vimeo.com/video/123456789?h=privateToken"',
    );
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

  it('normalizes bullet-number lines into ordered lists', async () => {
    const markdown = `### A. Controlled Practice

*   1. Please ____ the coffee beans.
*   2. I ____ eating raisins.`;
    const html = await renderToHtml(markdown, 'List Normalize');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>Please ____ the coffee beans.</li>');
    expect(html).toContain('<li>I ____ eating raisins.</li>');
    expect(html).not.toContain('<li>1. Please ____ the coffee beans.</li>');
  });

  it('renders task-list markers as interactive checklist inputs', async () => {
    const markdown = `- **Checklist:**
  - [ ] Introduce the institution with "**the**" (e.g., *the bank*).
  - [x] Use the phrase "**had problems [doing something]**".`;
    const html = await renderToHtml(markdown, 'Checklist');

    expect(html).toContain('class="task-list"');
    expect(html).toContain('class="task-list-item"');
    expect(html).toContain('<input type="checkbox" class="task-list-item-checkbox">');
    expect(html).toContain('<input type="checkbox" class="task-list-item-checkbox" checked>');
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('[ ] Introduce the institution');
    expect(html).not.toContain('[x] Use the phrase');
    expect(html).toContain('<strong>the</strong>');
  });

  it('preserves non-task sibling list items in mixed lists', async () => {
    const markdown = `- [ ] task item
- plain item`;
    const html = await renderToHtml(markdown, 'Mixed Checklist');
    const checkboxCount = (html.match(/<input type="checkbox"/g) ?? []).length;

    expect(checkboxCount).toBe(1);
    expect(html).toContain('<ul class="task-list">');
    expect(html).toContain('<li>plain item</li>');
    expect(html).not.toContain('.markdown-body ul.task-list,\n.markdown-body ol.task-list');
  });

  it('only converts task markers in a list item lead paragraph', async () => {
    const markdown = `- [ ] Task lead paragraph.

  [x] Continuation paragraph should remain literal.

- [x] Separate task item.`;
    const html = await renderToHtml(markdown, 'Lead Paragraph Checklist');
    const checkboxCount = (html.match(/<input type="checkbox"/g) ?? []).length;

    expect(checkboxCount).toBe(2);
    expect(html).toContain('[x] Continuation paragraph should remain literal.');
    expect(html).not.toContain(
      '<input type="checkbox" class="task-list-item-checkbox"> Continuation paragraph should remain literal.',
    );
  });

  it('does not convert task markers inside fenced code blocks', async () => {
    const markdown = `\`\`\`markdown
- [ ] keep this literal
\`\`\`

- [ ] convert this`;
    const html = await renderToHtml(markdown, 'Checklist Fence');
    const checkboxCount = (html.match(/<input type="checkbox"/g) ?? []).length;

    expect(checkboxCount).toBe(1);
    expect(html).toContain('- [ ] keep this literal');
    expect(html).toContain('<input type="checkbox" class="task-list-item-checkbox">');
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

  it('styles table headers with theme variables for dark mode compatibility', async () => {
    const markdown = `| H1 | H2 |\n| --- | --- |\n| A | B |`;
    const html = await renderToHtml(markdown, 'Table');
    expect(html).toContain('--table-head-bg: color-mix');
    expect(html).toContain('th {\n  background: var(--table-head-bg);');
    expect(html).not.toContain('background: #f4efe6;');
  });

  it('applies grammar matrix styling only to Notice the Grammar column-list blocks', async () => {
    const markdown = `### A. 👀 Notice the Grammar

:::column-list
:::column
One
:::
:::column
Two
:::
:::`;
    const html = await renderToHtml(markdown, 'Grammar');
    expect(html).toContain('<div class="column-list grammar-matrix-grid">');
  });

  it('leaves other column-list blocks unscoped', async () => {
    const markdown = `### A. Different Section

:::column-list
:::column
One
:::
:::column
Two
:::
:::`;
    const html = await renderToHtml(markdown, 'General Columns');
    expect(html).toContain('<div class="column-list">');
    expect(html).not.toContain('<div class="column-list grammar-matrix-grid">');
  });

  it('promotes the first useful chunks table row to a header when needed', async () => {
    const markdown = `### B. 🗣️ Useful Chunks & Vocabulary

<table>
<tr><td>Term</td><td>Meaning &amp; Context</td></tr>
<tr><td>freeze</td><td>when the app stops moving</td></tr>
</table>`;
    const html = await renderToHtml(markdown, 'Useful Chunks', { allowRawHtml: true });

    expect(html).toContain('<th scope="col">Term</th>');
    expect(html).toContain('<th scope="col">Meaning &amp; Context</th>');
    expect(html).toContain('<td>freeze</td>');
  });

  it('keeps non-useful-chunks raw tables unchanged', async () => {
    const markdown = `### A. 👀 Notice the Grammar

<table>
<tr><td>Example</td><td>Value</td></tr>
<tr><td>one</td><td>two</td></tr>
</table>`;
    const html = await renderToHtml(markdown, 'Grammar Table', { allowRawHtml: true });

    expect(html).toContain('<td>Example</td>');
    expect(html).not.toContain('<th scope="col">Example</th>');
  });

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

  it('ships browser word-level pronunciation controls for shadow_sentence mode', async () => {
    const markdown = `### C. Pronunciation Micro-Focus

**Mode:** shadow_sentence
**Shadow sentence:** The weather was unexpectedly warm.

1. weather — /ˈweð.ər/
2. unexpectedly — /ˌʌn.ɪkˈspek.tɪd.li/
3. warm — /wɔːrm/`;
    const html = await renderToHtml(markdown, 'Pronunciation');
    expect(html).toContain('.word-tts-button');
    expect(html).toContain('.pronunciation-word-tts');
    expect(html).toContain('shadow_sentence');
    expect(html).toContain('speechSynthesis');
  });

  it('ships browser connected-speech playback controls', async () => {
    const markdown = `### C. Pronunciation Micro-Focus

**Mode:** connected_speech

1. "Change helps us." -> Change help-sus.
2. "It gives us food." -> It give-sus food.
3. "Light feels stronger." -> Light feel-stronger.`;
    const html = await renderToHtml(markdown, 'Connected Speech');
    expect(html).toContain('connected_speech');
    expect(html).toContain('Play connected speech line');
  });

  it('emits a parseable behavior script', async () => {
    const html = await renderToHtml('### C. Pronunciation Micro-Focus', 'Script Parse');
    const scriptMatch = html.match(/<script>\n([\s\S]*?)<\/script>/);
    expect(scriptMatch?.[1]).toBeTruthy();
    expect(scriptMatch?.[1]).toContain('theme-preference');
    expect(scriptMatch?.[1]).toContain('speechSynthesis');
    expect(() => new Function(scriptMatch?.[1] ?? '')).not.toThrow();
  });

  it('normalizes LLM-variant pronunciation markup for clean rendering', async () => {
    const markdown = `### C. Pronunciation Micro-Focus

:::callout 🗣️
- \`**Mode:** shadow_sentence\`
- \`**Shadow sentence:** There was a flood, so the vehicle stopped working.\`
- 1. \`Flood\` — /flʌd/
- 2. \`Vehicle\` — /viːɪkl/
- 3. \`Stopped\` — /stɒpt/ (End with T sound)
:::`;
    const html = await renderToHtml(markdown, 'Pronunciation Variant');
    expect(html).toContain('<strong>Shadow sentence:</strong>');
    expect(html).not.toContain('<code>**Shadow sentence:**');
    expect(html).not.toContain('?.[');
  });
});

function formatCurrentDateForAssertion(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());
}
