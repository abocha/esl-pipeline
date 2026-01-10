import { normalizePronunciationCalloutLines, shouldUsePlainToggle } from '../rendering.js';
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
export function mdToBlocks(md) {
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
    const blocks = [];
    let i = 0;
    const listStack = [];
    const defaultAnnotations = () => ({
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: 'default',
    });
    const createRichTextItem = (content, annotationsOverride, link) => ({
        type: 'text',
        text: { content, link: link ?? null },
        annotations: { ...defaultAnnotations(), ...annotationsOverride },
    });
    const parseInlineMarkdown = (input) => {
        const items = [];
        const active = { bold: false, italic: false, strikethrough: false };
        let buffer = '';
        const flush = (link) => {
            if (!buffer)
                return;
            items.push(createRichTextItem(buffer, {
                bold: active.bold,
                italic: active.italic,
                strikethrough: active.strikethrough,
            }, link));
            buffer = '';
        };
        const hasClosing = (delimiter, start) => input.includes(delimiter, start);
        const isWhitespace = (value) => value === undefined || /\s/.test(value);
        for (let idx = 0; idx < input.length;) {
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
                }
                else {
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
                }
                else {
                    const before = input[idx - 1];
                    if (isWhitespace(next) ||
                        !hasClosing('*', idx + 1) ||
                        (!isWhitespace(before) && before !== undefined && before !== '(')) {
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
                }
                else {
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
                items.push(createRichTextItem(codeContent, {
                    bold: false,
                    italic: false,
                    code: true,
                    color: 'red',
                }));
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
    const makeRichText = (content) => parseInlineMarkdown(content);
    const paragraphBlock = (content) => {
        const block = {
            type: 'paragraph',
            paragraph: { rich_text: makeRichText(content) },
        };
        return block;
    };
    const bulletBlock = (content) => {
        const block = {
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: makeRichText(content) },
        };
        return block;
    };
    const numberedListBlock = (content) => {
        const block = {
            type: 'numbered_list_item',
            numbered_list_item: { rich_text: makeRichText(content) },
        };
        return block;
    };
    const quoteBlock = (content) => {
        const block = {
            type: 'quote',
            quote: { rich_text: makeRichText(content) },
        };
        return block;
    };
    const headingBlock = (depth, content, toggleable = false, children) => {
        if (depth === 1) {
            return {
                type: 'heading_1',
                heading_1: {
                    rich_text: makeRichText(content),
                    is_toggleable: toggleable,
                    ...(children?.length ? { children } : {}),
                },
            };
        }
        if (depth === 2) {
            return {
                type: 'heading_2',
                heading_2: {
                    rich_text: makeRichText(content),
                    is_toggleable: toggleable,
                    ...(children?.length ? { children } : {}),
                },
            };
        }
        return {
            type: 'heading_3',
            heading_3: {
                rich_text: makeRichText(content),
                is_toggleable: toggleable,
                ...(children?.length ? { children } : {}),
            },
        };
    };
    const toggleBlock = (title, childrenLines) => {
        const nested = childrenLines.length > 0 ? mdToBlocks(childrenLines.join('\n')) : [];
        const children = nested.map((block) => block);
        const block = {
            type: 'toggle',
            toggle: {
                rich_text: makeRichText(title),
                children,
            },
        };
        return block;
    };
    const codeBlock = (content, language) => {
        const block = {
            type: 'code',
            code: {
                rich_text: [createRichTextItem(content)],
                language: language || 'plain text',
            },
        };
        return block;
    };
    const imageBlock = (url, _caption) => {
        const block = {
            type: 'image',
            image: {
                type: 'external',
                external: { url },
            },
        };
        return block;
    };
    const tableBlock = (rows, hasHeader) => {
        const tableWidth = rows[0]?.length ?? 0;
        const tableRows = rows.map((row) => ({
            type: 'table_row',
            table_row: {
                cells: row.map((cell) => makeRichText(cell)),
            },
        }));
        const block = {
            type: 'table',
            table: {
                table_width: tableWidth,
                has_column_header: hasHeader,
                has_row_header: false,
                children: tableRows,
            },
        };
        return block;
    };
    const calloutBlock = (content, emoji) => {
        const { isPronunciation, normalized } = normalizePronunciationCalloutLines(content);
        const sourceLines = isPronunciation ? normalized : content;
        const nested = sourceLines.length > 0 ? mdToBlocks(sourceLines.join('\n')) : [];
        // Callout children are allowed; first paragraph (if any) becomes the main text.
        const block = {
            type: 'callout',
            callout: {
                rich_text: [],
                icon: { type: 'emoji', emoji },
            },
        };
        // If there are children, move the first paragraph's text to callout.rich_text if possible
        // to avoid an empty callout header.
        if (nested.length > 0 && nested[0]?.type === 'paragraph') {
            const firstPara = nested.shift();
            block.callout.rich_text = firstPara.paragraph.rich_text;
        }
        else {
            block.callout.rich_text = [createRichTextItem(' ')];
        }
        // Notion expects nested content inside callout payload
        if (nested.length > 0) {
            block.callout.children =
                nested;
        }
        return block;
    };
    const columnListBlock = (columns) => {
        const cols = columns.map((colLines) => {
            const children = mdToBlocks(colLines.join('\n'));
            return {
                type: 'column',
                column: { children: children },
            };
        });
        const block = {
            type: 'column_list',
            column_list: {
                children: cols,
            },
        };
        return block;
    };
    const tocBlock = () => ({
        type: 'table_of_contents',
        table_of_contents: {},
    });
    const audioBlock = (url) => ({
        type: 'audio',
        audio: { type: 'external', external: { url } },
    });
    const videoBlock = (url) => ({
        type: 'video',
        video: { type: 'external', external: { url } },
    });
    const syncedBlock = (childrenLines, syncFromId) => {
        if (syncFromId) {
            return {
                type: 'synced_block',
                synced_block: {
                    synced_from: { block_id: syncFromId },
                },
            };
        }
        const nested = childrenLines.length > 0 ? mdToBlocks(childrenLines.join('\n')) : [];
        return {
            type: 'synced_block',
            synced_block: {
                synced_from: null,
                children: nested,
            },
        };
    };
    const flushParagraph = (raw) => {
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
                            []);
                        children.push(paragraph);
                    }
                    else {
                        const numbered = entry.block;
                        const children = (numbered.numbered_list_item.children ??= []);
                        children.push(paragraph);
                    }
                    return;
                }
            }
        }
        listStack.length = 0;
        blocks.push(paragraph);
    };
    const handleList = (indent, content, type) => {
        const block = type === 'bullet' ? bulletBlock(content.trim()) : numberedListBlock(content.trim());
        while (listStack.length > 0) {
            const top = listStack.at(-1);
            if (top && indent <= top.indent) {
                listStack.pop();
            }
            else {
                break;
            }
        }
        const parentEntry = listStack.at(-1);
        if (parentEntry && indent > parentEntry.indent) {
            // Add as child to parent
            if (parentEntry.type === 'bullet') {
                const children = (parentEntry.block.bulleted_list_item.children ??=
                    []);
                children.push(block);
            }
            else {
                const numbered = parentEntry.block;
                const children = (numbered.numbered_list_item.children ??= []);
                children.push(block);
            }
        }
        else {
            blocks.push(block);
        }
        listStack.push({ indent, block, type });
    };
    const extractDirectiveContent = (startIndex) => {
        let idx = startIndex;
        const inner = [];
        let depth = 1;
        while (idx < lines.length) {
            const line = lines[idx];
            if (line === undefined)
                break;
            const trimmed = line.trim();
            // Check for start of new block
            if (/^:::(column|callout|toggle-|study-text|synced-block|column-list)/i.test(trimmed)) {
                depth++;
            }
            // Check for end of block
            else if (/^:::\s*$/.test(trimmed)) {
                depth--;
            }
            if (depth === 0)
                break;
            inner.push(trimmed);
            idx++;
        }
        return { content: inner, endIndex: idx };
    };
    while (i < lines.length) {
        const current = lines[i];
        if (current === undefined)
            break;
        // ToC
        if (/^:::toc\s*$/i.test(current)) {
            blocks.push(tocBlock());
            i++;
            continue;
        }
        // Audio/Video
        const audioMatch = /^:::audio\s+(.+)$/i.exec(current);
        if (audioMatch) {
            blocks.push(audioBlock(audioMatch[1].trim()));
            i++;
            continue;
        }
        const videoMatch = /^:::video\s+(.+)$/i.exec(current);
        if (videoMatch) {
            blocks.push(videoBlock(videoMatch[1].trim()));
            i++;
            continue;
        }
        // Callout
        const calloutMatch = /^:::callout\s+(.+)\s*$/i.exec(current);
        if (calloutMatch) {
            i++;
            const { content, endIndex } = extractDirectiveContent(i);
            i = endIndex;
            if (i < lines.length && /^:::\s*$/.test(lines[i] ?? ''))
                i++;
            listStack.length = 0;
            blocks.push(calloutBlock(content, calloutMatch[1]));
            continue;
        }
        // Column List
        if (/^:::column-list\s*$/i.test(current)) {
            i++;
            const { content: listContent, endIndex } = extractDirectiveContent(i);
            i = endIndex;
            if (i < lines.length && /^:::\s*$/.test(lines[i] ?? ''))
                i++;
            const columns = [];
            let currentColumn = [];
            let inColumn = false;
            for (const line of listContent) {
                if (/^:::column\s*$/i.test(line)) {
                    if (inColumn) {
                        columns.push(currentColumn);
                        currentColumn = [];
                    }
                    inColumn = true;
                }
                else if (/^:::\s*$/.test(line) && inColumn) {
                    columns.push(currentColumn);
                    currentColumn = [];
                    inColumn = false;
                }
                else if (inColumn) {
                    currentColumn.push(line);
                }
            }
            if (inColumn && currentColumn.length > 0) {
                columns.push(currentColumn);
            }
            listStack.length = 0;
            if (columns.length > 0) {
                blocks.push(columnListBlock(columns));
            }
            else if (listContent.length > 0) {
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
            if (i < lines.length && /^:::\s*$/.test(lines[i] ?? ''))
                i++;
            listStack.length = 0;
            blocks.push(syncedBlock(content, syncId));
            continue;
        }
        // study-text block (Legacy support)
        if (/^:::study-text\b/i.test(current)) {
            i++;
            const { content, endIndex } = extractDirectiveContent(i);
            i = endIndex;
            if (i < lines.length && /^:::\s*$/.test(lines[i] ?? ''))
                i++;
            listStack.length = 0;
            blocks.push(toggleBlock('study-text', content));
            continue;
        }
        // toggle-heading block (Legacy & New)
        const toggleHeadingMatch = /^:::(toggle-heading|toggle-h1|toggle-h2|toggle-h3)\s+(.+?)\s*$/i.exec(current);
        if (toggleHeadingMatch) {
            i++;
            const type = toggleHeadingMatch[1].toLowerCase();
            const label = toggleHeadingMatch[2].trim();
            const { content, endIndex } = extractDirectiveContent(i);
            i = endIndex;
            if (i < lines.length && /^:::\s*$/.test(lines[i] ?? ''))
                i++;
            listStack.length = 0;
            if (type === 'toggle-heading' || shouldUsePlainToggle(label)) {
                blocks.push(toggleBlock(label, content));
            }
            else {
                const depth = type === 'toggle-h1' ? 1 : type === 'toggle-h2' ? 2 : 3;
                const nested = content.length > 0 ? mdToBlocks(content.join('\n')) : [];
                blocks.push(headingBlock(depth, label, true, nested));
            }
            continue;
        }
        // Code blocks
        if (current.trim().startsWith('```')) {
            const lang = current.trim().slice(3).trim();
            i++;
            const codeLines = [];
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
            const tableLines = [];
            while (i < lines.length && lines[i]?.trim().startsWith('|')) {
                tableLines.push(lines[i].trim());
                i++;
            }
            if (tableLines.length > 0) {
                const parseRow = (line) => {
                    const cells = line.split('|');
                    if (cells[0] === '')
                        cells.shift();
                    if (cells.at(-1) === '')
                        cells.pop();
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
                        finalRows = [rows[0], ...rows.slice(2)];
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
            blocks.push(imageBlock(imageMatch[2], imageMatch[1]));
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
        }
        else {
            listStack.length = 0;
        }
        i++;
    }
    return blocks;
}
// @ts-nocheck
//# sourceMappingURL=mdToBlocks.js.map