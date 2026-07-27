import { describe, expect, it, vi } from 'vitest';

import { parseMarkdownContext } from '@esl-pipeline/pmd';

import {
  buildInworldChunkHash,
  buildStudyTextMp3Inworld,
  createInworldTtsProvider,
  loadInworldVoicesCatalog,
  renderInworldSpeechSegment,
  resolveInworldAssemblyGapDurations,
  resolveInworldSpeakerAssignmentsFromCatalog,
  resolveInworldSpeakerAssignmentsWithRankerFromCatalog,
  resolveInworldTtsModel,
} from '../src/index.js';

function createPreviewContext() {
  return parseMarkdownContext(
    '---\ntitle: Test\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\n---\n\n:::study-text\n[Maya]: We need a clearer deadline.\n:::',
  );
}

function createPreviewVoicePlan(generatedAt: string, speaker = 'Maya', voiceId = 'Ashley') {
  return {
    schemaVersion: 1 as const,
    mode: 'ranked' as const,
    provider: 'inworld' as const,
    model: 'inworld-tts-2' as const,
    sourceHash: 'source-hash',
    ranker: { provider: 'google_ai_studio', model: 'gemma-4-26b-a4b-it', generatedAt },
    assignments: [
      {
        speaker,
        voiceId,
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

function createPreviewSpeechPlan(segment: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    mode: 'prompted' as const,
    provider: 'inworld' as const,
    model: 'inworld-tts-2' as const,
    sourceHash: 'source-hash',
    segments: [
      {
        id: 'segment-1',
        speaker: 'Maya',
        text: 'We need a clearer deadline.',
        ...segment,
      },
    ],
  };
}

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

  it('records TTS-2 voice capability tiers and prefers steerable voices when fit is close', () => {
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
        voiceId: 'Calm Steerable',
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
          capabilities: { supportsFreeFormDirection: false },
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
    expect(
      renderInworldSpeechSegment({
        model: 'inworld-tts-2',
        segment: {
          id: 'segment-1',
          speaker: 'Maya',
          text: 'We need a clearer deadline.',
          emotion: 'calm concern',
          intonation: 'firm but collaborative',
          pace: 'measured',
          emphasis: ['clearer deadline'],
          pauseBeforeMs: 150,
          pauseAfterMs: 350,
          nonVerbalsBefore: ['sigh'],
          deliveryMode: 'BALANCED',
          freeFormDirection: 'speak as if carefully breaking difficult news',
        },
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: true,
        },
      }),
    ).toEqual({
      text: '[emotion: calm concern; intonation: firm but collaborative] [speak as if carefully breaking difficult news] [sigh] <break time="150ms" /> We need a CLEARER DEADLINE. <break time="350ms" />',
      speakingRate: 0.95,
      deliveryMode: 'BALANCED',
    });
  });

  it.each([
    [undefined, undefined],
    ['natural', undefined],
    ['slow', 0.85],
    ['measured', 0.95],
    ['brisk', 1.1],
  ] as const)('renders TTS-2 pace %s through only the numeric SDK control', (pace, speakingRate) => {
    const rendered = renderInworldSpeechSegment({
      model: 'inworld-tts-2',
      segment: {
        id: 'segment-1',
        text: 'Keep a steady tempo.',
        ...(pace ? { pace } : {}),
      },
    });

    expect(rendered.text).toBe('Keep a steady tempo.');
    expect(rendered.speakingRate).toBe(speakingRate);
  });

  it('keeps common TTS-2 controls but omits free-form direction for non-steerable voices', () => {
    expect(
      renderInworldSpeechSegment({
        model: 'inworld-tts-2',
        segment: {
          id: 'segment-1',
          text: 'We need a clearer deadline.',
          emotion: 'calm concern',
          emphasis: ['clearer deadline'],
          nonVerbalsBefore: ['sigh'],
          freeFormDirection: 'speak as if carefully breaking difficult news',
        },
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: false,
        },
      }),
    ).toEqual({
      text: '[emotion: calm concern] [sigh] We need a CLEARER DEADLINE.',
    });
  });

  it('keeps TTS 1.5 rendering free from TTS-2 steering syntax without changing natural pace', () => {
    expect(
      renderInworldSpeechSegment({
        model: 'inworld-tts-1.5-mini',
        segment: {
          id: 'segment-1',
          text: 'We need a clearer deadline.',
          emotion: 'calm concern',
          pace: 'natural',
          nonVerbalsBefore: ['sigh'],
          pauseAfterMs: 350,
          deliveryMode: 'CREATIVE',
        },
      }),
    ).toEqual({ text: 'We need a clearer deadline.', speakingRate: 1 });
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

    expect(same).toBe(first);
    expect(differentSampleRate).not.toBe(first);
    expect(differentEncoding).not.toBe(first);
  });
});
