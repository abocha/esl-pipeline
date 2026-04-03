import type {
  FactEvidence,
  LessonMemoryRecord,
  MemoryConfidence,
  StudentFact,
  StudentFactAuthority,
} from '../domain/lesson-memory-model.js';
import { listRecentReadyLessonMemoryByStudentId } from '../domain/lesson-memory-repository.js';
import type { StudentMemorySnapshotRecord } from '../domain/student-memory-snapshot-model.js';
import { getLatestReadyStudentMemorySnapshotByStudentId } from '../domain/student-memory-snapshot-repository.js';
import type {
  StudentProfileCandidateRecord,
  StudentProfileCandidateTargetSection,
} from '../domain/student-profile-candidate-model.js';
import {
  getStudentProfileCandidateById,
  insertStudentProfileCandidate,
  listLatestStudentProfileCandidatesByKeys,
  supersedePendingStudentProfileCandidates,
  updateStudentProfileCandidateReview,
} from '../domain/student-profile-candidate-repository.js';
import { getStudentProfileById } from './student-profiles-store.js';

const DEFAULT_CORROBORATING_LESSON_LIMIT = 12;

const AUTHORITY_PRIORITY: Record<StudentFactAuthority, number> = {
  model_inferred: 0,
  student_stated: 1,
  teacher_confirmed: 2,
};

const CONFIDENCE_PRIORITY: Record<MemoryConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

type CandidateAction = 'approve' | 'reject' | 'defer';

interface LessonFactObservation {
  targetSection: StudentProfileCandidateTargetSection;
  category: string;
  fact: string;
  authority: StudentFactAuthority;
  confidence: MemoryConfidence;
  reviewNeeded: boolean;
  lessonMemoryIds: Set<string>;
  evidence: FactEvidence[];
}

interface StudentProfileCandidateDraft {
  targetSection: StudentProfileCandidateTargetSection;
  candidateKey: string;
  fact: string;
  category: string;
  authority: StudentFactAuthority;
  confidence: MemoryConfidence;
  reviewNeeded: boolean;
  sourceSnapshotId: string | null;
  sourceLessonMemoryIds: string[];
  evidence: FactEvidence[];
}

export interface RefreshStudentProfileCandidatesResult {
  studentId: string;
  sourceSnapshotId: string | null;
  created: StudentProfileCandidateRecord[];
  skippedCandidateKeys: string[];
}

interface StudentProfileCandidateDependencies {
  students: {
    getById: typeof getStudentProfileById;
  };
  snapshots: {
    getLatestReadyByStudentId: typeof getLatestReadyStudentMemorySnapshotByStudentId;
  };
  lessonMemory: {
    listRecentReadyByStudentId: typeof listRecentReadyLessonMemoryByStudentId;
  };
  candidates: {
    getById: typeof getStudentProfileCandidateById;
    insert: typeof insertStudentProfileCandidate;
    listLatestByKeys: typeof listLatestStudentProfileCandidatesByKeys;
    supersedePending: typeof supersedePendingStudentProfileCandidates;
    updateReview: typeof updateStudentProfileCandidateReview;
  };
}

export class StudentProfileCandidateServiceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(args: { code: string; status: number; message: string }) {
    super(args.message);
    this.name = 'StudentProfileCandidateServiceError';
    this.code = args.code;
    this.status = args.status;
  }
}

