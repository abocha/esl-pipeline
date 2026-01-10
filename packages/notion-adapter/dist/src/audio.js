import { ValidationError } from '@esl-pipeline/contracts';
import { createNotionClient } from './client.js';
import { withRetry } from './retry.js';
export function getClient() {
    return createNotionClient();
}
export async function addOrReplaceAudioUnderStudyText(pageId, url, opts = {}) {
    if (!pageId.trim())
        throw new ValidationError('pageId is required');
    if (!url.trim())
        throw new ValidationError('url is required');
    const client = opts.client ?? getClient();
    // List blocks to find the study-text toggle and preceding block
    let cursor;
    let studyTextBlockId;
    let precedingBlockId;
    const audioBlocksOnPage = [];
    let lastNonAudioBlockId;
    do {
        const resp = await withRetry(() => client.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 }), 'blocks.children.list');
        for (const block of resp.results) {
            if (!('type' in block))
                continue;
            if (block.type === 'audio') {
                audioBlocksOnPage.push(block.id);
                continue;
            }
            if (block.type === 'toggle' &&
                'toggle' in block &&
                block.toggle?.rich_text?.[0]?.plain_text === 'study-text') {
                studyTextBlockId = block.id;
                precedingBlockId = lastNonAudioBlockId;
                break;
            }
            lastNonAudioBlockId = block.id;
        }
        if (studyTextBlockId)
            break;
        cursor = resp.next_cursor || undefined;
    } while (cursor);
    if (!studyTextBlockId) {
        throw new ValidationError('study-text toggle not found on page');
    }
    // Remove or respect existing audio blocks at the page level
    let replaced = false;
    if (audioBlocksOnPage.length > 0) {
        if (!opts.replace) {
            return { replaced: false, appended: false };
        }
        for (const audioId of audioBlocksOnPage) {
            await withRetry(() => client.blocks.delete({ block_id: audioId }), 'blocks.delete');
            replaced = true;
        }
    }
    // List children of the study-text toggle to find existing audio blocks
    const childrenResp = await withRetry(() => client.blocks.children.list({ block_id: studyTextBlockId }), 'blocks.children.list');
    // Remove existing audio blocks if replace is true
    for (const block of childrenResp.results) {
        if ('type' in block && block.type === 'audio') {
            if (opts.replace) {
                await withRetry(() => client.blocks.delete({ block_id: block.id }), 'blocks.delete');
                replaced = true;
            }
            else {
                // If not replacing and found existing audio, do nothing
                return { replaced: false, appended: false };
            }
        }
    }
    // Append new audio block as a sibling before the study-text toggle
    const appendPayload = {
        block_id: pageId,
        children: [
            {
                type: 'audio',
                audio: {
                    type: 'external',
                    external: { url },
                },
            },
        ],
    };
    if (precedingBlockId) {
        appendPayload.after = precedingBlockId;
    }
    await withRetry(() => client.blocks.children.append(appendPayload), 'blocks.children.append');
    return { replaced, appended: true };
}
//# sourceMappingURL=audio.js.map