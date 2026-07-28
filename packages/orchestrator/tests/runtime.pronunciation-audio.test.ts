import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@esl-pipeline/pmd', () => ({
  extractPronunciationFocus: vi.fn(),
}));

vi.mock('@esl-pipeline/tts-core', async () => ({
  ...(await vi.importActual<typeof import('@esl-pipeline/tts-core')>('@esl-pipeline/tts-core')),
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

import { extractPronunciationFocus } from '@esl-pipeline/pmd';
import {
  buildPronunciationShadowSentenceMp3,
  buildPronunciationTextMp3,
  TtsSynthesisCancelledError,
} from '@esl-pipeline/tts-core';

import { synthesizePronunciationAudio } from '../src/runtime/pronunciation-audio.js';

describe('runtime/pronunciation-audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates one request control to shadow primary and item synthesis', async () => {
    vi.mocked(extractPronunciationFocus).mockReturnValue({
      mode: 'shadow_sentence',
      shadowSentence: 'Use one shared request control.',
      words: [{ line: 1, text: 'shared request', transcription: '/shared request/' }],
      sectionStartLine: 1,
      issues: [],
    });
    vi.mocked(buildPronunciationShadowSentenceMp3).mockResolvedValue({
      path: '/tmp/shadow.mp3',
      hash: 'shadow-hash',
      voiceId: 'voice-primary',
    });
    vi.mocked(buildPronunciationTextMp3).mockResolvedValue({
      path: '/tmp/item.mp3',
      hash: 'item-hash',
      voiceId: 'voice-primary',
    });
    const controller = new AbortController();
    const deadlineAtMs = Date.now() + 60_000;

    await synthesizePronunciationAudio({
      context: {} as never,
      mdPath: '/tmp/example.md',
      outPath: '/tmp',
      primaryTtsProvider: 'inworld',
      primaryVoiceId: 'voice-primary',
      signal: controller.signal,
      deadlineAtMs,
    });

    expect(vi.mocked(buildPronunciationShadowSentenceMp3)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signal: controller.signal, deadlineAtMs }),
    );
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signal: controller.signal, deadlineAtMs }),
    );
  });

  it('starts no pronunciation worker when the caller is already cancelled', async () => {
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
    const controller = new AbortController();
    controller.abort('operator stop');

    await expect(
      synthesizePronunciationAudio({
        context: {} as never,
        mdPath: '/tmp/example.md',
        outPath: '/tmp',
        primaryVoiceId: 'voice-primary',
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(TtsSynthesisCancelledError);
    expect(vi.mocked(buildPronunciationTextMp3)).not.toHaveBeenCalled();
  });

  it('lets started pronunciation calls settle but launches no more after cancellation', async () => {
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
    const pending: Array<() => void> = [];
    vi.mocked(buildPronunciationTextMp3).mockImplementation(
      ({ text, voiceId }) =>
        new Promise((resolve) => {
          pending.push(() =>
            resolve({
              path: `/tmp/${text}.mp3`,
              hash: `hash-${text}`,
              voiceId,
            }),
          );
        }),
    );
    const controller = new AbortController();
    const result = expect(
      synthesizePronunciationAudio({
        context: {} as never,
        mdPath: '/tmp/example.md',
        outPath: '/tmp',
        regeneratePrimary: false,
        primaryVoiceId: 'voice-primary',
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(TtsSynthesisCancelledError);

    await vi.waitFor(() => expect(buildPronunciationTextMp3).toHaveBeenCalledTimes(3));
    controller.abort('operator stop');
    for (const resolve of pending.slice(0, 3)) resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (const resolve of pending.slice(3)) resolve();

    await result;
    expect(buildPronunciationTextMp3).toHaveBeenCalledTimes(3);
  });

  it('synthesizes one Word clip per shadow drill without duplicate Natural clips', async () => {
    vi.mocked(extractPronunciationFocus).mockReturnValue({
      mode: 'shadow_sentence',
      shadowSentence: 'She asks me to use a natural workplace phrase.',
      words: [
        { line: 1, text: 'asks me to', transcription: '/asks mi tu/' },
        {
          line: 2,
          text: 'a natural workplace phrase',
          transcription: '/a natural workplace phrase/',
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
      regeneratePrimary: false,
      primaryTtsProvider: 'google',
      primaryVoiceId: 'voice-primary',
    });

    expect(result?.itemClips).toHaveLength(2);
    expect(result?.itemClips?.map((clip) => clip.text)).toEqual([
      'asks me to',
      'a natural workplace phrase',
    ]);
    expect(result?.itemClips?.map((clip) => clip.label)).toEqual(['Word', 'Word']);
    expect(result?.itemClips?.some((clip) => clip.label === 'Natural')).toBe(false);
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenCalledTimes(2);
  });

  it('defaults pronunciation chunk clips to google provider synthesis', async () => {
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

  it('uses the normal written connected-speech phrase for item audio', async () => {
    vi.mocked(extractPronunciationFocus).mockReturnValue({
      mode: 'connected_speech',
      naturalSentence: 'I saw a tuft of feathers on the path.',
      lines: [
        {
          line: 1,
          careful: 'a tuft of feathers',
          connected: 'ə-tuft-uv-feathers',
        },
      ],
      sectionStartLine: 1,
      issues: [],
    });
    vi.mocked(buildPronunciationTextMp3).mockImplementation(async ({ text }) => ({
      path: `/tmp/${String(text).replaceAll(/\s+/g, '-')}.mp3`,
      hash: `hash-${String(text).replaceAll(/\s+/g, '-')}`,
      voiceId: 'provider-voice',
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
      regeneratePrimary: false,
      primaryTtsProvider: 'google',
      primaryVoiceId: 'voice-1',
    });

    expect(result?.mode).toBe('connected_speech');
    expect(result?.itemClips).toHaveLength(1);
    expect(result?.itemClips?.[0]?.text).toBe('a tuft of feathers');
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        text: 'a tuft of feathers',
      }),
      expect.any(Object),
    );
  });

  it('reuses unchanged pronunciation item clips while synthesizing changed clips', async () => {
    vi.mocked(extractPronunciationFocus).mockReturnValue({
      mode: 'connected_speech',
      naturalSentence: 'I saw a tuft of feathers and a cup of tea.',
      lines: [
        {
          line: 1,
          careful: 'a tuft of feathers',
          connected: 'ə-tuft-uv-feathers',
        },
        {
          line: 2,
          careful: 'a cup of tea',
          connected: 'ə-cup-uv-tea',
        },
      ],
      sectionStartLine: 1,
      issues: [],
    });
    vi.mocked(buildPronunciationTextMp3).mockImplementation(async ({ text }) => ({
      path: `/tmp/${String(text).replaceAll(/\s+/g, '-')}.mp3`,
      hash: `hash-${String(text).replaceAll(/\s+/g, '-')}`,
      voiceId: 'chunk-voice',
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
      regeneratePrimary: false,
      primaryTtsProvider: 'google',
      primaryVoiceId: 'voice-1',
      chunkVoiceId: 'chunk-voice',
      previousAudio: {
        mode: 'connected_speech',
        itemClips: [
          {
            id: 'connected-speech-1',
            itemIndex: 0,
            kind: 'connected_target',
            engine: 'provider',
            text: 'a tuft of feathers',
            label: 'Play',
            url: 'https://cdn.example/audio/a-tuft-of-feathers.mp3',
            hash: 'old-hash-a-tuft-of-feathers',
            voiceId: 'chunk-voice',
            tts: {
              provider: 'google',
              modelId: 'chirp3_hd',
              generatedCharacters: 18,
              cachedCharacters: 0,
            },
          },
          {
            id: 'connected-speech-2',
            itemIndex: 1,
            kind: 'connected_target',
            engine: 'provider',
            text: 'old phrase',
            label: 'Play',
            url: 'https://cdn.example/audio/old-phrase.mp3',
            hash: 'old-hash-old-phrase',
            voiceId: 'chunk-voice',
            tts: {
              provider: 'google',
              modelId: 'chirp3_hd',
              generatedCharacters: 10,
              cachedCharacters: 0,
            },
          },
        ],
      },
    });

    expect(result?.itemClips).toHaveLength(2);
    expect(result?.itemClips?.[0]).toEqual(
      expect.objectContaining({
        text: 'a tuft of feathers',
        url: 'https://cdn.example/audio/a-tuft-of-feathers.mp3',
        hash: 'old-hash-a-tuft-of-feathers',
      }),
    );
    expect(result?.itemClips?.[1]).toEqual(
      expect.objectContaining({
        text: 'a cup of tea',
        hash: 'hash-a-cup-of-tea',
      }),
    );
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildPronunciationTextMp3)).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'a cup of tea' }),
      expect.any(Object),
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
    expect(result?.primaryClip?.text).toBe(
      'We really need to leave now before traffic gets worse.',
    );
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
