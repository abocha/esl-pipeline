import type { Client } from '@notionhq/client';
import { describe, expect, it, vi } from 'vitest';

import { addOrReplaceAudio } from '../src/audio.js';

type NotionBlock = Record<string, unknown>;

function createMockClient(blocks: NotionBlock[], appendedBlockId = 'new-audio-block') {
  const list = vi.fn().mockResolvedValue({
    results: blocks,
    next_cursor: null,
  });
  const append = vi.fn().mockResolvedValue({
    results: [{ id: appendedBlockId, type: 'audio' }],
  });
  const remove = vi.fn().mockResolvedValue({});

  const client = {
    blocks: {
      children: {
        list,
        append,
      },
      delete: remove,
    },
  } as unknown as Client;

  return { client, list, append, remove };
}

function studyToggle(id: string): NotionBlock {
  return {
    id,
    type: 'toggle',
    toggle: {
      rich_text: [{ plain_text: 'study-text' }],
    },
  };
}

function pronunciationHeading(id: string): NotionBlock {
  return {
    id,
    type: 'heading_3',
    heading_3: {
      rich_text: [{ plain_text: 'C. Pronunciation Micro-Focus' }],
    },
  };
}

function externalAudio(id: string, url: string): NotionBlock {
  return {
    id,
    type: 'audio',
    audio: {
      type: 'external',
      external: { url },
    },
  };
}

describe('notion audio target insertion', () => {
  it('study-text insertion does not delete unrelated top-level audio blocks', async () => {
    const { client, append, remove } = createMockClient([
      { id: 'h2-a', type: 'heading_2' },
      externalAudio('unrelated-audio', 'https://example.com/unrelated.mp3'),
      { id: 'paragraph-1', type: 'paragraph' },
      studyToggle('study-toggle'),
    ]);

    const result = await addOrReplaceAudio('page-1', 'https://example.com/study.mp3', {
      target: 'study-text',
      replace: true,
      client,
    });

    expect(remove).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        block_id: 'page-1',
        after: 'paragraph-1',
      }),
    );
    expect(result.appended).toBe(true);
    expect(result.blockId).toBe('new-audio-block');
  });

  it('pronunciation-shadow-sentence insertion anchors at pronunciation heading', async () => {
    const { client, append } = createMockClient([
      { id: 'paragraph-0', type: 'paragraph' },
      pronunciationHeading('pron-heading'),
      { id: 'paragraph-1', type: 'paragraph' },
    ]);

    const result = await addOrReplaceAudio('page-2', 'https://example.com/pronunciation.mp3', {
      target: 'pronunciation-shadow-sentence',
      replace: true,
      client,
    });

    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        block_id: 'page-2',
        after: 'pron-heading',
      }),
    );
    expect(result.appended).toBe(true);
    expect(result.blockId).toBe('new-audio-block');
  });

  it('uses previousBlockId for targeted replacement when provided', async () => {
    const { client, remove } = createMockClient([
      { id: 'paragraph-0', type: 'paragraph' },
      pronunciationHeading('pron-heading'),
      externalAudio('adjacent-pronunciation', 'https://example.com/old-pronunciation.mp3'),
    ]);

    await addOrReplaceAudio('page-3', 'https://example.com/new-pronunciation.mp3', {
      target: 'pronunciation-shadow-sentence',
      replace: true,
      previousBlockId: 'tracked-audio-block-id',
      client,
    });

    expect(remove).toHaveBeenCalledWith({ block_id: 'tracked-audio-block-id' });
    expect(remove).not.toHaveBeenCalledWith({ block_id: 'adjacent-pronunciation' });
  });

  it('falls back to adjacent audio deletion when previousBlockId is stale', async () => {
    const { client, remove } = createMockClient([
      { id: 'paragraph-0', type: 'paragraph' },
      pronunciationHeading('pron-heading'),
      externalAudio('adjacent-pronunciation', 'https://example.com/old-pronunciation.mp3'),
    ]);
    const notFoundError = Object.assign(new Error('not found'), { status: 404 });
    remove.mockRejectedValueOnce(notFoundError).mockResolvedValueOnce({});

    await addOrReplaceAudio('page-5', 'https://example.com/new-pronunciation.mp3', {
      target: 'pronunciation-shadow-sentence',
      replace: true,
      previousBlockId: 'stale-tracked-id',
      client,
    });

    expect(remove).toHaveBeenNthCalledWith(1, { block_id: 'stale-tracked-id' });
    expect(remove).toHaveBeenNthCalledWith(2, { block_id: 'adjacent-pronunciation' });
  });

  it('rethrows non-not-found delete failures instead of appending duplicates', async () => {
    const { client, append, remove } = createMockClient([
      { id: 'paragraph-0', type: 'paragraph' },
      pronunciationHeading('pron-heading'),
      externalAudio('adjacent-pronunciation', 'https://example.com/old-pronunciation.mp3'),
    ]);
    const authError = Object.assign(new Error('unauthorized'), { status: 401 });
    remove.mockRejectedValueOnce(authError);

    await expect(
      addOrReplaceAudio('page-6', 'https://example.com/new-pronunciation.mp3', {
        target: 'pronunciation-shadow-sentence',
        replace: true,
        previousBlockId: 'tracked-id',
        client,
      }),
    ).rejects.toThrow('unauthorized');
    expect(append).not.toHaveBeenCalled();
  });

  it('is idempotent when adjacent audio already matches and replace=false', async () => {
    const { client, append } = createMockClient([
      { id: 'paragraph-0', type: 'paragraph' },
      externalAudio('study-audio', 'https://example.com/study.mp3'),
      studyToggle('study-toggle'),
    ]);

    const result = await addOrReplaceAudio('page-4', 'https://example.com/study.mp3', {
      target: 'study-text',
      replace: false,
      client,
    });

    expect(result).toEqual({
      replaced: false,
      appended: false,
      blockId: 'study-audio',
    });
    expect(append).not.toHaveBeenCalled();
  });
});
