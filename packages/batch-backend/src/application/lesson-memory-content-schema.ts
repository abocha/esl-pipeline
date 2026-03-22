import { z } from 'zod';

const ConfidenceValues = ['low', 'medium', 'high'] as const;
const FactAuthorityValues = ['teacher_confirmed', 'student_stated', 'model_inferred'] as const;
const SpeakerRoleValues = ['student', 'teacher'] as const;

const NonEmptyStringSchema = z.string().trim().min(1);

export const LessonMemoryConfidenceSchema = z.enum(ConfidenceValues);
export const LessonMemoryFactAuthoritySchema = z.enum(FactAuthorityValues);

export const FactEvidenceSchema = z
  .object({
    quote: NonEmptyStringSchema,
    speakerRole: z.enum(SpeakerRoleValues).nullable(),
    evidenceNote: NonEmptyStringSchema.nullable(),
    transcriptSpan: NonEmptyStringSchema.nullable(),
  })
  .strict();

export const MistakeEvidenceSchema = z
  .object({
    observedForm: NonEmptyStringSchema,
    suggestedTarget: NonEmptyStringSchema.nullable(),
    evidenceQuote: NonEmptyStringSchema.nullable(),
    evidenceNote: NonEmptyStringSchema.nullable(),
    confidenceNote: NonEmptyStringSchema.nullable(),
  })
  .strict();

export const PronunciationEvidenceSchema = z
  .object({
    observedIssue: NonEmptyStringSchema,
    focusWords: z.array(NonEmptyStringSchema),
    evidenceQuote: NonEmptyStringSchema.nullable(),
    evidenceNote: NonEmptyStringSchema.nullable(),
    confidenceNote: NonEmptyStringSchema.nullable(),
  })
  .strict();

export const StudentFactContentSchema = z
  .object({
    fact: NonEmptyStringSchema,
    category: NonEmptyStringSchema,
    authority: LessonMemoryFactAuthoritySchema,
    confidence: LessonMemoryConfidenceSchema,
    evidence: z.array(FactEvidenceSchema),
    reviewNeeded: z.boolean(),
  })
  .strict();

export const LessonMemoryTopicSchema = z
  .object({
    topic: NonEmptyStringSchema,
    note: NonEmptyStringSchema,
  })
  .strict();

export const LessonMemoryNamedNoteSchema = z
  .object({
    name: NonEmptyStringSchema,
    note: NonEmptyStringSchema,
  })
  .strict();

export const LessonMemoryLabeledNoteSchema = z
  .object({
    label: NonEmptyStringSchema,
    note: NonEmptyStringSchema,
  })
  .strict();

export const LessonMemoryVocabularyFocusSchema = z
  .object({
    text: NonEmptyStringSchema,
    note: NonEmptyStringSchema,
  })
  .strict();

export const LessonMemoryMistakePatternSchema = z
  .object({
    label: NonEmptyStringSchema,
    explanation: NonEmptyStringSchema,
    reviewRecommended: z.boolean(),
    confidence: LessonMemoryConfidenceSchema,
    evidence: z.array(MistakeEvidenceSchema),
  })
  .strict();

export const LessonMemoryPronunciationFocusSchema = z
  .object({
    label: NonEmptyStringSchema,
    note: NonEmptyStringSchema,
    confidence: LessonMemoryConfidenceSchema,
    evidence: z.array(PronunciationEvidenceSchema),
  })
  .strict();

export const LessonMemoryContentSchema = z
  .object({
    lessonSummary: NonEmptyStringSchema,
    topicsDiscussed: z.array(LessonMemoryTopicSchema),
    mistakePatterns: z.array(LessonMemoryMistakePatternSchema),
    grammarReviewed: z.array(LessonMemoryNamedNoteSchema),
    grammarWatchlist: z.array(LessonMemoryNamedNoteSchema),
    vocabularyFocus: z.array(LessonMemoryVocabularyFocusSchema),
    pronunciationFocus: z.array(LessonMemoryPronunciationFocusSchema),
    studentFacts: z.array(StudentFactContentSchema),
    progressSignals: z.array(LessonMemoryLabeledNoteSchema),
    followUpRecommendations: z.array(LessonMemoryLabeledNoteSchema),
  })
  .strict();

export type FactEvidence = z.infer<typeof FactEvidenceSchema>;
export type MistakeEvidence = z.infer<typeof MistakeEvidenceSchema>;
export type PronunciationEvidence = z.infer<typeof PronunciationEvidenceSchema>;
export type StudentFactContent = z.infer<typeof StudentFactContentSchema>;
export type LessonMemoryContent = z.infer<typeof LessonMemoryContentSchema>;

