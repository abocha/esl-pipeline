// Notion SDK types are unstable; use loose typing for block requests.
type BlockObjectRequest = any;

type ParagraphBlock = Extract<BlockObjectRequest, { type?: 'paragraph' }>;
type BulletBlock = Extract<BlockObjectRequest, { type?: 'bulleted_list_item' }>;
type NumberedListItemBlock = Extract<BlockObjectRequest, { type?: 'numbered_list_item' }>;
type QuoteBlock = Extract<BlockObjectRequest, { type?: 'quote' }>;
type CodeBlock = Extract<BlockObjectRequest, { type?: 'code' }>;
type ImageBlock = Extract<BlockObjectRequest, { type?: 'image' }>;
type TableBlock = Extract<BlockObjectRequest, { type?: 'table' }>;
type TableRowBlock = Extract<BlockObjectRequest, { type?: 'table_row' }>;
type CalloutBlock = Extract<BlockObjectRequest, { type?: 'callout' }>;
type ColumnListBlock = Extract<BlockObjectRequest, { type?: 'column_list' }>;
type ColumnBlock = Extract<BlockObjectRequest, { type?: 'column' }>;
type TableOfContentsBlock = Extract<BlockObjectRequest, { type?: 'table_of_contents' }>;
type VideoBlock = Extract<BlockObjectRequest, { type?: 'video' }>;
type AudioBlock = Extract<BlockObjectRequest, { type?: 'audio' }>;
type SyncedBlock = Extract<BlockObjectRequest, { type?: 'synced_block' }>;

type Heading1Block = Extract<BlockObjectRequest, { type?: 'heading_1' }>;
type Heading2Block = Extract<BlockObjectRequest, { type?: 'heading_2' }>;
type Heading3Block = Extract<BlockObjectRequest, { type?: 'heading_3' }>;
type HeadingBlock = Heading1Block | Heading2Block | Heading3Block;
type ToggleBlock = Extract<BlockObjectRequest, { type?: 'toggle' }>;
type RichTextItem = ParagraphBlock['paragraph']['rich_text'][number];
type ToggleChild = NonNullable<ToggleBlock['toggle']['children']>[number];
type BulletChildren = NonNullable<BulletBlock['bulleted_list_item']['children']>;

interface BulletListEntry {
  type: 'bullet';
  indent: number;
  block: BulletBlock & {
    bulleted_list_item: BulletBlock['bulleted_list_item'] & {
      children?: BulletChildren;
    };
  };
}

interface NumberedListEntry {
  type: 'numbered';
  indent: number;
  block: NumberedListItemBlock;
}