export async function refreshStudentProfileCandidatesFromCanonicalMemory(args: {
  studentId: string;
  lessonLimit?: number;
  overrides?: Partial<StudentProfileCandidateDependencies>;
}): Promise<RefreshStudentProfileCandidatesResult | null> {
  const students = args.overrides?.students ?? {
    getById: getStudentProfileById,
  };
  const snapshots = args.overrides?.snapshots ?? {
    getLatestReadyByStudentId: getLatestReadyStudentMemorySnapshotByStudentId,
  };
  const lessonMemory = args.overrides?.lessonMemory ?? {
    listRecentReadyByStudentId: listRecentReadyLessonMemoryByStudentId,
  };
  const candidates = args.overrides?.candidates ?? {
    getById: getStudentProfileCandidateById,
    insert: insertStudentProfileCandidate,
    listLatestByKeys: listLatestStudentProfileCandidatesByKeys,
    supersedePending: supersedePendingStudentProfileCandidates,
    updateReview: updateStudentProfileCandidateReview,
  };

  const student = await students.getById(args.studentId);
  if (!student) {
    return null;
  }

  const [snapshot, corroboratingLessonMemory] = await Promise.all([
    snapshots.getLatestReadyByStudentId(args.studentId),
    lessonMemory.listRecentReadyByStudentId(args.studentId, {
      limit: args.lessonLimit ?? DEFAULT_CORROBORATING_LESSON_LIMIT,
    }),
  ]);

  if (!snapshot && corroboratingLessonMemory.length === 0) {
    return {
      studentId: args.studentId,
      sourceSnapshotId: null,
      created: [],
      skippedCandidateKeys: [],
    };
  }

  const proposals = buildCandidateDrafts({
    snapshot,
    lessonMemoryEntries: corroboratingLessonMemory,
  });
  const existingByKey = await candidates.listLatestByKeys(
    args.studentId,
    proposals.map((proposal) => proposal.candidateKey),
  );

  const created: StudentProfileCandidateRecord[] = [];
  const skippedCandidateKeys: string[] = [];

  for (const proposal of proposals) {
    const existing = existingByKey.get(proposal.candidateKey);
    if (!shouldInsertCandidateProposal(proposal, existing)) {
      skippedCandidateKeys.push(proposal.candidateKey);
      continue;
    }

    const inserted = await candidates.insert({
      studentId: args.studentId,
      targetSection: proposal.targetSection,
      candidateKey: proposal.candidateKey,
      fact: proposal.fact,
      category: proposal.category,
      authority: proposal.authority,
      confidence: proposal.confidence,
      reviewNeeded: proposal.reviewNeeded,
      sourceSnapshotId: proposal.sourceSnapshotId,
      sourceLessonMemoryIds: proposal.sourceLessonMemoryIds,
      evidence: proposal.evidence,
    });

    await candidates.supersedePending({
      studentId: args.studentId,
      candidateKey: proposal.candidateKey,
      supersededById: inserted.id,
      supersededAt: inserted.createdAt,
    });

    created.push(inserted);
  }

  return {
    studentId: args.studentId,
    sourceSnapshotId: snapshot?.id ?? null,
    created,
    skippedCandidateKeys,
  };
}

export async function approveStudentProfileCandidate(args: {
  studentId: string;
  candidateId: string;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  approvedFact?: string | null;
  overrides?: Partial<StudentProfileCandidateDependencies>;
}): Promise<StudentProfileCandidateRecord> {
  const approvedFact = normalizeOptionalFact(args.approvedFact);
  return reviewStudentProfileCandidate({
    ...args,
    action: 'approve',
    approvedFact,
  });
}

export async function rejectStudentProfileCandidate(args: {
  studentId: string;
  candidateId: string;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  overrides?: Partial<StudentProfileCandidateDependencies>;
}): Promise<StudentProfileCandidateRecord> {
  return reviewStudentProfileCandidate({
    ...args,
    action: 'reject',
  });
}

export async function deferStudentProfileCandidate(args: {
  studentId: string;
  candidateId: string;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  overrides?: Partial<StudentProfileCandidateDependencies>;
}): Promise<StudentProfileCandidateRecord> {
  return reviewStudentProfileCandidate({
    ...args,
    action: 'defer',
  });
}

async function reviewStudentProfileCandidate(args: {
  studentId: string;
  candidateId: string;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  approvedFact?: string | null;
  action: CandidateAction;
  overrides?: Partial<StudentProfileCandidateDependencies>;
}): Promise<StudentProfileCandidateRecord> {
  const candidates = args.overrides?.candidates ?? {
    getById: getStudentProfileCandidateById,
    insert: insertStudentProfileCandidate,
    listLatestByKeys: listLatestStudentProfileCandidatesByKeys,
    supersedePending: supersedePendingStudentProfileCandidates,
    updateReview: updateStudentProfileCandidateReview,
  };

  const candidate = await candidates.getById(args.studentId, args.candidateId);
  if (!candidate) {
    throw new StudentProfileCandidateServiceError({
      code: 'not_found',
      status: 404,
      message: 'Student profile candidate not found',
    });
  }

  if (candidate.status === 'superseded' || candidate.status === 'promoted') {
    throw new StudentProfileCandidateServiceError({
      code: 'invalid_candidate_state',
      status: 409,
      message: `Candidate cannot be ${args.action}d once it is ${candidate.status}`,
    });
  }

  const approvedFact =
    args.action === 'approve' ? args.approvedFact?.trim() || candidate.fact : null;
  const updated = await candidates.updateReview({
    studentId: args.studentId,
    candidateId: args.candidateId,
    status: reviewStatusForAction(args.action),
    reviewState: reviewStateForAction(args.action),
    reviewerId: args.reviewerId ?? null,
    reviewerNote: args.reviewerNote ?? null,
    approvedFact,
  });

  if (!updated) {
    throw new StudentProfileCandidateServiceError({
      code: 'not_found',
      status: 404,
      message: 'Student profile candidate not found',
    });
  }

  return updated;
}