function nullableStringJsonSchema(): Record<string, unknown> {
  return {
    anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
  };
}

function nullableEnumJsonSchema(values: readonly string[]): Record<string, unknown> {
  return {
    anyOf: [{ type: 'string', enum: [...values] }, { type: 'null' }],
  };
}

const factEvidenceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    quote: { type: 'string', minLength: 1 },
    speakerRole: nullableEnumJsonSchema(SpeakerRoleValues),
    evidenceNote: nullableStringJsonSchema(),
    transcriptSpan: nullableStringJsonSchema(),
  },
  required: ['quote', 'speakerRole', 'evidenceNote', 'transcriptSpan'],
} as const;

const mistakeEvidenceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    observedForm: { type: 'string', minLength: 1 },
    suggestedTarget: nullableStringJsonSchema(),
    evidenceQuote: nullableStringJsonSchema(),
    evidenceNote: nullableStringJsonSchema(),
    confidenceNote: nullableStringJsonSchema(),
  },
  required: [
    'observedForm',
    'suggestedTarget',
    'evidenceQuote',
    'evidenceNote',
    'confidenceNote',
  ],
} as const;

const pronunciationEvidenceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    observedIssue: { type: 'string', minLength: 1 },
    focusWords: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    evidenceQuote: nullableStringJsonSchema(),
    evidenceNote: nullableStringJsonSchema(),
    confidenceNote: nullableStringJsonSchema(),
  },
  required: [
    'observedIssue',
    'focusWords',
    'evidenceQuote',
    'evidenceNote',
    'confidenceNote',
  ],
} as const;

export const LESSON_MEMORY_CONTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lessonSummary: { type: 'string', minLength: 1 },
    topicsDiscussed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: { type: 'string', minLength: 1 },
          note: { type: 'string', minLength: 1 },
        },
        required: ['topic', 'note'],
      },
    },
    mistakePatterns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1 },
          explanation: { type: 'string', minLength: 1 },
          reviewRecommended: { type: 'boolean' },
          confidence: { type: 'string', enum: [...ConfidenceValues] },
          evidence: {
            type: 'array',
            items: mistakeEvidenceJsonSchema,
          },
        },
        required: ['label', 'explanation', 'reviewRecommended', 'confidence', 'evidence'],
      },
    },
    grammarReviewed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          note: { type: 'string', minLength: 1 },
        },
        required: ['name', 'note'],
      },
    },
    grammarWatchlist: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          note: { type: 'string', minLength: 1 },
        },
        required: ['name', 'note'],
      },
    },
    vocabularyFocus: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', minLength: 1 },
          note: { type: 'string', minLength: 1 },
        },
        required: ['text', 'note'],
      },
    },
    pronunciationFocus: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1 },
          note: { type: 'string', minLength: 1 },
          confidence: { type: 'string', enum: [...ConfidenceValues] },
          evidence: {
            type: 'array',
            items: pronunciationEvidenceJsonSchema,
          },
        },
        required: ['label', 'note', 'confidence', 'evidence'],
      },
    },
    studentFacts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fact: { type: 'string', minLength: 1 },
          category: { type: 'string', minLength: 1 },
          authority: { type: 'string', enum: [...FactAuthorityValues] },
          confidence: { type: 'string', enum: [...ConfidenceValues] },
          evidence: {
            type: 'array',
            items: factEvidenceJsonSchema,
          },
          reviewNeeded: { type: 'boolean' },
        },
        required: ['fact', 'category', 'authority', 'confidence', 'evidence', 'reviewNeeded'],
      },
    },
    progressSignals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1 },
          note: { type: 'string', minLength: 1 },
        },
        required: ['label', 'note'],
      },
    },
    followUpRecommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1 },
          note: { type: 'string', minLength: 1 },
        },
        required: ['label', 'note'],
      },
    },
  },
  required: [
    'lessonSummary',
    'topicsDiscussed',
    'mistakePatterns',
    'grammarReviewed',
    'grammarWatchlist',
    'vocabularyFocus',
    'pronunciationFocus',
    'studentFacts',
    'progressSignals',
    'followUpRecommendations',
  ],
} as const satisfies Record<string, unknown>;

export const LESSON_MEMORY_RESPONSE_SCHEMA_NAME = 'lesson_memory_content';

export const LESSON_MEMORY_RESPONSE_SCHEMA_DESCRIPTION =
  'Canonical structured lesson-memory content for one ESL lesson transcript.';

export function validateLessonMemoryContent(input: unknown): LessonMemoryContent {
  return LessonMemoryContentSchema.parse(input);
}

