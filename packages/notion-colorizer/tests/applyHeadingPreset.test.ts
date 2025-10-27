import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listMock, updateMock, ClientCtor } = vi.hoisted(() => {
  const listMock = vi.fn();
  const updateMock = vi.fn();
  const clientMock = {
    blocks: {
      children: {
        list: listMock,
      },
      update: updateMock,
    },
  };
  const ClientCtor = vi.fn(function ClientMock() {
    return clientMock;
  });
  return { listMock, updateMock, ClientCtor };
});

vi.mock('@notionhq/client', () => ({
  Client: ClientCtor,
}));

import { applyHeadingPreset } from '../src/index.js';

describe('applyHeadingPreset', () => {
  beforeEach(() => {
    process.env.NOTION_TOKEN = 'test-token';
    listMock.mockReset();
    updateMock.mockReset();
    ClientCtor.mockClear();
  });

  it('colors toggle label and heading_3 children inside toggles', async () => {
    const heading2Block = {
      object: 'block',
      id: 'h2-block',
      type: 'heading_2' as const,
      heading_2: { rich_text: [{ text: { content: 'Section' }, annotations: {} }] },
    };
    const toggleBlock = {
      object: 'block',
      id: 'toggle-block',
      type: 'toggle' as const,
      toggle: { rich_text: [{ text: { content: 'Toggle Title' }, annotations: {} }] },
    };
    const childHeading3 = {
      object: 'block',
      id: 'h3-child',
      type: 'heading_3' as const,
      heading_3: { rich_text: [{ text: { content: 'Inner Heading' }, annotations: {} }] },
    };
    const childParagraph = {
      object: 'block',
      id: 'paragraph-child',
      type: 'paragraph' as const,
      paragraph: { rich_text: [{ text: { content: 'Body' }, annotations: {} }] },
    };

    listMock.mockResolvedValueOnce({
      results: [heading2Block, toggleBlock],
      has_more: false,
      next_cursor: null,
    });
    listMock.mockResolvedValueOnce({
      results: [childHeading3, childParagraph],
      has_more: false,
      next_cursor: null,
    });

    const result = await applyHeadingPreset('page-id', 'b1-default', 'configs/presets.json');

    expect(result.applied).toBe(true);
    expect(result.counts).toEqual({ h2: 1, h3: 1, toggles: 1 });

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(listMock).toHaveBeenNthCalledWith(1, {
      block_id: 'page-id',
      start_cursor: undefined,
      page_size: 100,
    });
    expect(listMock).toHaveBeenNthCalledWith(2, {
      block_id: 'toggle-block',
      start_cursor: undefined,
      page_size: 100,
    });

    const updateCalls = updateMock.mock.calls;
    expect(updateCalls).toHaveLength(3);

    const firstCall = updateCalls[0]!;
    const secondCall = updateCalls[1]!;
    const thirdCall = updateCalls[2]!;
    expect(firstCall[0]).toMatchObject({
      block_id: 'h2-block',
      heading_2: { color: 'yellow_background' },
    });
    expect(secondCall[0]).toMatchObject({
      block_id: 'toggle-block',
      toggle: {
        rich_text: [
          expect.objectContaining({ annotations: expect.objectContaining({ color: 'yellow_background' }) }),
        ],
      },
    });
    expect(thirdCall[0]).toMatchObject({
      block_id: 'h3-child',
      heading_3: { color: 'purple_background' },
    });
  });
});
