import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const GET_JOB_OPTIONS_TEST_TIMEOUT_MS = 30_000;

vi.mock('../src/infrastructure/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../src/infrastructure/orchestrator-service', () => ({
  getJobOptionsFromOrchestrator: vi.fn(),
}));

function buildGenerationOptions() {
  return {
    providers: ['openai', 'google_ai_studio', 'openrouter'] as const,
    defaultProvider: 'openai' as const,
    modelOptions: [
      {
        provider: 'openai' as const,
        id: 'gpt-5.2',
        tier: 'primary' as const,
        fallbackRank: 0,
        defaultSelected: true,
        enabled: true,
      },
      {
        provider: 'openai' as const,
        id: 'gpt-5-mini',
        tier: 'fallback' as const,
        fallbackRank: 1,
        enabled: true,
      },
    ],
    defaultModelByProvider: {
      openai: 'gpt-5.2',
      google_ai_studio: 'gemini-3-flash-preview',
    },
    quota: {
      source: 'hybrid' as const,
      lastUpdatedAt: '2026-02-18T00:00:00.000Z',
      requestsPerMinute: 5,
      tokensPerMinute: 250000,
      requestsPerDay: 20,
      usedRequestsToday: 1,
      usedTokensToday: 1800,
    },
  };
}

describe('application/get-job-options', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.NOTION_DB_ID;
    delete process.env.NOTION_DB_NAME;
    delete process.env.NOTION_DB_LABEL;
    delete process.env.NOTION_DB_OPTIONS;
    delete process.env.BATCH_BACKEND_JOB_OPTIONS_ALLOW_STATIC_FALLBACK;
  });

  it('returns orchestrator metadata when helper succeeds', {
    timeout: GET_JOB_OPTIONS_TEST_TIMEOUT_MS,
  }, async () => {
    const { getJobOptions } = await import('../src/application/get-job-options.js');
    const { getJobOptionsFromOrchestrator } = await import(
      '../src/infrastructure/orchestrator-service.js'
    );

    vi.mocked(getJobOptionsFromOrchestrator).mockResolvedValue({
      presets: ['alpha'],
      cefrLevels: ['A2', 'B1', 'B2'],
      cefrDefault: 'B1',
      generation: buildGenerationOptions(),
      voiceAccents: ['accent_one'],
      voices: [{ id: 'voice-1', name: 'Voice One', accent: 'accent_one', gender: 'female' }],
      notionDatabases: [{ id: 'db-1', name: 'DB One' }],
      uploadOptions: ['auto', 's3', 'none'],
      ttsStrategies: ['auto', 'dialogue', 'tts'],
      ttsProviders: ['elevenlabs', 'google'],
      ttsModelOptionsByProvider: {
        elevenlabs: ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2'],
        google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
      },
      defaultTtsProvider: 'google',
      defaultTtsModelByProvider: {
        elevenlabs: 'eleven_flash_v2_5',
        google: 'studio',
      },
      learningPresets: [
        {
          id: 'general-english',
          version: 'v1',
          alias: 'current',
          title: 'General English',
          track: 'general-english',
          status: 'active',
          promptSnapshotVersion: 'hw_prompt_v4-2_clean',
        },
      ],
    } as any);

    const result = await getJobOptions();

    expect(result).toMatchObject({
      presets: ['alpha'],
      cefrLevels: ['A2', 'B1', 'B2'],
      cefrDefault: 'B1',
      voiceAccents: ['accent_one'],
      voices: [{ id: 'voice-1', name: 'Voice One', accent: 'accent_one', gender: 'female' }],
      notionDatabases: [{ id: 'db-1', name: 'DB One' }],
      uploadOptions: ['auto', 's3', 'none'],
      ttsStrategies: ['auto', 'dialogue', 'tts'],
      ttsProviders: ['elevenlabs', 'google'],
      ttsModelOptionsByProvider: {
        elevenlabs: ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2'],
        google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
      },
      defaultTtsProvider: 'google',
      defaultTtsModelByProvider: {
        elevenlabs: 'eleven_flash_v2_5',
        google: 'studio',
      },
      learningPresets: [
        {
          id: 'general-english',
          version: 'v1',
          alias: 'current',
          title: 'General English',
          track: 'general-english',
          status: 'active',
          promptSnapshotVersion: 'hw_prompt_v4-2_clean',
        },
      ],
    });
    expect(result.generation).toEqual(
      expect.objectContaining({
        providers: buildGenerationOptions().providers,
        defaultProvider: 'openai',
        modelOptions: buildGenerationOptions().modelOptions,
        quota: expect.objectContaining({
          source: 'hybrid',
          requestsPerMinute: 5,
          requestsPerDay: 20,
        }),
      }),
    );
    expect(result.supportedActions).toEqual([
      {
        type: 'rerun',
        label: 'Rerun',
        description:
          'Republish current draft or selectively regenerate study-text and pronunciation audio families',
        requiresFields: [],
        implemented: true,
      },
      {
        type: 'cancel',
        label: 'Cancel Job',
        description: 'Cancel a queued or running job',
        requiresFields: [],
        implemented: true,
      },
      {
        type: 'edit_metadata',
        label: 'Edit Job Metadata',
        description: 'Update job configuration without rerunning',
        requiresFields: [],
        implemented: true,
      },
    ]);
    expect(result.generation?.quota.usedRequestsToday).toBe(0);
    expect(result.generation?.quota.usedTokensToday).toBe(0);
    expect(result.ttsProviders).toEqual(['elevenlabs', 'google']);
    expect(result.ttsModelOptionsByProvider).toEqual({
      elevenlabs: ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2'],
      google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
    });
    expect(result.defaultTtsProvider).toBe('google');
    expect(result.defaultTtsModelByProvider).toEqual({
      elevenlabs: 'eleven_flash_v2_5',
      google: 'studio',
    });
  });

  it('falls back to static options when orchestrator helper fails', {
    timeout: GET_JOB_OPTIONS_TEST_TIMEOUT_MS,
  }, async () => {
    process.env.BATCH_BACKEND_JOB_OPTIONS_ALLOW_STATIC_FALLBACK = 'true';
    const { getJobOptions } = await import('../src/application/get-job-options.js');
    const { getJobOptionsFromOrchestrator } = await import(
      '../src/infrastructure/orchestrator-service.js'
    );
    const { logger } = await import('../src/infrastructure/logger.js');

    vi.mocked(getJobOptionsFromOrchestrator).mockRejectedValue(new Error('boom'));

    const result = await getJobOptions();

    expect(result.presets).toEqual(['b1-default']);
    expect(result.cefrLevels).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    expect(result.cefrDefault).toEqual('B1');
    expect(result.uploadOptions).toEqual(['auto', 's3', 'none']);
    expect(result.ttsStrategies).toEqual(['auto']);
    expect(result.ttsProviders).toEqual(['elevenlabs', 'google']);
    expect(result.ttsModelOptionsByProvider).toEqual({
      elevenlabs: ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_flash_v2'],
      google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
    });
    expect(result.defaultTtsProvider).toEqual('elevenlabs');
    expect(result.defaultTtsModelByProvider).toEqual({
      elevenlabs: 'eleven_multilingual_v2',
      google: 'chirp3_hd',
    });
    expect(result.learningPresets).toEqual([
      {
        id: 'general-english',
        version: 'v1',
        alias: 'current',
        title: 'General English',
        track: 'general-english',
        status: 'active',
        promptSnapshotVersion: 'hw_prompt_definitive',
      },
    ]);
    expect(result.notionDatabases).toEqual([
      { id: 'notion-db-b1', name: 'B1 Lessons' },
      { id: 'notion-db-b2', name: 'B2 Lessons' },
    ]);
    expect(result.voiceAccents.length).toBeGreaterThan(0);
    expect(Array.isArray(result.voices)).toBe(true);
    expect(result.supportedActions).toHaveLength(3);

    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to load job options from orchestrator. Using static fallback config.',
      expect.objectContaining({ error: 'boom' }),
    );
  });

  it('throws when orchestrator helper fails and static fallback is disabled', {
    timeout: GET_JOB_OPTIONS_TEST_TIMEOUT_MS,
  }, async () => {
    process.env.BATCH_BACKEND_JOB_OPTIONS_ALLOW_STATIC_FALLBACK = 'false';
    const { getJobOptions } = await import('../src/application/get-job-options.js');
    const { getJobOptionsFromOrchestrator } = await import(
      '../src/infrastructure/orchestrator-service.js'
    );
    const { logger } = await import('../src/infrastructure/logger.js');

    vi.mocked(getJobOptionsFromOrchestrator).mockRejectedValue(new Error('boom'));

    await expect(getJobOptions()).rejects.toThrow('boom');
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to load job options from orchestrator and static fallback is disabled.',
      expect.objectContaining({
        staticFallbackEnabled: false,
        error: 'boom',
      }),
    );
  });

  it('caches resolved options for 60 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));

    const { getJobOptions } = await import('../src/application/get-job-options.js');
    const { getJobOptionsFromOrchestrator } = await import(
      '../src/infrastructure/orchestrator-service.js'
    );

    vi.mocked(getJobOptionsFromOrchestrator).mockResolvedValue({
      presets: ['alpha'],
      cefrLevels: ['A2', 'B1'],
      cefrDefault: 'B1',
      generation: buildGenerationOptions(),
      voiceAccents: ['accent_one'],
      voices: [{ id: 'voice-1', name: 'Voice One', accent: 'accent_one', gender: 'female' }],
      notionDatabases: [{ id: 'db-1', name: 'DB One' }],
      uploadOptions: ['auto', 's3', 'none'],
      ttsStrategies: ['auto', 'dialogue', 'tts'],
      ttsProviders: ['elevenlabs', 'google'],
      ttsModelOptionsByProvider: {
        elevenlabs: ['eleven_turbo_v2_5'],
        google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
      },
      defaultTtsProvider: 'google',
      defaultTtsModelByProvider: {
        elevenlabs: 'eleven_turbo_v2_5',
        google: 'studio',
      },
      learningPresets: [
        {
          id: 'general-english',
          version: 'v1',
          alias: 'current',
          title: 'General English',
          track: 'general-english',
          status: 'active',
          promptSnapshotVersion: 'hw_prompt_v4-2_clean',
        },
      ],
    } as any);

    await getJobOptions();
    await getJobOptions();
    expect(getJobOptionsFromOrchestrator).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-02-01T00:01:01.000Z'));
    await getJobOptions();
    expect(getJobOptionsFromOrchestrator).toHaveBeenCalledTimes(2);
  });

  it('returns deep-cloned generation metadata from cache', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));

    const { getJobOptions } = await import('../src/application/get-job-options.js');
    const { getJobOptionsFromOrchestrator } = await import(
      '../src/infrastructure/orchestrator-service.js'
    );

    vi.mocked(getJobOptionsFromOrchestrator).mockResolvedValue({
      presets: ['alpha'],
      cefrLevels: ['A2', 'B1'],
      cefrDefault: 'B1',
      generation: buildGenerationOptions(),
      voiceAccents: ['accent_one'],
      voices: [{ id: 'voice-1', name: 'Voice One', accent: 'accent_one', gender: 'female' }],
      notionDatabases: [{ id: 'db-1', name: 'DB One' }],
      uploadOptions: ['auto', 's3', 'none'],
      ttsStrategies: ['auto', 'dialogue', 'tts'],
      ttsProviders: ['elevenlabs', 'google'],
      ttsModelOptionsByProvider: {
        elevenlabs: ['eleven_turbo_v2_5'],
        google: ['chirp3_hd', 'studio', 'neural2', 'wavenet'],
      },
      defaultTtsProvider: 'google',
      defaultTtsModelByProvider: {
        elevenlabs: 'eleven_turbo_v2_5',
        google: 'studio',
      },
      learningPresets: [
        {
          id: 'general-english',
          version: 'v1',
          alias: 'current',
          title: 'General English',
          track: 'general-english',
          status: 'active',
          promptSnapshotVersion: 'hw_prompt_v4-2_clean',
        },
      ],
    } as any);

    const first = await getJobOptions();
    expect(first.generation?.modelOptions[0]?.id).toBe('gpt-5.2');
    expect(first.generation?.quota.source).toBe('hybrid');

    if (first.generation) {
      first.generation.modelOptions[0]!.id = 'mutated-model-id';
      first.generation.quota.source = 'configured';
    }
    if (first.ttsModelOptionsByProvider?.google) {
      first.ttsModelOptionsByProvider.google[0] = 'mutated-google-model';
    }
    if (first.defaultTtsModelByProvider) {
      first.defaultTtsModelByProvider.google = 'mutated-default-google-model';
    }

    const second = await getJobOptions();
    expect(second.generation?.modelOptions[0]?.id).toBe('gpt-5.2');
    expect(second.generation?.quota.source).toBe('hybrid');
    expect(second.ttsModelOptionsByProvider?.google?.[0]).toBe('chirp3_hd');
    expect(second.defaultTtsModelByProvider?.google).toBe('studio');
  });
});
