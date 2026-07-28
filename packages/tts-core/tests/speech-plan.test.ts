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
  resolveVoicePlanForExecution,
  type SpeechPerformancePlan,
  type VoicePlan,
  validateSpeechPerformancePlan,
  validateVoicePlan,
  withVoicePlan,
} from '../src/index.js';

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

describe('speech performance plans', () => {
  it.each([
    '[laugh]',
    '<break />',
    '{voice}',
    'line\nbreak',
    'line\u2028break',
    'line\u2029break',
    '\u0007alarm',
  ]) (
    'rejects unsafe cue text %j',
    (cue) => {
      expect(() => normalizeSpeechCueText('freeFormDirection', cue)).toThrow();
    },
  );

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
});
