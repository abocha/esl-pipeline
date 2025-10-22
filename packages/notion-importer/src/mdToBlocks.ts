import type { BlockObjectRequest } from '@notionhq/client/build/src/api-endpoints.js';

type ParagraphBlock = Extract<BlockObjectRequest, { type?: 'paragraph' }>;
type BulletBlock = Extract<BlockObjectRequest, { type?: 'bulleted_list_item' }>;
type Heading2Block = Extract<BlockObjectRequest, { type?: 'heading_2' }>;
type Heading3Block = Extract<BlockObjectRequest, { type?: 'heading_3' }>;
type HeadingBlock = Heading2Block | Heading3Block;
type ToggleBlock = Extract<BlockObjectRequest, { type?: 'toggle' }>;
type RichTextItem = ParagraphBlock['paragraph']['rich_text'][number];
type ToggleChild = NonNullable<ToggleBlock['toggle']['children']>[number];

/**
 * Extremely pragmatic MD→Notion mapper that:
 * - Emits heading_2 / heading_3 for '##' / '###'
 * - Emits toggles only for:
 *     :::toggle-heading <Label>
 *     ...content...
 *     :::
 * - Emits a regular text toggle with title "study-text" for:
 *     :::study-text
 *     ...content...
 *     :::
 * - Maps bullet lines (- , *) to bulleted_list_item
 * - Maps everything else (non-empty) to paragraph
 */
export function mdToBlocks(md: string): BlockObjectRequest[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockObjectRequest[] = [];

  let i = 0;

  const makeRichText = (content: string): RichTextItem => ({
    type: 'text',
    text: { content }
  });

  const paragraphBlock = (content: string): ParagraphBlock => {
    const block = {
      type: 'paragraph',
      paragraph: { rich_text: [makeRichText(content)] }
    } satisfies ParagraphBlock;
    return block;
  };

  const bulletBlock = (content: string): BulletBlock => {
    const block = {
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [makeRichText(content)] }
    } satisfies BulletBlock;
    return block;
  };

  const headingBlock = (depth: 2 | 3, content: string): HeadingBlock => {
    if (depth === 2) {
      const block = {
        type: 'heading_2',
        heading_2: { rich_text: [makeRichText(content)] }
      } satisfies Heading2Block;
      return block;
    }
    const block = {
      type: 'heading_3',
      heading_3: { rich_text: [makeRichText(content)] }
    } satisfies Heading3Block;
    return block;
  };

  const toggleBlock = (title: string, childrenLines: string[]): ToggleBlock => {
    const children: ToggleChild[] = [];
    for (const raw of childrenLines) {
      const child = raw?.trim();
      if (!child) continue;
      if (/^[-*]\s+/.test(child)) {
        const match = /^[-*]\s+(.+)$/.exec(child);
        if (!match?.[1]) continue;
        const [, body] = match;
        if (!body) continue;
        children.push(bulletBlock(body.trim()) as ToggleChild);
      } else {
        children.push(paragraphBlock(child) as ToggleChild);
      }
    }
    const block = {
      type: 'toggle',
      toggle: {
        rich_text: [makeRichText(title)],
        children
      }
    } satisfies ToggleBlock;
    return block;
  };

  const flushParagraph = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    blocks.push(paragraphBlock(trimmed));
  };

  while (i < lines.length) {
    const current = lines[i];
    if (current === undefined) break;

    // study-text block
    if (/^:::study-text\b/i.test(current)) {
      i++;
      const inner: string[] = [];
      while (i < lines.length) {
        const candidate = lines[i];
        if (candidate === undefined || /^:::\s*$/.test(candidate)) break;
        inner.push(candidate);
        i++;
      }
      if (i < lines.length && /^:::\s*$/.test(lines[i] ?? '')) i++;
      blocks.push(toggleBlock('study-text', inner));
      continue;
    }

    // toggle-heading block
    const toggleHeadingMatch = /^:::toggle-heading\s+(.+?)\s*$/i.exec(current);
    if (toggleHeadingMatch) {
      i++;
      const label = toggleHeadingMatch[1]?.trim();
      const inner: string[] = [];
      while (i < lines.length) {
        const candidate = lines[i];
        if (candidate === undefined || /^:::\s*$/.test(candidate)) break;
        inner.push(candidate);
        i++;
      }
      if (i < lines.length && /^:::\s*$/.test(lines[i] ?? '')) i++;
      if (label) blocks.push(toggleBlock(label, inner));
      continue;
    }

    // headings
    const h2 = /^##\s+(.+)\s*$/.exec(current);
    if (h2?.[1]) {
      blocks.push(headingBlock(2, h2[1].trim()));
      i++;
      continue;
    }
    const h3 = /^###\s+(.+)\s*$/.exec(current);
    if (h3?.[1]) {
      blocks.push(headingBlock(3, h3[1].trim()));
      i++;
      continue;
    }

    // bullets
    const bullet = /^[-*]\s+(.+)$/.exec(current);
    if (bullet?.[1]) {
      blocks.push(bulletBlock(bullet[1].trim()));
      i++;
      continue;
    }

    // blank line → skip, non-empty → paragraph
    if (current.trim().length > 0) {
      flushParagraph(current);
    }
    i++;
  }

  return blocks;
}
