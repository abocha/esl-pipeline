import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TtsProviderAdapter, TtsProviderId } from '@esl-pipeline/tts-core';
import { getRegisteredTtsProvider, loadVoicesCatalog } from '@esl-pipeline/tts-core';

import type { ConfigProvider } from '../src/config.js';
import { resolveJobOptions } from '../src/metadata/job-options.js';
import type { ResolvedConfigPaths } from '../src/pipeline.js';

vi.mock('@esl-pipeline/tts-core', async () => ({
  ...(await vi.importActual<typeof import('@esl-pipeline/tts-core')>('@esl-pipeline/tts-core')),
  loadVoicesCatalog: vi.fn(),
  getRegisteredTtsProvider: vi.fn(),
  registerTtsProvider: vi.fn(),
}));

const configPaths: ResolvedConfigPaths = {
  configRoot: '/repo/packages/orchestrator/configs',
  presetsPath: '/repo/packages/orchestrator/configs/presets.json',
  voicesPath: '/repo/packages/orchestrator/configs/voices.yml',
  studentsDir: '/repo/packages/orchestrator/configs/students',
};

function createConfigProvider(overrides: Partial<ConfigProvider> = {}): ConfigProvider {
  const base: ConfigProvider = {
    loadPresets: vi.fn().mockResolvedValue({}),
    loadStudentProfiles: vi.fn().mockResolvedValue([]),
    resolveVoicesPath: vi.fn().mockResolvedValue(void 0),
  };
  return { ...base, ...overrides };
}

function createProviderMock(id: TtsProviderId, modelFamily: string): TtsProviderAdapter {
  return {
    id,
    providerMetadata: () => ({
      provider: id,
      modelFamily,
      pricingToken: id === 'google' ? 'GOOGLE_TTS' : 'ELEVENLABS',
    }),
    voice: {
      loadCatalog: vi.fn(async () => ({ voices: [] })),
      resolveSpeakerAssignments: vi.fn(async () => []),
    },
    synthesizeStudyText: vi.fn(async () => ({
      path: '/tmp/study.mp3',
      hash: 'hash-study',
      voices: [],
    })),
    synthesizeShadowSentence: vi.fn(async () => ({
      path: '/tmp/shadow.mp3',
      hash: 'hash-shadow',
      voiceId: 'voice-1',
    })),
    synthesizePronunciationText: vi.fn(async () => ({
      path: '/tmp/pronunciation.mp3',
      hash: 'hash-pronunciation',
      voiceId: 'voice-1',
    })),
  };
}

describe('metadata/job-options', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('ESL_TTS_DEFAULT_PROVIDER', '');
    vi.mocked(getRegisteredTtsProvider).mockImplementation((providerId) => {
      if (providerId === 'elevenlabs') {
        return createProviderMock('elevenlabs', 'eleven_multilingual_v2');
      }
      if (providerId === 'google') {
        return createProviderMock('google', 'chirp3_hd');
      }
    });
  });

  it.each(['', 'inworld'])(
    'publishes the configured provider default (%s), with Gemini when unset',
    async (configured) => {
      vi.stubEnv('ESL_TTS_DEFAULT_PROVIDER', configured);
      vi.mocked(getRegisteredTtsProvider).mockImplementation((id) =>
        createProviderMock(id, id === 'gemini' ? 'gemini-3.8-flash-lite-tts' : 'inworld-tts-2'),
      );
      vi.mocked(loadVoicesCatalog).mockResolvedValue({ voices: [] });
      const result = await resolveJobOptions({
        configProvider: createConfigProvider(),
        configPaths,
      });
      expect(result.defaultTtsProvider).toBe(configured || 'gemini');
      expect(result.defaultTtsModelByProvider?.gemini).toBe('gemini-3.8-flash-lite-tts');
    },
  );

  it('returns orchestrator-backed presets and voices without retired notion metadata', async () => {
    const configProvider = createConfigProvider({
      loadPresets: vi.fn().mockResolvedValue({
        'b1-default': {},
        'b2-alt': {},
      }),
    });

    vi.mocked(loadVoicesCatalog).mockResolvedValue({
      voices: [
        {
          id: 'voice_a',
          name: 'Amanda',
          category: 'narration',
          labels: { accent: 'American', gender: 'Female' },
        },
        {
          id: 'voice_b',
          name: 'Luke',
          labels: { accent: 'British', gender: 'Male' },
        },
      ],
    });

    const result = await resolveJobOptions({ configProvider, configPaths });

    expect(configProvider.loadPresets).toHaveBeenCalledWith(configPaths.presetsPath);
    expect(loadVoicesCatalog).toHaveBeenCalledTimes(1);

    expect(result.presets).toEqual(['b1-default', 'b2-alt']);
    expect(result).not.toHaveProperty('notionDatabases');
    expect(result.uploadOptions).toEqual(['auto', 's3', 'none']);
    expect(result.ttsStrategies).toEqual(['auto', 'dialogue', 'tts']);
    expect(result.ttsProviders).toEqual(['elevenlabs', 'google']);
    expect(result.ttsModelOptionsByProvider).toEqual({
      elevenlabs: ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2'],
      google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
    });
    expect(result.defaultTtsProvider).toBe('elevenlabs');
    expect(result.defaultTtsModelByProvider).toEqual({
      elevenlabs: 'eleven_multilingual_v2',
      google: 'chirp3_hd',
    });
    expect(result.voices).toEqual([
      {
        id: 'voice_a',
        name: 'Amanda',
        category: 'narration',
        accent: 'american_female',
        gender: 'female',
      },
      {
        id: 'voice_b',
        name: 'Luke',
        category: null,
        accent: 'british_male',
        gender: 'male',
      },
    ]);
    expect(result.voiceAccents).toEqual(['american_female', 'british_male']);
  });

  it('tolerates empty voice catalogs', async () => {
    const configProvider = createConfigProvider({
      loadPresets: vi.fn().mockResolvedValue({}),
    });
    vi.mocked(loadVoicesCatalog).mockResolvedValue({ voices: [] });

    const result = await resolveJobOptions({ configProvider, configPaths });

    expect(result).not.toHaveProperty('notionDatabases');
    expect(result.voices).toEqual([]);
    expect(result.voiceAccents).toEqual([]);
  });

  it('filters unavailable providers from job options metadata', async () => {
    const configProvider = createConfigProvider();
    vi.mocked(loadVoicesCatalog).mockResolvedValue({ voices: [] });
    vi.mocked(getRegisteredTtsProvider).mockImplementation((providerId) => {
      if (providerId === 'google') {
        return createProviderMock('google', 'studio');
      }
    });

    const result = await resolveJobOptions({ configProvider, configPaths });

    expect(result.ttsProviders).toEqual(['google']);
    expect(result.defaultTtsProvider).toBe('google');
    expect(result.defaultTtsModelByProvider).toEqual({ google: 'chirp3_hd' });
    expect(result.ttsModelOptionsByProvider).toEqual({
      google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
    });
  });
});
