import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@esl-pipeline/pmd', () => ({
  extractPronunciationFocus: vi.fn(),
}));

vi.mock('@esl-pipeline/tts-core', () => ({
  buildPronunciationShadowSentenceMp3: vi.fn(),
  buildPronunciationTextMp3: vi.fn(),
  isTtsModelForProvider: (provider: string, model: string) =>
    provider === 'google'
      ? ['chirp3_hd', 'studio', 'neural2', 'wavenet'].includes(model)
      : provider === 'elevenlabs'
        ? ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2'].includes(
            model,
          )
        : ['inworld-tts-2', 'inworld-tts-1.5-max', 'inworld-tts-1.5-mini'].includes(model),
  resolveDefaultTtsModel: (provider: string) =>
    provider === 'google'
      ? 'chirp3_hd'
      : provider === 'inworld'
        ? 'inworld-tts-2'
        : 'eleven_multilingual_v2',
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
      chunkTtsProvider: 'edge-tts',
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
    expect(
      result?.itemClips?.every((entry: { engine: string }) => entry.engine === 'provider'),
    ).toBe(true);
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

  it('defaults pronunciation chunk clips to google without invoking edge-tts', async () => {
    vi.mocked(extractPronunciationFocus).mockReturnValue({
      mode: 'minimal_pair',
      pairs: [
        {
          line: 1,
          left: { text: 'pull', transcription: '/pʊl/', line: 1 },
          right: { text: 'pool', transcription: '/puːl/', line: 1 },
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
      modelId: 'chirp3_hd',
      generatedCharacters: String(text).length,
      cachedCharacters: 0,
    }));

    const result = await synthesizePronunciationAudio({
      context: {} as never,
      mdPath: '/tmp/example.md',
      outPath: '/tmp',
      title: 'Pronunciation',
      primaryTtsProvider: 'elevenlabs',
      primaryVoiceId: 'eleven-voice-1',
      chunkVoiceId: 'en-US-Chirp3-HD-Achernar',
    });

    expect(result?.mode).toBe('minimal_pair');
    expect(result?.itemClips).toHaveLength(2);
    expect(vi.mocked(synthesizeEdgeTtsClip)).not.toHaveBeenCalled();
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: 'pull',
        voiceId: 'en-US-Chirp3-HD-Achernar',
      }),
      expect.objectContaining({
        ttsProvider: 'google',
      }),
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

  it('uses the Google chunk default voice for sentence-level item clips when no chunk voice override is provided', async () => {
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
    vi.mocked(buildPronunciationTextMp3).mockImplementation(
      async ({ text, voiceId }, providerConfig) => ({
        path: `/tmp/${String(text).replaceAll(/\s+/g, '-')}.mp3`,
        hash: `hash-${String(text).replaceAll(/\s+/g, '-')}`,
        voiceId,
        provider: 'google',
        modelId: providerConfig.ttsModel,
        generatedCharacters: String(text).length,
        cachedCharacters: 0,
      }),
    );

    const result = await synthesizePronunciationAudio({
      context: {} as never,
      mdPath: '/tmp/example.md',
      outPath: '/tmp',
      title: 'Pronunciation',
      primaryTtsProvider: 'google',
      primaryTtsModel: 'studio',
      primaryVoiceId: 'voice-primary',
    });

    expect(result?.mode).toBe('sentence_stress');
    expect(result?.primaryClip?.voiceId).toBe('voice-primary');
    expect(result?.primaryClip?.tts?.modelId).toBe('studio');
    expect(result?.itemClips).toHaveLength(1);
    expect(result?.itemClips?.[0]?.voiceId).toBe('en-US-Chirp3-HD-Charon');
    expect(result?.itemClips?.[0]?.tts?.modelId).toBe('chirp3_hd');
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        text: 'We REALLY need to leave now.',
        voiceId: 'en-US-Chirp3-HD-Charon',
      }),
      expect.objectContaining({
        ttsProvider: 'google',
        ttsModel: 'chirp3_hd',
      }),
    );
  });

  it('persists the resolved edge voice on chunk artifacts for future reruns', async () => {
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
    vi.mocked(synthesizeEdgeTtsClip).mockImplementation(async ({ text, voice }) => ({
      path: `/tmp/${String(text).replaceAll(/\s+/g, '-')}.mp3`,
      hash: `edge-hash-${String(text).replaceAll(/\s+/g, '-')}`,
      voice: voice ?? 'en-US-AriaNeural',
      generatedCharacters: String(text).length,
      cachedCharacters: 0,
    }));

    const result = await synthesizePronunciationAudio({
      context: {} as never,
      mdPath: '/tmp/example.md',
      outPath: '/tmp',
      title: 'Pronunciation',
      chunkTtsProvider: 'edge-tts',
      chunkEdgeVoice: 'en-GB-SoniaNeural',
    });

    expect(result?.itemClips).toHaveLength(2);
    expect(result?.itemClips?.every((clip) => clip.voiceId === 'en-GB-SoniaNeural')).toBe(true);
    expect(result?.itemClips?.every((clip) => clip.tts?.provider === 'edge')).toBe(true);
  });

  it('synthesizes independent item clips with bounded concurrency while preserving order', async () => {
    vi.mocked(extractPronunciationFocus).mockReturnValue({
      mode: 'sentence_stress',
      naturalSentence: 'One two three four five.',
      drills: [
        { line: 1, text: 'one' },
        { line: 2, text: 'two' },
        { line: 3, text: 'three' },
        { line: 4, text: 'four' },
        { line: 5, text: 'five' },
      ],
      sectionStartLine: 1,
      issues: [],
    });

    let inFlight = 0;
    let maxInFlight = 0;
    const delayByText = new Map([
      ['one', 30],
      ['two', 20],
      ['three', 10],
      ['four', 5],
      ['five', 1],
    ]);
    vi.mocked(buildPronunciationTextMp3).mockImplementation(async ({ text, voiceId }) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, delayByText.get(String(text)) ?? 1));
      inFlight -= 1;
      return {
        path: `/tmp/${String(text)}.mp3`,
        hash: `hash-${String(text)}`,
        voiceId,
        provider: 'google',
        modelId: 'chirp3_hd',
        generatedCharacters: String(text).length,
        cachedCharacters: 0,
      };
    });

    const result = await synthesizePronunciationAudio({
      context: {} as never,
      mdPath: '/tmp/example.md',
      outPath: '/tmp',
      title: 'Pronunciation',
      regeneratePrimary: false,
      primaryTtsProvider: 'google',
      primaryVoiceId: 'voice-primary',
    });

    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(result?.itemClips?.map((clip) => clip.text)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
    ]);
  });
});
