// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderToHtml } from '../src/rendering.js';

describe('rendering', () => {
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
    expect(html).not.toContain('<input type="checkbox" class="task-list-item-checkbox" disabled>');
    expect(html).not.toContain(
      '<input type="checkbox" class="task-list-item-checkbox" checked disabled>',
    );
    expect(html).not.toContain('[ ] Introduce the institution');
    expect(html).not.toContain('[x] Use the phrase');
    expect(html).toContain('<strong>the</strong>');
  });

  it('styles checklist checkboxes for centered alignment and theme-aware contrast', async () => {
    const html = await renderToHtml('- [ ] checklist item', 'Checklist Styles');
    expect(html).toContain('.task-list-item-checkbox');
    expect(html).toContain('vertical-align: middle;');
    expect(html).toContain('color-scheme: light;');
    expect(html).toContain('[data-theme="dark"] .markdown-body .task-list-item-checkbox');
    expect(html).toContain('color-scheme: dark;');
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
});
