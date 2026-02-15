import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createNotionClientMock } = vi.hoisted(() => ({
  createNotionClientMock: vi.fn(),
}));

vi.mock('../src/client.js', () => ({
  createNotionClient: createNotionClientMock,
}));

const tempDirs: string[] = [];

async function createPresetsFile(content: Record<string, unknown>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-colorizer-idempotence-'));
  const filePath = path.join(root, 'presets.json');
  await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');
  tempDirs.push(root);
  return filePath;
}

function listResponse(results: unknown[]) {
  return {
    object: 'list',
    results,
    has_more: false,
    next_cursor: null,
    type: 'block',
    block: {},
  };
}

function heading2Block(id: string, color: string) {
  return {
    object: 'block',
    id,
    type: 'heading_2',
    heading_2: { rich_text: [], color },
  };
}

function heading3Block(id: string, color: string) {
  return {
    object: 'block',
    id,
    type: 'heading_3',
    heading_3: { rich_text: [], color },
  };
}

function toggleBlock(id: string, color: string, title = 'Practice') {
  return {
    object: 'block',
    id,
    type: 'toggle',
    toggle: {
      rich_text: [
        {
          type: 'text',
          plain_text: title,
          text: { content: title },
          annotations: {
            color,
          },
        },
      ],
      color: 'default',
    },
  };
}

describe('applyHeadingPreset idempotence', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('skips block updates when colors are already correct', async () => {
    const presetsPath = await createPresetsFile({
      'b1-default': { h2: 'blue', h3: 'green', toggleMap: { h2: 'yellow' } },
    });
    const list = vi
      .fn()
      .mockResolvedValueOnce(
        listResponse([
          heading2Block('h2-1', 'blue'),
          heading3Block('h3-1', 'green'),
          toggleBlock('toggle-1', 'yellow'),
        ]),
      )
      .mockResolvedValueOnce(listResponse([]));
    const update = vi.fn();
    createNotionClientMock.mockReturnValue({
      blocks: {
        children: {
          list,
        },
        update,
      },
    });

    const { applyHeadingPreset } = await import('../src/colorizer.js');
    const result = await applyHeadingPreset('page-1', 'b1-default', presetsPath);

    expect(result.counts).toEqual({ h2: 0, h3: 0, toggles: 0 });
    expect(update).not.toHaveBeenCalled();
  });

  it('updates only blocks that differ from target colors', async () => {
    const presetsPath = await createPresetsFile({
      'b1-default': { h2: 'blue', h3: 'green', toggleMap: { h2: 'yellow' } },
    });
    const list = vi
      .fn()
      .mockResolvedValueOnce(
        listResponse([
          heading2Block('h2-1', 'default'),
          toggleBlock('toggle-1', 'default'),
          heading3Block('h3-1', 'default'),
        ]),
      )
      .mockResolvedValueOnce(listResponse([]));
    const update = vi.fn().mockResolvedValue({});
    createNotionClientMock.mockReturnValue({
      blocks: {
        children: {
          list,
        },
        update,
      },
    });

    const { applyHeadingPreset } = await import('../src/colorizer.js');
    const result = await applyHeadingPreset('page-1', 'b1-default', presetsPath);

    expect(result.counts).toEqual({ h2: 1, h3: 1, toggles: 1 });
    expect(update).toHaveBeenCalledTimes(3);
  });
});
