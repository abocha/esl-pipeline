import { describe, expect, it } from 'vitest';

import { mdToBlocks } from '../src/mdToBlocks.js';

describe('mdToBlocks new features', () => {
  it('maps numbered lists', () => {
    const md = `
1. First item
2. Second item
   1. Nested item
`;
    const blocks = mdToBlocks(md);
    expect(blocks[0]?.type).toBe('numbered_list_item');
    expect((blocks[0] as any).numbered_list_item.rich_text[0].text.content).toBe('First item');
    expect(blocks[1]?.type).toBe('numbered_list_item');
    expect((blocks[1] as any).numbered_list_item.rich_text[0].text.content).toBe('Second item');

    // Check nesting
    const children = (blocks[1] as any).numbered_list_item.children;
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe('numbered_list_item');
    expect(children[0].numbered_list_item.rich_text[0].text.content).toBe('Nested item');
  });

  it('maps blockquotes', () => {
    const md = `> This is a quote.`;
    const blocks = mdToBlocks(md);
    expect(blocks[0]?.type).toBe('quote');
    expect((blocks[0] as any).quote.rich_text[0].text.content).toBe('This is a quote.');
  });

  it('maps code blocks with language', () => {
    const md = `
\`\`\`typescript
const x = 1;
\`\`\`
`;
    const blocks = mdToBlocks(md);
    expect(blocks[0]?.type).toBe('code');
    expect((blocks[0] as any).code.language).toBe('typescript');
    expect((blocks[0] as any).code.rich_text[0].text.content).toBe('const x = 1;');
  });

  it('maps standalone images', () => {
    const md = `![Alt text](https://example.com/image.png)`;
    const blocks = mdToBlocks(md);
    expect(blocks[0]?.type).toBe('image');
    expect((blocks[0] as any).image.external.url).toBe('https://example.com/image.png');
  });

  it('maps inline links', () => {
    const md = `Click [here](https://example.com) for more.`;
    const blocks = mdToBlocks(md);
    expect(blocks[0]?.type).toBe('paragraph');
    const richText = (blocks[0] as any).paragraph.rich_text;
    expect(richText).toHaveLength(3); // "Click ", "here", " for more."
    expect(richText[1].text.content).toBe('here');
    expect(richText[1].text.link.url).toBe('https://example.com');
  });

  it('maps simple tables', () => {
    const md = `
| Header 1 | Header 2 |
| --- | --- |
| Cell 1 | Cell 2 |
| Cell 3 | Cell 4 |
`;
    const blocks = mdToBlocks(md);
    expect(blocks[0]?.type).toBe('table');
    const table = (blocks[0] as any).table;
    expect(table.has_column_header).toBe(true);
    expect(table.table_width).toBe(2);
    expect(table.children).toHaveLength(3); // Header row + 2 body rows

    // Header row
    expect(table.children[0].table_row.cells[0][0].text.content).toBe('Header 1');

    // Body row 1
    expect(table.children[1].table_row.cells[0][0].text.content).toBe('Cell 1');
  });

  it('maps tables without header', () => {
    const md = `
| Cell 1 | Cell 2 |
| Cell 3 | Cell 4 |
`;
    const blocks = mdToBlocks(md);
    expect(blocks[0]?.type).toBe('table');
    const table = (blocks[0] as any).table;
    expect(table.has_column_header).toBe(false);
    expect(table.children).toHaveLength(2);
  });
});
