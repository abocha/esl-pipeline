import { describe, expect, it } from 'vitest';

import { mdToBlocks } from '../src/mdToBlocks.js';

describe('mdToBlocks - Advanced Features', () => {
  it('parses table of contents', () => {
    const md = ':::toc';
    const blocks = mdToBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('table_of_contents');
  });

  it('parses audio embed', () => {
    const md = ':::audio https://example.com/audio.mp3';
    const blocks = mdToBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('audio');
    expect((blocks[0] as any).audio?.external?.url).toBe('https://example.com/audio.mp3');
  });

  it('parses video embed', () => {
    const md = ':::video https://youtube.com/watch?v=123';
    const blocks = mdToBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('video');
    expect((blocks[0] as any).video?.external?.url).toBe('https://youtube.com/watch?v=123');
  });

  it('parses callout with emoji and content', () => {
    const md = `:::callout 💡
This is a callout.
It has multiple lines.
:::`;
    const blocks = mdToBlocks(md);
    expect(blocks).toHaveLength(1);
    const callout = blocks[0] as any;
    expect(callout.type).toBe('callout');
    expect(callout.callout.icon.emoji).toBe('💡');
    // First line should be in rich_text
    expect(callout.callout.rich_text[0].text.content).toBe('This is a callout.');
    // Remaining lines nested under callout children
    expect(callout.callout.children).toHaveLength(1);
    expect(callout.callout.children[0].paragraph.rich_text[0].text.content).toBe(
      'It has multiple lines.',
    );
  });

  it('parses column list with columns', () => {
    const md = `:::column-list
:::column
Left
:::
:::column
Right
:::
:::`;
    const blocks = mdToBlocks(md);
    expect(blocks).toHaveLength(1);
    const colList = blocks[0] as any;
    expect(colList.type).toBe('column_list');
    expect(colList.column_list.children).toHaveLength(2);
    expect(colList.column_list.children[0].type).toBe('column');
    expect(
      colList.column_list.children[0].column.children[0].paragraph.rich_text[0].text.content,
    ).toBe('Left');
    expect(colList.column_list.children[1].type).toBe('column');
    expect(
      colList.column_list.children[1].column.children[0].paragraph.rich_text[0].text.content,
    ).toBe('Right');
  });

  it('parses indented column list markers', () => {
    const md = `:::column-list
    :::column
    Left indented
    :::
    :::column
    Right indented
    :::
:::`;
    const blocks = mdToBlocks(md);
    expect(blocks).toHaveLength(1);
    const colList = blocks[0] as any;
    expect(colList.type).toBe('column_list');
    expect(colList.column_list.children).toHaveLength(2);
    expect(
      colList.column_list.children[0].column.children[0].paragraph.rich_text[0].text.content,
    ).toBe('Left indented');
    expect(
      colList.column_list.children[1].column.children[0].paragraph.rich_text[0].text.content,
    ).toBe('Right indented');
  });

  it('parses toggle headings', () => {
    const md = `:::toggle-h1 Heading 1
Content 1
:::
:::toggle-h2 Heading 2
Content 2
:::`;
    const blocks = mdToBlocks(md);
    expect(blocks).toHaveLength(2);

    const h1 = blocks[0] as any;
    expect(h1.type).toBe('heading_1');
    expect(h1.heading_1.is_toggleable).toBe(true);
    expect(h1.heading_1.rich_text[0].text.content).toBe('Heading 1');
    expect(h1.heading_1.children).toHaveLength(1);
    expect(h1.heading_1.children[0].paragraph.rich_text[0].text.content).toBe('Content 1');

    const h2 = blocks[1] as any;
    expect(h2.type).toBe('heading_2');
    expect(h2.heading_2.is_toggleable).toBe(true);
    expect(h2.heading_2.rich_text[0].text.content).toBe('Heading 2');
  });

  it('parses synced block (new)', () => {
    const md = `:::synced-block
Content inside
:::`;
    const blocks = mdToBlocks(md);
    expect(blocks).toHaveLength(1);
    const synced = blocks[0] as any;
    expect(synced.type).toBe('synced_block');
    expect(synced.synced_block.synced_from).toBeNull();
    expect(synced.synced_block.children).toHaveLength(1);
    expect(synced.synced_block.children[0].paragraph.rich_text[0].text.content).toBe(
      'Content inside',
    );
  });

  it('parses synced block (existing)', () => {
    const md = ':::synced-block block-id-123';
    const blocks = mdToBlocks(md);
    expect(blocks).toHaveLength(1);
    const synced = blocks[0] as any;
    expect(synced.type).toBe('synced_block');
    expect(synced.synced_block.synced_from.block_id).toBe('block-id-123');
    expect(synced.children ?? []).toHaveLength(0);
  });
});
