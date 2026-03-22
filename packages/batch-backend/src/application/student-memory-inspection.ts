import type { BatchBackendConfig } from '../config/env.js';
import type {
  HomeworkMemoryEntryStatus,
  HomeworkMemoryRecord,
} from '../domain/homework-memory-model.js';
import {
  listHomeworkMemoryEntries,
  listRecentReadyHomeworkMemoryByStudentId,
} from '../domain/homework-memory-repository.js';
import type {
  LessonMemoryEntryStatus,
  LessonMemoryRecord,
} from '../domain/lesson-memory-model.js';
import {
  listLessonMemoryEntries,
  listRecentReadyLessonMemoryByStudentId,
} from '../domain/lesson-memory-repository.js';
import type {
  StudentMemorySnapshotRecord,
  StudentMemorySnapshotStatus,
} from '../domain/student-memory-snapshot-model.js';
import {
  getLatestReadyStudentMemorySnapshotByStudentId,
  listStudentMemorySnapshots,
} from '../domain/student-memory-snapshot-repository.js';
import type {
  StudentProfileCandidateRecord,
  StudentProfileCandidateReviewState,
  StudentProfileCandidateStatus,
} from '../domain/student-profile-candidate-model.js';
import { listStudentProfileCandidates } from '../domain/student-profile-candidate-repository.js';
import type { StudentProfileData } from './student-profiles-store.js';
import { getStudentProfileById } from './student-profiles-store.js';

const DEFAULT_OVERVIEW_LESSON_LIMIT = 3;
const DEFAULT_OVERVIEW_HOMEWORK_LIMIT = 2;
const DEFAULT_LIST_LIMIT = 50;
const DEFAULT_LIST_OFFSET = 0;
const DEFAULT_LIST_ORDER = 'desc' as const;

export interface StudentMemoryOverview {
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
    getLatestReadyByStudentId: typeof getLatestReadyStudentMemorySnapshotByStudentId;
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
    getLatestReadyByStudentId: getLatestReadyStudentMemorySnapshotByStudentId,
    list: listStudentMemorySnapshots,
  };

  const student = await resolveStudent(args.studentId, args.config, students);
  if (!student) {
    return null;
  }

  const lessonLimit = args.lessonLimit ?? DEFAULT_OVERVIEW_LESSON_LIMIT;
  const homeworkLimit = args.homeworkLimit ?? DEFAULT_OVERVIEW_HOMEWORK_LIMIT;

  const [latestReadyStudentMemorySnapshot, recentReadyLessonMemory, recentReadyHomeworkMemory] =
    await Promise.all([
      snapshots.getLatestReadyByStudentId(args.studentId),
      lessonMemory.listRecentReadyByStudentId(args.studentId, {
        limit: lessonLimit,
      }),
      homeworkMemory.listRecentReadyByStudentId(args.studentId, {
        limit: homeworkLimit,
      }),
    ]);

  return {
    studentId: args.studentId,
    latestReadyStudentMemorySnapshot,
    recentReadyLessonMemory,
    recentReadyHomeworkMemory,
    unresolvedIssues: latestReadyStudentMemorySnapshot?.unresolvedIssues ?? [],
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
    getLatestReadyByStudentId: getLatestReadyStudentMemorySnapshotByStudentId,
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
