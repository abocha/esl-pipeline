import type { StudentMemoryAvailability } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type {
  HomeworkMemoryEntryStatus,
  HomeworkMemoryRecord,
} from '../domain/homework-memory-model.js';
import {
  listHomeworkMemoryEntries,
  listRecentReadyHomeworkMemoryByStudentId,
} from '../domain/homework-memory-repository.js';
import type { LessonMemoryEntryStatus, LessonMemoryRecord } from '../domain/lesson-memory-model.js';
import {
  listLessonMemoryEntries,
  listRecentReadyLessonMemoryByStudentId,
} from '../domain/lesson-memory-repository.js';
import type {
  StudentMemorySnapshotRecord,
  StudentMemorySnapshotStatus,
} from '../domain/student-memory-snapshot-model.js';
import {
  getStudentMemorySnapshotSelection,
  listStudentMemorySnapshots,
} from '../domain/student-memory-snapshot-repository.js';
import type {
  StudentProfileCandidateRecord,
  StudentProfileCandidateReviewState,
  StudentProfileCandidateStatus,
} from '../domain/student-profile-candidate-model.js';
import { listStudentProfileCandidates } from '../domain/student-profile-candidate-repository.js';
import { loadStudentMemorySelection } from './student-memory-availability.js';
import type { StudentProfileData } from './student-profiles-store.js';
import { getStudentProfileById } from './student-profiles-store.js';

const DEFAULT_OVERVIEW_LESSON_LIMIT = 3;
const DEFAULT_OVERVIEW_HOMEWORK_LIMIT = 2;
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_LIST_OFFSET = 0;
const DEFAULT_LIST_ORDER = 'desc' as const;
const DEFAULT_HEALTH_MEMORY_COUNT_LIMIT = 500;

type MemoryArtifactKind = 'lesson' | 'homework' | 'snapshot';

interface MemoryStatusCounts {
  ready: MemoryStatusCount;
  pending: MemoryStatusCount;
  failed: MemoryStatusCount;
}

interface MemoryStatusCount {
  count: number;
  capped: boolean;
  limit: number;
}

export interface StudentMemoryLatestSnapshotHealth {
  id: string;
  status: StudentMemorySnapshotStatus;
  generatedAt: StudentMemorySnapshotRecord['generatedAt'];
  strategy: string | null;
  trigger: string | null;
  triggerSourceKind: string | null;
  triggerSourceEntryId: string | null;
  parentSnapshotId: string | null;
  inputTokenEstimate: number | null;
  outputTokenEstimate: number | null;
  promptByteLength: number | null;
  includedLessonMemoryCount: number | null;
  includedHomeworkMemoryCount: number | null;
  coveredLessonMemoryCount: number | null;
  coveredHomeworkMemoryCount: number | null;
  contentHash: string | null;
  materialChange: boolean | null;
  budgetDecision: Record<string, unknown> | null;
  candidateRefresh: Record<string, unknown> | null;
}

export interface StudentMemoryLatestFailedReason {
  source: MemoryArtifactKind;
  artifactId: string;
  message: string;
}

export interface StudentMemoryHealth {
  availability: StudentMemoryAvailability;
  studentId: string;
  latestSnapshot: StudentMemoryLatestSnapshotHealth | null;
  memoryCounts: {
    lesson: MemoryStatusCounts;
    homework: MemoryStatusCounts;
  };
  latestFailedReason: StudentMemoryLatestFailedReason | null;
  profileCandidateCounts: {
    pending: number;
    approved: number;
    rejected: number;
    deferred: number;
  };
}

export interface StudentMemoryOverview {
  availability: StudentMemoryAvailability;
  studentId: string;
  latestReadyStudentMemorySnapshot: StudentMemorySnapshotRecord | null;
  recentReadyLessonMemory: LessonMemoryRecord[];
  recentReadyHomeworkMemory: HomeworkMemoryRecord[];
  unresolvedIssues: StudentMemorySnapshotRecord['unresolvedIssues'];
}

export interface StudentLessonMemoryListResponse {
  studentId: string;
  items: LessonMemoryRecord[];
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
  statuses: LessonMemoryEntryStatus[] | null;
}

