import { describe, expect, it } from 'vitest';

import {
  createInworldTtsProvider,
  loadInworldVoicesCatalog,
  resolveInworldTtsModel,
} from '../src/index.js';

describe('inworld provider adapter basics', () => {
  it('defaults model family to inworld-tts-2', () => {
    delete process.env.ESL_TTS_PROVIDER_INWORLD_MODEL;

    expect(resolveInworldTtsModel()).toBe('inworld-tts-2');
  });

  it('accepts all supported Inworld TTS models', () => {
    expect(resolveInworldTtsModel('inworld-tts-2')).toBe('inworld-tts-2');
    expect(resolveInworldTtsModel('inworld-tts-1.5-max')).toBe('inworld-tts-1.5-max');
    expect(resolveInworldTtsModel('inworld-tts-1.5-mini')).toBe('inworld-tts-1.5-mini');
  });

  it('exposes fallback voice capabilities without live credentials', async () => {
    delete process.env.INWORLD_API_KEY;
    delete process.env.ESL_TTS_PROVIDER_INWORLD_API_KEY;

    const catalog = await loadInworldVoicesCatalog();

    expect(catalog.capabilities?.provider).toBe('inworld');
    expect(catalog.capabilities?.style).toEqual([
      'inworld-tts-1.5-max',
      'inworld-tts-1.5-mini',
      'inworld-tts-2',
    ]);
    expect(catalog.voices.map((voice) => voice.id)).toEqual(['Ashley', 'Dennis']);
  });

  it('reports provider metadata for selected model', () => {
    const provider = createInworldTtsProvider();

    expect(
      provider.providerMetadata({
        studyTextOptions: {
          voiceMapPath: 'voices.yml',
          outPath: '/tmp',
          ttsModel: 'inworld-tts-1.5-mini',
        },
      }),
    ).toEqual({
      provider: 'inworld',
      modelFamily: 'inworld-tts-1.5-mini',
      pricingToken: 'INWORLD_TTS',
    });
  });
});
