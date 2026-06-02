import { describe, expect, it } from 'vitest';

import { parseMarkdownContext } from '@esl-pipeline/pmd';

import {
  createIdentitySpeechPerformancePlan,
  createPreparedStudyTextSynthesis,
  createResolvedVoicePlan,
  getTtsModelCapabilities,
  type PreparedStudyTextSynthesis,
  type SpeechPerformancePlan,
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

  it('rejects free-form direction for a selected voice without that capability', () => {
    const source = createPrepared();
    const prepared = withVoicePlan(
      source,
      createResolvedVoicePlan(source, [
        {
          speaker: 'Maya',
          voiceId: 'Ashley',
          source: 'auto',
          capabilities: {
            supportsMetadataInstructions: true,
            supportsNonVerbals: true,
            supportsUppercaseEmphasis: true,
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
          supportsFreeFormDirection: false,
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
