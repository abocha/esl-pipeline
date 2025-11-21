import type { BlockObjectRequest } from '@notionhq/client/build/src/api-endpoints.js';

type ParagraphBlock = Extract<BlockObjectRequest, { type?: 'paragraph' }>;
type BulletBlock = Extract<BlockObjectRequest, { type?: 'bulleted_list_item' }>;
type Heading2Block = Extract<BlockObjectRequest, { type?: 'heading_2' }>;
type Heading3Block = Extract<BlockObjectRequest, { type?: 'heading_3' }>;
type HeadingBlock = Heading2Block | Heading3Block;
type ToggleBlock = Extract<BlockObjectRequest, { type?: 'toggle' }>;
type RichTextItem = ParagraphBlock['paragraph']['rich_text'][number];
type ToggleChild = NonNullable<ToggleBlock['toggle']['children']>[number];
type BulletChildren = NonNullable<BulletBlock['bulleted_list_item']['children']>;
interface BulletListEntry {
  indent: number;
  block: BulletBlock & {
    bulleted_list_item: BulletBlock['bulleted_list_item'] & {
      children?: BulletChildren;
    };
  };
}

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
  const normalized = md.replaceAll('\r\n', '\n');
  const rawLines = normalized.split('\n');

  let lines = rawLines;
  const firstContentIndex = rawLines.findIndex((line) => line.trim().length > 0);
  if (firstContentIndex !== -1 && rawLines[firstContentIndex]?.trim() === '---') {
    let end = firstContentIndex + 1;
    let foundTerminator = false;
    while (end < rawLines.length) {
      if (rawLines[end]?.trim() === '---') {
        foundTerminator = true;
        end += 1;
        break;
      }
      end += 1;
    }
    if (foundTerminator) {
      lines = [...rawLines.slice(0, firstContentIndex), ...rawLines.slice(end)];
    }
  }
  const blocks: BlockObjectRequest[] = [];

  let i = 0;
  const listStack: BulletListEntry[] = [];

  const defaultAnnotations = (): NonNullable<RichTextItem['annotations']> => ({
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: 'default' as const,
  });

  const createRichTextItem = (
    content: string,
    annotationsOverride?: Partial<NonNullable<RichTextItem['annotations']>>,
  ): RichTextItem => ({
    type: 'text',
    text: { content },
    annotations: { ...defaultAnnotations(), ...annotationsOverride },
  });

  const parseInlineMarkdown = (input: string): RichTextItem[] => {
    const items: RichTextItem[] = [];
    const active = { bold: false, italic: false, strikethrough: false };
    let buffer = '';

    const flush = () => {
      if (!buffer) return;
      items.push(
        createRichTextItem(buffer, {
          bold: active.bold,
          italic: active.italic,
          strikethrough: active.strikethrough,
        }),
      );
      buffer = '';
    };

    const hasClosing = (delimiter: string, start: number) => input.includes(delimiter, start);
    const isWhitespace = (value: string | undefined) => value === undefined || /\s/.test(value);

    for (let idx = 0; idx < input.length; ) {
      const ch = input[idx];
      const next = input[idx + 1];

      if (ch === '\\' && next && '*_`~'.includes(next)) {
        buffer += next;
        idx += 2;
        continue;
      }

      if (input.startsWith('**', idx)) {
        if (active.bold) {
          flush();
          active.bold = false;
        } else {
          const after = input[idx + 2];
          if (isWhitespace(after) || !hasClosing('**', idx + 2)) {
            buffer += '**';
            idx += 2;
            continue;
          }
          flush();
          active.bold = true;
        }
        idx += 2;
        continue;
      }

      if (ch === '*' && next !== '*') {
        if (active.italic) {
          flush();
          active.italic = false;
        } else {
          const before = input[idx - 1];
          if (
            isWhitespace(next) ||
            !hasClosing('*', idx + 1) ||
            (!isWhitespace(before) && before !== undefined && before !== '(')
          ) {
            buffer += '*';
            idx += 1;
            continue;
          }
          flush();
          active.italic = true;
        }
        idx += 1;
        continue;
      }

      if (input.startsWith('~~', idx)) {
        if (active.strikethrough) {
          flush();
          active.strikethrough = false;
        } else {
          const after = input[idx + 2];
          if (isWhitespace(after) || !hasClosing('~~', idx + 2)) {
            buffer += '~~';
            idx += 2;
            continue;
          }
          flush();
          active.strikethrough = true;
        }
        idx += 2;
        continue;
      }

      if (ch === '`') {
        const close = input.indexOf('`', idx + 1);
        if (close === -1) {
          buffer += '`';
          idx += 1;
          continue;
        }
        const codeContent = input.slice(idx + 1, close);
        flush();
        items.push(
          createRichTextItem(codeContent, {
            bold: false,
            italic: false,
            code: true,
            color: 'red',
          }),
        );
        idx = close + 1;
        continue;
      }

      buffer += ch;
      idx += 1;
    }

    flush();

    if (items.length === 0) {
      return [createRichTextItem('')];
    }

    return items;
  };

  const makeRichText = (content: string): RichTextItem[] => parseInlineMarkdown(content);

  const paragraphBlock = (content: string): ParagraphBlock => {
    const block = {
      type: 'paragraph',
      paragraph: { rich_text: makeRichText(content) },
    } satisfies ParagraphBlock;
    return block;
  };

  const bulletBlock = (content: string): BulletBlock => {
    const block = {
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: makeRichText(content) },
    } satisfies BulletBlock;
    return block;
  };

  const headingBlock = (depth: 2 | 3, content: string): HeadingBlock => {
    if (depth === 2) {
      const block = {
        type: 'heading_2',
        heading_2: { rich_text: makeRichText(content) },
      } satisfies Heading2Block;
      return block;
    }
    const block = {
      type: 'heading_3',
      heading_3: { rich_text: makeRichText(content) },
    } satisfies Heading3Block;
    return block;
  };

  const toggleBlock = (title: string, childrenLines: string[]): ToggleBlock => {
    const nested = childrenLines.length > 0 ? mdToBlocks(childrenLines.join('\n')) : [];
    const children = nested.map((block) => block as ToggleChild);
    const block = {
      type: 'toggle',
      toggle: {
        rich_text: makeRichText(title),
        children,
      },
    } satisfies ToggleBlock;
    return block;
  };

  const flushParagraph = (raw: string) => {
    if (!raw) {
      listStack.length = 0;
      return;
    }
    const match = /^(\s*)(.*\S.*)$/.exec(raw);
    if (!match) {
      listStack.length = 0;
      return;
    }
    const [, indentStrRaw, bodyRaw] = match;
    const indentStr = indentStrRaw ?? '';
    const body = bodyRaw ?? '';
    const indent = indentStr.replaceAll('\t', '    ').length;
    const paragraph = paragraphBlock(body.trim());
    if (indent > 0) {
      for (let idx = listStack.length - 1; idx >= 0; idx--) {
        const entry = listStack[idx];
        if (entry && indent > entry.indent) {
          const children = (entry.block.bulleted_list_item.children ??=
            [] as unknown as BulletChildren);
          children.push(paragraph as unknown as BulletChildren[number]);
          return;
        }
      }
    }
    listStack.length = 0;
    blocks.push(paragraph);
  };

  const handleBullet = (indent: number, content: string) => {
    const block = bulletBlock(content.trim()) as BulletListEntry['block'];
    while (listStack.length > 0) {
      const top = listStack.at(-1);
      if (top && indent <= top.indent) {
        listStack.pop();
      } else {
        break;
      }
    }
    const parentEntry = listStack.at(-1);
    if (parentEntry && indent > parentEntry.indent) {
      const children = (parentEntry.block.bulleted_list_item.children ??=
        [] as unknown as BulletChildren);
      children.push(block as unknown as BulletChildren[number]);
    } else {
      blocks.push(block);
    }
    listStack.push({ indent, block });
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
      listStack.length = 0;
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
      if (label) {
        listStack.length = 0;
        blocks.push(toggleBlock(label, inner));
      }
      continue;
    }

    // headings
    const h2 = /^##\s+(.+)\s*$/.exec(current);
    if (h2?.[1]) {
      listStack.length = 0;
      blocks.push(headingBlock(2, h2[1].trim()));
      i++;
      continue;
    }
    const h3 = /^###\s+(.+)\s*$/.exec(current);
    if (h3?.[1]) {
      listStack.length = 0;
      blocks.push(headingBlock(3, h3[1].trim()));
      i++;
      continue;
    }

    // bullets (with optional indentation)
    const bullet = /^(\s*)([-*])\s+(.+)$/.exec(current);
    if (bullet?.[3]) {
      const indentWidth = bullet[1]?.replaceAll('\t', '    ').length ?? 0;
      handleBullet(indentWidth, bullet[3]);
      i++;
      continue;
    }

    // blank line → skip, non-empty → paragraph
    if (current.trim().length > 0) {
      flushParagraph(current);
    } else {
      listStack.length = 0;
    }
    i++;
  }

  return blocks;
}
