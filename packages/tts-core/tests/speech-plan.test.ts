import { describe, expect, it } from 'vitest';

import { parseMarkdownContext } from '@esl-pipeline/pmd';

import {
  analyzeSpeechPlanCandidate,
  analyzeValidatedSpeechPlan,
  assertSpeechPlanSafeForSynthesis,
  createIdentitySpeechPerformancePlan,
  createPreparedStudyTextSynthesis,
  createResolvedVoicePlan,
  getTtsModelCapabilities,
  normalizeSpeechCueText,
  type PreparedStudyTextSynthesis,
  resolveEffectiveSpeechDirection,
  resolveStudyTextPerformanceMode,
  resolveVoicePlanForExecution,
  type SpeechPerformancePlan,
  type SpeechPerformancePlanV2,
  TtsSynthesisCancelledError,
  throwIfTtsCancelled,
  type VoicePlan,
  validateSpeechPerformancePlan,
  validateVoicePlan,
  withVoicePlan,
} from '../src/index.js';

describe('TTS request cancellation', () => {
  it('throws a stable cancellation error for an aborted caller signal', () => {
    const controller = new AbortController();
    controller.abort('operator stop');

    expect(() => throwIfTtsCancelled({ signal: controller.signal }, () => 100)).toThrow(
      TtsSynthesisCancelledError,
    );
    let cancellation: unknown;
    try {
      throwIfTtsCancelled({ signal: controller.signal }, () => 100);
    } catch (error) {
      cancellation = error;
    }
    expect(cancellation).toMatchObject({
      name: 'TtsSynthesisCancelledError',
      code: 'TTS_SYNTHESIS_CANCELLED',
      message: 'TTS synthesis cancelled',
      reason: 'operator stop',
    });
  });

  it('treats an exact deadline boundary as caller cancellation', () => {
    expect(() => throwIfTtsCancelled({ deadlineAtMs: 100 }, () => 100)).toThrow(
      TtsSynthesisCancelledError,
    );
    expect(() => throwIfTtsCancelled({ deadlineAtMs: 101 }, () => 100)).not.toThrow();
  });
});

function createPrepared(): PreparedStudyTextSynthesis {
  return {
    selection: { provider: 'inworld', model: 'inworld-tts-2' },
    sourceHash: 'source-hash',
    segments: [
      { id: 'segment-1', speaker: 'Maya', text: 'We need a clearer deadline.' },
      { id: 'segment-2', speaker: 'Leo', text: 'I can revise the plan today.' },
    ],
    voices: [],
    voiceAssignments: { Maya: 'Ashley', Leo: 'Dennis' },
  };
}

function createPreparedWithPerformanceContext(): PreparedStudyTextSynthesis {
  const context = parseMarkdownContext(
    `---\ntitle: Deadline conversation\nstudent: Alex\nlevel: B1\ntopic: [work, deadlines]\ninput_type: generate\nstudy_text_type: dialogue\nspeaker_profiles:\n  - id: Maya\n    role: project manager\n    persona: warm practical and direct\n  - id: Leo\n    role: developer\n    persona: thoughtful and responsive\n---\n\n:::study-text\nMaya: We need a clearer deadline.\nLeo: I can revise the plan today.\nMaya: That would help the whole team.\n:::`,
  );
  const prepared = createPreparedStudyTextSynthesis(
    { context },
    {
      voiceMapPath: 'voices.yml',
      outPath: '/tmp',
      ttsProvider: 'inworld',
      ttsStrategy: 'dialogue',
    },
  );
  const capabilities = {
    supportsMetadataInstructions: true,
    supportsNonVerbals: true,
    supportsUppercaseEmphasis: true,
    supportsFreeFormDirection: true,
  };
  return withVoicePlan(
    prepared,
    createResolvedVoicePlan(prepared, [
      { speaker: 'Maya', voiceId: 'Ashley', source: 'auto', capabilities, language: 'en-US' },
      { speaker: 'Leo', voiceId: 'Dennis', source: 'auto', capabilities, language: 'en-US' },
    ]),
  );
}

