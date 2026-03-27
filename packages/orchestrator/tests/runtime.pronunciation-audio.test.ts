import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@esl-pipeline/pmd', () => ({
  extractPronunciationFocus: vi.fn(),
}));

vi.mock('@esl-pipeline/tts-core', () => ({
  buildPronunciationShadowSentenceMp3: vi.fn(),
  buildPronunciationTextMp3: vi.fn(),
}));

vi.mock('../src/runtime/edge-tts.js', () => ({
  synthesizeEdgeTtsClip: vi.fn(),
}));

import { extractPronunciationFocus } from '@esl-pipeline/pmd';
import { buildPronunciationTextMp3 } from '@esl-pipeline/tts-core';

import { synthesizeEdgeTtsClip } from '../src/runtime/edge-tts.js';
import { synthesizePronunciationAudio } from '../src/runtime/pronunciation-audio.js';

describe('runtime/pronunciation-audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('falls back to provider pronunciation audio when edge-tts is unavailable', async () => {
    vi.mocked(extractPronunciationFocus).mockReturnValue({
      mode: 'minimal_pair',
      pairs: [
        {
          line: 1,
          left: { text: 'ship', transcription: '/ʃɪp/', line: 1 },
          right: { text: 'sheep', transcription: '/ʃiːp/', line: 1 },
        },
      ],
      sectionStartLine: 1,
      issues: [],
    });
    vi.mocked(synthesizeEdgeTtsClip).mockRejectedValue(new Error('edge-tts missing'));
    vi.mocked(buildPronunciationTextMp3).mockImplementation(async ({ text }) => ({
      path: `/tmp/${String(text).replaceAll(/\s+/g, '-')}.mp3`,
      hash: `hash-${String(text).replaceAll(/\s+/g, '-')}`,
      voiceId: 'provider-voice',
      provider: 'google',
      generatedCharacters: String(text).length,
      cachedCharacters: 0,
    }));

    const logs: unknown[] = [];
    const result = await synthesizePronunciationAudio({
      context: {} as never,
      mdPath: '/tmp/example.md',
      outPath: '/tmp',
      title: 'Pronunciation',
      providerVoiceId: 'voice-1',
      logger: {
        log: (entry: unknown) => logs.push(entry),
      } as never,
    });

    expect(result?.mode).toBe('minimal_pair');
    expect(result?.warnings).toEqual([
      {
        code: 'edge_tts_unavailable_provider_fallback',
        message:
          'edge-tts was unavailable for word/pair pronunciation clips, so provider pronunciation audio was used instead.',
      },
    ]);
    expect(result?.primaryClip?.engine).toBe('provider');
    expect(result?.itemClips?.every((entry: { engine: string }) => entry.engine === 'provider')).toBe(
      true,
    );
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenCalledTimes(3);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          message:
            'edge-tts was unavailable for word/pair pronunciation clips, so provider pronunciation audio was used instead.',
        }),
      ]),
    );
  });
});
