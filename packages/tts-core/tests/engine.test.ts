import { describe, expect, it } from 'vitest';

import { createTtsEngine, type TtsProviderAdapter, type TtsProviderId } from '../src/index.js';

function createProvider(id: TtsProviderId): TtsProviderAdapter {
  return {
    id,
    providerMetadata() {
      return { provider: id, pricingToken: id.toUpperCase() };
    },
    voice: {
      async loadCatalog() {
        return { voices: [] };
      },
      async resolveSpeakerAssignments() {
        return [];
      },
    },
    async synthesizeStudyText() {
      return {
        path: `/tmp/${id}.mp3`,
        hash: id,
        voices: [],
        provider: id,
      };
    },
    async synthesizeShadowSentence() {
      return {
        path: `/tmp/${id}-shadow.mp3`,
        hash: `${id}-shadow`,
        voiceId: id,
        provider: id,
      };
    },
  };
}

describe('DefaultTtsEngine provider selection', () => {
  it('prefers elevenlabs by default when registered', async () => {
    delete process.env.ESL_TTS_DEFAULT_PROVIDER;
    delete process.env.ESL_TTS_PROVIDER_ORDER;

    const engine = createTtsEngine([createProvider('elevenlabs'), createProvider('google')]);
    const result = await engine.buildStudyTextMp3(
      { context: {} as never },
      { voiceMapPath: 'voices.yml', outPath: '/tmp' },
    );

    expect(result.provider).toBe('elevenlabs');
  });

  it('falls back to registered provider order when default is unavailable', async () => {
    process.env.ESL_TTS_DEFAULT_PROVIDER = 'google';
    process.env.ESL_TTS_PROVIDER_ORDER = 'google,elevenlabs';

    const engine = createTtsEngine([createProvider('elevenlabs')]);
    const result = await engine.buildStudyTextMp3(
      { context: {} as never },
      { voiceMapPath: 'voices.yml', outPath: '/tmp' },
    );

    expect(result.provider).toBe('elevenlabs');
  });

  it('uses explicit provider override over env defaults', async () => {
    process.env.ESL_TTS_DEFAULT_PROVIDER = 'elevenlabs';
    process.env.ESL_TTS_PROVIDER_ORDER = 'elevenlabs,google';

    const engine = createTtsEngine([createProvider('elevenlabs'), createProvider('google')]);
    const result = await engine.buildStudyTextMp3(
      { context: {} as never },
      { voiceMapPath: 'voices.yml', outPath: '/tmp', ttsProvider: 'google' },
    );

    expect(result.provider).toBe('google');
  });
});