function buildCandidateDrafts(args: {
  snapshot: StudentMemorySnapshotRecord | null;
  lessonMemoryEntries: LessonMemoryRecord[];
}): StudentProfileCandidateDraft[] {
  const lessonObservations = collectLessonFactObservations(args.lessonMemoryEntries);
  const proposals = new Map<string, StudentProfileCandidateDraft>();

  if (args.snapshot) {
    for (const fact of args.snapshot.personalFacts) {
      const targetSection = classifyTargetSection(fact);
      if (!targetSection || isTransientFact(fact.fact)) {
        continue;
      }

      const candidateKey = buildCandidateKey(targetSection, fact.fact);
      const lessonObservation = lessonObservations.get(candidateKey);
      const matchedLessonMemoryIds = lessonObservation
        ? [...lessonObservation.lessonMemoryIds].sort()
        : [];
      if (!isStrengthEligible(targetSection, matchedLessonMemoryIds.length)) {
        continue;
      }

      proposals.set(candidateKey, {
        targetSection,
        candidateKey,
        fact: fact.fact.trim(),
        category: fact.category.trim(),
        authority: strongerAuthority(fact.authority, lessonObservation?.authority),
        confidence: strongerConfidence(fact.confidence, lessonObservation?.confidence),
        reviewNeeded: fact.reviewNeeded || lessonObservation?.reviewNeeded || false,
        sourceSnapshotId: args.snapshot.id,
        sourceLessonMemoryIds: matchedLessonMemoryIds,
        evidence: dedupeEvidence([
          ...(fact.evidence ?? []),
          ...(lessonObservation?.evidence ?? []),
        ]),
      });
    }
  }

  for (const [candidateKey, observation] of lessonObservations) {
    if (proposals.has(candidateKey)) {
      continue;
    }
    if (observation.lessonMemoryIds.size < 2) {
      continue;
    }
    if (
      isTransientFact(observation.fact) ||
      !isStrengthEligible(observation.targetSection, observation.lessonMemoryIds.size)
    ) {
      continue;
    }

    proposals.set(candidateKey, {
      targetSection: observation.targetSection,
      candidateKey,
      fact: observation.fact.trim(),
      category: observation.category.trim(),
      authority: observation.authority,
      confidence: observation.confidence,
      reviewNeeded: observation.reviewNeeded,
      sourceSnapshotId: null,
      sourceLessonMemoryIds: [...observation.lessonMemoryIds].sort(),
      evidence: dedupeEvidence(observation.evidence),
    });
  }

  return [...proposals.values()];
}

function collectLessonFactObservations(
  lessonMemoryEntries: LessonMemoryRecord[],
): Map<string, LessonFactObservation> {
  const observations = new Map<string, LessonFactObservation>();

  for (const entry of lessonMemoryEntries) {
    for (const fact of entry.studentFacts) {
      const targetSection = classifyTargetSection(fact);
      if (!targetSection || isTransientFact(fact.fact)) {
        continue;
      }

      const candidateKey = buildCandidateKey(targetSection, fact.fact);
      const existing = observations.get(candidateKey);
      if (!existing) {
        observations.set(candidateKey, {
          targetSection,
          category: fact.category,
          fact: fact.fact,
          authority: fact.authority,
          confidence: fact.confidence,
          reviewNeeded: fact.reviewNeeded,
          lessonMemoryIds: new Set([entry.id]),
          evidence: [...(fact.evidence ?? [])],
        });
        continue;
      }

      existing.lessonMemoryIds.add(entry.id);
      existing.authority = strongerAuthority(existing.authority, fact.authority);
      existing.confidence = strongerConfidence(existing.confidence, fact.confidence);
      existing.reviewNeeded = existing.reviewNeeded || fact.reviewNeeded;
      existing.evidence = dedupeEvidence([...existing.evidence, ...(fact.evidence ?? [])]);
    }
  }

  return observations;
}

function shouldInsertCandidateProposal(
  proposal: StudentProfileCandidateDraft,
  existing: StudentProfileCandidateRecord | undefined,
): boolean {
  if (!existing) {
    return true;
  }

  if (
    existing.status === 'pending_review' ||
    existing.status === 'approved' ||
    existing.status === 'promoted'
  ) {
    return false;
  }

  if (existing.status === 'rejected') {
    return proposalIsMateriallyImproved(proposal, existing);
  }

  return true;
}

