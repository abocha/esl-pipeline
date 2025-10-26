import { describe, expect, it, vi } from 'vitest';
import { addOrReplaceAudioUnderStudyText, AddAudioOpts } from '../src/index.js';

function makeMockClient() {
  return {
    blocks: {
      children: {
        list: vi.fn(),
        append: vi.fn(),
      },
      delete: vi.fn(),
    },
  } as any;
}

describe('addOrReplaceAudioUnderStudyText', () => {
  it('throws on missing pageId', async () => {
    await expect(
      addOrReplaceAudioUnderStudyText('', 'https://example.com/audio.mp3')
    ).rejects.toThrow('pageId is required');
  });

  it('throws on missing url', async () => {
    await expect(addOrReplaceAudioUnderStudyText('page123', '')).rejects.toThrow('url is required');
  });

  it('appends audio when no existing audio and replace=false', async () => {
    const mockClient = makeMockClient();
    mockClient.blocks.children.list
      .mockResolvedValueOnce({
        results: [
          {
            type: 'toggle',
            id: 'toggle123',
            toggle: { rich_text: [{ plain_text: 'study-text' }] },
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        results: [], // no existing audio
      });
    mockClient.blocks.children.append.mockResolvedValue({});

    const opts: AddAudioOpts = { client: mockClient };
    const result = await addOrReplaceAudioUnderStudyText(
      'page123',
      'https://example.com/audio.mp3',
      opts
    );
    expect(result.replaced).toBe(false);
    expect(result.appended).toBe(true);
  });

  it('replaces audio when existing audio and replace=true', async () => {
    const mockClient = makeMockClient();
    mockClient.blocks.children.list
      .mockResolvedValueOnce({
        results: [
          {
            type: 'toggle',
            id: 'toggle123',
            toggle: { rich_text: [{ plain_text: 'study-text' }] },
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        results: [{ type: 'audio', id: 'audio123' }], // existing audio
      });
    mockClient.blocks.children.append.mockResolvedValue({});
    mockClient.blocks.delete.mockResolvedValue({});

    const opts: AddAudioOpts = { client: mockClient, replace: true };
    const result = await addOrReplaceAudioUnderStudyText(
      'page123',
      'https://example.com/audio.mp3',
      opts
    );
    expect(result.replaced).toBe(true);
    expect(result.appended).toBe(true);
  });

  it('does not append or replace when existing audio and replace=false', async () => {
    const mockClient = makeMockClient();
    mockClient.blocks.children.list
      .mockResolvedValueOnce({
        results: [
          {
            type: 'toggle',
            id: 'toggle123',
            toggle: { rich_text: [{ plain_text: 'study-text' }] },
          },
        ],
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        results: [{ type: 'audio', id: 'audio123' }], // existing audio
      });

    const opts: AddAudioOpts = { client: mockClient, replace: false };
    const result = await addOrReplaceAudioUnderStudyText(
      'page123',
      'https://example.com/audio.mp3',
      opts
    );
    expect(result.replaced).toBe(false);
    expect(result.appended).toBe(false);
  });
});