/**
 * Extremely pragmatic MD→Notion mapper that:
 * - Emits heading_1 / heading_2 / heading_3 for '#', '##', '###'
 * - Emits toggles for :::toggle-heading / :::toggle-hX
 * - Emits callouts for :::callout <emoji>
 * - Emits columns for :::column-list / :::column
 * - Emits ToC for :::toc
 * - Emits Audio/Video for :::audio / :::video
 * - Emits Synced Blocks for :::synced-block
 * - Maps bullet lines (- , *) to bulleted_list_item
 * - Maps numbered lines (1.) to numbered_list_item
 * - Maps blockquotes (> ) to quote
 * - Maps code blocks (```) to code
 * - Maps images (![alt](url)) to image
 * - Maps tables (| col | col |) to table
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
  const listStack: (BulletListEntry | NumberedListEntry)[] = [];

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
    link?: { url: string } | null,
  ): RichTextItem => ({
    type: 'text',
    text: { content, link: link ?? null },
    annotations: { ...defaultAnnotations(), ...annotationsOverride },
  });

  const parseInlineMarkdown = (input: string): RichTextItem[] => {
    const items: RichTextItem[] = [];
    const active = { bold: false, italic: false, strikethrough: false };
    let buffer = '';

    const flush = (link?: { url: string }) => {
      if (!buffer) return;
      items.push(
        createRichTextItem(
          buffer,
          {
            bold: active.bold,
            italic: active.italic,
            strikethrough: active.strikethrough,
          },
          link,
        ),
      );
      buffer = '';
    };

    const hasClosing = (delimiter: string, start: number) => input.includes(delimiter, start);
    const isWhitespace = (value: string | undefined) => value === undefined || /\s/.test(value);

    for (let idx = 0; idx < input.length; ) {
      const ch = input[idx];
      const next = input[idx + 1];

      if (ch === '\\' && next && '*_`~[]!'.includes(next)) {
        buffer += next;
        idx += 2;
        continue;
      }

      // Images: ![alt](url)
      if (ch === '!' && next === '[') {
        const closeBracket = input.indexOf(']', idx + 2);
        if (closeBracket !== -1 && input[closeBracket + 1] === '(') {
          const closeParen = input.indexOf(')', closeBracket + 2);
          if (closeParen !== -1) {
            flush();
            // Render alt text as a link to the image for inline images
            const alt = input.slice(idx + 2, closeBracket);
            const url = input.slice(closeBracket + 2, closeParen);
            buffer = alt || 'Image';
            flush({ url });
            idx = closeParen + 1;
            continue;
          }
        }
      }

      // Links: [text](url)
      if (ch === '[') {
        const closeBracket = input.indexOf(']', idx + 1);
        if (closeBracket !== -1 && input[closeBracket + 1] === '(') {
          const closeParen = input.indexOf(')', closeBracket + 2);
          if (closeParen !== -1) {
            flush();
            const text = input.slice(idx + 1, closeBracket);
            const url = input.slice(closeBracket + 2, closeParen);

            // Recursively parse the link text
            const innerItems = parseInlineMarkdown(text);
            for (const item of innerItems) {
              if (item.type === 'text' && item.text) {
                item.text.link = { url };
              }
              items.push(item);
            }

            idx = closeParen + 1;
            continue;
          }
        }
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

  const numberedListBlock = (content: string): NumberedListItemBlock => {
    const block = {
      type: 'numbered_list_item',
      numbered_list_item: { rich_text: makeRichText(content) },
    } satisfies NumberedListItemBlock;
    return block;
  };

  const quoteBlock = (content: string): QuoteBlock => {
    const block = {
      type: 'quote',
      quote: { rich_text: makeRichText(content) },
    } satisfies QuoteBlock;
    return block;
  };

  const headingBlock = (
    depth: 1 | 2 | 3,
    content: string,
    toggleable = false,
    children?: BlockObjectRequest[],
  ): HeadingBlock => {
    if (depth === 1) {
      return {
        type: 'heading_1',
        heading_1: {
          rich_text: makeRichText(content),
          is_toggleable: toggleable,
          ...(children?.length ? { children } : {}),
        },
      } as Heading1Block;
    }
    if (depth === 2) {
      return {
        type: 'heading_2',
        heading_2: {
          rich_text: makeRichText(content),
          is_toggleable: toggleable,
          ...(children?.length ? { children } : {}),
        },
      } as Heading2Block;
    }
    return {
      type: 'heading_3',
      heading_3: {
        rich_text: makeRichText(content),
        is_toggleable: toggleable,
        ...(children?.length ? { children } : {}),
      },
    } as Heading3Block;
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

  const codeBlock = (content: string, language?: string): CodeBlock => {
    const block = {
      type: 'code',
      code: {
        rich_text: [createRichTextItem(content)],
        language: (language || 'plain text') as any,
      },
    } satisfies CodeBlock;
    return block;
  };

  const imageBlock = (url: string, _caption?: string): ImageBlock => {
    const block = {
      type: 'image',
      image: {
        type: 'external',
        external: { url },
      },
    } satisfies ImageBlock;
    return block;
  };

  const tableBlock = (rows: string[][], hasHeader: boolean): TableBlock => {
    const tableWidth = rows[0]?.length ?? 0;
    const tableRows = rows.map(
      (row) =>
        ({
          type: 'table_row',
          table_row: {
            cells: row.map((cell) => makeRichText(cell)),
          },
        }) satisfies TableRowBlock,
    );

    const block = {
      type: 'table',
      table: {
        table_width: tableWidth,
        has_column_header: hasHeader,
        has_row_header: false,
        children: tableRows,
      },
    } satisfies TableBlock;
    return block;
  };

  const calloutBlock = (content: string[], emoji: string): CalloutBlock => {
    const nested = content.length > 0 ? mdToBlocks(content.join('\n')) : [];
    // Callout children are allowed; first paragraph (if any) becomes the main text.
    const block: CalloutBlock = {
      type: 'callout',
      callout: {
        rich_text: [],
        icon: { type: 'emoji', emoji },
      },
    };

    // If there are children, move the first paragraph's text to callout.rich_text if possible
    // to avoid an empty callout header.
    if (nested.length > 0 && nested[0]?.type === 'paragraph') {
      const firstPara = nested.shift() as ParagraphBlock;
      block.callout.rich_text = firstPara.paragraph.rich_text;
    } else {
      block.callout.rich_text = [createRichTextItem(' ')];
    }
    // Notion expects nested content inside callout payload
    if (nested.length > 0) {
      (block.callout as CalloutBlock['callout'] & { children?: BlockObjectRequest[] }).children =
        nested as BlockObjectRequest[];
    }

    return block;
  };

  const columnListBlock = (columns: string[][]): ColumnListBlock => {
    const cols = columns.map((colLines) => {
      const children = mdToBlocks(colLines.join('\n'));
      return {
        type: 'column',
        column: { children: children as BlockObjectRequest[] },
      } as unknown as ColumnBlock;
    });

    const block = {
      type: 'column_list',
      column_list: {
        children: cols as unknown as ColumnBlock[],
      },
    } as unknown as ColumnListBlock;
    return block;
  };

  const tocBlock = (): TableOfContentsBlock => ({
    type: 'table_of_contents',
    table_of_contents: {},
  });

  const audioBlock = (url: string): AudioBlock => ({
    type: 'audio',
    audio: { type: 'external', external: { url } },
  });

  const videoBlock = (url: string): VideoBlock => ({
    type: 'video',
    video: { type: 'external', external: { url } },
  });

  const syncedBlock = (childrenLines: string[], syncFromId?: string): SyncedBlock => {
    if (syncFromId) {
      return {
        type: 'synced_block',
        synced_block: {
          synced_from: { block_id: syncFromId },
        },
      } as SyncedBlock;
    }
    const nested = childrenLines.length > 0 ? mdToBlocks(childrenLines.join('\n')) : [];
    return {
      type: 'synced_block',
      synced_block: {
        synced_from: null,
        children: nested as BlockObjectRequest[],
      },
    } as SyncedBlock;
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
          // Add to children of the list item
          if (entry.type === 'bullet') {
            const children = (entry.block.bulleted_list_item.children ??=
              [] as unknown as BulletChildren);
            children.push(paragraph as unknown as BulletChildren[number]);
          } else {
            const numbered = entry.block as NumberedListItemBlock;
            const children = (numbered.numbered_list_item.children ??= []);
            children.push(paragraph as BlockObjectRequest);
          }
          return;
        }
      }
    }
    listStack.length = 0;
    blocks.push(paragraph);
  };

  const handleList = (indent: number, content: string, type: 'bullet' | 'numbered') => {
    const block =
      type === 'bullet' ? bulletBlock(content.trim()) : numberedListBlock(content.trim());

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
      // Add as child to parent
      if (parentEntry.type === 'bullet') {
        const children = (parentEntry.block.bulleted_list_item.children ??=
          [] as unknown as BulletChildren);
        children.push(block as unknown as BulletChildren[number]);
      } else {
        const numbered = parentEntry.block as NumberedListItemBlock;
        const children = (numbered.numbered_list_item.children ??= []);
        children.push(block as BlockObjectRequest);
      }
    } else {
      blocks.push(block);
    }
    listStack.push({ indent, block, type });
  };

  const extractDirectiveContent = (startIndex: number): { content: string[]; endIndex: number } => {
    let idx = startIndex;
    const inner: string[] = [];
    let depth = 1;

    while (idx < lines.length) {
      const line = lines[idx];
      if (line === undefined) break;
      const trimmed = line.trim();

      // Check for start of new block
      if (/^:::(column|callout|toggle-|study-text|synced-block|column-list)/i.test(trimmed)) {
        depth++;
      }
      // Check for end of block
      else if (/^:::\s*$/.test(trimmed)) {
        depth--;
      }

      if (depth === 0) break;

      inner.push(trimmed);
      idx++;
    }
    return { content: inner, endIndex: idx };
  };

  while (i < lines.length) {
    const current = lines[i];
    if (current === undefined) break;

    // ToC
    if (/^:::toc\s*$/i.test(current)) {
      blocks.push(tocBlock());
      i++;
      continue;
    }

    // Audio/Video
    const audioMatch = /^:::audio\s+(.+)$/i.exec(current);
    if (audioMatch) {
      blocks.push(audioBlock(audioMatch[1]!.trim()));
      i++;
      continue;
    }
    const videoMatch = /^:::video\s+(.+)$/i.exec(current);
    if (videoMatch) {
      blocks.push(videoBlock(videoMatch[1]!.trim()));
      i++;
      continue;
    }

    // Callout
    const calloutMatch = /^:::callout\s+(.+)\s*$/i.exec(current);
    if (calloutMatch) {
      i++;
      const { content, endIndex } = extractDirectiveContent(i);
      i = endIndex;
      if (i < lines.length && /^:::\s*$/.test(lines[i] ?? '')) i++;
      listStack.length = 0;
      blocks.push(calloutBlock(content, calloutMatch[1]!));
      continue;
    }

    // Column List
    if (/^:::column-list\s*$/i.test(current)) {
      i++;
      const { content: listContent, endIndex } = extractDirectiveContent(i);
      i = endIndex;
      if (i < lines.length && /^:::\s*$/.test(lines[i] ?? '')) i++;

      const columns: string[][] = [];
      let currentColumn: string[] = [];
      let inColumn = false;

      for (const line of listContent) {
        if (/^:::column\s*$/i.test(line)) {
          if (inColumn) {
            columns.push(currentColumn);
            currentColumn = [];
          }
          inColumn = true;
        } else if (/^:::\s*$/.test(line) && inColumn) {
          columns.push(currentColumn);
          currentColumn = [];
          inColumn = false;
        } else if (inColumn) {
          currentColumn.push(line);
        }
      }
      if (inColumn && currentColumn.length > 0) {
        columns.push(currentColumn);
      }

      listStack.length = 0;
      if (columns.length > 0) {
        blocks.push(columnListBlock(columns));
      } else if (listContent.length > 0) {
        // Fallback: treat the inner content as normal markdown blocks if no columns were parsed
        blocks.push(...mdToBlocks(listContent.join('\n')));
      }
      continue;
    }

    // Synced Block
    const syncedMatch = /^:::synced-block(?:\s+(.+))?\s*$/i.exec(current);
    if (syncedMatch) {
      i++;
      const syncId = syncedMatch[1]?.trim();
      const { content, endIndex } = extractDirectiveContent(i);
      i = endIndex;
      if (i < lines.length && /^:::\s*$/.test(lines[i] ?? '')) i++;
      listStack.length = 0;
      blocks.push(syncedBlock(content, syncId));
      continue;
    }

    // study-text block (Legacy support)
    if (/^:::study-text\b/i.test(current)) {
      i++;
      const { content, endIndex } = extractDirectiveContent(i);
      i = endIndex;
      if (i < lines.length && /^:::\s*$/.test(lines[i] ?? '')) i++;
      listStack.length = 0;
      blocks.push(toggleBlock('study-text', content));
      continue;
    }

    // toggle-heading block (Legacy & New)
    const toggleHeadingMatch =
      /^:::(toggle-heading|toggle-h1|toggle-h2|toggle-h3)\s+(.+?)\s*$/i.exec(current);
    if (toggleHeadingMatch) {
      i++;
      const type = toggleHeadingMatch[1]!.toLowerCase();
      const label = toggleHeadingMatch[2]!.trim();
      const { content, endIndex } = extractDirectiveContent(i);
      i = endIndex;
      if (i < lines.length && /^:::\s*$/.test(lines[i] ?? '')) i++;

      listStack.length = 0;

      if (type === 'toggle-heading') {
        blocks.push(toggleBlock(label, content));
      } else {
        const depth: 1 | 2 | 3 = type === 'toggle-h1' ? 1 : type === 'toggle-h2' ? 2 : 3;
        const nested = content.length > 0 ? mdToBlocks(content.join('\n')) : [];
        blocks.push(headingBlock(depth, label, true, nested));
      }
      continue;
    }

    // Code blocks
    if (current.trim().startsWith('```')) {
      const lang = current.trim().slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length) {
        if (lines[i]?.trim().startsWith('```')) {
          i++;
          break;
        }
        codeLines.push(lines[i] ?? '');
        i++;
      }
      listStack.length = 0;
      blocks.push(codeBlock(codeLines.join('\n'), lang));
      continue;
    }

    // Tables
    if (current.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i]?.trim().startsWith('|')) {
        tableLines.push(lines[i]!.trim());
        i++;
      }

      if (tableLines.length > 0) {
        const parseRow = (line: string) => {
          const cells = line.split('|');
          if (cells[0] === '') cells.shift();
          if (cells.at(-1) === '') cells.pop();
          return cells.map((c) => c.trim());
        };

        const rows = tableLines.map((line) => parseRow(line));

        let hasHeader = false;
        let finalRows = rows;

        if (rows.length >= 2) {
          const secondRow = rows[1];
          const isSeparator = secondRow?.every((cell) => /^[-:]+$/.test(cell));
          if (isSeparator) {
            hasHeader = true;
            finalRows = [rows[0]!, ...rows.slice(2)];
          }
        }

        listStack.length = 0;
        blocks.push(tableBlock(finalRows, hasHeader));
        continue;
      }
    }

    // Blockquotes
    if (current.trim().startsWith('>')) {
      const content = current.trim().slice(1).trim();
      listStack.length = 0;
      blocks.push(quoteBlock(content));
      i++;
      continue;
    }

    // Images (standalone)
    const imageMatch = /^!\[(.*?)\]\((.*?)\)\s*$/.exec(current.trim());
    if (imageMatch) {
      listStack.length = 0;
      blocks.push(imageBlock(imageMatch[2]!, imageMatch[1]));
      i++;
      continue;
    }

    // headings
    const h1 = /^#\s+(.+)\s*$/.exec(current);
    if (h1?.[1]) {
      listStack.length = 0;
      blocks.push(headingBlock(1, h1[1].trim()));
      i++;
      continue;
    }
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
      handleList(indentWidth, bullet[3], 'bullet');
      i++;
      continue;
    }

    // numbered lists
    const numbered = /^(\s*)(\d+)\.\s+(.+)$/.exec(current);
    if (numbered?.[3]) {
      const indentWidth = numbered[1]?.replaceAll('\t', '    ').length ?? 0;
      handleList(indentWidth, numbered[3], 'numbered');
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
// @ts-nocheck
