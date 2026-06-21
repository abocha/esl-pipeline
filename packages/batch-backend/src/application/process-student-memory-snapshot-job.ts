import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { HomeworkMemoryRecord } from '../domain/homework-memory-model.js';
import { listHomeworkMemoryEntries } from '../domain/homework-memory-repository.js';
import type { LessonMemoryRecord } from '../domain/lesson-memory-model.js';
import { listLessonMemoryEntries } from '../domain/lesson-memory-repository.js';
import {
  getStudentMemorySnapshotById,
  markStudentMemorySnapshotFailed,
  supersedePendingStudentMemorySnapshotsForStudent,
} from '../domain/student-memory-snapshot-repository.js';
import { logger } from '../infrastructure/logger.js';
import { requestStudentProfileCandidateRefresh } from './request-student-profile-candidate-refresh.js';
import {
  createStudentMemoryGenerationPacer,
  isStudentMemoryPacingDeferredError,
  type StudentMemoryGenerationPacer,
} from './student-memory-generation-pacing.js';
import {
  type GenerateStudentMemorySnapshotDependencies,
  generateStudentMemorySnapshot,
} from './student-memory-snapshot-generation.js';
import {
  buildStudentMemorySnapshotEnvelope,
  buildStudentMemorySnapshotPrompt,
} from './student-memory-snapshot-prompt.js';

export interface ProcessStudentMemorySnapshotJobPayload {
  kind: 'student-memory-snapshot-refresh';
  studentId: string;
  pendingEntryId: string;
  provider: GenerationProvider;
  model: string;
  trigger: 'lesson-memory-ready' | 'homework-memory-ready' | 'manual-replay';
  sourceEntryId?: string | null;
}

export interface ProcessStudentMemorySnapshotJobDependencies {
  lessonMemory: {
    list: typeof listLessonMemoryEntries;
  };
  homeworkMemory: {
    list: typeof listHomeworkMemoryEntries;
  };
  snapshots: {
    getById: typeof getStudentMemorySnapshotById;
    markFailed: typeof markStudentMemorySnapshotFailed;
    supersedePendingForStudent: typeof supersedePendingStudentMemorySnapshotsForStudent;
  };
  profileCandidates: {
    requestRefresh: typeof requestStudentProfileCandidateRefresh;
  };
  generator: typeof generateStudentMemorySnapshot;
  pacer: StudentMemoryGenerationPacer;
}

