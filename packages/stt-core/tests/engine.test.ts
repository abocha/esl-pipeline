import { beforeEach, describe, expect, it } from 'vitest';

import {
  type SttProviderAdapter,
  type SttProviderId,
  type SttTranscriptionResult,
  createSttEngine,
} from '../src/index.js';

function createProvider(id: SttProviderId): SttProviderAdapter {
  return {
    id,
    async transcribe() {
      return {
        provider: id,
        model: 'mock-model',
        language: 'en',
        text: id,
        rawResponse: {},
        segments: [],
        fallbackUsed: false,
      };
    },
  };
}

describe('stt-core engine', () => {
  const originalDefault = process.env.ESL_STT_DEFAULT_PROVIDER;
  const originalOrder = process.env.ESL_STT_PROVIDER_ORDER;

  beforeEach(() => {
    if (originalDefault === undefined) {
      delete process.env.ESL_STT_DEFAULT_PROVIDER;
    } else {
      process.env.ESL_STT_DEFAULT_PROVIDER = originalDefault;
    }

    if (originalOrder === undefined) {
      delete process.env.ESL_STT_PROVIDER_ORDER;
    } else {
      process.env.ESL_STT_PROVIDER_ORDER = originalOrder;
    }
  });

  it('uses explicit provider when supplied', async () => {
    const engine = createSttEngine([createProvider('deepgram'), createProvider('elevenlabs')]);

    const result = await engine.transcribe({
      provider: 'elevenlabs',
      context: {
        recordingId: 'rec-1',
        storageUri: 'local://audio.wav',
        async getStream() {
          throw new Error('not needed');
        },
      },
      configByProvider: {},
    });

    expect(result.provider).toBe('elevenlabs');
  });

  it('falls back to env default/provider order when explicit provider missing', async () => {
    process.env.ESL_STT_DEFAULT_PROVIDER = 'google';
    process.env.ESL_STT_PROVIDER_ORDER = 'google,deepgram,elevenlabs';

    const engine = createSttEngine([createProvider('deepgram'), createProvider('elevenlabs')]);

    const result = await engine.transcribe({
      context: {
        recordingId: 'rec-1',
        storageUri: 'local://audio.wav',
        async getStream() {
          throw new Error('not needed');
        },
      },
      configByProvider: {},
    });

    expect(result.provider).toBe('deepgram');
  });

  it('throws when no providers are registered', async () => {
    const engine = createSttEngine([]);

    await expect(
      engine.transcribe({
        context: {
          recordingId: 'rec-1',
          storageUri: 'local://audio.wav',
          async getStream() {
            throw new Error('not needed');
          },
        },
        configByProvider: {},
      }),
    ).rejects.toThrow(/not registered/i);
  });

  it('forwards provider config into adapter', async () => {
    let received: unknown = null;
    const provider: SttProviderAdapter = {
      id: 'deepgram',
      async transcribe(args): Promise<SttTranscriptionResult> {
        received = args.config;
        return {
          provider: 'deepgram',
          model: 'mock',
          language: 'en',
          text: 'ok',
          rawResponse: {},
          segments: [],
          fallbackUsed: false,
        };
      },
    };

    const engine = createSttEngine([provider]);
    await engine.transcribe({
      provider: 'deepgram',
      context: {
        recordingId: 'rec-1',
        storageUri: 'local://audio.wav',
        async getStream() {
          throw new Error('not needed');
        },
      },
      configByProvider: {
        deepgram: {
          model: 'nova-3',
        },
      },
    });

    expect(received).toEqual({ model: 'nova-3' });
  });
});