function proposalIsMateriallyImproved(
  proposal: StudentProfileCandidateDraft,
  existing: StudentProfileCandidateRecord,
): boolean {
  if (AUTHORITY_PRIORITY[proposal.authority] > AUTHORITY_PRIORITY[existing.authority]) {
    return true;
  }
  if (CONFIDENCE_PRIORITY[proposal.confidence] > CONFIDENCE_PRIORITY[existing.confidence]) {
    return true;
  }
  if (proposal.sourceLessonMemoryIds.length > existing.sourceLessonMemoryIds.length) {
    return true;
  }
  if (proposal.sourceSnapshotId && !existing.sourceSnapshotId) {
    return true;
  }
  return false;
}

function classifyTargetSection(
  fact: Pick<StudentFact, 'category' | 'fact'>,
): StudentProfileCandidateTargetSection | null {
  const haystack = `${fact.category} ${fact.fact}`.toLowerCase();

  if (
    matchesAny(haystack, [
      'goal',
      'motivat',
      'wants to',
      'wants',
      'aims to',
      'needs english',
      'career transition',
    ])
  ) {
    return 'goals_motivation';
  }
  if (
    matchesAny(haystack, [
      'profession',
      'job',
      'work',
      'client',
      'meeting',
      'colleague',
      'career',
      'communication context',
    ])
  ) {
    return 'work_communication_context';
  }
  if (
    matchesAny(haystack, [
      'hobby',
      'interest',
      'likes',
      'family',
      'location',
      'lives in',
      'personal',
      'routine',
    ])
  ) {
    return 'interests_personal_context';
  }
  if (
    matchesAny(haystack, [
      'prefers',
      'benefits from',
      'study habit',
      'study preference',
      'uses',
      'practices',
      'one-take',
      'notebook',
      'chatgpt',
      'methodical',
      'logical',
      'formula',
    ])
  ) {
    return 'learning_preferences_study_habits';
  }
  if (
    matchesAny(haystack, [
      'strength',
      'strong at',
      'responds well',
      'retains',
      'comfortable with',
      'benefits from structured',
    ])
  ) {
    return 'long_running_strengths';
  }
  if (
    matchesAny(haystack, [
      'challenge',
      'constraint',
      'struggles',
      'difficulty',
      'under pressure',
      'perfectionist',
      'limited time',
      'persistent',
      'tends to',
    ])
  ) {
    return 'persistent_challenges_constraints';
  }

  return null;
}

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function buildCandidateKey(
  targetSection: StudentProfileCandidateTargetSection,
  fact: string,
): string {
  return `${targetSection}:${normalizeFact(fact)}`;
}

function normalizeFact(fact: string): string {
  return fact
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function isTransientFact(fact: string): boolean {
  return /\b(today|this lesson|tonight|yesterday|last lesson|this week|recently)\b/i.test(fact);
}

function isStrengthEligible(
  targetSection: StudentProfileCandidateTargetSection,
  corroboratingLessonCount: number,
): boolean {
  if (targetSection !== 'long_running_strengths') {
    return true;
  }

  return corroboratingLessonCount >= 1;
}

function strongerAuthority(
  left: StudentFactAuthority,
  right?: StudentFactAuthority,
): StudentFactAuthority {
  if (!right) {
    return left;
  }
  return AUTHORITY_PRIORITY[right] > AUTHORITY_PRIORITY[left] ? right : left;
}

function strongerConfidence(left: MemoryConfidence, right?: MemoryConfidence): MemoryConfidence {
  if (!right) {
    return left;
  }
  return CONFIDENCE_PRIORITY[right] > CONFIDENCE_PRIORITY[left] ? right : left;
}

function dedupeEvidence(evidence: FactEvidence[]): FactEvidence[] {
  const seen = new Set<string>();
  const output: FactEvidence[] = [];

  for (const entry of evidence) {
    const key = JSON.stringify(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(entry);
  }

  return output;
}

function normalizeOptionalFact(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function reviewStatusForAction(action: CandidateAction): StudentProfileCandidateRecord['status'] {
  switch (action) {
    case 'approve': {
      return 'approved';
    }
    case 'reject': {
      return 'rejected';
    }
    case 'defer': {
      return 'pending_review';
    }
  }
}

function reviewStateForAction(
  action: CandidateAction,
): StudentProfileCandidateRecord['reviewState'] {
  switch (action) {
    case 'approve': {
      return 'approved';
    }
    case 'reject': {
      return 'rejected';
    }
    case 'defer': {
      return 'deferred';
    }
  }
}
