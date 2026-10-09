import type {
  FactEvidence,
  LessonMemoryRecord,
  MemoryConfidence,
  StudentFact,
  StudentFactAuthority,
} from '../domain/lesson-memory-model.js';
import { listVerifiedReadyLessonMemoryEntriesByIds } from '../domain/lesson-memory-repository.js';
import { getActiveProfileRevision } from '../domain/profile-revision-repository.js';
import type { StudentMemorySnapshotRecord } from '../domain/student-memory-snapshot-model.js';
import { getProfileCandidateSourceStudentMemorySnapshotById } from '../domain/student-memory-snapshot-repository.js';
import type {
  StudentProfileCandidateRecord,
  StudentProfileCandidateTargetSection,
} from '../domain/student-profile-candidate-model.js';
import {
  getStudentProfileCandidateById,
  persistStudentProfileCandidateRefresh,
  updateStudentProfileCandidateReview,
} from '../domain/student-profile-candidate-repository.js';
import { deriveFoundationalProfileFromMarkdown } from './foundational-profile.js';
import {
  buildStudentProfileCandidateKey,
  classifyStudentProfileCandidateTargetSection,
  isStudentProfileCandidateRepresented,
  isTransientStudentProfileFact,
} from './student-profile-candidate-facts.js';
import { getStudentProfileById } from './student-profiles-store.js';

const AUTHORITY_PRIORITY: Record<StudentFactAuthority, number> = {
  model_inferred: 0,
  student_stated: 1,
  teacher_confirmed: 2,
};
const CONFIDENCE_PRIORITY: Record<MemoryConfidence, number> = { low: 0, medium: 1, high: 2 };

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
  sourceLessonId: string | null;
  sourceLessonStartedAt: Date | null;
  sourceLessonTitle: string | null;
  sourceMemoryIds: string[];
  provenance: Record<string, unknown>;
  dedupDecision: StudentProfileCandidateDedupDecision;
  evidence: FactEvidence[];
}

interface StudentProfileCandidateDedupDecision extends Record<string, unknown> {
  decision: 'created' | 'duplicate' | 'stale';
  reason: string;
  model?: string;
}

export interface RefreshStudentProfileCandidatesResult {
  outcome: 'processed' | 'skipped';
  skipReason?: string;
  studentId: string;
  sourceSnapshotId: string | null;
  created: StudentProfileCandidateRecord[];
  skippedCandidateKeys: string[];
  skippedDuplicateCandidateKeys: string[];
  skippedStaleCandidateKeys: string[];
  skippedDuplicateCount: number;
  skippedStaleCount: number;
  skippedNoProfileWorthyDeltaCount: number;
}

