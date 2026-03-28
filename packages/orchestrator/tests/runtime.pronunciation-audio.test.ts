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
      chunkVoiceId: 'voice-1',
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
    expect(result?.primaryClip).toBeNull();
    expect(result?.itemClips?.every((entry: { engine: string }) => entry.engine === 'provider')).toBe(
      true,
    );
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenCalledTimes(2);
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

  it('uses careful connected-speech text when the connected target is IPA-only', async () => {
    vi.mocked(extractPronunciationFocus).mockReturnValue({
      mode: 'connected_speech',
      naturalSentence: 'The device is as heavy as the old one.',
      lines: [
        {
          line: 1,
          careful: 'The device is as heavy as the old one.',
          connected: '/ðə dɪˈvaɪs ɪz æz ˈhɛvi æz ði əʊld wʌn/',
        },
      ],
      sectionStartLine: 1,
      issues: [],
    });
    vi.mocked(buildPronunciationTextMp3).mockImplementation(async ({ text }) => ({
      path: `/tmp/${String(text).replaceAll(/\s+/g, '-')}.mp3`,
      hash: `hash-${String(text).replaceAll(/\s+/g, '-')}`,
      voiceId: 'provider-voice',
      provider: 'elevenlabs',
      generatedCharacters: String(text).length,
      cachedCharacters: 0,
    }));

    const logs: unknown[] = [];
    const result = await synthesizePronunciationAudio({
      context: {} as never,
      mdPath: '/tmp/example.md',
      outPath: '/tmp',
      title: 'Pronunciation',
      primaryVoiceId: 'voice-1',
      chunkVoiceId: 'voice-1',
      logger: {
        log: (entry: unknown) => logs.push(entry),
      } as never,
    });

    expect(result?.mode).toBe('connected_speech');
    expect(result?.primaryClip?.text).toBe('The device is as heavy as the old one.');
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: 'The device is as heavy as the old one.',
      }),
      expect.any(Object),
    );
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: 'The device is as heavy as the old one.',
      }),
      expect.any(Object),
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: 'warn',
          message:
            'Connected-speech pronunciation target was IPA-only; using careful text for provider TTS',
        }),
      ]),
    );
  });

  it('reuses the primary provider voice for sentence-level item clips when no chunk voice override is provided', async () => {
    vi.mocked(extractPronunciationFocus).mockReturnValue({
      mode: 'sentence_stress',
      naturalSentence: 'We really need to leave now before traffic gets worse.',
      drills: [
        {
          line: 1,
          text: 'We REALLY need to leave now.',
        },
      ],
      sectionStartLine: 1,
      issues: [],
    });
    vi.mocked(buildPronunciationTextMp3).mockImplementation(async ({ text, voiceId }) => ({
      path: `/tmp/${String(text).replaceAll(/\s+/g, '-')}.mp3`,
      hash: `hash-${String(text).replaceAll(/\s+/g, '-')}`,
      voiceId,
      provider: 'google',
      generatedCharacters: String(text).length,
      cachedCharacters: 0,
    }));

    const result = await synthesizePronunciationAudio({
      context: {} as never,
      mdPath: '/tmp/example.md',
      outPath: '/tmp',
      title: 'Pronunciation',
      primaryTtsProvider: 'google',
      primaryGoogleTtsModel: 'studio',
      primaryVoiceId: 'voice-primary',
    });

    expect(result?.mode).toBe('sentence_stress');
    expect(result?.primaryClip?.voiceId).toBe('voice-primary');
    expect(result?.itemClips).toHaveLength(1);
    expect(result?.itemClips?.[0]?.voiceId).toBe('voice-primary');
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: 'We REALLY need to leave now.',
        voiceId: 'voice-primary',
      }),
      expect.objectContaining({
        ttsProvider: 'google',
        googleTtsModel: 'studio',
      }),
    );
  });
});
