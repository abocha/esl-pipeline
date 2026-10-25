import { createHash } from 'node:crypto';

import { serializeAssignmentV1 } from '@esl-pipeline/contracts';
import type {
  PreparedStudyTextSynthesis,
  SpeechPerformancePromptPolicyId,
} from '@esl-pipeline/tts-core';
import { SPEECH_ANNOTATION_CLOSE, SPEECH_ANNOTATION_OPEN } from '@esl-pipeline/tts-core';

function createSpeechPlanResponseSchema(plannerPauseMaximumMs: number) {
  return {
    name: 'tts_speech_performance_plan',
    description: 'Provider-neutral expressive speech cues for immutable study-text segments.',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['segments'],
      properties: {
        segments: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id'],
            properties: {
              id: { type: 'string' },
              emotion: { type: 'string' },
              intonation: { type: 'string' },
              pace: { type: 'string', enum: ['slow', 'measured', 'natural', 'brisk'] },
              emphasis: { type: 'array', items: { type: 'string' } },
              pauseBeforeMs: {
                type: 'integer',
                minimum: 0,
                maximum: plannerPauseMaximumMs,
              },
              pauseAfterMs: {
                type: 'integer',
                minimum: 0,
                maximum: plannerPauseMaximumMs,
              },
              nonVerbalsBefore: {
                type: 'array',
                items: { type: 'string', enum: ['sigh', 'laugh', 'chuckle', 'breath'] },
              },
              nonVerbalsAfter: {
                type: 'array',
                items: { type: 'string', enum: ['sigh', 'laugh', 'chuckle', 'breath'] },
              },
              deliveryMode: {
                type: 'string',
                enum: ['STABLE', 'BALANCED', 'CREATIVE'],
              },
              freeFormDirection: { type: 'string' },
            },
          },
        },
      },
    },
  } as const;
}

const V1_SPEECH_PLAN_RESPONSE_SCHEMA = createSpeechPlanResponseSchema(3000);
export const SPEECH_PLAN_RESPONSE_SCHEMA = createSpeechPlanResponseSchema(1000);

export const SPEECH_ANNOTATION_RESPONSE_SCHEMA = {
  name: 'tts_contextual_speech_annotations',
  description: 'Optional performance annotations inserted into immutable authored speech.',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['segments'],
    properties: {
      segments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'synthesisText'],
          properties: {
            id: { type: 'string' },
            synthesisText: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

const V1_LINES = [
  'Create restrained, natural speech-performance cues for this ESL study text.',
  'Do not rewrite words, add dialogue, or change segment order.',
  'Use non-verbal cues sparingly. Prefer clarity over theatrical delivery.',
  'Maintain a natural, consistent conversational tempo across adjacent segments.',
  'Omit pace for ordinary dialogue.',
  'Use slow, measured, or brisk only when a non-natural tempo is explicitly justified by the authored scene or learning goal.',
  'Do not use pace merely to reinforce emotion, seriousness, regret, reflection, or intonation.',
  'Only set freeFormDirection for segments whose selected voice supportsFreeFormDirection.',
] as const;

const V2_LINES = [
  'Create restrained, natural speech-performance cues for this ESL study text; authored words and segment order are immutable.',
  'Never add, remove, reorder, normalize, or rewrite spoken words, dialogue, fillers, contractions, or numbers.',
  'When freeFormDirection is useful, write one complete free-form direction that combines all compatible delivery qualities.',
  'Supported Inworld direction categories include emotion, articulation, intonation, volume, pitch, range, speed, and vocal style.',
  'Do not combine conflicting directions or directions that contradict the authored content.',
  'Optional cues must be sparse: prefer clarity and natural delivery over theatrical control.',
  'Each explicit pause must be 1000 ms or less.',
  'Use at most one nonverbal cue total per segment, either before or after.',
  'Maintain a natural, consistent conversational tempo across adjacent segments.',
  'Omit pace for ordinary dialogue.',
  'Use slow, measured, or brisk only when a non-natural tempo is explicitly justified by the authored scene or learning goal.',
  'Do not use pace merely to reinforce emotion, seriousness, regret, reflection, or intonation.',
  'Only set freeFormDirection for segments whose selected voice supportsFreeFormDirection.',
  'Unless an explicit existing use case requires otherwise, deliveryMode must remain BALANCED.',
] as const;

const CONTEXTUAL_ANNOTATION_LINES = [
  'Enhance the spoken segments using the complete assignment below as read-only context.',
  'Return only the ordered spoken segments with their existing id and synthesisText.',
  'Every authored character in each segment is immutable: do not change, add, remove, reorder, normalize, or reproduce it differently.',
  `You may insert optional performance annotations only as ${SPEECH_ANNOTATION_OPEN}natural playable direction${SPEECH_ANNOTATION_CLOSE}.`,
  'Annotations may be leading directions or inline nonverbals such as sighs, laughs, breaths, or more context-specific natural-language variants.',
  'Unchanged synthesisText is completely valid. Do not add annotations to satisfy a quota.',
  'Do not invent reactions that materially change the event, characterization, or intended meaning.',
  'Ordinary square brackets are authored text; only the reserved tts-annotation delimiters identify your insertions.',
] as const;

export const SPEECH_PERFORMANCE_PROMPT_POLICIES: Record<
  SpeechPerformancePromptPolicyId,
  readonly string[]
> = {
  'speech-performance-v1-restrained-natural': V1_LINES,
  'speech-performance-v2-inworld-tts2': V2_LINES,
  'contextual-bracket-annotation-v1': CONTEXTUAL_ANNOTATION_LINES,
};

export function buildSpeechPlannerRequest(
  prepared: PreparedStudyTextSynthesis,
  promptPolicyVersion: SpeechPerformancePromptPolicyId,
  _model: string,
) {
  const contextual = promptPolicyVersion === 'contextual-bracket-annotation-v1';
  const context = prepared.enhancementContext;
  const assignmentContext = context ? serializeAssignmentV1(context.assignment) : undefined;
  if (contextual && !assignmentContext) {
    throw new Error('Contextual speech annotation requires complete assignment context.');
  }
  const prompt = contextual
    ? [
        ...SPEECH_PERFORMANCE_PROMPT_POLICIES[promptPolicyVersion],
        'COMPLETE ASSIGNMENT (READ ONLY):',
        assignmentContext!,
        'ORDERED SPOKEN SEGMENTS:',
        JSON.stringify({ segments: prepared.segments }),
      ].join('\n\n')
    : [
        ...SPEECH_PERFORMANCE_PROMPT_POLICIES[promptPolicyVersion],
        JSON.stringify({
          segments: prepared.segments,
          voiceAssignments: prepared.voicePlan?.assignments ?? [],
        }),
      ].join('\n\n');
  return {
    prompt,
    promptHash: createHash('sha256').update(prompt).digest('hex'),
    promptPolicyVersion,
    responseSchema: contextual
      ? SPEECH_ANNOTATION_RESPONSE_SCHEMA
      : promptPolicyVersion === 'speech-performance-v1-restrained-natural'
        ? V1_SPEECH_PLAN_RESPONSE_SCHEMA
        : SPEECH_PLAN_RESPONSE_SCHEMA,
  };
}