interface StudentProfileCandidateDependencies {
  students: {
    getById: typeof getStudentProfileById;
  };
  snapshots: {
    getCandidateSourceById: typeof getProfileCandidateSourceStudentMemorySnapshotById;
  };
  lessonMemory: {
    listVerifiedReadyByIds: typeof listVerifiedReadyLessonMemoryEntriesByIds;
  };
  revisions: {
    getActive: typeof getActiveProfileRevision;
  };
  candidates: {
    getById: typeof getStudentProfileCandidateById;
    persistRefresh: typeof persistStudentProfileCandidateRefresh;
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
  sourceSnapshotId?: string | null;
  overrides?: Partial<StudentProfileCandidateDependencies>;
}): Promise<RefreshStudentProfileCandidatesResult | null> {
  const students = args.overrides?.students ?? {
    getById: getStudentProfileById,
  };
  const snapshots = args.overrides?.snapshots ?? {
    getCandidateSourceById: getProfileCandidateSourceStudentMemorySnapshotById,
  };
  const lessonMemory = args.overrides?.lessonMemory ?? {
    listVerifiedReadyByIds: listVerifiedReadyLessonMemoryEntriesByIds,
  };
  const revisions = args.overrides?.revisions ?? {
    getActive: getActiveProfileRevision,
  };
  const candidates = args.overrides?.candidates ?? {
    getById: getStudentProfileCandidateById,
    persistRefresh: persistStudentProfileCandidateRefresh,
    updateReview: updateStudentProfileCandidateReview,
  };

  const sourceSnapshotId = args.sourceSnapshotId?.trim();
  if (!sourceSnapshotId) {
    return skippedRefresh(args.studentId, 'source_snapshot_id_missing');
  }

  const snapshot = await snapshots.getCandidateSourceById(sourceSnapshotId);
  if (!snapshot) return skippedRefresh(args.studentId, 'source_snapshot_unavailable_or_obsolete');
  if (snapshot.studentId !== args.studentId) {
    return skippedRefresh(args.studentId, 'source_snapshot_student_mismatch');
  }

  const selectedLessonMemoryIds = resolveSelectedLessonMemoryIds(snapshot);
  if (selectedLessonMemoryIds.length === 0) {
    return skippedRefresh(args.studentId, 'source_lesson_context_unavailable');
  }
  if (selectedLessonMemoryIds.some((id) => !snapshot.lessonMemoryEntryIds.includes(id))) {
    return skippedRefresh(args.studentId, 'source_lesson_context_not_in_snapshot');
  }

  const student = await students.getById(args.studentId);
  if (!student) return null;

  const lessonMemoryEntries = await lessonMemory.listVerifiedReadyByIds(
    args.studentId,
    selectedLessonMemoryIds,
  );
  if (lessonMemoryEntries.length !== selectedLessonMemoryIds.length) {
    return skippedRefresh(args.studentId, 'source_lesson_evidence_unavailable');
  }

  const activeRevision = await revisions.getActive(args.studentId);
  const activeProfile =
    activeRevision?.structuredContent ??
    deriveFoundationalProfileFromMarkdown(activeRevision?.content ?? '');

  const proposals = buildCandidateDrafts({
    snapshot,
    lessonMemoryEntries,
  });
  const skippedActiveProfileKeys: string[] = [];
  const reviewProposals = proposals.filter((proposal) => {
    const represented = isStudentProfileCandidateRepresented(activeProfile, {
      targetSection: proposal.targetSection,
      fact: proposal.fact,
    });
    if (represented) skippedActiveProfileKeys.push(proposal.candidateKey);
    return !represented;
  });
  const persisted = await candidates.persistRefresh({
    studentId: args.studentId,
    sourceSnapshotId: snapshot.id,
    sourceLessonMemoryIds: selectedLessonMemoryIds,
    expectedActiveRevisionId: activeRevision?.id ?? null,
    proposals: reviewProposals.map((proposal) => ({
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
      sourceLessonId: proposal.sourceLessonId,
      sourceLessonStartedAt: proposal.sourceLessonStartedAt,
      sourceLessonTitle: proposal.sourceLessonTitle,
      sourceMemoryIds: proposal.sourceMemoryIds,
      provenance: proposal.provenance,
      dedupDecision: proposal.dedupDecision,
      evidence: proposal.evidence,
    })),
  });
  if (persisted.outcome === 'active_profile_changed') {
    throw new Error(
      'Active profile changed during source-bound candidate refresh; retry the same snapshot',
    );
  }
  if (persisted.outcome === 'source_obsolete') {
    return skippedRefresh(args.studentId, 'source_snapshot_or_evidence_became_obsolete');
  }

  return {
    outcome: 'processed',
    studentId: args.studentId,
    sourceSnapshotId: snapshot?.id ?? null,
    created: persisted.created,
    skippedCandidateKeys: [...persisted.skippedCandidateKeys, ...skippedActiveProfileKeys],
    skippedDuplicateCandidateKeys: [
      ...persisted.skippedDuplicateCandidateKeys,
      ...skippedActiveProfileKeys,
    ],
    skippedStaleCandidateKeys: persisted.skippedStaleCandidateKeys,
    skippedDuplicateCount:
      persisted.skippedDuplicateCandidateKeys.length + skippedActiveProfileKeys.length,
    skippedStaleCount: persisted.skippedStaleCandidateKeys.length,
    skippedNoProfileWorthyDeltaCount: proposals.length === 0 ? 1 : 0,
  };
}

function skippedRefresh(
  studentId: string,
  skipReason: string,
): RefreshStudentProfileCandidatesResult {
  return {
    outcome: 'skipped',
    skipReason,
    studentId,
    sourceSnapshotId: null,
    created: [],
    skippedCandidateKeys: [],
    skippedDuplicateCandidateKeys: [],
    skippedStaleCandidateKeys: [],
    skippedDuplicateCount: 0,
    skippedStaleCount: 0,
    skippedNoProfileWorthyDeltaCount: 0,
  };
}

