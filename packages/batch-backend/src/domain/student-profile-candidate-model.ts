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
