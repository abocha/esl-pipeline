import { z } from 'zod';

const InputTypeValues = ['generate', 'authentic'] as const;
const StudyTextTypeValues = ['monologue', 'dialogue'] as const;
const PronunciationModeValues = [
  'shadow_sentence',
  'intonation',
  'rhythm_chunking',
  'sentence_stress',
  'connected_speech',
  'minimal_pair',
  'other',
] as const;
const TaskTypeValues = [
  'roadmap',
  'input',
  'grammar',
  'vocabulary',
  'controlled_practice',
  'comprehension',
  'pronunciation',
  'mission',
  'teacher_follow_up',
  'other',
] as const;
const TargetKindValues = ['new', 'review', 'mixed'] as const;
const FollowUpCueTypeValues = ['warm_up', 'error_focus', 'monitoring', 'other'] as const;

const NonEmptyStringSchema = z.string().trim().min(1);

export const HomeworkMemoryInputTypeSchema = z.enum(InputTypeValues);
export const HomeworkMemoryStudyTextTypeSchema = z.enum(StudyTextTypeValues);
export const HomeworkMemoryPronunciationModeSchema = z.enum(PronunciationModeValues);
export const HomeworkMemoryTaskTypeSchema = z.enum(TaskTypeValues);
export const HomeworkMemoryTargetKindSchema = z.enum(TargetKindValues);
export const HomeworkMemoryFollowUpCueTypeSchema = z.enum(FollowUpCueTypeValues);

export const HomeworkMemoryNamedTargetSchema = z
  .object({
    name: NonEmptyStringSchema,
    note: NonEmptyStringSchema,
    targetKind: HomeworkMemoryTargetKindSchema,
  })
  .strict();

export const HomeworkMemoryVocabularyTargetSchema = z
  .object({
    text: NonEmptyStringSchema,
    note: NonEmptyStringSchema,
    targetKind: HomeworkMemoryTargetKindSchema,
  })
  .strict();

export const HomeworkMemoryLabeledNoteSchema = z
  .object({
    label: NonEmptyStringSchema,
    note: NonEmptyStringSchema,
  })
  .strict();

export const HomeworkMemoryTaskSchema = z
  .object({
    section: NonEmptyStringSchema,
    task: NonEmptyStringSchema,
    taskType: HomeworkMemoryTaskTypeSchema,
    review: z.boolean(),
  })
  .strict();

export const HomeworkMemoryPronunciationFocusSchema = z
  .object({
    mode: HomeworkMemoryPronunciationModeSchema,
    target: NonEmptyStringSchema,
    action: NonEmptyStringSchema,
  })
  .strict();

export const HomeworkMemoryTeacherFollowUpCueSchema = z
  .object({
    cueType: HomeworkMemoryFollowUpCueTypeSchema,
    note: NonEmptyStringSchema,
  })
  .strict();

export const HomeworkMemoryContentSchema = z
  .object({
    homeworkSummary: NonEmptyStringSchema,
    topic: NonEmptyStringSchema,
    grammarTargets: z.array(HomeworkMemoryNamedTargetSchema),
    vocabularyTargets: z.array(HomeworkMemoryVocabularyTargetSchema),
    reviewTargets: z.array(HomeworkMemoryLabeledNoteSchema),
    taskList: z.array(HomeworkMemoryTaskSchema),
    pronunciationFocus: z.array(HomeworkMemoryPronunciationFocusSchema),
    studyTextType: HomeworkMemoryStudyTextTypeSchema,
    inputType: HomeworkMemoryInputTypeSchema,
    communicativeOutcome: NonEmptyStringSchema,
    teacherFollowUpCues: z.array(HomeworkMemoryTeacherFollowUpCueSchema),
  })
  .strict();

export type HomeworkMemoryContent = z.infer<typeof HomeworkMemoryContentSchema>;

export const HOMEWORK_MEMORY_CONTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    homeworkSummary: { type: 'string', minLength: 1 },
    topic: { type: 'string', minLength: 1 },
    grammarTargets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          note: { type: 'string', minLength: 1 },
          targetKind: { type: 'string', enum: [...TargetKindValues] },
        },
        required: ['name', 'note', 'targetKind'],
      },
    },
    vocabularyTargets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', minLength: 1 },
          note: { type: 'string', minLength: 1 },
          targetKind: { type: 'string', enum: [...TargetKindValues] },
        },
        required: ['text', 'note', 'targetKind'],
      },
    },
    reviewTargets: {
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
    taskList: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section: { type: 'string', minLength: 1 },
          task: { type: 'string', minLength: 1 },
          taskType: { type: 'string', enum: [...TaskTypeValues] },
          review: { type: 'boolean' },
        },
        required: ['section', 'task', 'taskType', 'review'],
      },
    },
    pronunciationFocus: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { type: 'string', enum: [...PronunciationModeValues] },
          target: { type: 'string', minLength: 1 },
          action: { type: 'string', minLength: 1 },
        },
        required: ['mode', 'target', 'action'],
      },
    },
    studyTextType: { type: 'string', enum: [...StudyTextTypeValues] },
    inputType: { type: 'string', enum: [...InputTypeValues] },
    communicativeOutcome: { type: 'string', minLength: 1 },
    teacherFollowUpCues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cueType: { type: 'string', enum: [...FollowUpCueTypeValues] },
          note: { type: 'string', minLength: 1 },
        },
        required: ['cueType', 'note'],
      },
    },
  },
  required: [
    'homeworkSummary',
    'topic',
    'grammarTargets',
    'vocabularyTargets',
    'reviewTargets',
    'taskList',
    'pronunciationFocus',
    'studyTextType',
    'inputType',
    'communicativeOutcome',
    'teacherFollowUpCues',
  ],
} as const satisfies Record<string, unknown>;

export const HOMEWORK_MEMORY_RESPONSE_SCHEMA_NAME = 'homework_memory_content';

export const HOMEWORK_MEMORY_RESPONSE_SCHEMA_DESCRIPTION =
  'Canonical structured homework-memory content for one published ESL assignment.';

export function validateHomeworkMemoryContent(input: unknown): HomeworkMemoryContent {
  return HomeworkMemoryContentSchema.parse(input);
}
