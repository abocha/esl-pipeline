// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderToHtml } from '../src/rendering.js';
import { createRenderedDocument } from './rendering.test-harness.js';

describe('rendering', () => {
  it('styles table headers with theme variables for dark mode compatibility', async () => {
    const markdown = `| H1 | H2 |\n| --- | --- |\n| A | B |`;
    const html = await renderToHtml(markdown, 'Table');
    expect(html).toContain('--table-head-bg: color-mix');
    expect(html).toContain('th {\n  background: var(--table-head-bg);');
    expect(html).toContain('table-layout: auto;');
    expect(html).toContain('.markdown-body table[data-balanced-columns="true"]');
    expect(html).toContain('table-layout: fixed;');
    expect(html).toContain('white-space: normal;');
    expect(html).toContain('overflow-wrap: anywhere;');
    expect(html).toContain('width: max-content;');
    expect(html).toContain('data-table-archetype="glossary_2col"');
    expect(html).toContain('data-col-role="meaning"');
    expect(html).toContain('text-wrap: pretty;');
    expect(html).not.toContain('th:first-child');
    expect(html).not.toContain('background: #f4efe6;');
  });

  it('renders literal <br> markers inside markdown table cells as line breaks', async () => {
    const markdown = `| Phrase | Meaning |
  | --- | --- |
  | Do vs. Make | Do = execute.<br>Make = create. |`;
    const html = await renderToHtml(markdown, 'Table Breaks');
    expect(html).toContain('<td>Do = execute.<br>Make = create.</td>');
    expect(html).not.toContain('&lt;br&gt;');
  });

  it('ships hybrid archetype-aware table balancing hooks', async () => {
    const markdown = `| Word | Real English Meaning | Structural Formula | Example from Text |
  | :--- | :--- | :--- | :--- |
  | **A way / An option** 🛠️ | A method or path to solve a problem. | **Problem + Brain = Way** | "I couldn't find **a way** to solve the problem." |`;
    const html = await renderToHtml(markdown, 'Instructional Table');
    const scriptMatch = html.match(/<script>\n([\s\S]*?)<\/script>/);

    expect(scriptMatch?.[1]).toContain('glossary_2col');
    expect(scriptMatch?.[1]).toContain('vocab_3col');
    expect(scriptMatch?.[1]).toContain('long_meaning_3col');
    expect(scriptMatch?.[1]).toContain('instructional_4col');
    expect(scriptMatch?.[1]).toContain('emoji_split_4col');
    expect(scriptMatch?.[1]).toContain("cell.setAttribute('data-col-role', column.role)");
    expect(scriptMatch?.[1]).toContain("table.setAttribute('data-table-archetype', archetype)");
    expect(scriptMatch?.[1]).toContain("normalized.includes('structural formula')");
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
    expect(html).toContain('.column-list.grammar-matrix-grid .column p,');
    expect(html).toContain('.column-list.grammar-matrix-grid .column li {');
    expect(html).toContain('.column-list.grammar-matrix-grid .column > .grammar-card-heading {');
    expect(html).toContain('.column-list.grammar-matrix-grid .column > p > em:only-child {');
    expect(html).toContain('text-align: justify;');
    expect(html).toContain('border-bottom: 1px dashed');
    expect(html).toContain('class="grammar-card-heading"');
  });

  it('normalizes rule line breaks and marks long grammar prose paragraphs', async () => {
    const markdown = `### A. 👀 Notice the Grammar
  
  :::column-list
  :::column
  **1. Is it GENERAL?**
  
  *(Am I talking about this whole category or idea?)*
  
  **Rule:**
  Use **Zero Article (Ø)**
  for plurals and uncountables.
  :::
  :::`;
    const html = await renderToHtml(markdown, 'Grammar Rule Normalize');
    const renderedDocument = createRenderedDocument(html);
    const heading = renderedDocument.querySelector(
      '.column-list.grammar-matrix-grid .column > .grammar-card-heading',
    );
    expect(heading?.textContent?.trim()).toBe('1. Is it GENERAL?');

    const ruleParagraph = [
      ...renderedDocument.querySelectorAll('.column-list.grammar-matrix-grid .column > p'),
    ].find((paragraph) => paragraph.textContent?.includes('Rule:'));
    expect(ruleParagraph).toBeTruthy();
    expect(ruleParagraph?.classList.contains('grammar-card-heading')).toBe(false);
    expect(ruleParagraph?.textContent?.replaceAll(/\s+/g, ' ').trim()).toBe(
      'Rule: Use Zero Article (Ø) for plurals and uncountables.',
    );
    expect(ruleParagraph?.innerHTML.includes('<br')).toBe(false);
  });

  it('splits stacked grammar card lines so rule text is not styled as a heading', async () => {
    const markdown = `### A. 👀 Notice the Grammar
  
  :::column-list
  :::column
  **1. Is it GENERAL?**
  *(Am I talking about this whole category or idea?)*
  **Rule:** Use **Zero Article (Ø)** for plurals and uncountables.
  - "I love Ø music."
  - "Ø Cars are expensive."
  :::
  :::column
  **2. Is it EXACT & IDENTIFIABLE?**
  *(Can my listener identify exactly which one I mean without me explaining?)*
  **Rule:** Use **The**.
  - "**The** music at the party was loud." *(The specific music there).*
  :::
  :::`;
    const html = await renderToHtml(markdown, 'Stacked Grammar Card');
    const renderedDocument = createRenderedDocument(html);
    const firstColumn = renderedDocument.querySelector('.column-list.grammar-matrix-grid .column');
    expect(firstColumn).toBeTruthy();

    const directParagraphs = firstColumn ? [...firstColumn.querySelectorAll(':scope > p')] : [];
    expect(directParagraphs.length).toBeGreaterThanOrEqual(3);
    expect(firstColumn?.querySelectorAll(':scope > .grammar-card-heading').length).toBe(1);

    const ruleParagraph = directParagraphs.find((paragraph) =>
      paragraph.textContent?.includes('Rule:'),
    );
    expect(ruleParagraph).toBeTruthy();
    expect(ruleParagraph?.classList.contains('grammar-card-heading')).toBe(false);
    expect(ruleParagraph?.textContent?.replaceAll(/\s+/g, ' ').trim()).toBe(
      'Rule: Use Zero Article (Ø) for plurals and uncountables.',
    );
    expect(ruleParagraph?.innerHTML.includes('<br')).toBe(false);
  });

  it('applies targeted widow lock to grammar card italics and inline parenthetical notes', async () => {
    const markdown = `### A. 👀 Notice the Grammar
  
  :::column-list
  :::column
  **1. Is it GENERAL?**
  *(Am I talking about this whole category or idea?)*
  **Rule:** Use **Zero Article (Ø)** for plurals and uncountables.
  - "I love Ø music."
  :::
  :::column
  **2. Is it EXACT & IDENTIFIABLE?**
  *(Can my listener identify exactly which one I mean without me explaining?)*
  **Rule:** Use **The**.
  - "**The** music at the party was loud." *(The specific music there).*
  :::
  :::`;
    const html = await renderToHtml(markdown, 'Grammar Widows');
    const renderedDocument = createRenderedDocument(html);

    const firstCardQuestion = renderedDocument.querySelector(
      '.column-list.grammar-matrix-grid .column:first-child > p > em',
    );
    expect(firstCardQuestion?.textContent).toContain('or\u00A0idea?)');

    const firstInlineNote = renderedDocument.querySelector(
      '.column-list.grammar-matrix-grid .column li > em',
    );
    expect(firstInlineNote?.textContent).toContain('(The\u00A0specific');
    expect(firstInlineNote?.textContent).toContain('music\u00A0there).');
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
});
