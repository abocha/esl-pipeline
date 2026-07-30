import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { parseMarkdownContext } from '@esl-pipeline/pmd';
import {
  hashStudyText,
  type SpeechPerformancePlan,
  TtsSynthesisCancelledError,
} from '@esl-pipeline/tts-core';

import {
  buildInworldChunkHash,
  buildStudyTextMp3Inworld,
  createInworldClientProvider,
  createInworldTtsProvider,
  INWORLD_RENDERER_POLICY_VERSION,
  loadInworldVoicesCatalog,
  renderInworldSpeechSegment,
  resolveInworldAssemblyGapDurations,
  resolveInworldSpeakerAssignmentsFromCatalog,
  resolveInworldSpeakerAssignmentsWithRankerFromCatalog,
  resolveInworldTtsModel,
  resolveInworldVoiceCapabilities,
} from '../src/index.js';

function createPreviewContext() {
  return parseMarkdownContext(
    '---\ntitle: Test\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\n---\n\n:::study-text\n[Maya]: We need a clearer deadline.\n:::',
  );
}

function createPreviewVoicePlan(
  generatedAt: string,
  speaker = 'Maya',
  voiceId = 'Ashley',
  language?: string,
  sourceHash = hashStudyText(
    JSON.stringify([{ id: 'segment-1', speaker: 'Maya', text: 'We need a clearer deadline.' }]),
  ),
) {
  return {
    schemaVersion: 1 as const,
    mode: 'ranked' as const,
    provider: 'inworld' as const,
    model: 'inworld-tts-2' as const,
    sourceHash,
    ranker: { provider: 'google_ai_studio', model: 'gemma-4-26b-a4b-it', generatedAt },
    assignments: [
      {
        speaker,
        voiceId,
        ...(language ? { language } : {}),
        source: 'auto' as const,
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: false,
        },
      },
    ],
  };
}

function createPreviewSpeechPlan(
  segment: Partial<SpeechPerformancePlan['segments'][number]> = {},
): SpeechPerformancePlan {
  const sourceSegments = [
    {
      id: 'segment-1',
      speaker: 'Maya',
      text: 'We need a clearer deadline.',
    },
  ];
  return {
    schemaVersion: 1 as const,
    mode: 'prompted' as const,
    provider: 'inworld' as const,
    model: 'inworld-tts-2' as const,
    sourceHash: hashStudyText(JSON.stringify(sourceSegments)),
    segments: [
      {
        ...sourceSegments[0]!,
        ...segment,
      },
    ],
  };
}

function createSchemaV2RenderPlan(
  args: {
    overallComponents?: Array<{
      dimension: 'relationship' | 'style' | 'intonation' | 'tempo';
      direction: string;
    }>;
    segment?: Partial<Extract<SpeechPerformancePlan, { schemaVersion: 2 }>['segments'][number]>;
  } = {},
) {
  const segment = {
    id: 'segment-1',
    speaker: 'Maya',
    text: 'We need a clearer deadline.',
    turnAdjustment: {
      components: [{ dimension: 'intonation' as const, direction: 'land the deadline firmly' }],
      reason: 'The authored correction hinges on the deadline.',
      evidence: [
        {
          kind: 'authored_substring' as const,
          segmentId: 'segment-1',
          quote: 'deadline',
        },
      ],
    },
    ...args.segment,
  };
  const plan: Extract<SpeechPerformancePlan, { schemaVersion: 2 }> = {
    schemaVersion: 2,
    mode: 'prompted',
    provider: 'inworld',
    model: 'inworld-tts-2',
    sourceHash: 'source-hash',
    performanceContextHash: 'c'.repeat(64),
    resolvedPerformanceMode: 'dialogue',
    performanceContext: {
      overallDirection: {
        components: args.overallComponents ?? [
          { dimension: 'relationship', direction: 'sound like colleagues solving a real problem' },
        ],
        basis: ['frontmatter:topic'],
      },
      speakerEnvelopes: [
        {
          speaker: 'Maya',
          baselineDirection: {
            components: [{ dimension: 'style', direction: 'warm practical and direct' }],
            basis: ['speaker_profile:Maya:persona'],
          },
        },
      ],
    },
    planner: {
      provider: 'google_ai_studio',
      model: 'gemini-3.1-flash-lite',
      generatedAt: '2026-07-30T00:00:00.000Z',
      promptPolicyVersion: 'speech-performance-v3-contextual-continuity',
      promptHash: 'a'.repeat(64),
    },
    segments: [segment],
  };
  return { plan, segment: plan.segments[0]! };
}