export interface StudentHomeworkMemoryListResponse {
  studentId: string;
  items: HomeworkMemoryRecord[];
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
  statuses: HomeworkMemoryEntryStatus[] | null;
}

export interface StudentMemorySnapshotListResponse {
  studentId: string;
  items: StudentMemorySnapshotRecord[];
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
  statuses: StudentMemorySnapshotStatus[] | null;
}

export interface StudentProfileCandidateListResponse {
  studentId: string;
  items: StudentProfileCandidateRecord[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
  statuses: StudentProfileCandidateStatus[] | null;
  reviewStates: StudentProfileCandidateReviewState[] | null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return asObject(value);
}

function getFailureMessage(record: {
  generationNotes?: Record<string, unknown> | null;
}): string | null {
  const notes = asObject(record.generationNotes);
  if (!notes) {
    return null;
  }

  const failureDetails = asObject(notes.failureDetails);
  const failureMessage = failureDetails ? readString(failureDetails.message) : null;
  return failureMessage ?? readString(notes.error) ?? readString(notes.message);
}

function buildLatestSnapshotHealth(
  snapshot: StudentMemorySnapshotRecord | null,
): StudentMemoryLatestSnapshotHealth | null {
  if (!snapshot) {
    return null;
  }

  const notes = asObject(snapshot.generationNotes) ?? {};

  return {
    id: snapshot.id,
    status: snapshot.status,
    generatedAt: snapshot.generatedAt,
    strategy: readString(notes.strategy),
    trigger: readString(notes.trigger),
    triggerSourceKind: readString(notes.triggerSourceKind),
    triggerSourceEntryId: readString(notes.triggerSourceEntryId),
    parentSnapshotId: readString(notes.parentSnapshotId),
    inputTokenEstimate: readNumber(notes.inputTokenEstimate),
    outputTokenEstimate: readNumber(notes.outputTokenEstimate),
    promptByteLength: readNumber(notes.promptByteLength),
    includedLessonMemoryCount: readNumber(notes.includedLessonMemoryCount),
    includedHomeworkMemoryCount: readNumber(notes.includedHomeworkMemoryCount),
    coveredLessonMemoryCount: readNumber(notes.coveredLessonMemoryCount),
    coveredHomeworkMemoryCount: readNumber(notes.coveredHomeworkMemoryCount),
    contentHash: snapshot.contentHash ?? null,
    materialChange: readBoolean(notes.materialChange),
    budgetDecision: readObject(notes.budgetDecision),
    candidateRefresh: readObject(notes.candidateRefresh),
  };
}

function getMostRecentFailedReason(args: {
  snapshot: StudentMemorySnapshotRecord | null;
  lesson: LessonMemoryRecord | null;
  homework: HomeworkMemoryRecord | null;
}): StudentMemoryLatestFailedReason | null {
  if (args.snapshot?.status === 'failed') {
    const message = getFailureMessage(args.snapshot);
    if (message) {
      return {
        source: 'snapshot',
        artifactId: args.snapshot.id,
        message,
      };
    }
  }

  const failedEntries = [
    ...(args.lesson
      ? [
          {
            source: 'lesson' as const,
            artifactId: args.lesson.id,
            generatedAt: args.lesson.generatedAt,
            message: getFailureMessage(args.lesson),
          },
        ]
      : []),
    ...(args.homework
      ? [
          {
            source: 'homework' as const,
            artifactId: args.homework.id,
            generatedAt: args.homework.generatedAt,
            message: getFailureMessage(args.homework),
          },
        ]
      : []),
  ].filter((entry) => entry.message);

  failedEntries.sort(
    (left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime(),
  );

  const latest = failedEntries[0];
  return latest
    ? {
        source: latest.source,
        artifactId: latest.artifactId,
        message: latest.message ?? 'Memory generation failed.',
      }
    : null;
}

function buildMemoryStatusCount(items: readonly unknown[]): MemoryStatusCount {
  return {
    count: items.length,
    capped: items.length >= DEFAULT_HEALTH_MEMORY_COUNT_LIMIT,
    limit: DEFAULT_HEALTH_MEMORY_COUNT_LIMIT,
  };
}

async function countProfileCandidates(args: {
  studentId: string;
  profileCandidates: StudentMemoryInspectionDependencies['profileCandidates'];
  statuses?: StudentProfileCandidateStatus[];
  reviewStates?: StudentProfileCandidateReviewState[];
}): Promise<number> {
  const result = await args.profileCandidates.list({
    studentId: args.studentId,
    statuses: args.statuses,
    reviewStates: args.reviewStates,
    limit: 1,
    offset: 0,
    order: 'desc',
  });
  return result.total;
}

interface StudentMemoryInspectionDependencies {
  students: {
    getById: typeof getStudentProfileById;
  };
  lessonMemory: {
    list: typeof listLessonMemoryEntries;
    listRecentReadyByStudentId: typeof listRecentReadyLessonMemoryByStudentId;
  };
  homeworkMemory: {
    list: typeof listHomeworkMemoryEntries;
    listRecentReadyByStudentId: typeof listRecentReadyHomeworkMemoryByStudentId;
  };
  snapshots: {
    getSelection: typeof getStudentMemorySnapshotSelection;
    list: typeof listStudentMemorySnapshots;
  };
  profileCandidates: {
    list: typeof listStudentProfileCandidates;
  };
}

async function resolveStudent(
  studentId: string,
  config: BatchBackendConfig | undefined,
  students: StudentMemoryInspectionDependencies['students'],
): Promise<StudentProfileData | null> {
  return students.getById(studentId, config ? { config } : undefined);
}

export async function getStudentMemoryOverview(args: {
  studentId: string;
  lessonLimit?: number;
  homeworkLimit?: number;
  config?: BatchBackendConfig;
  overrides?: Partial<StudentMemoryInspectionDependencies>;
}): Promise<StudentMemoryOverview | null> {
  const students = args.overrides?.students ?? {
    getById: getStudentProfileById,
  };
  const lessonMemory = args.overrides?.lessonMemory ?? {
    list: listLessonMemoryEntries,
    listRecentReadyByStudentId: listRecentReadyLessonMemoryByStudentId,
  };
  const homeworkMemory = args.overrides?.homeworkMemory ?? {
    list: listHomeworkMemoryEntries,
    listRecentReadyByStudentId: listRecentReadyHomeworkMemoryByStudentId,
  };
  const snapshots = args.overrides?.snapshots ?? {
    getSelection: getStudentMemorySnapshotSelection,
    list: listStudentMemorySnapshots,
  };

  const student = await resolveStudent(args.studentId, args.config, students);
  if (!student) {
    return null;
  }

  const lessonLimit = args.lessonLimit ?? DEFAULT_OVERVIEW_LESSON_LIMIT;
  const homeworkLimit = args.homeworkLimit ?? DEFAULT_OVERVIEW_HOMEWORK_LIMIT;

  const [selection, recentReadyLessonMemory, recentReadyHomeworkMemory] = await Promise.all([
    loadStudentMemorySelection(args.studentId, snapshots.getSelection),
    lessonMemory.listRecentReadyByStudentId(args.studentId, {
      limit: lessonLimit,
    }),
    homeworkMemory.listRecentReadyByStudentId(args.studentId, {
      limit: homeworkLimit,
    }),
  ]);

  return {
    studentId: args.studentId,
    latestReadyStudentMemorySnapshot: selection.snapshot,
    availability: selection.availability,
    recentReadyLessonMemory,
    recentReadyHomeworkMemory,
    unresolvedIssues: selection.snapshot?.unresolvedIssues ?? [],
  };
}

export async function getStudentMemoryHealth(args: {
  studentId: string;
  config?: BatchBackendConfig;
  overrides?: Partial<StudentMemoryInspectionDependencies>;
}): Promise<StudentMemoryHealth | null> {
  const students = args.overrides?.students ?? {
    getById: getStudentProfileById,
  };
  const lessonMemory = args.overrides?.lessonMemory ?? {
    list: listLessonMemoryEntries,
    listRecentReadyByStudentId: listRecentReadyLessonMemoryByStudentId,
  };
  const homeworkMemory = args.overrides?.homeworkMemory ?? {
    list: listHomeworkMemoryEntries,
    listRecentReadyByStudentId: listRecentReadyHomeworkMemoryByStudentId,
  };
  const snapshots = args.overrides?.snapshots ?? {
    getSelection: getStudentMemorySnapshotSelection,
    list: listStudentMemorySnapshots,
  };
  const profileCandidates = args.overrides?.profileCandidates ?? {
    list: listStudentProfileCandidates,
  };

  const student = await resolveStudent(args.studentId, args.config, students);
  if (!student) {
    return null;
  }

  const memoryListParams = {
    studentId: args.studentId,
    limit: DEFAULT_HEALTH_MEMORY_COUNT_LIMIT,
    offset: 0,
    order: DEFAULT_LIST_ORDER,
  };

  const [
    selection,
    latestSnapshots,
    readyLessonMemory,
    pendingLessonMemory,
    failedLessonMemory,
    readyHomeworkMemory,
    pendingHomeworkMemory,
    failedHomeworkMemory,
    pendingCandidates,
    approvedCandidates,
    rejectedCandidates,
    deferredCandidates,
  ] = await Promise.all([
    loadStudentMemorySelection(args.studentId, snapshots.getSelection),
    snapshots
      .list({
        studentId: args.studentId,
        limit: 1,
        offset: 0,
        order: DEFAULT_LIST_ORDER,
      })
      .catch(() => []),
    lessonMemory.list({
      ...memoryListParams,
      statuses: ['ready'],
    }),
    lessonMemory.list({
      ...memoryListParams,
      statuses: ['pending'],
    }),
    lessonMemory.list({
      ...memoryListParams,
      statuses: ['failed'],
    }),
    homeworkMemory.list({
      ...memoryListParams,
      statuses: ['ready'],
    }),
    homeworkMemory.list({
      ...memoryListParams,
      statuses: ['pending'],
    }),
    homeworkMemory.list({
      ...memoryListParams,
      statuses: ['failed'],
    }),
    countProfileCandidates({
      studentId: args.studentId,
      profileCandidates,
      statuses: ['pending_review'],
    }),
    countProfileCandidates({
      studentId: args.studentId,
      profileCandidates,
      statuses: ['approved'],
    }),
    countProfileCandidates({
      studentId: args.studentId,
      profileCandidates,
      statuses: ['rejected'],
    }),
    countProfileCandidates({
      studentId: args.studentId,
      profileCandidates,
      reviewStates: ['deferred'],
    }),
  ]);

  const latestSnapshot = latestSnapshots[0] ?? null;
  const latestFailedLessonMemory = failedLessonMemory[0] ?? null;
  const latestFailedHomeworkMemory = failedHomeworkMemory[0] ?? null;

  return {
    studentId: args.studentId,
    latestSnapshot: buildLatestSnapshotHealth(latestSnapshot),
    availability: selection.availability,
    memoryCounts: {
      lesson: {
        ready: buildMemoryStatusCount(readyLessonMemory),
        pending: buildMemoryStatusCount(pendingLessonMemory),
        failed: buildMemoryStatusCount(failedLessonMemory),
      },
      homework: {
        ready: buildMemoryStatusCount(readyHomeworkMemory),
        pending: buildMemoryStatusCount(pendingHomeworkMemory),
        failed: buildMemoryStatusCount(failedHomeworkMemory),
      },
    },
    latestFailedReason: getMostRecentFailedReason({
      snapshot: latestSnapshot,
      lesson: latestFailedLessonMemory,
      homework: latestFailedHomeworkMemory,
    }),
    profileCandidateCounts: {
      pending: pendingCandidates,
      approved: approvedCandidates,
      rejected: rejectedCandidates,
      deferred: deferredCandidates,
    },
  };
}

export async function listStudentLessonMemory(args: {
  studentId: string;
  statuses?: LessonMemoryEntryStatus[];
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  config?: BatchBackendConfig;
  overrides?: Partial<StudentMemoryInspectionDependencies>;
}): Promise<StudentLessonMemoryListResponse | null> {
  const students = args.overrides?.students ?? {
    getById: getStudentProfileById,
  };
  const lessonMemory = args.overrides?.lessonMemory ?? {
    list: listLessonMemoryEntries,
    listRecentReadyByStudentId: listRecentReadyLessonMemoryByStudentId,
  };

  const student = await resolveStudent(args.studentId, args.config, students);
  if (!student) {
    return null;
  }

  const limit = args.limit ?? DEFAULT_LIST_LIMIT;
  const offset = args.offset ?? DEFAULT_LIST_OFFSET;
  const order = args.order ?? DEFAULT_LIST_ORDER;
  const items = await lessonMemory.list({
    studentId: args.studentId,
    statuses: args.statuses,
    limit,
    offset,
    order,
  });

  return {
    studentId: args.studentId,
    items,
    limit,
    offset,
    order,
    statuses: args.statuses ?? null,
  };
}

export async function listStudentProfileCandidatesForStudent(args: {
  studentId: string;
  statuses?: StudentProfileCandidateStatus[];
  reviewStates?: StudentProfileCandidateReviewState[];
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  config?: BatchBackendConfig;
  overrides?: Partial<StudentMemoryInspectionDependencies>;
}): Promise<StudentProfileCandidateListResponse | null> {
  const students = args.overrides?.students ?? {
    getById: getStudentProfileById,
  };
  const profileCandidates = args.overrides?.profileCandidates ?? {
    list: listStudentProfileCandidates,
  };

  const student = await resolveStudent(args.studentId, args.config, students);
  if (!student) {
    return null;
  }

  const limit = args.limit ?? DEFAULT_LIST_LIMIT;
  const offset = args.offset ?? DEFAULT_LIST_OFFSET;
  const order = args.order ?? DEFAULT_LIST_ORDER;
  const result = await profileCandidates.list({
    studentId: args.studentId,
    statuses: args.statuses,
    reviewStates: args.reviewStates,
    limit,
    offset,
    order,
  });

  return {
    studentId: args.studentId,
    items: result.items,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    order: result.order,
    statuses: args.statuses ?? null,
    reviewStates: args.reviewStates ?? null,
  };
}

export async function listStudentHomeworkMemory(args: {
  studentId: string;
  statuses?: HomeworkMemoryEntryStatus[];
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  config?: BatchBackendConfig;
  overrides?: Partial<StudentMemoryInspectionDependencies>;
}): Promise<StudentHomeworkMemoryListResponse | null> {
  const students = args.overrides?.students ?? {
    getById: getStudentProfileById,
  };
  const homeworkMemory = args.overrides?.homeworkMemory ?? {
    list: listHomeworkMemoryEntries,
    listRecentReadyByStudentId: listRecentReadyHomeworkMemoryByStudentId,
  };

  const student = await resolveStudent(args.studentId, args.config, students);
  if (!student) {
    return null;
  }

  const limit = args.limit ?? DEFAULT_LIST_LIMIT;
  const offset = args.offset ?? DEFAULT_LIST_OFFSET;
  const order = args.order ?? DEFAULT_LIST_ORDER;
  const items = await homeworkMemory.list({
    studentId: args.studentId,
    statuses: args.statuses,
    limit,
    offset,
    order,
  });

  return {
    studentId: args.studentId,
    items,
    limit,
    offset,
    order,
    statuses: args.statuses ?? null,
  };
}

export async function listStudentMemorySnapshotsForStudent(args: {
  studentId: string;
  statuses?: StudentMemorySnapshotStatus[];
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  config?: BatchBackendConfig;
  overrides?: Partial<StudentMemoryInspectionDependencies>;
}): Promise<StudentMemorySnapshotListResponse | null> {
  const students = args.overrides?.students ?? {
    getById: getStudentProfileById,
  };
  const snapshots = args.overrides?.snapshots ?? {
    getSelection: getStudentMemorySnapshotSelection,
    list: listStudentMemorySnapshots,
  };

  const student = await resolveStudent(args.studentId, args.config, students);
  if (!student) {
    return null;
  }

  const limit = args.limit ?? DEFAULT_LIST_LIMIT;
  const offset = args.offset ?? DEFAULT_LIST_OFFSET;
  const order = args.order ?? DEFAULT_LIST_ORDER;
  const items = await snapshots.list({
    studentId: args.studentId,
    statuses: args.statuses,
    limit,
    offset,
    order,
  });

  return {
    studentId: args.studentId,
    items,
    limit,
    offset,
    order,
    statuses: args.statuses ?? null,
  };
}
