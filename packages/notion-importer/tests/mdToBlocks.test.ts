import { describe, it, expect } from 'vitest';
import { mdToBlocks } from '../src/mdToBlocks.js';

const sample = `
## 1. study text

:::study-text
A: Hello
B: Hi
:::

## 8. answer key
:::toggle-heading Answer Key
1) Yes.
:::
`;

describe('mdToBlocks', () => {
  it('maps headings, toggles, and study-text', () => {
    const blocks = mdToBlocks(sample);
    const types = blocks.map(b => b.type);
    expect(types.includes('heading_2')).toBe(true);
    expect(types.includes('toggle')).toBe(true);
  });
});

describe('mdToBlocks mapping', () => {
  it('maps study-text to a regular text toggle titled "study-text"', () => {
    const md = `
## 1. study text

:::study-text
A: Hello
- bullet one
:::
`;
    const blocks = mdToBlocks(md);
    // find the toggle block
    const toggle = blocks.find(b => b.type === 'toggle') as any;
    expect(toggle).toBeTruthy();
    const title = toggle.toggle.rich_text?.[0]?.text?.content;
    expect(title).toBe('study-text');

    // children must be paragraph/bulleted_list_item only
    const types = toggle.toggle.children.map((c: any) => c.type);
    expect(types).toEqual(expect.arrayContaining(['paragraph', 'bulleted_list_item']));
  });

  it('maps :::toggle-heading <Label> to a toggle with that label', () => {
    const md = `
## 8. answer key
:::toggle-heading Answer Key
1) Yes.
:::
`;
    const blocks = mdToBlocks(md);
    const toggle = blocks.find(b => b.type === 'toggle') as any;
    expect(toggle).toBeTruthy();
    const title = toggle.toggle.rich_text?.[0]?.text?.content;
    expect(title).toBe('Answer Key');
  });

  it('maps ## and ### to heading_2/heading_3; bullets to bulleted_list_item', () => {
    const md = `
## H2 Title
### H3 Title
- item
* item2
not a list
`;
    const types = mdToBlocks(md).map(b => b.type);
    expect(types).toContain('heading_2');
    expect(types).toContain('heading_3');
    expect(types).toContain('bulleted_list_item');
    expect(types).toContain('paragraph');
  });
});