export async function processStudentMemorySnapshotJob(args: {
  config: BatchBackendConfig;
  payload: ProcessStudentMemorySnapshotJobPayload;
  attemptsMade?: number;
  maxAttempts?: number;
  overrides?: Partial<
    ProcessStudentMemorySnapshotJobDependencies & GenerateStudentMemorySnapshotDependencies
  >;
}): Promise<void> {
  const lessonMemory = args.overrides?.lessonMemory ?? {
    list: listLessonMemoryEntries,
  };
  const homeworkMemory = args.overrides?.homeworkMemory ?? {
    list: listHomeworkMemoryEntries,
  };
  const snapshots = args.overrides?.snapshots ?? {
    getById: getStudentMemorySnapshotById,
    markFailed: markStudentMemorySnapshotFailed,
    supersedePendingForStudent: supersedePendingStudentMemorySnapshotsForStudent,
  };
  const profileCandidates = args.overrides?.profileCandidates ?? {
    requestRefresh: requestStudentProfileCandidateRefresh,
  };
  const generator = args.overrides?.generator ?? generateStudentMemorySnapshot;
  const pacer = args.overrides?.pacer ?? createStudentMemoryGenerationPacer(args.config);

  const pendingEntry = await snapshots.getById(args.payload.pendingEntryId);
  if (!pendingEntry || pendingEntry.status !== 'pending') {
    return;
  }

  const readyLessonMemory = await listAllReadyLessonMemory(
    args.payload.studentId,
    lessonMemory.list,
  );
  const readyHomeworkMemory = await listAllReadyHomeworkMemory(
    args.payload.studentId,
    homeworkMemory.list,
  );

  if (readyLessonMemory.length === 0 && readyHomeworkMemory.length === 0) {
    await markFailureIfFinalAttempt({
      payload: args.payload,
      attemptsMade: args.attemptsMade,
      maxAttempts: args.maxAttempts,
      snapshots,
      error: new Error('No canonical lesson/homework memory available for student-memory snapshot'),
    });
    return;
  }

  try {
    const prompt = buildStudentMemorySnapshotPrompt({
      lessonMemoryEntries: readyLessonMemory,
      homeworkMemoryEntries: readyHomeworkMemory,
    });
    const envelope = buildStudentMemorySnapshotEnvelope({
      lessonMemoryEntries: readyLessonMemory,
      homeworkMemoryEntries: readyHomeworkMemory,
    });

    const result = await pacer.run({
      workload: 'student_memory_snapshot',
      provider: args.payload.provider,
      model: args.payload.model,
      prompt,
      execute: () =>
        generator({
          config: args.config.generation,
          request: {
            studentId: args.payload.studentId,
            lessonMemoryEntryIds: readyLessonMemory.map((entry: LessonMemoryRecord) => entry.id),
            homeworkMemoryEntryIds: readyHomeworkMemory.map(
              (entry: HomeworkMemoryRecord) => entry.id,
            ),
            pendingEntryId: pendingEntry.id,
            pendingGenerationNotes: pendingEntry.generationNotes ?? null,
            provider: args.payload.provider,
            model: args.payload.model,
            prompt,
            envelope,
          },
          overrides: args.overrides,
        }),
    });

    await snapshots.supersedePendingForStudent({
      studentId: args.payload.studentId,
      supersededById: result.snapshot.id,
      supersededAt: result.snapshot.generatedAt,
      maxGeneratedAt: pendingEntry.generatedAt,
    });

    try {
      await profileCandidates.requestRefresh({
        params: {
          studentId: args.payload.studentId,
          sourceSnapshotId: result.snapshot.id,
          trigger:
            args.payload.trigger === 'manual-replay'
              ? 'manual-replay'
              : 'student-memory-snapshot-ready',
        },
      });
    } catch (enqueueError) {
      logger.warn('Student profile candidate refresh enqueue failed; continuing', {
        event: 'student_profile_candidate_refresh_enqueue_failed',
        studentId: args.payload.studentId,
        sourceSnapshotId: result.snapshot.id,
        error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
      });
    }
  } catch (error) {
    if (isStudentMemoryPacingDeferredError(error)) {
      throw error;
    }
    await markFailureIfFinalAttempt({
      payload: args.payload,
      attemptsMade: args.attemptsMade,
      maxAttempts: args.maxAttempts,
      snapshots,
      error,
    });
    throw error;
  }
}

async function listAllReadyLessonMemory(
  studentId: string,
  list: typeof listLessonMemoryEntries,
): Promise<LessonMemoryRecord[]> {
  return listAllPages<LessonMemoryRecord>(async ({ limit, offset }) =>
    list({
      studentId,
      statuses: ['ready'],
      limit,
      offset,
    }),
  );
}

async function listAllReadyHomeworkMemory(
  studentId: string,
  list: typeof listHomeworkMemoryEntries,
): Promise<HomeworkMemoryRecord[]> {
  return listAllPages<HomeworkMemoryRecord>(async ({ limit, offset }) =>
    list({
      studentId,
      statuses: ['ready'],
      limit,
      offset,
    }),
  );
}

async function listAllPages<T>(
  loadPage: (args: { limit: number; offset: number }) => Promise<T[]>,
): Promise<T[]> {
  const limit = 200;
  const records: T[] = [];

  for (let offset = 0; ; offset += limit) {
    const page = await loadPage({ limit, offset });
    records.push(...page);
    if (page.length < limit) {
      return records;
    }
  }
}

async function markFailureIfFinalAttempt(args: {
  payload: ProcessStudentMemorySnapshotJobPayload;
  attemptsMade?: number;
  maxAttempts?: number;
  snapshots: {
    markFailed: typeof markStudentMemorySnapshotFailed;
  };
  error: unknown;
}): Promise<void> {
  const maxAttempts = args.maxAttempts ?? 1;
  const attemptNumber = (args.attemptsMade ?? 0) + 1;
  if (attemptNumber < maxAttempts) {
    return;
  }

  await args.snapshots.markFailed({
    id: args.payload.pendingEntryId,
    errorMessage: args.error instanceof Error ? args.error.message : String(args.error),
  });
}