function resolveSelectedLessonMemoryIds(snapshot: StudentMemorySnapshotRecord): string[] {
  const notes = snapshot.generationNotes ?? {};
  const triggerKind = notes.triggerSourceKind;
  const triggerSourceEntryId =
    typeof notes.triggerSourceEntryId === 'string'
      ? notes.triggerSourceEntryId
      : typeof notes.sourceEntryId === 'string'
        ? notes.sourceEntryId
        : null;
  const included = readStringArray(notes.includedLessonMemoryEntryIds);

  if (triggerKind === 'lesson_memory') {
    return triggerSourceEntryId ? [triggerSourceEntryId] : [];
  }
  if (triggerKind === 'homework_memory') {
    return included;
  }
  if (triggerKind === 'manual') {
    return triggerSourceEntryId ? [triggerSourceEntryId] : [];
  }
  return [];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0)),
  ];
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
    persistRefresh: persistStudentProfileCandidateRefresh,
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
      code: 'invalid_candidate_state',
      status: 409,
      message: 'Candidate changed during review; reload its current state before reviewing it.',
    });
  }

  return updated;
}

function buildCandidateDrafts(args: {
  snapshot: StudentMemorySnapshotRecord;
  lessonMemoryEntries: LessonMemoryRecord[];
}): StudentProfileCandidateDraft[] {
  const orderedLessons = [...args.lessonMemoryEntries].sort(
    (left, right) =>
      (right.sourceLessonStartedAt?.getTime() ?? right.generatedAt.getTime()) -
        (left.sourceLessonStartedAt?.getTime() ?? left.generatedAt.getTime()) ||
      right.generatedAt.getTime() - left.generatedAt.getTime() ||
      right.createdAt.getTime() - left.createdAt.getTime() ||
      right.id.localeCompare(left.id),
  );
  const observations = collectLessonFactObservations(orderedLessons);

  const proposals = new Map<string, StudentProfileCandidateDraft>();

  for (const [candidateKey, observation] of observations) {
    const sourceLesson = orderedLessons.find((entry) => observation.lessonMemoryIds.has(entry.id));
    if (!sourceLesson) continue;
    if (
      isTransientStudentProfileFact(observation.fact) ||
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
      sourceSnapshotId: args.snapshot?.id ?? null,
      sourceLessonMemoryIds: [...observation.lessonMemoryIds].sort(),
      sourceLessonId: sourceLesson.sourceLessonId ?? null,
      sourceLessonStartedAt: sourceLesson.sourceLessonStartedAt ?? null,
      sourceLessonTitle: sourceLesson.lessonTitle ?? sourceLesson.topicsDiscussed[0]?.topic ?? null,
      sourceMemoryIds: [...observation.lessonMemoryIds].sort(),
      provenance: {
        sourceKind: 'snapshot_selected_lesson_memory',
        triggerSourceKind: args.snapshot.generationNotes?.triggerSourceKind ?? null,
        triggerSourceEntryId: args.snapshot.generationNotes?.triggerSourceEntryId ?? null,
        sourceLessonMemoryId: sourceLesson.id,
        sourceLessonGeneratedAt: sourceLesson.generatedAt.toISOString(),
        sourceLessonChronology: sourceLesson.sourceLessonStartedAt
          ? 'completed_lesson_started_at'
          : 'memory_generated_at_fallback',
        sourceLessonTopic: sourceLesson.topicsDiscussed[0]?.topic ?? null,
      },
      dedupDecision: {
        decision: 'created',
        reason: 'A pinned eligible lesson source contains this review opportunity.',
      },
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
      if (!targetSection || isTransientStudentProfileFact(fact.fact)) {
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

function classifyTargetSection(
  fact: Pick<StudentFact, 'category' | 'fact'>,
): StudentProfileCandidateTargetSection | null {
  return classifyStudentProfileCandidateTargetSection(fact);
}

function buildCandidateKey(
  targetSection: StudentProfileCandidateTargetSection,
  fact: string,
): string {
  return buildStudentProfileCandidateKey(targetSection, fact);
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
