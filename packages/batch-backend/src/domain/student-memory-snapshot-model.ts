import { z } from 'zod';

import type { MemoryConfidence, StudentFact } from './lesson-memory-model.js';

export type StudentMemorySnapshotStatus = 'pending' | 'ready' | 'failed' | 'superseded';
export type StudentMemorySnapshotSourceKind = 'student_memory_rollup';
export type StudentMemoryIssueType =
  | 'grammar'
  | 'vocabulary'
  | 'pronunciation'
  | 'fluency'
  | 'communication'
  | 'review_loop'
  | 'other';
export type StudentMemoryPriority = 'low' | 'medium' | 'high';

export interface StudentMemoryRecurringIssue {
  label: string;
  issueType: StudentMemoryIssueType;
  note: string;
  confidence: MemoryConfidence;
}

export interface StudentMemoryLabeledNote {
  label: string;
  note: string;
}

export interface StudentMemoryRecommendedAssignmentDirection {
  direction: string;
  rationale: string;
}

export interface StudentMemoryUnresolvedIssue {
  label: string;
  issueType: StudentMemoryIssueType;
  note: string;
  priority: StudentMemoryPriority;
}

export interface StudentMemorySnapshotGenerationNotes extends Record<string, unknown> {}

export interface StudentMemorySnapshotRecord {
  id: string;
  studentId: string;
  schemaVersion: string;
  generatedAt: Date;
  provider: string;
  model: string;
  status: StudentMemorySnapshotStatus;
  sourceKind: StudentMemorySnapshotSourceKind;
  lessonMemoryEntryIds: string[];
  homeworkMemoryEntryIds: string[];
  contentHash?: string | null;
  generationNotes?: StudentMemorySnapshotGenerationNotes | null;
  stableStrengths: StudentMemoryLabeledNote[];
  recurringIssues: StudentMemoryRecurringIssue[];
  activeReviewBacklog: StudentMemoryLabeledNote[];
  recentProgress: StudentMemoryLabeledNote[];
  personalFacts: StudentFact[];
  recommendedAssignmentDirections: StudentMemoryRecommendedAssignmentDirection[];
  unresolvedIssues: StudentMemoryUnresolvedIssue[];
  snapshotSummary?: string | null;
  supersededById?: string | null;
  supersededAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const StudentMemorySnapshotStatusSchema = z.enum([
  'pending',
  'ready',
  'failed',
  'superseded',
]);

export const StudentMemorySnapshotSourceKindSchema = z.enum(['student_memory_rollup']);

export const StudentMemoryIssueTypeSchema = z.enum([
  'grammar',
  'vocabulary',
  'pronunciation',
  'fluency',
  'communication',
  'review_loop',
  'other',
]);

export const StudentMemoryConfidenceSchema = z.enum(['low', 'medium', 'high']);
export const StudentMemoryPrioritySchema = z.enum(['low', 'medium', 'high']);