describe('inworld provider adapter basics', () => {
  it('constructs one lazy SDK client with retries disabled', () => {
    const sdkClient = {
      listVoices: vi.fn().mockResolvedValue([]),
      generate: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    const sdkFactory = vi.fn(() => sdkClient);
    const clientProvider = createInworldClientProvider({
      apiKey: 'test-api-key',
      sdkFactory,
    });

    expect(sdkFactory).not.toHaveBeenCalled();
    expect(clientProvider.get()).toBe(sdkClient);
    expect(clientProvider.get()).toBe(sdkClient);
    expect(sdkFactory).toHaveBeenCalledTimes(1);
    expect(sdkFactory).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'test-api-key', maxRetries: 0 }),
    );
  });

  it('shares one injected SDK client between catalog and synthesis', async () => {
    const outPath = join(tmpdir(), `inworld-provider-${process.pid}-${Date.now()}`);
    const sdkClient = {
      listVoices: vi.fn().mockResolvedValue([]),
      generate: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    const sdkFactory = vi.fn(() => sdkClient);
    const provider = createInworldTtsProvider({ apiKey: 'test-api-key', sdkFactory });

    try {
      await provider.voice.loadCatalog();
      const result = await provider.synthesizePronunciationText(
        { text: 'Deterministic test line.', voiceId: 'Ashley' },
        { outPath, force: true, ttsModel: 'inworld-tts-2' },
      );

      expect(sdkFactory).toHaveBeenCalledTimes(1);
      expect(sdkFactory).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'test-api-key', maxRetries: 0 }),
      );
      expect(sdkClient.generate).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'Deterministic test line.', voice: 'Ashley' }),
      );
      await expect(readFile(result.path)).resolves.toEqual(Buffer.from([1, 2, 3]));
    } finally {
      await rm(outPath, { recursive: true, force: true });
    }
  });

  it('shares one local SDK client across the exported study-text helper', async () => {
    const outPath = join(tmpdir(), `inworld-study-text-${process.pid}-${Date.now()}`);
    const sdkClient = {
      listVoices: vi.fn().mockResolvedValue([]),
      generate: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    };
    const sdkFactory = vi.fn(() => sdkClient);

    try {
      const result = await buildStudyTextMp3Inworld(
        { context: createPreviewContext() },
        { voiceMapPath: 'voices.yml', outPath, force: true, ttsModel: 'inworld-tts-2' },
        { apiKey: 'test-api-key', sdkFactory },
      );

      expect(sdkFactory).toHaveBeenCalledTimes(1);
      expect(sdkClient.listVoices).toHaveBeenCalledTimes(1);
      expect(sdkClient.generate).toHaveBeenCalledTimes(1);
      await expect(readFile(result.path)).resolves.toEqual(Buffer.from([4, 5, 6]));
    } finally {
      await rm(outPath, { recursive: true, force: true });
    }
  });

  it('does not call the SDK catalog or synthesis after study-text cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const sdkClient = {
      listVoices: vi.fn().mockResolvedValue([]),
      generate: vi.fn().mockResolvedValue(new Uint8Array([4, 5, 6])),
    };
    const sdkFactory = vi.fn(() => sdkClient);

    await expect(
      buildStudyTextMp3Inworld(
        { context: createPreviewContext() },
        {
          voiceMapPath: 'voices.yml',
          outPath: '/path-that-must-not-be-created',
          force: true,
          ttsModel: 'inworld-tts-2',
          signal: controller.signal,
        },
        { apiKey: 'test-api-key', sdkFactory },
      ),
    ).rejects.toBeInstanceOf(TtsSynthesisCancelledError);
    expect(sdkFactory).not.toHaveBeenCalled();
    expect(sdkClient.listVoices).not.toHaveBeenCalled();
    expect(sdkClient.generate).not.toHaveBeenCalled();
  });

  it('does not construct the injected SDK client when credentials are missing', async () => {
    const sdkFactory = vi.fn();
    const provider = createInworldTtsProvider({ apiKey: undefined, sdkFactory });

    await expect(provider.voice.loadCatalog()).resolves.toMatchObject({
      voices: [{ id: 'Ashley' }, { id: 'Dennis' }],
    });
    expect(sdkFactory).not.toHaveBeenCalled();
  });

  it('derives steering capabilities from the selected Inworld model', () => {
    expect(resolveInworldVoiceCapabilities('inworld-tts-2')).toEqual({
      supportsMetadataInstructions: true,
      supportsNonVerbals: true,
      supportsUppercaseEmphasis: true,
      supportsFreeFormDirection: true,
    });
    expect(resolveInworldVoiceCapabilities('inworld-tts-1.5-max')).toEqual({
      supportsMetadataInstructions: false,
      supportsNonVerbals: false,
      supportsUppercaseEmphasis: false,
      supportsFreeFormDirection: false,
    });
    expect(resolveInworldVoiceCapabilities('inworld-tts-1.5-mini')).toEqual({
      supportsMetadataInstructions: false,
      supportsNonVerbals: false,
      supportsUppercaseEmphasis: false,
      supportsFreeFormDirection: false,
    });
  });

  it('preserves typed voice metadata and canonicalizes SDK language', async () => {
    const catalog = await loadInworldVoicesCatalog({
      client: {
        listVoices: vi.fn().mockResolvedValue([
          {
            voiceId: 'workspace-maya',
            displayName: 'Maya Display',
            name: 'maya_internal',
            langCode: 'en_US',
            description: 'Warm classroom voice',
            tags: ['warm'],
            source: 'workspace',
          },
        ]),
      },
    });
    const voice = catalog.voices.find((candidate) => candidate.id === 'workspace-maya');

    expect(voice).toMatchObject({
      name: 'Maya Display',
      labels: {
        display_name: 'Maya Display',
        name: 'maya_internal',
        language: 'en-US',
        description: 'Warm classroom voice',
        tags: ['warm'],
        source: 'workspace',
      },
      verifiedLanguages: [{ language: 'en-US', locale: 'en-US' }],
    });
    expect(
      resolveInworldSpeakerAssignmentsFromCatalog(['Maya'], {}, catalog, {
        model: 'inworld-tts-2',
      }),
    ).toMatchObject([{ voiceId: 'workspace-maya', language: 'en-US' }]);
  });

  it('logs one privacy-safe warning when the live catalog falls back', async () => {
    const logger = { log: vi.fn() };
    const client = { listVoices: vi.fn().mockRejectedValue(new Error('secret response body')) };

    const catalog = await loadInworldVoicesCatalog({ logger, client });

    expect(catalog.voices.map((voice) => voice.id)).toEqual(['Ashley', 'Dennis']);
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith({
      level: 'warn',
      stage: 'voice-plan',
      message: 'Inworld voice catalog fell back to static voices',
      detail: {
        provider: 'inworld',
        errorCategory: expect.any(String),
        failureKind: 'unknown',
        fallbackVoiceCount: 2,
      },
    });
    expect(JSON.stringify(logger.log.mock.calls)).not.toContain('secret response body');
  });

  it('reports cancellation when an in-flight catalog call resolves after abort', async () => {
    const controller = new AbortController();
    const logger = { log: vi.fn() };
    let resolveCatalog!: (voices: []) => void;
    const listVoices = vi.fn(
      () =>
        new Promise<[]>((resolve) => {
          resolveCatalog = resolve;
        }),
    );
    const result = loadInworldVoicesCatalog({
      logger,
      client: { listVoices },
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(listVoices).toHaveBeenCalledTimes(1));
    controller.abort('operator stop');
    resolveCatalog([]);

    await expect(result).rejects.toBeInstanceOf(TtsSynthesisCancelledError);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('reports cancellation when an in-flight catalog call rejects after abort', async () => {
    const controller = new AbortController();
    const logger = { log: vi.fn() };
    let rejectCatalog!: (error: Error) => void;
    const listVoices = vi.fn(
      () =>
        new Promise<[]>((_resolve, reject) => {
          rejectCatalog = reject;
        }),
    );
    const result = loadInworldVoicesCatalog({
      logger,
      client: { listVoices },
      signal: controller.signal,
    });

    await vi.waitFor(() => expect(listVoices).toHaveBeenCalledTimes(1));
    controller.abort('operator stop');
    rejectCatalog(new Error('provider failure'));

    await expect(result).rejects.toBeInstanceOf(TtsSynthesisCancelledError);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('reports cancellation when the deadline expires before an in-flight catalog rejection', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(0);
    const logger = { log: vi.fn() };
    let rejectCatalog!: (error: Error) => void;
    const listVoices = vi.fn(
      () =>
        new Promise<[]>((_resolve, reject) => {
          rejectCatalog = reject;
        }),
    );

    try {
      const result = loadInworldVoicesCatalog({
        logger,
        client: { listVoices },
        deadlineAtMs: 1_000,
      });
      await vi.waitFor(() => expect(listVoices).toHaveBeenCalledTimes(1));
      now.mockReturnValue(2_000);
      rejectCatalog(new Error('provider failure'));

      await expect(result).rejects.toBeInstanceOf(TtsSynthesisCancelledError);
      expect(logger.log).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('emits aggregate cache hit and miss counts without learner text', async () => {
    const outPath = join(tmpdir(), `inworld-cache-${process.pid}-${Date.now()}`);
    const logger = { log: vi.fn() };
    const sdkFactory = vi.fn(() => ({
      listVoices: vi.fn().mockResolvedValue([]),
      generate: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    }));
    const options = {
      voiceMapPath: 'voices.yml',
      outPath,
      ttsModel: 'inworld-tts-2' as const,
      voicePlan: createPreviewVoicePlan('2026-06-02T00:00:00.000Z'),
      logger,
    };

    try {
      await buildStudyTextMp3Inworld(
        { context: createPreviewContext() },
        { ...options, force: true },
        { apiKey: 'test-api-key', sdkFactory },
      );
      await buildStudyTextMp3Inworld({ context: createPreviewContext() }, options, {
        apiKey: 'test-api-key',
        sdkFactory,
      });

      expect(logger.log).toHaveBeenCalledWith({
        level: 'info',
        stage: 'tts',
        message: 'Inworld TTS chunk cache summary',
        detail: { provider: 'inworld', model: 'inworld-tts-2', cacheHits: 0, cacheMisses: 1 },
      });
      expect(logger.log).toHaveBeenCalledWith({
        level: 'info',
        stage: 'tts',
        message: 'Inworld TTS chunk cache summary',
        detail: { provider: 'inworld', model: 'inworld-tts-2', cacheHits: 1, cacheMisses: 0 },
      });
      expect(JSON.stringify(logger.log.mock.calls)).not.toContain('We need a clearer deadline.');
    } finally {
      await rm(outPath, { recursive: true, force: true });
    }
  });

  it('defaults model family to inworld-tts-2', () => {
    delete process.env.ESL_TTS_PROVIDER_INWORLD_MODEL;

    expect(resolveInworldTtsModel()).toBe('inworld-tts-2');
  });

  it('accepts all supported Inworld TTS models', () => {
    expect(resolveInworldTtsModel('inworld-tts-2')).toBe('inworld-tts-2');
    expect(resolveInworldTtsModel('inworld-tts-1.5-max')).toBe('inworld-tts-1.5-max');
    expect(resolveInworldTtsModel('inworld-tts-1.5-mini')).toBe('inworld-tts-1.5-mini');
  });

  it('inserts deterministic minimum margins between rendered lines', () => {
    expect(
      resolveInworldAssemblyGapDurations([
        { speaker: 'Nina' },
        { speaker: 'Nina' },
        { speaker: 'Mark' },
      ]),
    ).toEqual([180, 320]);
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

  it('prefers credentialed catalog voices before static fallback rotation', () => {
    expect(
      resolveInworldSpeakerAssignmentsFromCatalog(
        ['Maya', 'Leo'],
        {},
        {
          voices: [
            { id: 'Ashley', name: 'Ashley' },
            { id: 'Dennis', name: 'Dennis' },
            {
              id: 'workspace-maya',
              name: 'Workspace Maya',
              labels: { language: 'en_us', accent: 'american' },
            },
            {
              id: 'workspace-leo',
              name: 'Workspace Leo',
              labels: { language: 'en_us', accent: 'american' },
            },
          ],
        },
        { defaultAccent: 'american' },
      ),
    ).toMatchObject([
      {
        speaker: 'Maya',
        voiceId: 'workspace-leo',
        source: 'auto',
      },
      {
        speaker: 'Leo',
        voiceId: 'workspace-maya',
        source: 'auto',
      },
    ]);
  });

  it('excludes non-English voices and prefers an exact requested accent', () => {
    expect(
      resolveInworldSpeakerAssignmentsFromCatalog(
        ['Nina', 'Mark'],
        {},
        {
          voices: [
            { id: 'Aanya', name: 'Aanya', labels: { language: 'hi_in', accent: 'indian' } },
            { id: 'Aarav', name: 'Aarav', labels: { language: 'hi_in', accent: 'indian' } },
            { id: 'Clive', name: 'Clive', labels: { language: 'en_us', accent: 'british' } },
            { id: 'Abby', name: 'Abby', labels: { language: 'en_us', accent: 'american' } },
            { id: 'Brian', name: 'Brian', labels: { language: 'en_us', accent: 'american' } },
          ],
        },
        { defaultAccent: 'american' },
      ),
    ).toMatchObject([
      {
        speaker: 'Nina',
        voiceId: 'Abby',
        source: 'auto',
        capabilityMatches: ['accent:american'],
      },
      {
        speaker: 'Mark',
        voiceId: 'Brian',
        source: 'auto',
        capabilityMatches: ['accent:american'],
      },
    ]);
  });

  it('uses a deterministic English fallback and reports an unavailable requested accent', () => {
    expect(
      resolveInworldSpeakerAssignmentsFromCatalog(
        ['Maya'],
        {},
        {
          voices: [
            { id: 'Aanya', name: 'Aanya', labels: { language: 'hi_in', accent: 'indian' } },
            { id: 'Clive', name: 'Clive', labels: { language: 'en_gb', accent: 'british' } },
          ],
        },
        { defaultAccent: 'australian' },
      ),
    ).toMatchObject([
      {
        speaker: 'Maya',
        voiceId: 'Clive',
        source: 'fallback',
        capabilityMismatches: ['accent:australian'],
      },
    ]);
  });

  it('uses static fallback voices only when credentialed English voices are unavailable', () => {
    expect(
      resolveInworldSpeakerAssignmentsFromCatalog(
        ['Nina', 'Mark'],
        {},
        {
          voices: [
            { id: 'Ashley', name: 'Ashley', labels: { language: 'en', accent: 'american' } },
            { id: 'Dennis', name: 'Dennis', labels: { language: 'en', accent: 'american' } },
            { id: 'Aanya', name: 'Aanya', labels: { language: 'hi_in', accent: 'indian' } },
          ],
        },
        { defaultAccent: 'american' },
      ),
    ).toMatchObject([
      { speaker: 'Nina', voiceId: 'Ashley', source: 'fallback' },
      { speaker: 'Mark', voiceId: 'Dennis', source: 'fallback' },
    ]);
  });

  it('keeps explicit speaker mappings and configured defaults ahead of automatic matching', () => {
    const catalog = {
      voices: [{ id: 'Abby', name: 'Abby', labels: { language: 'en_us', accent: 'american' } }],
    };

    expect(
      resolveInworldSpeakerAssignmentsFromCatalog(['Nina'], { Nina: 'Operator Nina' }, catalog, {
        defaultAccent: 'american',
      }),
    ).toMatchObject([{ speaker: 'Nina', voiceId: 'Operator Nina', source: 'voiceMap' }]);
    expect(
      resolveInworldSpeakerAssignmentsFromCatalog(
        ['Nina'],
        { default: 'Operator Default' },
        catalog,
        {
          defaultAccent: 'american',
        },
      ),
    ).toMatchObject([{ speaker: 'Nina', voiceId: 'Operator Default', source: 'default' }]);
  });

  it('uses stable speaker profile hints when scoring automatic English voices', () => {
    expect(
      resolveInworldSpeakerAssignmentsFromCatalog(
        ['Nina'],
        {},
        {
          voices: [
            {
              id: 'Adam',
              name: 'Adam',
              labels: { language: 'en_us', accent: 'american', gender: 'male', age: 'adult' },
            },
            {
              id: 'Zoe',
              name: 'Zoe',
              labels: { language: 'en_us', accent: 'american', gender: 'female', age: 'adult' },
            },
          ],
        },
        {
          defaultAccent: 'american',
          profiles: [{ id: 'Nina', gender: 'female', age: 'adult' }],
        },
      ),
    ).toMatchObject([
      {
        speaker: 'Nina',
        voiceId: 'Zoe',
        source: 'auto',
        capabilityMatches: ['accent:american', 'gender:female', 'age:adult'],
      },
    ]);
  });

  it('treats every TTS-2 voice as steerable without a tag or ranking bonus', () => {
    expect(
      resolveInworldSpeakerAssignmentsFromCatalog(
        ['Nina'],
        {},
        {
          voices: [
            {
              id: 'Calm Plain',
              name: 'Calm Plain',
              labels: {
                language: 'en_us',
                accent: 'american',
                tags: ['calm', 'neutral'],
              },
            },
            {
              id: 'Calm Steerable',
              name: 'Calm Steerable',
              labels: {
                language: 'en_us',
                accent: 'american',
                tags: ['calm', 'neutral', 'steerable'],
              },
            },
          ],
        },
        {
          defaultAccent: 'american',
          profiles: [{ id: 'Nina', voice_direction: 'calm neutral voice' }],
        },
      ),
    ).toMatchObject([
      {
        speaker: 'Nina',
        voiceId: 'Calm Plain',
        capabilityMatches: ['accent:american', 'persona:calm,neutral'],
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: true,
        },
      },
    ]);
  });

  it('lets the injected ranker choose a better non-steerable shortlist candidate', async () => {
    const ranker = {
      metadata: {
        provider: 'google_ai_studio',
        model: 'gemma-4-26b-a4b-it',
        generatedAt: '2026-06-02T00:00:00.000Z',
      },
      rank: async () => ({
        selections: [
          { speaker: 'Nina', voiceId: 'Warm Plain', reason: 'warmer conversational fit' },
        ],
      }),
    };

    await expect(
      resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
        ['Nina'],
        {},
        {
          voices: [
            {
              id: 'Cool Steerable',
              name: 'Cool Steerable',
              labels: { language: 'en_us', accent: 'american', tags: ['neutral', 'steerable'] },
            },
            {
              id: 'Warm Plain',
              name: 'Warm Plain',
              labels: { language: 'en_us', accent: 'american', tags: ['warm', 'neutral'] },
            },
          ],
        },
        {
          defaultAccent: 'american',
          profiles: [{ id: 'Nina', voice_direction: 'warm conversational voice' }],
          ranker,
          model: 'inworld-tts-2',
        },
      ),
    ).resolves.toMatchObject({
      mode: 'ranked',
      assignments: [
        {
          speaker: 'Nina',
          voiceId: 'Warm Plain',
          source: 'auto',
          selectionReason: 'Selected by Inworld voice ranker: warmer conversational fit',
          capabilities: { supportsFreeFormDirection: true },
          language: 'en-US',
        },
      ],
    });
  });

  it('logs the shortlist and selected voices when the injected ranker runs', async () => {
    const logger = { log: vi.fn() };
    const ranker = {
      metadata: {
        provider: 'google_ai_studio',
        model: 'gemma-4-26b-a4b-it',
        generatedAt: '2026-06-02T00:00:00.000Z',
      },
      debugLogPlan: true,
      rank: async () => ({
        selections: [{ speaker: 'Nina', voiceId: 'Warm Plain', reason: 'natural classroom fit' }],
      }),
    };

    const _resolution = await resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
      ['Nina'],
      {},
      {
        voices: [
          {
            id: 'Warm Plain',
            name: 'Warm Plain',
            labels: { language: 'en_us', accent: 'american', tags: ['warm', 'neutral'] },
          },
        ],
      },
      { model: 'inworld-tts-2', ranker, logger },
    );

    expect(logger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        stage: 'voice-plan',
        message: 'Inworld voice ranker shortlist debug payload',
      }),
    );
    expect(logger.log).toHaveBeenCalledWith({
      level: 'info',
      stage: 'voice-plan',
      message: 'Inworld voice ranker selected credentialed voices',
      detail: {
        ranker: ranker.metadata,
        voices: [{ speaker: 'Nina', voiceId: 'Warm Plain' }],
      },
    });
  });

  it('logs why an injected ranker is skipped when credentialed English voices are unavailable', async () => {
    const logger = { log: vi.fn() };
    const ranker = {
      metadata: {
        provider: 'google_ai_studio',
        model: 'gemma-4-26b-a4b-it',
        generatedAt: '2026-06-02T00:00:00.000Z',
      },
      rank: vi.fn(),
    };

    const resolution = await resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
      ['Nina'],
      {},
      {
        voices: [
          { id: 'Ashley', name: 'Ashley' },
          { id: 'Aanya', name: 'Aanya', labels: { language: 'hi_in', accent: 'indian' } },
        ],
      },
      { model: 'inworld-tts-2', ranker, logger },
    );

    expect(ranker.rank).not.toHaveBeenCalled();
    expect(resolution).toMatchObject({
      mode: 'deterministic',
      fallbackReason: 'no_rankable_credentialed_english_candidates',
    });
    expect(logger.log).toHaveBeenCalledWith({
      level: 'info',
      stage: 'voice-plan',
      message: 'Inworld voice ranker skipped',
      detail: {
        ranker: ranker.metadata,
        reason: 'no_rankable_credentialed_english_candidates',
      },
    });
  });

  it('logs why an injected ranker is skipped for models without semantic ranking', async () => {
    const logger = { log: vi.fn() };
    const ranker = {
      metadata: {
        provider: 'google_ai_studio',
        model: 'gemma-4-26b-a4b-it',
        generatedAt: '2026-06-02T00:00:00.000Z',
      },
      rank: vi.fn(),
    };

    const resolution = await resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
      ['Nina'],
      {},
      {
        voices: [
          {
            id: 'Warm Plain',
            name: 'Warm Plain',
            labels: { language: 'en_us', accent: 'american' },
          },
        ],
      },
      { model: 'inworld-tts-1.5-mini', ranker, logger },
    );

    expect(ranker.rank).not.toHaveBeenCalled();
    expect(resolution).toMatchObject({
      mode: 'deterministic',
      fallbackReason: 'model_not_supported',
    });
    expect(logger.log).toHaveBeenCalledWith({
      level: 'info',
      stage: 'voice-plan',
      message: 'Inworld voice ranker skipped',
      detail: {
        ranker: ranker.metadata,
        reason: 'model_not_supported',
        model: 'inworld-tts-1.5-mini',
      },
    });
  });

  it('logs ranker fallback messages only when ranker debug logging is enabled', async () => {
    const createRanker = (debugLogPlan: boolean) => ({
      metadata: {
        provider: 'google_ai_studio',
        model: 'gemma-4-26b-a4b-it',
        generatedAt: '2026-06-02T00:00:00.000Z',
      },
      debugLogPlan,
      async rank() {
        const error = new Error('ranker rejected shortlist') as Error & { rawText?: string };
        error.rawText = '{"selections":[{"speaker":"Nina"';
        throw error;
      },
    });
    const voices = [
      {
        id: 'Warm Plain',
        name: 'Warm Plain',
        labels: { language: 'en_us', accent: 'american', tags: ['warm', 'neutral'] },
      },
    ];

    const quietLogger = { log: vi.fn() };
    await resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
      ['Nina'],
      {},
      { voices },
      {
        model: 'inworld-tts-2',
        ranker: createRanker(false),
        logger: quietLogger,
      },
    );
    expect(JSON.stringify(quietLogger.log.mock.calls)).not.toContain('ranker rejected shortlist');
    expect(JSON.stringify(quietLogger.log.mock.calls)).not.toContain('{"selections"');

    const debugLogger = { log: vi.fn() };
    await resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
      ['Nina'],
      {},
      { voices },
      {
        model: 'inworld-tts-2',
        ranker: createRanker(true),
        logger: debugLogger,
      },
    );
    expect(debugLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        stage: 'voice-plan',
        message: 'Inworld voice ranker fell back to deterministic catalog selection',
        detail: expect.objectContaining({
          errorName: 'Error',
          errorMessage: 'ranker rejected shortlist',
          rejectedRankerRawText: '{"selections":[{"speaker":"Nina"',
        }),
      }),
    );
  });

  it('uses the operator regional accent when a legacy profile contains accent neutral', () => {
    expect(
      resolveInworldSpeakerAssignmentsFromCatalog(
        ['Nina'],
        {},
        {
          voices: [
            { id: 'British', name: 'British', labels: { language: 'en_gb', accent: 'british' } },
            {
              id: 'American',
              name: 'American',
              labels: { language: 'en_us', accent: 'american' },
            },
          ],
        },
        {
          defaultAccent: 'american',
          profiles: [{ id: 'Nina', accent: 'neutral' }],
        },
      ),
    ).toMatchObject([{ voiceId: 'American', source: 'auto' }]);
  });

  it('renders TTS-2 plan cues into prompt text and SDK controls', () => {
    const plan = createPreviewSpeechPlan({
      emotion: 'calm concern',
      intonation: 'firm but collaborative',
      pace: 'measured',
      emphasis: ['clearer deadline'],
      pauseBeforeMs: 150,
      pauseAfterMs: 350,
      nonVerbalsBefore: ['sigh'],
      deliveryMode: 'BALANCED',
      freeFormDirection: 'speak as if carefully breaking difficult news',
    });
    expect(
      renderInworldSpeechSegment({
        model: 'inworld-tts-2',
        plan,
        segment: plan.segments[0]!,
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: true,
        },
      }),
    ).toEqual({
      text: '[speak as if carefully breaking difficult news] [sigh] <break time="150ms" /> We need a CLEARER DEADLINE. <break time="350ms" />',
      lexicalText: 'We need a CLEARER DEADLINE.',
      leadingInstructionTagCount: 1,
      speakingRate: 0.95,
      deliveryMode: 'BALANCED',
    });
  });

  it('combines emotion and intonation into one TTS-2 instruction without free-form direction', () => {
    const plan = createPreviewSpeechPlan({
      emotion: 'grounded concern',
      intonation: 'a gently falling pitch',
      pace: 'measured',
    });
    expect(
      renderInworldSpeechSegment({
        model: 'inworld-tts-2',
        plan,
        segment: plan.segments[0]!,
      }),
    ).toEqual({
      text: '[speak with grounded concern and a gently falling pitch] We need a clearer deadline.',
      lexicalText: 'We need a clearer deadline.',
      leadingInstructionTagCount: 1,
      speakingRate: 0.95,
    });
  });

  it.each([
    [undefined, undefined],
    ['natural', undefined],
    ['slow', 0.85],
    ['measured', 0.95],
    ['brisk', 1.1],
  ] as const)('renders TTS-2 pace %s through only the numeric SDK control', (pace, speakingRate) => {
    const plan = createPreviewSpeechPlan({ ...(pace ? { pace } : {}) });
    const rendered = renderInworldSpeechSegment({
      model: 'inworld-tts-2',
      plan,
      segment: { ...plan.segments[0]!, text: 'Keep a steady tempo.' },
    });

    expect(rendered.text).toBe('Keep a steady tempo.');
    expect(rendered.text).not.toContain('pace');
    expect(rendered.speakingRate).toBe(speakingRate);
  });

  it('keeps at most one leading instruction when capability input is conservative', () => {
    const plan = createPreviewSpeechPlan({
      emotion: 'calm concern',
      emphasis: ['clearer deadline'],
      nonVerbalsBefore: ['sigh'],
      freeFormDirection: 'speak as if carefully breaking difficult news',
    });
    expect(
      renderInworldSpeechSegment({
        model: 'inworld-tts-2',
        plan,
        segment: plan.segments[0]!,
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: false,
        },
      }),
    ).toEqual({
      text: '[speak with calm concern] [sigh] We need a CLEARER DEADLINE.',
      lexicalText: 'We need a CLEARER DEADLINE.',
      leadingInstructionTagCount: 1,
    });
  });

  it('renders scene, speaker, and evidenced turn context as one instruction', () => {
    const { plan, segment } = createSchemaV2RenderPlan();

    expect(renderInworldSpeechSegment({ model: 'inworld-tts-2', plan, segment })).toEqual({
      text: '[sound like colleagues solving a real problem warm practical and direct land the deadline firmly] We need a clearer deadline.',
      lexicalText: 'We need a clearer deadline.',
      leadingInstructionTagCount: 1,
    });
  });

  it('gives numeric pace sole ownership of tempo', () => {
    const { plan, segment } = createSchemaV2RenderPlan({
      overallComponents: [{ dimension: 'tempo', direction: 'keep a naturally brisk exchange' }],
      segment: { pace: 'brisk' },
    });

    const rendered = renderInworldSpeechSegment({ model: 'inworld-tts-2', plan, segment });
    expect(rendered.text).toBe(
      '[warm practical and direct land the deadline firmly] We need a clearer deadline.',
    );
    expect(rendered.speakingRate).toBe(1.1);
  });

  it('omits default and zero controls from rendered text and SDK options', () => {
    const { plan, segment } = createSchemaV2RenderPlan({
      overallComponents: [],
      segment: {
        turnAdjustment: undefined,
        pauseBeforeMs: 0,
        pauseAfterMs: 0,
        deliveryMode: 'BALANCED',
      },
    });

    expect(renderInworldSpeechSegment({ model: 'inworld-tts-2', plan, segment })).toEqual({
      text: '[warm practical and direct] We need a clearer deadline.',
      lexicalText: 'We need a clearer deadline.',
      leadingInstructionTagCount: 1,
    });
  });

  it('renders pace with emphasis only when learner meaning evidence requires both controls', () => {
    const createRendered = (learnerMeaningRequired: boolean) => {
      const { plan, segment } = createSchemaV2RenderPlan({
        overallComponents: [],
        segment: {
          turnAdjustment: undefined,
          pace: 'brisk',
          emphasis: ['deadline'],
          controlEvidence: [
            {
              control: 'pace',
              reason: 'The correction is deliberately brisk.',
              evidence: [{ kind: 'authored_substring', segmentId: 'segment-1', quote: 'deadline' }],
              learnerMeaningRequired: false,
            },
            {
              control: 'emphasis',
              reason: 'The deadline carries the contrast.',
              evidence: [{ kind: 'authored_substring', segmentId: 'segment-1', quote: 'deadline' }],
              learnerMeaningRequired,
            },
          ],
        },
      });
      return renderInworldSpeechSegment({ model: 'inworld-tts-2', plan, segment });
    };

    expect(createRendered(false).lexicalText).toBe('We need a clearer deadline.');
    expect(createRendered(true).lexicalText).toBe('We need a clearer DEADLINE.');
  });

  it('omits an unevidenced nonverbal and keeps positive pause placement', () => {
    const { plan, segment } = createSchemaV2RenderPlan({
      overallComponents: [],
      segment: {
        turnAdjustment: undefined,
        pauseBeforeMs: 150,
        pauseAfterMs: 350,
        nonVerbalsBefore: ['sigh'],
        controlEvidence: [
          {
            control: 'pause_before',
            reason: 'The authored hesitation precedes the correction.',
            evidence: [{ kind: 'authored_substring', segmentId: 'segment-1', quote: 'deadline' }],
            learnerMeaningRequired: false,
          },
          {
            control: 'pause_after',
            reason: 'The authored deadline lands before the next reply.',
            evidence: [{ kind: 'authored_substring', segmentId: 'segment-1', quote: 'deadline' }],
            learnerMeaningRequired: false,
          },
        ],
      },
    });

    const rendered = renderInworldSpeechSegment({ model: 'inworld-tts-2', plan, segment });
    expect(rendered.text).toBe(
      '[warm practical and direct] <break time="150ms" /> We need a clearer deadline. <break time="350ms" />',
    );
    expect(rendered.text).not.toContain('authored hesitation');
    expect(rendered.text).not.toContain('frontmatter:topic');
  });

  it('renders one evidenced nonverbal without exposing its reason or evidence', () => {
    const { plan, segment } = createSchemaV2RenderPlan({
      overallComponents: [],
      segment: {
        turnAdjustment: undefined,
        nonVerbalsBefore: ['sigh'],
        controlEvidence: [
          {
            control: 'nonverbal',
            reason: 'The authored hesitation is meaningful.',
            evidence: [{ kind: 'authored_substring', segmentId: 'segment-1', quote: 'deadline' }],
            learnerMeaningRequired: false,
          },
        ],
      },
    });

    const rendered = renderInworldSpeechSegment({ model: 'inworld-tts-2', plan, segment });
    expect(rendered.text).toBe('[warm practical and direct] [sigh] We need a clearer deadline.');
    expect(rendered.text).not.toContain('authored hesitation');
    expect(rendered.leadingInstructionTagCount).toBe(1);
  });

  it.each([
    'inworld-tts-1.5-max',
    'inworld-tts-1.5-mini',
  ] as const)('keeps %s rendering free from TTS-2 steering syntax without changing natural pace', (model) => {
    const plan = createPreviewSpeechPlan({
      emotion: 'calm concern',
      pace: 'natural',
      nonVerbalsBefore: ['sigh'],
      pauseAfterMs: 350,
      deliveryMode: 'CREATIVE',
    });
    expect(
      renderInworldSpeechSegment({
        model,
        plan,
        segment: plan.segments[0]!,
      }),
    ).toEqual({
      text: 'We need a clearer deadline.',
      lexicalText: 'We need a clearer deadline.',
      leadingInstructionTagCount: 0,
      speakingRate: 1,
    });
  });

  it('changes preview cache identity when language or renderer policy changes', async () => {
    const context = createPreviewContext();
    const buildHash = (language: string, rendererPolicyVersion = INWORLD_RENDERER_POLICY_VERSION) =>
      buildStudyTextMp3Inworld(
        { context },
        {
          voiceMapPath: 'voices.yml',
          outPath: '/tmp',
          preview: true,
          voicePlan: createPreviewVoicePlan('2026-06-02T00:00:00.000Z', 'Maya', 'Ashley', language),
        },
        { rendererPolicyVersion },
      );

    const baseline = await buildHash('en-US');
    await expect(buildHash('en-GB')).resolves.not.toMatchObject({ hash: baseline.hash });
    await expect(buildHash('en-US', 'inworld-renderer-v3')).resolves.not.toMatchObject({
      hash: baseline.hash,
    });
  });

  it('blocks unsafe speech plans before calling injected synthesis', async () => {
    const synthesizeChunk = vi.fn();
    const context = createPreviewContext();
    const voicePlan = createPreviewVoicePlan('2026-06-02T00:00:00.000Z');
    voicePlan.assignments[0]!.capabilities.supportsFreeFormDirection = true;

    await expect(
      buildStudyTextMp3Inworld(
        { context },
        {
          voiceMapPath: 'voices.yml',
          outPath: '/path-that-must-not-be-created',
          force: true,
          speechPlan: createPreviewSpeechPlan({ freeFormDirection: '[inject]' }),
          voicePlan,
        },
        { synthesizeChunk },
      ),
    ).rejects.toThrow('freeFormDirection contains an unsafe markup delimiter');
    expect(synthesizeChunk).not.toHaveBeenCalled();
  });

  it('blocks authored provider-control markup before calling injected synthesis', async () => {
    const synthesizeChunk = vi.fn();
    const context = parseMarkdownContext(
      '---\ntitle: Test\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\n---\n\n:::study-text\n[Maya]: [whisper] Do not share the answer.\n:::',
    );

    await expect(
      buildStudyTextMp3Inworld(
        { context },
        {
          voiceMapPath: 'voices.yml',
          outPath: '/path-that-must-not-be-created',
          force: true,
          voicePlan: createPreviewVoicePlan(
            '2026-06-02T00:00:00.000Z',
            'Maya',
            'Ashley',
            undefined,
            hashStudyText(
              JSON.stringify([
                { id: 'segment-1', speaker: 'Maya', text: '[whisper] Do not share the answer.' },
              ]),
            ),
          ),
        },
        { synthesizeChunk },
      ),
    ).rejects.toThrow('authored_markup_delimiter:segment-1');
    expect(synthesizeChunk).not.toHaveBeenCalled();
  });

  it.each([
    ['partial', (segments: SpeechPerformancePlan['segments']) => segments.slice(0, 1)],
    [
      'extra',
      (segments: SpeechPerformancePlan['segments']) => [
        ...segments,
        { id: 'segment-3', speaker: 'Maya', text: 'This segment is foreign.' },
      ],
    ],
    ['reordered', (segments: SpeechPerformancePlan['segments']) => [...segments].reverse()],
  ] as const)('blocks a %s speech plan before calling injected synthesis', async (_caseName, mutateSegments) => {
    const synthesizeChunk = vi.fn();
    const context = parseMarkdownContext(
      '---\ntitle: Test\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\n---\n\n:::study-text\n[Maya]: First authored line.\n[Leo]: Second authored line.\n:::',
    );
    const sourceSegments = [
      { id: 'segment-1', speaker: 'Maya', text: 'First authored line.' },
      { id: 'segment-2', speaker: 'Leo', text: 'Second authored line.' },
    ];
    const speechPlan: SpeechPerformancePlan = {
      schemaVersion: 1,
      mode: 'prompted',
      provider: 'inworld',
      model: 'inworld-tts-2',
      sourceHash: hashStudyText(JSON.stringify(sourceSegments)),
      segments: mutateSegments(sourceSegments),
    };

    await expect(
      buildStudyTextMp3Inworld(
        { context },
        {
          voiceMapPath: 'voices.yml',
          outPath: '/path-that-must-not-be-created',
          force: true,
          speechPlan,
          voicePlan: createPreviewVoicePlan(
            '2026-06-02T00:00:00.000Z',
            'Maya',
            'Ashley',
            undefined,
            hashStudyText(JSON.stringify(sourceSegments)),
          ),
        },
        { synthesizeChunk },
      ),
    ).rejects.toThrow(/Speech plan (segment count|segment)/);
    expect(synthesizeChunk).not.toHaveBeenCalled();
  });

  it.each([
    ['foreign selection', { provider: 'google', model: 'chirp3_hd' }],
    ['foreign source hash', { sourceHash: 'foreign-source-hash' }],
  ] as const)('blocks a speech plan with %s before calling injected synthesis', async (_caseName, override) => {
    const synthesizeChunk = vi.fn();
    const context = createPreviewContext();
    const speechPlan = { ...createPreviewSpeechPlan(), ...override } as SpeechPerformancePlan;

    await expect(
      buildStudyTextMp3Inworld(
        { context },
        {
          voiceMapPath: 'voices.yml',
          outPath: '/path-that-must-not-be-created',
          force: true,
          speechPlan,
          voicePlan: createPreviewVoicePlan('2026-06-02T00:00:00.000Z'),
        },
        { synthesizeChunk },
      ),
    ).rejects.toThrow('selection or source hash does not match prepared text');
    expect(synthesizeChunk).not.toHaveBeenCalled();
  });

  it('keeps preview cache hashes stable when only ranker timestamps change', async () => {
    const context = createPreviewContext();
    const first = await buildStudyTextMp3Inworld(
      { context },
      {
        voiceMapPath: 'voices.yml',
        outPath: '/tmp',
        preview: true,
        voicePlan: createPreviewVoicePlan('2026-06-02T00:00:00.000Z'),
      },
    );
    const second = await buildStudyTextMp3Inworld(
      { context },
      {
        voiceMapPath: 'voices.yml',
        outPath: '/tmp',
        preview: true,
        voicePlan: createPreviewVoicePlan('2026-06-02T00:01:00.000Z'),
      },
    );

    expect(second.hash).toBe(first.hash);
  });

  it('normalizes bracketed segment speakers before resolving rendered voice assignments', async () => {
    const context = createPreviewContext();
    const bracketed = await buildStudyTextMp3Inworld(
      { context },
      {
        voiceMapPath: 'voices.yml',
        outPath: '/tmp',
        preview: true,
        voicePlan: createPreviewVoicePlan('2026-06-02T00:00:00.000Z', '[Maya]'),
      },
    );
    const unbracketed = await buildStudyTextMp3Inworld(
      { context },
      {
        voiceMapPath: 'voices.yml',
        outPath: '/tmp',
        preview: true,
        voicePlan: createPreviewVoicePlan('2026-06-02T00:00:00.000Z', 'Maya'),
      },
    );

    expect(bracketed.hash).toBe(unbracketed.hash);
  });

  it('changes preview cache hashes when rendered controls or voice assignments change', async () => {
    const context = createPreviewContext();
    const buildHash = async (
      speechPlan = createPreviewSpeechPlan(),
      voicePlan = createPreviewVoicePlan('2026-06-02T00:00:00.000Z'),
    ) =>
      (
        await buildStudyTextMp3Inworld(
          { context },
          { voiceMapPath: 'voices.yml', outPath: '/tmp', preview: true, speechPlan, voicePlan },
        )
      ).hash;
    const baseline = await buildHash();

    await expect(buildHash(createPreviewSpeechPlan({ pauseAfterMs: 250 }))).resolves.not.toBe(
      baseline,
    );
    await expect(
      buildHash(createPreviewSpeechPlan({ deliveryMode: 'CREATIVE' })),
    ).resolves.not.toBe(baseline);
    await expect(
      buildHash(createPreviewSpeechPlan({ emphasis: ['clearer deadline'] })),
    ).resolves.not.toBe(baseline);
    await expect(buildHash(createPreviewSpeechPlan({ pace: 'measured' }))).resolves.not.toBe(
      baseline,
    );
    await expect(buildHash(createPreviewSpeechPlan({ pace: 'natural' }))).resolves.toBe(baseline);
    await expect(
      buildHash(
        createPreviewSpeechPlan(),
        createPreviewVoicePlan('2026-06-02T00:00:00.000Z', 'Maya', 'Dennis'),
      ),
    ).resolves.not.toBe(baseline);
  });

  it('includes sample rate and encoding in chunk-cache identity hash', () => {
    const chunkArgs = {
      model: 'inworld-tts-2',
      voiceId: 'Ashley',
      text: 'We need a clearer deadline.',
      index: 0,
      speakingRate: 1.0,
      temperature: 1.0,
      deliveryMode: 'BALANCED',
      sampleRateHertz: 48_000,
    };

    const first = buildInworldChunkHash(chunkArgs);
    const same = buildInworldChunkHash({ ...chunkArgs });
    const differentSampleRate = buildInworldChunkHash({ ...chunkArgs, sampleRateHertz: 24_000 });
    const differentEncoding = buildInworldChunkHash({ ...chunkArgs, encoding: 'LINEAR16' });
    const differentLanguage = buildInworldChunkHash({ ...chunkArgs, language: 'en-GB' });
    const differentPolicy = buildInworldChunkHash({
      ...chunkArgs,
      rendererPolicyVersion: 'inworld-renderer-v3',
    });

    expect(same).toBe(first);
    expect(differentSampleRate).not.toBe(first);
    expect(differentEncoding).not.toBe(first);
    expect(differentLanguage).not.toBe(first);
    expect(differentPolicy).not.toBe(first);
  });
});
