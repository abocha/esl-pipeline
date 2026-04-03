import { z } from 'zod';

import {
  LessonMemoryConfidenceSchema,
  LessonMemoryFactAuthoritySchema,
  LessonMemoryLabeledNoteSchema,
  StudentFactContentSchema,
} from './lesson-memory-content-schema.js';

const IssueTypeValues = [
  'grammar',
  'vocabulary',
  'pronunciation',
  'fluency',
  'communication',
  'review_loop',
  'other',
] as const;
const PriorityValues = ['low', 'medium', 'high'] as const;
const NonEmptyStringSchema = z.string().trim().min(1);

export const StudentMemoryIssueTypeSchema = z.enum(IssueTypeValues);
export const StudentMemoryPrioritySchema = z.enum(PriorityValues);

export const StudentMemoryRecurringIssueSchema = z
  .object({
    label: NonEmptyStringSchema,
    issueType: StudentMemoryIssueTypeSchema,
    note: NonEmptyStringSchema,
    confidence: LessonMemoryConfidenceSchema,
  })
  .strict();

export const StudentMemoryRecommendedAssignmentDirectionSchema = z
  .object({
    direction: NonEmptyStringSchema,
    rationale: NonEmptyStringSchema,
  })
  .strict();

export const StudentMemoryUnresolvedIssueSchema = z
  .object({
    label: NonEmptyStringSchema,
    issueType: StudentMemoryIssueTypeSchema,
    note: NonEmptyStringSchema,
    priority: StudentMemoryPrioritySchema,
  })
  .strict();

export const StudentMemorySnapshotContentSchema = z
  .object({
    stableStrengths: z.array(LessonMemoryLabeledNoteSchema),
    recurringIssues: z.array(StudentMemoryRecurringIssueSchema),
    activeReviewBacklog: z.array(LessonMemoryLabeledNoteSchema),
    recentProgress: z.array(LessonMemoryLabeledNoteSchema),
    personalFacts: z.array(StudentFactContentSchema),
    recommendedAssignmentDirections: z.array(StudentMemoryRecommendedAssignmentDirectionSchema),
    unresolvedIssues: z.array(StudentMemoryUnresolvedIssueSchema),
    snapshotSummary: NonEmptyStringSchema,
  })
  .strict();

export type StudentMemorySnapshotContent = z.infer<typeof StudentMemorySnapshotContentSchema>;

function nullableStringJsonSchema(): Record<string, unknown> {
  return {
    anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }],
  };
}

const factEvidenceJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    quote: { type: 'string', minLength: 1 },
    speakerRole: {
      anyOf: [{ type: 'string', enum: ['student', 'teacher'] }, { type: 'null' }],
    },
    evidenceNote: nullableStringJsonSchema(),
    transcriptSpan: nullableStringJsonSchema(),
  },
  required: ['quote', 'speakerRole', 'evidenceNote', 'transcriptSpan'],
} as const;

export const STUDENT_MEMORY_SNAPSHOT_CONTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stableStrengths: {
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
    recurringIssues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1 },
          issueType: { type: 'string', enum: [...IssueTypeValues] },
          note: { type: 'string', minLength: 1 },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['label', 'issueType', 'note', 'confidence'],
      },
    },
    activeReviewBacklog: {
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
    recentProgress: {
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
    personalFacts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fact: { type: 'string', minLength: 1 },
          category: { type: 'string', minLength: 1 },
          authority: { type: 'string', enum: [...LessonMemoryFactAuthoritySchema.options] },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          evidence: {
            type: 'array',
            items: factEvidenceJsonSchema,
          },
          reviewNeeded: { type: 'boolean' },
        },
        required: ['fact', 'category', 'authority', 'confidence', 'evidence', 'reviewNeeded'],
      },
    },
    recommendedAssignmentDirections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          direction: { type: 'string', minLength: 1 },
          rationale: { type: 'string', minLength: 1 },
        },
        required: ['direction', 'rationale'],
      },
    },
    unresolvedIssues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', minLength: 1 },
          issueType: { type: 'string', enum: [...IssueTypeValues] },
          note: { type: 'string', minLength: 1 },
          priority: { type: 'string', enum: [...PriorityValues] },
        },
        required: ['label', 'issueType', 'note', 'priority'],
      },
    },
    snapshotSummary: { type: 'string', minLength: 1 },
  },
  required: [
    'stableStrengths',
    'recurringIssues',
    'activeReviewBacklog',
    'recentProgress',
    'personalFacts',
    'recommendedAssignmentDirections',
    'unresolvedIssues',
    'snapshotSummary',
  ],
} as const satisfies Record<string, unknown>;

export const STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_NAME = 'student_memory_snapshot_content';
export const STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_DESCRIPTION =
  'Canonical structured long-term student-memory snapshot derived from lesson and homework history.';

export function validateStudentMemorySnapshotContent(input: unknown): StudentMemorySnapshotContent {
  return StudentMemorySnapshotContentSchema.parse(input);
}

export {
  FactEvidenceSchema,
  LessonMemoryFactAuthoritySchema,
  StudentFactContentSchema,
} from './lesson-memory-content-schema.js';
