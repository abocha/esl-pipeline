import { describe, expect, it } from 'vitest';

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
    const types = new Set(blocks.map((b) => b.type));
    expect(types.has('heading_2')).toBe(true);
    expect(types.has('toggle')).toBe(true);
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
    const toggle = blocks.find((b) => b.type === 'toggle') as any;
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
    const toggle = blocks.find((b) => b.type === 'toggle') as any;
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
    const types = mdToBlocks(md).map((b) => b.type);
    expect(types).toContain('heading_2');
    expect(types).toContain('heading_3');
    expect(types).toContain('bulleted_list_item');
    expect(types).toContain('paragraph');
  });

  it('converts inline emphasis into Notion annotations', () => {
    const md = `Paragraph with **bold** and *italic* text.`;
    const [first] = mdToBlocks(md);
    expect(first?.type).toBe('paragraph');
    const richText = (first as any).paragraph.rich_text;
    const boldSegment = richText.find((item: any) => item.annotations?.bold === true);
    expect(boldSegment?.text?.content).toBe('bold');
    const italicSegment = richText.find((item: any) => item.annotations?.italic === true);
    expect(italicSegment?.text?.content).toBe('italic');
  });

  it('maps inline code spans to code annotations', () => {
    const md = 'Use `Ctrl+E` for inline code.';
    const [first] = mdToBlocks(md);
    expect(first?.type).toBe('paragraph');
    const richText = (first as any).paragraph.rich_text;
    const codeSegment = richText.find((item: any) => item.annotations?.code === true);
    expect(codeSegment?.text?.content).toBe('Ctrl+E');
    expect(codeSegment?.annotations?.color).toBe('red');
  });

  it('drops top-level frontmatter instead of emitting it as text', () => {
    const md = `---
title: Lesson
level: B1
---

## Overview
Content line.
`;
    const blocks = mdToBlocks(md);
    const joined = JSON.stringify(blocks);
    expect(joined).not.toContain('title: Lesson');
    expect(joined).not.toContain('level: B1');
    expect(blocks[0]?.type).toBe('heading_2');
    expect((blocks[0] as any).heading_2.rich_text[0].text.content).toBe('Overview');
  });

  it('maps ~~text~~ to strikethrough annotations', () => {
    const md = 'Mark ~~this section~~ as optional.';
    const [first] = mdToBlocks(md);
    expect(first?.type).toBe('paragraph');
    const richText = (first as any).paragraph.rich_text;
    const strikeSegment = richText.find((item: any) => item.annotations?.strikethrough === true);
    expect(strikeSegment?.text?.content).toBe('this section');
  });

  it('keeps underscore blanks as literal characters', () => {
    const md =
      'They ____ at home and they ____ hungry. He work__ at home, but live__ in the city center.';
    const [first] = mdToBlocks(md);
    expect(first?.type).toBe('paragraph');
    const richText = (first as any).paragraph.rich_text;
    const combined = richText.map((item: any) => item.text.content).join('');
    expect(combined).toBe(md);
    expect(richText.every((item: any) => item.annotations?.bold !== true)).toBe(true);
  });

  it('nests bulleted sub-items according to indentation', () => {
    const md = `
- root
  - child
    - grandchild
- sibling
`;
    const blocks = mdToBlocks(md);
    expect(blocks[0]?.type).toBe('bulleted_list_item');
    const first = blocks[0] as any;
    const child = first.bulleted_list_item.children?.[0];
    expect(child?.type).toBe('bulleted_list_item');
    const grandchild = child?.bulleted_list_item?.children?.[0];
    expect(grandchild?.type).toBe('bulleted_list_item');
    expect(blocks[1]?.type).toBe('bulleted_list_item');
  });

  it('keeps indented paragraphs attached to the preceding list item', () => {
    const md = `
* Parent bullet
    extra details line
    * Nested bullet
`;
    const blocks = mdToBlocks(md);
    expect(blocks[0]?.type).toBe('bulleted_list_item');
    const first = blocks[0] as any;
    const [paragraphChild, nestedBullet] = first.bulleted_list_item.children ?? [];
    expect(paragraphChild?.type).toBe('paragraph');
    expect(nestedBullet?.type).toBe('bulleted_list_item');
  });

  it('parses headings and lists inside toggles', () => {
    const md = `
:::toggle-heading Example Toggle
### Inside Heading
- item one
- item two
:::
`;
    const blocks = mdToBlocks(md);
    const toggle = blocks.find((b) => b.type === 'toggle') as any;
    expect(toggle).toBeTruthy();
    const childTypes = (toggle.toggle.children ?? []).map((child: any) => child.type);
    expect(childTypes).toContain('heading_3');
    expect(childTypes.filter((type: string) => type === 'bulleted_list_item')).toHaveLength(2);
  });
});
