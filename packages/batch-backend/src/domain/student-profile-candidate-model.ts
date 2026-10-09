import { z } from 'zod';

import type {
  FactEvidence,
  MemoryConfidence,
  StudentFactAuthority,
} from './lesson-memory-model.js';

export type StudentProfileCandidateStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'promoted'
  | 'superseded';

export type StudentProfileCandidateReviewState =
  | 'unreviewed'
  | 'deferred'
  | 'approved'
  | 'rejected';

export type StudentProfileCandidateTargetSection =
  | 'goals_motivation'
  | 'work_communication_context'
  | 'interests_personal_context'
  | 'learning_preferences_study_habits'
  | 'long_running_strengths'
  | 'persistent_challenges_constraints';

export interface StudentProfileCandidateRecord {
  id: string;
  studentId: string;
  targetSection: StudentProfileCandidateTargetSection;
  candidateKey: string;
  fact: string;
  approvedFact: string | null;
  category: string;
  authority: StudentFactAuthority;
  confidence: MemoryConfidence;
  reviewNeeded: boolean;
  sourceSnapshotId: string | null;
  sourceLessonMemoryIds: string[];
  sourceLessonId?: string | null;
  sourceLessonStartedAt?: Date | null;
  sourceLessonTitle?: string | null;
  sourceMemoryIds?: string[];
  provenance?: Record<string, unknown>;
  dedupDecision?: Record<string, unknown>;
  evidence: FactEvidence[];
  status: StudentProfileCandidateStatus;
  reviewState: StudentProfileCandidateReviewState;
  reviewerId: string | null;
  reviewerNote: string | null;
  reviewedAt: Date | null;
  promotedRevisionId: string | null;
  promotedAt: Date | null;
  supersededById: string | null;
  supersededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const StudentProfileCandidateStatusSchema = z.enum([
  'pending_review',
  'approved',
  'rejected',
  'promoted',
  'superseded',
]);

export const StudentProfileCandidateReviewStateSchema = z.enum([
  'unreviewed',
  'deferred',
  'approved',
  'rejected',
]);

export const StudentProfileCandidateTargetSectionSchema = z.enum([
  'goals_motivation',
  'work_communication_context',
  'interests_personal_context',
  'learning_preferences_study_habits',
  'long_running_strengths',
  'persistent_challenges_constraints',
]);

/** Conservative proof of application: case and whitespace may differ, wording must match. */
export function isStudentProfileCandidateRepresented(
  profile: unknown,
  candidate: { targetSection: string; fact: string; approvedFact?: string | null },
): boolean {
  if (!profile || typeof profile !== 'object') return false;
  const fields: Record<string, string[]> = {
    goals_motivation: ['primaryGoals'],
    work_communication_context: ['communicationContexts'],
    interests_personal_context: ['interestsAndUsefulThemes'],
    learning_preferences_study_habits: ['studyPreferences'],
    long_running_strengths: ['stableStrengths'],
    persistent_challenges_constraints: ['persistentChallenges', 'durableConstraints'],
  };
  const normalize = (value: string) =>
    value.normalize('NFC').toLowerCase().replaceAll(/\s+/g, ' ').trim();
  const expected = normalize(candidate.approvedFact ?? candidate.fact);
  if (!expected) return false;
  return (fields[candidate.targetSection] ?? []).some((field) => {
    const values = (profile as Record<string, unknown>)[field];
    return (
      Array.isArray(values) &&
      values.some((value) => typeof value === 'string' && normalize(value) === expected)
    );
  });
}
