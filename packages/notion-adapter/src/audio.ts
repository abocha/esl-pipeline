import { APIErrorCode, type Client, isNotionClientError } from '@notionhq/client';

import { ValidationError } from '@esl-pipeline/contracts';

import { createNotionClient } from './client.js';
import { withRetry } from './retry.js';

type AudioTarget = 'study-text' | 'pronunciation-shadow-sentence';

export interface AddAudioOpts {
  replace?: boolean;
  target?: AudioTarget;
  previousBlockId?: string;
  client?: Client;
}

export interface AddAudioResult {
  replaced: boolean;
  appended: boolean;
  blockId?: string;
}

interface TopLevelAnchor {
  anchorBlockId: string;
  insertAfterBlockId?: string;
  adjacentAudioBlockId?: string;
  adjacentAudioUrl?: string;
}

export function getClient(): Client {
  return createNotionClient();
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, ' ');
}

function blockPlainText(block: Record<string, unknown>, type: 'toggle' | 'heading_3'): string {
  const payload = block[type] as { rich_text?: { plain_text?: string }[] } | undefined;
  const richText = payload?.rich_text ?? [];
  return richText
    .map((item) => item?.plain_text ?? '')
    .join('')
    .trim();
}

function isStudyTextToggle(block: Record<string, unknown>): boolean {
  if (block.type !== 'toggle') return false;
  const label = normalizeText(blockPlainText(block, 'toggle'));
  return label === 'study-text';
}

function isPronunciationHeading(block: Record<string, unknown>): boolean {
  if (block.type !== 'heading_3') return false;
  const label = normalizeText(blockPlainText(block, 'heading_3'));
  return label.includes('pronunciation') && label.includes('micro') && label.includes('focus');
}

function getAudioExternalUrl(block: Record<string, unknown>): string | undefined {
  if (block.type !== 'audio') return undefined;
  const audio = block.audio as
    | {
        type?: string;
        external?: { url?: string };
      }
    | undefined;
  if (audio?.type !== 'external') return undefined;
  const url = audio.external?.url?.trim();
  return url && url.length > 0 ? url : undefined;
}

async function listTopLevelBlocks(
  client: Client,
  pageId: string,
): Promise<Record<string, unknown>[]> {
  const blocks: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  do {
    const resp = await withRetry(
      () => client.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 }),
      'blocks.children.list',
    );
    for (const block of resp.results) {
      if (!('type' in block)) continue;
      blocks.push(block as unknown as Record<string, unknown>);
    }
    cursor = resp.next_cursor ?? undefined;
  } while (cursor);
  return blocks;
}

function findAnchorForTarget(
  blocks: Record<string, unknown>[],
  target: AudioTarget,
): TopLevelAnchor | null {
  const anchorIndex = blocks.findIndex((block) =>
    target === 'study-text' ? isStudyTextToggle(block) : isPronunciationHeading(block),
  );
  if (anchorIndex === -1) return null;
  const anchor = blocks.at(anchorIndex);
  if (!anchor) return null;
  const anchorBlockId = String(anchor.id ?? '').trim();
  if (!anchorBlockId) return null;

  if (target === 'study-text') {
    let previousNonAudioBlockId: string | undefined;
    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
      const candidate = blocks[index];
      if (!candidate) continue;
      if (candidate.type === 'audio') continue;
      previousNonAudioBlockId = String(candidate.id ?? '').trim() || undefined;
      break;
    }
    const adjacent = blocks[anchorIndex - 1];
    const adjacentAudioBlockId =
      adjacent?.type === 'audio' ? String(adjacent.id ?? '').trim() || undefined : undefined;
    return {
      anchorBlockId,
      insertAfterBlockId: previousNonAudioBlockId,
      adjacentAudioBlockId,
      adjacentAudioUrl:
        adjacent && adjacentAudioBlockId ? getAudioExternalUrl(adjacent) : undefined,
    };
  }

  const adjacent = blocks[anchorIndex + 1];
  const adjacentAudioBlockId =
    adjacent?.type === 'audio' ? String(adjacent.id ?? '').trim() || undefined : undefined;
  return {
    anchorBlockId,
    insertAfterBlockId: anchorBlockId,
    adjacentAudioBlockId,
    adjacentAudioUrl: adjacent && adjacentAudioBlockId ? getAudioExternalUrl(adjacent) : undefined,
  };
}

async function deleteIfExists(client: Client, blockId: string): Promise<boolean> {
  const trimmed = blockId.trim();
  if (!trimmed) return false;
  try {
    await withRetry(() => client.blocks.delete({ block_id: trimmed }), 'blocks.delete');
    return true;
  } catch (error: unknown) {
    if (
      (isNotionClientError(error) && error.code === APIErrorCode.ObjectNotFound) ||
      (typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        (error as { status?: unknown }).status === 404)
    ) {
      return false;
    }
    throw error;
  }
}

export async function addOrReplaceAudio(
  pageId: string,
  url: string,
  opts: AddAudioOpts = {},
): Promise<AddAudioResult> {
  if (!pageId.trim()) throw new ValidationError('pageId is required');
  if (!url.trim()) throw new ValidationError('url is required');

  const target = opts.target ?? 'study-text';
  const client = opts.client ?? getClient();
  const blocks = await listTopLevelBlocks(client, pageId);
  const anchor = findAnchorForTarget(blocks, target);
  if (!anchor) {
    const label =
      target === 'study-text'
        ? 'study-text toggle'
        : 'Pronunciation Micro-Focus heading (### C...)';
    throw new ValidationError(`${label} not found on page`);
  }

  let replaced = false;
  const currentUrl = anchor.adjacentAudioUrl?.trim();
  if (!opts.replace && anchor.adjacentAudioBlockId) {
    if (currentUrl && currentUrl === url.trim()) {
      return {
        replaced: false,
        appended: false,
        blockId: anchor.adjacentAudioBlockId,
      };
    }
    return { replaced: false, appended: false };
  }

  if (opts.replace) {
    let deleted = false;
    if (opts.previousBlockId?.trim()) {
      deleted = await deleteIfExists(client, opts.previousBlockId);
    }
    if (!deleted && anchor.adjacentAudioBlockId) {
      deleted = await deleteIfExists(client, anchor.adjacentAudioBlockId);
    }
    if (deleted) {
      replaced = true;
    }
  }

  const appendPayload: Parameters<Client['blocks']['children']['append']>[0] = {
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
  if (anchor.insertAfterBlockId) {
    appendPayload.after = anchor.insertAfterBlockId;
  }

  const appended = await withRetry(
    () => client.blocks.children.append(appendPayload),
    'blocks.children.append',
  );
  const blockId = appended.results.find((block) => 'id' in block)?.id;

  return {
    replaced,
    appended: true,
    blockId: typeof blockId === 'string' ? blockId : undefined,
  };
}

export async function addOrReplaceAudioUnderStudyText(
  pageId: string,
  url: string,
  opts: AddAudioOpts = {},
): Promise<AddAudioResult> {
  return addOrReplaceAudio(pageId, url, { ...opts, target: 'study-text' });
}
