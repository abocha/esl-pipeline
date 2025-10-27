import { Client } from '@notionhq/client';

export type AddAudioOpts = {
  replace?: boolean;
  target?: 'study-text';
  client?: Client;
};

export function getClient(): Client {
  return createNotionClient();
}

export function createNotionClient() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('NOTION_TOKEN is required in environment');
  return new Client({ auth: token, notionVersion: '2025-09-03' });
}

async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 5): Promise<T> {
  let delay = 350; // ms
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      const status = e?.status ?? e?.code;
      const retryable =
        status === 429 || status === 503 || status === 'ECONNRESET' || status === 'ETIMEDOUT';
      if (!retryable || i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, delay + Math.floor(Math.random() * 120)));
      delay *= 2;
    }
  }
  // should never reach
  throw new Error(`withRetry(${label}) exhausted`);
}

export async function addOrReplaceAudioUnderStudyText(
  pageId: string,
  url: string,
  opts: AddAudioOpts = {}
): Promise<{ replaced: boolean; appended: boolean }> {
  if (!pageId.trim()) throw new Error('pageId is required');
  if (!url.trim()) throw new Error('url is required');

  const client = opts.client ?? getClient();

  // List blocks to find the study-text toggle and preceding block
  let cursor: string | undefined;
  let studyTextBlockId: string | undefined;
  let precedingBlockId: string | undefined;
  const audioBlocksOnPage: string[] = [];
  let lastNonAudioBlockId: string | undefined;

  do {
    const resp = await withRetry(
      () => client.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 }),
      'blocks.children.list'
    );

    for (const block of resp.results) {
      if (!('type' in block)) continue;

      if (block.type === 'audio') {
        audioBlocksOnPage.push(block.id);
        continue;
      }

      if (
        block.type === 'toggle' &&
        'toggle' in block &&
        block.toggle?.rich_text?.[0]?.plain_text === 'study-text'
      ) {
        studyTextBlockId = block.id;
        precedingBlockId = lastNonAudioBlockId;
        break;
      }

      lastNonAudioBlockId = block.id;
    }

    if (studyTextBlockId) break;
    cursor = resp.next_cursor || undefined;
  } while (cursor);

  if (!studyTextBlockId) {
    throw new Error('study-text toggle not found on page');
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
  const childrenResp = await withRetry(
    () => client.blocks.children.list({ block_id: studyTextBlockId }),
    'blocks.children.list'
  );

  // Remove existing audio blocks if replace is true
  for (const block of childrenResp.results) {
    if ('type' in block && block.type === 'audio') {
      if (opts.replace) {
        await withRetry(() => client.blocks.delete({ block_id: block.id }), 'blocks.delete');
        replaced = true;
      } else {
        // If not replacing and found existing audio, do nothing
        return { replaced: false, appended: false };
      }
    }
  }

  // Append new audio block as a sibling before the study-text toggle
  const appendPayload: any = {
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