function createSchemaV2Plan(prepared: PreparedStudyTextSynthesis): SpeechPerformancePlanV2 {
  return {
    schemaVersion: 2,
    mode: 'prompted',
    provider: prepared.selection.provider,
    model: prepared.selection.model,
    sourceHash: prepared.sourceHash,
    performanceContextHash: prepared.performanceContextHash!,
    resolvedPerformanceMode: prepared.performanceMode!,
    performanceContext: {
      overallDirection: {
        components: [
          {
            dimension: 'relationship',
            direction: 'sound like colleagues solving a real problem',
          },
          { dimension: 'energy', direction: 'keep the exchange engaged but grounded' },
        ],
        basis: ['frontmatter:topic'],
      },
      speakerEnvelopes: [
        {
          speaker: 'Maya',
          baselineDirection: {
            components: [
              { dimension: 'style', direction: 'warm practical and direct' },
              { dimension: 'intonation', direction: 'use clear collaborative phrasing' },
            ],
            basis: ['speaker_profile:Maya:persona'],
          },
        },
        {
          speaker: 'Leo',
          baselineDirection: {
            components: [{ dimension: 'style', direction: 'thoughtful and responsive' }],
            basis: ['speaker_profile:Leo:persona'],
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
    segments: prepared.segments.map((segment) => ({ ...segment })),
  };
}

describe('speech performance plans', () => {
  it.each([
    '[laugh]',
    '<break />',
    '{voice}',
    'line\nbreak',
    'line\u2028break',
    'line\u2029break',
    '\u0007alarm',
  ])('rejects unsafe cue text %j', (cue) => {
    expect(() => normalizeSpeechCueText('freeFormDirection', cue)).toThrow();
  });

  it('normalizes bounded Unicode cue text and rejects excessive or unsupported content', () => {
    expect(normalizeSpeechCueText('emotion', '  gently — but clearly  ')).toBe(
      'gently — but clearly',
    );
    expect(() => normalizeSpeechCueText('emotion', 'é'.repeat(81))).toThrow('80 code points');
    expect(() => normalizeSpeechCueText('freeFormDirection', 'calm / clear')).toThrow(
      'unsupported character',
    );
  });

  it('analyzes raw candidate identity, cue grammar, and planner caps before merge', () => {
    const analysis = analyzeSpeechPlanCandidate(createPrepared(), {
      segments: [
        {
          id: 'segment-1',
          emotion: '[urgent]',
          pauseAfterMs: 1001,
          nonVerbalsBefore: ['sigh'],
          nonVerbalsAfter: ['laugh'],
        },
        { id: 'segment-1' },
        { id: 'unknown-segment' },
      ],
    });

    expect(analysis.hardFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate_segment_id', segmentId: 'segment-1' }),
        expect.objectContaining({ code: 'unknown_segment_id', segmentId: 'unknown-segment' }),
        expect.objectContaining({ code: 'missing_source_segment', segmentId: 'segment-2' }),
        expect.objectContaining({ code: 'unsafe_cue_text', segmentId: 'segment-1' }),
        expect.objectContaining({ code: 'planner_pause_exceeds_cap', segmentId: 'segment-1' }),
        expect.objectContaining({
          code: 'planner_nonverbal_cap_exceeded',
          segmentId: 'segment-1',
        }),
      ]),
    );
  });

  it('rejects raw candidate enum and collection shapes before merge', () => {
    const analysis = analyzeSpeechPlanCandidate(createPrepared(), {
      segments: [
        {
          id: 'segment-1',
          pace: 'warp',
          deliveryMode: 'LOUD',
          emphasis: 'deadline',
          nonVerbalsBefore: ['</s>'],
        },
        { id: 'segment-2' },
      ],
    });

    expect(analysis.hardFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'candidate_pace_invalid', segmentId: 'segment-1' }),
        expect.objectContaining({
          code: 'candidate_delivery_mode_invalid',
          segmentId: 'segment-1',
        }),
        expect.objectContaining({ code: 'candidate_emphasis_invalid', segmentId: 'segment-1' }),
        expect.objectContaining({ code: 'candidate_nonverbal_invalid', segmentId: 'segment-1' }),
      ]),
    );
  });

  it('detects rendered lexical changes from explicit renderer summaries', () => {
    const prepared = createPrepared();
    const plan = createIdentitySpeechPerformancePlan(prepared);
    const analysis = analyzeValidatedSpeechPlan(prepared, plan, [
      {
        id: 'segment-1',
        text: 'Goodbye world.',
        lexicalText: 'Goodbye world.',
      },
      {
        id: 'segment-2',
        text: 'I can revise the plan today.',
        lexicalText: 'I can revise the plan today.',
      },
    ]);

    expect(analysis.hardFailures).toContainEqual(
      expect.objectContaining({ code: 'rendered_words_changed', segmentId: 'segment-1' }),
    );
  });

  it.each([
    ['$5 is due.', '5 is due.'],
    ['Completion is 50%.', 'Completion is 50.'],
    ['Use C++ here.', 'Use C here.'],
    ['Read ½ aloud.', 'Read 1/2 aloud.'],
  ])('detects spoken symbol changes from %j to %j', (authored, rendered) => {
    const prepared: PreparedStudyTextSynthesis = {
      ...createPrepared(),
      segments: [{ id: 'segment-1', text: authored }],
    };
    const plan = createIdentitySpeechPerformancePlan(prepared);

    expect(
      analyzeValidatedSpeechPlan(prepared, plan, [
        { id: 'segment-1', text: rendered, lexicalText: rendered },
      ]).hardFailures,
    ).toContainEqual(
      expect.objectContaining({ code: 'rendered_words_changed', segmentId: 'segment-1' }),
    );
  });

  it('analyzes normalized plans and blocks privacy-safe synthesis failures', () => {
    const prepared: PreparedStudyTextSynthesis = {
      ...createPrepared(),
      selection: { provider: 'inworld', model: 'inworld-tts-1.5-mini' },
    };
    const plan: SpeechPerformancePlan = {
      ...createIdentitySpeechPerformancePlan(prepared),
      mode: 'prompted',
      segments: [
        {
          ...prepared.segments[0]!,
          emotion: 'concerned',
          freeFormDirection: 'speak gently',
          nonVerbalsBefore: ['sigh'],
          pauseAfterMs: 1001,
        },
        prepared.segments[1]!,
      ],
    };
    const analysis = analyzeValidatedSpeechPlan(prepared, plan, [
      {
        id: 'segment-1',
        text: '[one] [two] We need a clearer deadline.',
        lexicalText: 'We need a clearer deadline.',
      },
      {
        id: 'segment-2',
        text: 'I can revise the plan today.',
        lexicalText: 'I can revise the plan today.',
      },
    ]);

    expect(analysis.hardFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unsupported_metadata_instruction' }),
        expect.objectContaining({ code: 'unsupported_free_form_direction' }),
        expect.objectContaining({ code: 'unsupported_nonverbal' }),
        expect.objectContaining({ code: 'planner_pause_exceeds_cap' }),
        expect.objectContaining({ code: 'leading_instruction_tag_count_exceeded' }),
      ]),
    );
    expect(analysis.metrics.pauseCount).toBe(1);
    expect(() => assertSpeechPlanSafeForSynthesis(analysis)).toThrow(
      'leading_instruction_tag_count_exceeded:segment-1',
    );
    expect(() => assertSpeechPlanSafeForSynthesis(analysis)).not.toThrowError(
      /We need a clearer deadline/,
    );
  });

  it('marks newly resolved voice plans with model-scoped capability provenance', () => {
    const prepared = createPrepared();
    const plan = createResolvedVoicePlan(prepared, [
      {
        speaker: 'Maya',
        voiceId: 'Ashley',
        source: 'auto',
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: true,
        },
      },
    ]);

    expect(plan.capabilityPolicyVersion).toBe('model-scoped-v1');
  });

  it('normalizes legacy Inworld capabilities into an immutable execution view', () => {
    const prepared = createPrepared();
    const legacy: VoicePlan = {
      schemaVersion: 1,
      mode: 'deterministic',
      provider: 'inworld',
      model: 'inworld-tts-2',
      sourceHash: prepared.sourceHash,
      assignments: [
        {
          speaker: 'Maya',
          voiceId: 'Ashley',
          source: 'auto',
          capabilities: {
            supportsMetadataInstructions: false,
            supportsNonVerbals: false,
            supportsUppercaseEmphasis: false,
            supportsFreeFormDirection: false,
          },
        },
      ],
    };

    const effective = resolveVoicePlanForExecution(prepared, legacy);

    expect(effective).not.toBe(legacy);
    expect(effective.assignments[0]?.capabilities).toEqual({
      supportsMetadataInstructions: true,
      supportsNonVerbals: true,
      supportsUppercaseEmphasis: true,
      supportsFreeFormDirection: true,
    });
    expect(effective.assignments[0]?.language).toBeUndefined();
    expect(legacy.assignments[0]?.capabilities.supportsFreeFormDirection).toBe(false);
    expect(withVoicePlan(prepared, legacy).voicePlan).toEqual(effective);
  });

  it.each([
    ['inworld', 'inworld-tts-2'],
    ['google', 'chirp3_hd'],
    ['elevenlabs', 'eleven_v3'],
  ] as const)('rejects contradictory marked %s voice plans', (provider, model) => {
    const prepared: PreparedStudyTextSynthesis = {
      ...createPrepared(),
      selection: { provider, model },
    };

    expect(() =>
      resolveVoicePlanForExecution(prepared, {
        schemaVersion: 1,
        capabilityPolicyVersion: 'model-scoped-v1',
        mode: 'deterministic',
        provider,
        model,
        sourceHash: prepared.sourceHash,
        assignments: [
          {
            speaker: 'Maya',
            voiceId: 'voice-1',
            source: 'auto',
            capabilities: {
              supportsMetadataInstructions: provider !== 'inworld',
              supportsNonVerbals: provider !== 'inworld',
              supportsUppercaseEmphasis: provider !== 'inworld',
              supportsFreeFormDirection: false,
            },
          },
        ],
      }),
    ).toThrow('contradicts model-scoped capabilities');
  });

  it('declares prompted expressive capabilities only for Inworld TTS-2', () => {
    expect(getTtsModelCapabilities('inworld', 'inworld-tts-2')).toMatchObject({
      planningMode: 'prompted',
      naturalLanguageSteering: true,
      ssmlBreaks: true,
      nonVerbals: true,
      deliveryModes: ['STABLE', 'BALANCED', 'CREATIVE'],
    });
    expect(getTtsModelCapabilities('inworld', 'inworld-tts-1.5-mini')).toMatchObject({
      planningMode: 'identity',
      temperature: { min: 0, max: 2 },
    });
    expect(getTtsModelCapabilities('elevenlabs', 'eleven_v3')).toMatchObject({
      planningMode: 'identity',
    });
  });

  it('creates a one-to-one identity plan from prepared study text', () => {
    const plan = createIdentitySpeechPerformancePlan(createPrepared(), {
      fallbackReason: 'planner_disabled',
    });

    expect(plan).toMatchObject({
      schemaVersion: 1,
      mode: 'identity',
      sourceHash: 'source-hash',
      provider: 'inworld',
      model: 'inworld-tts-2',
      fallbackReason: 'planner_disabled',
      segments: [
        { id: 'segment-1', speaker: 'Maya', text: 'We need a clearer deadline.' },
        { id: 'segment-2', speaker: 'Leo', text: 'I can revise the plan today.' },
      ],
    });
  });

  it('prepares stable segments from learner markdown', () => {
    const context = parseMarkdownContext(
      `---\ntitle: Test\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\n---\n\n:::study-text\n[Maya]: We need a clearer deadline.\nLeo: I can revise the plan today.\n:::`,
    );

    expect(
      createPreparedStudyTextSynthesis(
        { context },
        { voiceMapPath: 'voices.yml', outPath: '/tmp', ttsProvider: 'inworld' },
      ),
    ).toMatchObject({
      selection: { provider: 'inworld', model: 'inworld-tts-2' },
      segments: [
        { id: 'segment-1', speaker: 'Maya', text: 'We need a clearer deadline.' },
        { id: 'segment-2', speaker: 'Leo', text: 'I can revise the plan today.' },
      ],
    });
  });

  it.each([
    ['dialogue', 'monologue', ['Maya'], 'dialogue'],
    ['tts', 'dialogue', ['Maya', 'Leo'], 'monologue'],
    ['auto', 'monologue', ['Narrator'], 'monologue'],
    ['auto', 'dialogue', ['Maya'], 'monologue'],
    ['auto', 'dialogue', ['Maya', 'Leo'], 'dialogue'],
  ] as const)('resolves strategy %s, parsed type %s, and speakers %j', (ttsStrategy, studyTextType, speakers, expected) => {
    expect(resolveStudyTextPerformanceMode({ ttsStrategy, studyTextType, speakers })).toBe(
      expected,
    );
  });

  it('prepares only decision-relevant performance context', () => {
    const context = parseMarkdownContext(
      `---\ntitle: Deadline conversation\nstudent: private learner\nlevel: B1\ntopic: [work, deadlines]\ninput_type: generate\nstudy_text_type: dialogue\nspeaker_profiles:\n  - id: Maya\n    role: project manager clarifying an unrealistic deadline\n    persona: warm, practical, and direct\n    voice_direction: calm, clear, conversational adult voice\n    voice: secret-provider-id\n  - id: Unused\n    persona: must not escape\n---\n\n:::study-text\nMaya: We need a clearer deadline.\nLeo: I can revise the plan today.\n:::`,
    );

    const prepared = createPreparedStudyTextSynthesis(
      { context },
      {
        voiceMapPath: 'voices.yml',
        outPath: '/tmp',
        ttsProvider: 'inworld',
        ttsStrategy: 'dialogue',
      },
    );

    expect(prepared).toMatchObject({
      performanceMode: 'dialogue',
      performanceSpeakers: ['Maya', 'Leo'],
      performanceContextHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      performanceSource: {
        title: 'Deadline conversation',
        topics: ['work', 'deadlines'],
        studyTextType: 'dialogue',
        speakerProfiles: [
          {
            id: 'Maya',
            role: 'project manager clarifying an unrealistic deadline',
            persona: 'warm, practical, and direct',
            voice_direction: 'calm, clear, conversational adult voice',
          },
        ],
      },
    });
    expect(JSON.stringify(prepared)).not.toContain('private learner');
    expect(JSON.stringify(prepared)).not.toContain('secret-provider-id');
    expect(JSON.stringify(prepared)).not.toContain('must not escape');
  });

  it('uses one stable narrator for an unlabeled monologue', () => {
    const context = parseMarkdownContext(
      `---\ntitle: Update\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\nspeaker_profiles:\n  - id: Maya\n  - id: Leo\n---\n\n:::study-text\nWe need a clearer deadline.\nI can revise the plan today.\n:::`,
    );

    const prepared = createPreparedStudyTextSynthesis(
      { context },
      {
        voiceMapPath: 'voices.yml',
        outPath: '/tmp',
        ttsProvider: 'inworld',
        ttsStrategy: 'auto',
      },
    );

    expect(prepared.performanceMode).toBe('monologue');
    expect(prepared.performanceSpeakers).toEqual(['Narrator']);
    expect(prepared.performanceSource?.speakerProfiles).toEqual([]);
  });

  it('rejects dialogue when any turn lacks authored speaker ownership', () => {
    const context = parseMarkdownContext(
      `---\ntitle: Deadline conversation\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\nstudy_text_type: dialogue\nspeaker_labels: [Maya, Leo]\nspeaker_profiles:\n  - id: Maya\n  - id: Leo\n---\n\n:::study-text\nMaya: We need a clearer deadline.\nI can revise the plan today.\n:::`,
    );

    expect(() =>
      createPreparedStudyTextSynthesis(
        { context },
        {
          voiceMapPath: 'voices.yml',
          outPath: '/tmp',
          ttsProvider: 'inworld',
          ttsStrategy: 'dialogue',
        },
      ),
    ).toThrow('dialogue strategy requires an authored speaker for every study-text segment');
  });

  it('rejects explicit monologue strategy with multiple authored speakers', () => {
    const context = parseMarkdownContext(
      `---\ntitle: Deadline conversation\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\n---\n\n:::study-text\nMaya: We need a clearer deadline.\nLeo: I can revise the plan today.\n:::`,
    );

    expect(() =>
      createPreparedStudyTextSynthesis(
        { context },
        {
          voiceMapPath: 'voices.yml',
          outPath: '/tmp',
          ttsProvider: 'inworld',
          ttsStrategy: 'tts',
        },
      ),
    ).toThrow('tts strategy requires one authored study-text speaker');
  });

  it('changes only the performance context hash when voice language changes', () => {
    const context = parseMarkdownContext(
      `---\ntitle: Update\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\n---\n\n:::study-text\nMaya: We need a clearer deadline.\nMaya: I can revise the plan today.\n:::`,
    );
    const prepared = createPreparedStudyTextSynthesis(
      { context },
      {
        voiceMapPath: 'voices.yml',
        outPath: '/tmp',
        ttsProvider: 'inworld',
        ttsStrategy: 'auto',
      },
    );
    const assignment = {
      speaker: 'Maya',
      voiceId: 'Ashley',
      source: 'auto' as const,
      capabilities: {
        supportsMetadataInstructions: true,
        supportsNonVerbals: true,
        supportsUppercaseEmphasis: true,
        supportsFreeFormDirection: true,
      },
    };

    const first = withVoicePlan(
      prepared,
      createResolvedVoicePlan(prepared, [{ ...assignment, language: 'en-US' }]),
    );
    const second = withVoicePlan(
      prepared,
      createResolvedVoicePlan(prepared, [{ ...assignment, language: 'en-GB' }]),
    );

    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.performanceContextHash).not.toBe(second.performanceContextHash);
  });

  it('preserves normalized speaker labels for frontmatter-only speaker universes', () => {
    const context = parseMarkdownContext(
      `---\ntitle: Test\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\nspeaker_labels: ["[Alex]", "Alex"]\nspeaker_profiles:\n  - id: alex\n---\n\n:::study-text\nWe need a clearer deadline.\n:::`,
    );

    const prepared = createPreparedStudyTextSynthesis(
      { context },
      { voiceMapPath: 'voices.yml', outPath: '/tmp', ttsProvider: 'inworld' },
    );

    expect(prepared.speakerLabels).toEqual(['Alex']);
    expect(() =>
      validateVoicePlan(prepared, {
        schemaVersion: 1,
        mode: 'deterministic',
        provider: 'inworld',
        model: 'inworld-tts-2',
        sourceHash: prepared.sourceHash,
        assignments: [
          {
            speaker: 'Alex',
            voiceId: 'Ashley',
            source: 'auto',
            capabilities: {
              supportsMetadataInstructions: true,
              supportsNonVerbals: true,
              supportsUppercaseEmphasis: true,
              supportsFreeFormDirection: true,
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  it('falls back to the first speaker profile when unlabeled study text has no speaker prefixes', () => {
    const context = parseMarkdownContext(
      `---\ntitle: Test\nstudent: Alex\nlevel: B1\ntopic: work\ninput_type: generate\nspeaker_profiles:\n  - id: "[Narrator]"\n---\n\n:::study-text\nWe need a clearer deadline.\n:::`,
    );

    expect(
      createPreparedStudyTextSynthesis(
        { context },
        { voiceMapPath: 'voices.yml', outPath: '/tmp', ttsProvider: 'inworld' },
      ).speakerLabels,
    ).toEqual(['Narrator']);
  });

  it('accepts expressive cues while preserving authored words', () => {
    const prepared = withVoicePlan(
      createPrepared(),
      createResolvedVoicePlan(createPrepared(), [
        {
          speaker: 'Maya',
          voiceId: 'Ashley',
          source: 'auto',
          capabilities: {
            supportsMetadataInstructions: true,
            supportsNonVerbals: true,
            supportsUppercaseEmphasis: true,
            supportsFreeFormDirection: true,
          },
        },
        {
          speaker: 'Leo',
          voiceId: 'Dennis',
          source: 'auto',
          capabilities: {
            supportsMetadataInstructions: true,
            supportsNonVerbals: true,
            supportsUppercaseEmphasis: true,
            supportsFreeFormDirection: true,
          },
        },
      ]),
    );
    const plan: SpeechPerformancePlan = {
      ...createIdentitySpeechPerformancePlan(prepared),
      mode: 'prompted',
      segments: [
        {
          id: 'segment-1',
          speaker: 'Maya',
          text: 'We need a clearer deadline.',
          emotion: 'calm concern',
          intonation: 'firm but collaborative',
          pace: 'measured',
          pauseAfterMs: 350,
          nonVerbalsBefore: ['sigh'],
          deliveryMode: 'BALANCED',
          freeFormDirection: 'speak as if carefully breaking difficult news',
        },
        {
          id: 'segment-2',
          speaker: 'Leo',
          text: 'I can revise the plan today.',
          emphasis: ['today'],
        },
      ],
    };

    expect(validateSpeechPerformancePlan(prepared, plan)).toEqual(plan);
  });

  it('canonicalizes emphasis phrases to the authored text casing without changing source text', () => {
    const prepared = createPrepared();
    const plan: SpeechPerformancePlan = {
      ...createIdentitySpeechPerformancePlan(prepared),
      mode: 'prompted',
      segments: [
        {
          id: 'segment-1',
          speaker: 'Maya',
          text: 'We need a clearer deadline.',
          emphasis: ['we', 'DEADLINE'],
        },
        { id: 'segment-2', speaker: 'Leo', text: 'I can revise the plan today.' },
      ],
    };

    expect(validateSpeechPerformancePlan(prepared, plan).segments[0]?.emphasis).toEqual([
      'We',
      'deadline',
    ]);
    expect(prepared.segments[0]?.text).toBe('We need a clearer deadline.');
  });

  it('rejects emphasis phrases that are empty or absent from authored text', () => {
    const prepared = createPrepared();
    const createPlan = (emphasis: string[]): SpeechPerformancePlan => ({
      ...createIdentitySpeechPerformancePlan(prepared),
      mode: 'prompted',
      segments: [
        {
          id: 'segment-1',
          speaker: 'Maya',
          text: 'We need a clearer deadline.',
          emphasis,
        },
        { id: 'segment-2', speaker: 'Leo', text: 'I can revise the plan today.' },
      ],
    });

    expect(() => validateSpeechPerformancePlan(prepared, createPlan(['']))).toThrow(
      'emphasis phrase must not be empty',
    );
    expect(() => validateSpeechPerformancePlan(prepared, createPlan(['tomorrow']))).toThrow(
      'is not present in authored text',
    );
  });

  it('rejects free-form direction for a selected model without that capability', () => {
    const source: PreparedStudyTextSynthesis = {
      ...createPrepared(),
      selection: { provider: 'google', model: 'chirp3_hd' },
    };
    const prepared = withVoicePlan(
      source,
      createResolvedVoicePlan(source, [
        {
          speaker: 'Maya',
          voiceId: 'Ashley',
          source: 'auto',
          capabilities: {
            supportsMetadataInstructions: false,
            supportsNonVerbals: false,
            supportsUppercaseEmphasis: false,
            supportsFreeFormDirection: false,
          },
        },
      ]),
    );
    const plan: SpeechPerformancePlan = {
      ...createIdentitySpeechPerformancePlan(prepared),
      mode: 'prompted',
      segments: [
        {
          id: 'segment-1',
          speaker: 'Maya',
          text: 'We need a clearer deadline.',
          freeFormDirection: 'speak as if carefully breaking difficult news',
        },
        { id: 'segment-2', speaker: 'Leo', text: 'I can revise the plan today.' },
      ],
    };

    expect(() => validateSpeechPerformancePlan(prepared, plan)).toThrow(
      'does not support free-form direction',
    );
  });

  it('validates resolved voice plans against prepared study text', () => {
    const prepared = createPrepared();
    const plan = createResolvedVoicePlan(prepared, [
      {
        speaker: 'Maya',
        voiceId: 'Ashley',
        source: 'auto',
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: true,
        },
      },
      {
        speaker: 'Leo',
        voiceId: 'Dennis',
        source: 'auto',
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: true,
        },
      },
    ]);

    expect(validateVoicePlan(prepared, plan)).toEqual(plan);
  });

  it('rejects voice plans with duplicate casing assignments for the same speaker', () => {
    const prepared = createPrepared();
    const plan = createResolvedVoicePlan(prepared, [
      {
        speaker: 'Maya',
        voiceId: 'Ashley',
        source: 'auto',
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: true,
        },
      },
      {
        speaker: 'maya',
        voiceId: 'Ashley',
        source: 'auto',
        capabilities: {
          supportsMetadataInstructions: true,
          supportsNonVerbals: true,
          supportsUppercaseEmphasis: true,
          supportsFreeFormDirection: true,
        },
      },
    ]);

    expect(() => validateVoicePlan(prepared, plan)).toThrow(
      'Voice plan contains duplicate assignment for speaker "maya".',
    );
  });

  it('rejects plans that rewrite the authored words', () => {
    const prepared = createPrepared();
    const plan: SpeechPerformancePlan = {
      ...createIdentitySpeechPerformancePlan(prepared),
      mode: 'prompted',
      segments: [
        { id: 'segment-1', speaker: 'Maya', text: 'We need a much clearer deadline.' },
        { id: 'segment-2', speaker: 'Leo', text: 'I can revise the plan today.' },
      ],
    };

    expect(() => validateSpeechPerformancePlan(prepared, plan)).toThrow(
      'Speech plan segment "segment-1" changed the authored text.',
    );
  });

  it('validates one envelope per speaker and composes closest-scope direction', () => {
    const prepared = createPreparedWithPerformanceContext();
    const plan = createSchemaV2Plan(prepared);
    plan.segments[0]!.turnAdjustment = {
      components: [{ dimension: 'intonation', direction: 'land the deadline firmly' }],
      reason: 'The correction needs a clear boundary',
      evidence: [
        {
          kind: 'authored_substring',
          segmentId: 'segment-1',
          quote: 'clearer deadline',
        },
      ],
    };

    const validated = validateSpeechPerformancePlan(prepared, plan);
    expect(resolveEffectiveSpeechDirection(validated, validated.segments[0]!)).toEqual({
      components: [
        { dimension: 'relationship', direction: 'sound like colleagues solving a real problem' },
        { dimension: 'energy', direction: 'keep the exchange engaged but grounded' },
        { dimension: 'style', direction: 'warm practical and direct' },
        { dimension: 'intonation', direction: 'land the deadline firmly' },
      ],
      instruction:
        'sound like colleagues solving a real problem keep the exchange engaged but grounded warm practical and direct land the deadline firmly',
    });
  });

  it.each([
    [
      'missing envelope',
      (plan: SpeechPerformancePlanV2) => {
        plan.performanceContext.speakerEnvelopes.shift();
      },
      'missing speaker envelope',
    ],
    [
      'unknown envelope',
      (plan: SpeechPerformancePlanV2) => {
        plan.performanceContext.speakerEnvelopes.push({
          speaker: 'Unknown',
          baselineDirection: { components: [], basis: ['frontmatter:title'] },
        });
      },
      'unknown speaker envelope',
    ],
    [
      'duplicate dimension',
      (plan: SpeechPerformancePlanV2) => {
        plan.performanceContext.speakerEnvelopes[0]!.baselineDirection.components.push({
          dimension: 'style',
          direction: 'another style',
        });
      },
      'duplicate direction dimension',
    ],
    [
      'foreign basis',
      (plan: SpeechPerformancePlanV2) => {
        plan.performanceContext.overallDirection.basis = ['frontmatter:student'];
      },
      'basis reference',
    ],
    [
      'changed words',
      (plan: SpeechPerformancePlanV2) => {
        plan.segments[0]!.text = 'Changed words.';
      },
      'changed the authored text',
    ],
    [
      'non-adjacent evidence',
      (plan: SpeechPerformancePlanV2) => {
        plan.segments[0]!.turnAdjustment = {
          components: [{ dimension: 'intonation', direction: 'respond to the later point' }],
          reason: 'A later point changes the delivery',
          evidence: [{ kind: 'adjacent_segment', segmentId: 'segment-3', quote: 'whole team' }],
        };
      },
      'must reference an adjacent segment',
    ],
  ] as const)('rejects schema-v2 %s', (_name, mutate, message) => {
    const prepared = createPreparedWithPerformanceContext();
    const plan = createSchemaV2Plan(prepared);
    mutate(plan);
    expect(() => validateSpeechPerformancePlan(prepared, plan)).toThrow(message);
  });

  it('rejects a schema-v2 plan when decision-relevant context changed', () => {
    const prepared = createPreparedWithPerformanceContext();
    const plan = createSchemaV2Plan(prepared);
    const changed: PreparedStudyTextSynthesis = {
      ...prepared,
      performanceContextHash: 'b'.repeat(64),
    };

    expect(() => validateSpeechPerformancePlan(changed, plan)).toThrow('performance context hash');
  });

  it('canonicalizes defaults and requires evidence for surviving auxiliary controls', () => {
    const prepared = createPreparedWithPerformanceContext();
    const plan = createSchemaV2Plan(prepared);
    Object.assign(plan.segments[0]!, {
      pace: 'natural',
      pauseBeforeMs: 0,
      pauseAfterMs: 250,
      deliveryMode: 'BALANCED',
      controlEvidence: [
        {
          control: 'pause_after',
          reason: 'The completed boundary needs a deliberate beat',
          learnerMeaningRequired: false,
          evidence: [
            {
              kind: 'authored_substring',
              segmentId: 'segment-1',
              quote: 'deadline',
            },
          ],
        },
      ],
    });

    const validated = validateSpeechPerformancePlan(prepared, plan);
    expect(validated.segments[0]).toMatchObject({ pauseAfterMs: 250 });
    expect(validated.segments[0]).not.toHaveProperty('pace');
    expect(validated.segments[0]).not.toHaveProperty('pauseBeforeMs');
    expect(validated.segments[0]).not.toHaveProperty('deliveryMode');

    const missingEvidence = createSchemaV2Plan(prepared);
    missingEvidence.segments[0]!.pace = 'brisk';
    expect(() => validateSpeechPerformancePlan(prepared, missingEvidence)).toThrow(
      'control evidence',
    );
  });

  it('requires learner-meaning evidence when pace and emphasis are both active', () => {
    const prepared = createPreparedWithPerformanceContext();
    const plan = createSchemaV2Plan(prepared);
    Object.assign(plan.segments[0]!, {
      pace: 'brisk',
      emphasis: ['deadline'],
      controlEvidence: [
        {
          control: 'pace',
          reason: 'The correction is intentionally brisk',
          learnerMeaningRequired: false,
          evidence: [{ kind: 'authored_substring', segmentId: 'segment-1', quote: 'deadline' }],
        },
        {
          control: 'emphasis',
          reason: 'The same word also received an acoustic cue',
          learnerMeaningRequired: false,
          evidence: [{ kind: 'authored_substring', segmentId: 'segment-1', quote: 'deadline' }],
        },
      ],
    });

    expect(() => validateSpeechPerformancePlan(prepared, plan)).toThrow('learner-meaning evidence');
  });

  it('counts effective controls instead of raw defaults and shadowed fields', () => {
    const prepared = createPreparedWithPerformanceContext();
    const plan = createSchemaV2Plan(prepared);
    plan.performanceContext.overallDirection.components.push({
      dimension: 'tempo',
      direction: 'keep a naturally brisk exchange',
    });
    Object.assign(plan.segments[0]!, {
      pace: 'brisk',
      pauseBeforeMs: 0,
      pauseAfterMs: 250,
      deliveryMode: 'BALANCED',
      controlEvidence: [
        {
          control: 'pace',
          reason: 'The deadline correction is intentionally brisk',
          learnerMeaningRequired: false,
          evidence: [{ kind: 'authored_substring', segmentId: 'segment-1', quote: 'deadline' }],
        },
        {
          control: 'pause_after',
          reason: 'The correction needs a boundary',
          learnerMeaningRequired: false,
          evidence: [{ kind: 'authored_substring', segmentId: 'segment-1', quote: 'deadline' }],
        },
      ],
    });
    const validated = validateSpeechPerformancePlan(prepared, plan);
    const effective = resolveEffectiveSpeechDirection(validated, validated.segments[0]!);
    expect(effective.components).not.toContainEqual(
      expect.objectContaining({ dimension: 'tempo' }),
    );

    const analysis = analyzeValidatedSpeechPlan(prepared, validated);
    expect(analysis.metrics).toMatchObject({
      instructionCount: 3,
      paceCount: 1,
      pauseCount: 1,
      emphasisCount: 0,
      nonverbalCount: 0,
      nonDefaultDeliveryModeCount: 0,
      cueCount: 5,
    });
    expect(analysis.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'high_cue_density' }),
    );
  });

  it('warns about structural continuity risks without blocking synthesis', () => {
    const prepared = createPreparedWithPerformanceContext();
    const plan = createSchemaV2Plan(prepared);
    const paces = ['slow', 'brisk', 'slow'] as const;
    for (const [index, segment] of plan.segments.entries()) {
      segment.pace = paces[index]!;
      segment.turnAdjustment = {
        components: [{ dimension: 'energy', direction: `change energy for turn ${index + 1}` }],
        reason: 'The authored words create a local shift',
        evidence: [
          {
            kind: 'authored_substring',
            segmentId: segment.id,
            quote: segment.text.split(' ').at(-1)!.replace('.', ''),
          },
        ],
      };
      segment.controlEvidence = [
        {
          control: 'pace',
          reason: 'The turn needs an intentionally extreme pace',
          learnerMeaningRequired: index === 0,
          evidence: [
            {
              kind: 'authored_substring',
              segmentId: segment.id,
              quote: segment.text.split(' ')[0]!,
            },
          ],
        },
      ];
    }
    plan.segments[0]!.emphasis = ['deadline'];
    plan.segments[0]!.controlEvidence!.push({
      control: 'emphasis',
      reason: 'Deadline is the learner meaning contrast',
      learnerMeaningRequired: true,
      evidence: [{ kind: 'authored_substring', segmentId: 'segment-1', quote: 'deadline' }],
    });

    const analysis = analyzeValidatedSpeechPlan(
      prepared,
      validateSpeechPerformancePlan(prepared, plan),
    );
    expect(analysis.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'pace_with_emphasis' }),
        expect.objectContaining({ code: 'abrupt_adjacent_pace_change' }),
        expect.objectContaining({ code: 'excessive_same_speaker_changes' }),
      ]),
    );
    expect(analysis.hardFailures).toEqual([]);
  });
});
