import { Buffer } from 'node:buffer';

import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { HomeworkMemoryRecord } from '../domain/homework-memory-model.js';
import {
  getHomeworkMemoryEntryById,
  listHomeworkMemoryEntries,
  listRecentReadyHomeworkMemoryByStudentId,
} from '../domain/homework-memory-repository.js';
import type { LessonMemoryRecord } from '../domain/lesson-memory-model.js';
import {
  getLessonMemoryEntryById,
  listLessonMemoryEntries,
  listRecentReadyLessonMemoryByStudentId,
} from '../domain/lesson-memory-repository.js';
import type { StudentMemorySnapshotRecord } from '../domain/student-memory-snapshot-model.js';
import {
  getLatestReadyStudentMemorySnapshotByStudentId,
  getStudentMemorySnapshotById,
  markStudentMemorySnapshotFailed,
  supersedePendingStudentMemorySnapshotsForStudent,
} from '../domain/student-memory-snapshot-repository.js';
import { logger } from '../infrastructure/logger.js';
import { requestStudentProfileCandidateRefresh } from './request-student-profile-candidate-refresh.js';
import { estimateGenerationTokens } from './generation-budget-guard.js';
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
  buildStudentMemorySnapshotGenerationNotes,
  resolveStudentMemorySnapshotTriggerSourceKind,
  type StudentMemorySnapshotRefreshStrategy,
  type StudentMemorySnapshotV11GenerationNotes,
} from './student-memory-snapshot-generation-notes.js';
import {
  buildIncrementalStudentMemorySnapshotEnvelope,
  buildIncrementalStudentMemorySnapshotPrompt,
  buildStudentMemorySnapshotEnvelope,
  buildStudentMemorySnapshotPrompt,
  type IncrementalStudentMemorySnapshotTriggerSource,
} from './student-memory-snapshot-prompt.js';

export interface ProcessStudentMemorySnapshotJobPayload {
  kind: 'student-memory-snapshot-refresh';
  studentId: string;
  pendingEntryId: string;
  provider: GenerationProvider;
  model: string;
  trigger: 'lesson-memory-ready' | 'homework-memory-ready' | 'manual-replay';
  sourceEntryId?: string | null;
  strategy?: StudentMemorySnapshotRefreshStrategy | null;
  operatorReason?: string | null;
}

export interface ProcessStudentMemorySnapshotJobDependencies {
  lessonMemory: {
    list: typeof listLessonMemoryEntries;
    getById: typeof getLessonMemoryEntryById;
    listRecentReadyByStudentId: typeof listRecentReadyLessonMemoryByStudentId;
  };
  homeworkMemory: {
    list: typeof listHomeworkMemoryEntries;
    getById: typeof getHomeworkMemoryEntryById;
    listRecentReadyByStudentId: typeof listRecentReadyHomeworkMemoryByStudentId;
  };
  snapshots: {
    getById: typeof getStudentMemorySnapshotById;
    getLatestReadyByStudentId: typeof getLatestReadyStudentMemorySnapshotByStudentId;
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
    getById: getLessonMemoryEntryById,
    listRecentReadyByStudentId: listRecentReadyLessonMemoryByStudentId,
  };
  const homeworkMemory = args.overrides?.homeworkMemory ?? {
    list: listHomeworkMemoryEntries,
    getById: getHomeworkMemoryEntryById,
    listRecentReadyByStudentId: listRecentReadyHomeworkMemoryByStudentId,
  };
  const snapshots = args.overrides?.snapshots ?? {
    getById: getStudentMemorySnapshotById,
    getLatestReadyByStudentId: getLatestReadyStudentMemorySnapshotByStudentId,
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

  let generationNotes: StudentMemorySnapshotV11GenerationNotes | null = null;

  try {
    const buildResult = await buildSnapshotRefreshRequest({
      payload: args.payload,
      pendingGenerationNotes: pendingEntry.generationNotes ?? null,
      lessonMemory,
      homeworkMemory,
      snapshots,
    });
    const { prompt, envelope, lessonMemoryEntryIds, homeworkMemoryEntryIds } = buildResult;
    const promptByteLength = Buffer.byteLength(prompt, 'utf8');
    const inputTokenEstimate = estimateGenerationTokens({
      prompt,
      hardCap: 0,
    });
    generationNotes = buildStudentMemorySnapshotGenerationNotes({
      existingNotes: pendingEntry.generationNotes ?? null,
      strategy: buildResult.strategy,
      trigger: args.payload.trigger,
      triggerSourceKind: resolveStudentMemorySnapshotTriggerSourceKind(args.payload.trigger),
      triggerSourceEntryId: args.payload.sourceEntryId ?? null,
      parentSnapshotId: buildResult.parentSnapshotId,
      includedLessonMemoryEntryIds: buildResult.includedLessonMemoryEntryIds,
      includedHomeworkMemoryEntryIds: buildResult.includedHomeworkMemoryEntryIds,
      coveredLessonMemoryEntryIds: lessonMemoryEntryIds,
      coveredHomeworkMemoryEntryIds: homeworkMemoryEntryIds,
      inputTokenEstimate,
      promptByteLength,
      materialChange: null,
    });

    logger.info('Student-memory snapshot prompt metrics recorded', {
      event: 'student_memory_snapshot_prompt_metrics_recorded',
      studentId: args.payload.studentId,
      pendingEntryId: pendingEntry.id,
      strategy: generationNotes.strategy,
      trigger: generationNotes.trigger,
      triggerSourceKind: generationNotes.triggerSourceKind,
      triggerSourceEntryId: generationNotes.triggerSourceEntryId,
      includedLessonMemoryCount: generationNotes.includedLessonMemoryCount,
      includedHomeworkMemoryCount: generationNotes.includedHomeworkMemoryCount,
      coveredLessonMemoryCount: generationNotes.coveredLessonMemoryCount,
      coveredHomeworkMemoryCount: generationNotes.coveredHomeworkMemoryCount,
      inputTokenEstimate,
      promptByteLength,
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
            lessonMemoryEntryIds,
            homeworkMemoryEntryIds,
            pendingEntryId: pendingEntry.id,
            pendingGenerationNotes: generationNotes,
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
      generationNotes,
    });
    throw error;
  }
}

async function buildSnapshotRefreshRequest(args: {
  payload: ProcessStudentMemorySnapshotJobPayload;
  pendingGenerationNotes: Record<string, unknown> | null;
  lessonMemory: ProcessStudentMemorySnapshotJobDependencies['lessonMemory'];
  homeworkMemory: ProcessStudentMemorySnapshotJobDependencies['homeworkMemory'];
  snapshots: Pick<ProcessStudentMemorySnapshotJobDependencies['snapshots'], 'getLatestReadyByStudentId'>;
}): Promise<{
  strategy: StudentMemorySnapshotRefreshStrategy;
  parentSnapshotId: string | null;
  prompt: string;
  envelope: ReturnType<typeof buildStudentMemorySnapshotEnvelope>;
  lessonMemoryEntryIds: string[];
  homeworkMemoryEntryIds: string[];
  includedLessonMemoryEntryIds: string[];
  includedHomeworkMemoryEntryIds: string[];
}> {
  if (args.payload.trigger === 'manual-replay') {
    const strategy = resolveManualSnapshotRefreshStrategy({
      payload: args.payload,
      pendingGenerationNotes: args.pendingGenerationNotes,
    });
    const readyLessonMemory = await listAllReadyLessonMemory(
      args.payload.studentId,
      args.lessonMemory.list,
    );
    const readyHomeworkMemory = await listAllReadyHomeworkMemory(
      args.payload.studentId,
      args.homeworkMemory.list,
    );

    if (readyLessonMemory.length === 0 && readyHomeworkMemory.length === 0) {
      throw new Error('No canonical lesson/homework memory available for student-memory snapshot');
    }

    const prompt = buildStudentMemorySnapshotPrompt({
      lessonMemoryEntries: readyLessonMemory,
      homeworkMemoryEntries: readyHomeworkMemory,
    });
    const envelope = buildStudentMemorySnapshotEnvelope({
      lessonMemoryEntries: readyLessonMemory,
      homeworkMemoryEntries: readyHomeworkMemory,
    });
    const lessonMemoryEntryIds = readyLessonMemory.map((entry: LessonMemoryRecord) => entry.id);
    const homeworkMemoryEntryIds = readyHomeworkMemory.map(
      (entry: HomeworkMemoryRecord) => entry.id,
    );
    return {
      strategy,
      parentSnapshotId: null,
      prompt,
      envelope,
      lessonMemoryEntryIds,
      homeworkMemoryEntryIds,
      includedLessonMemoryEntryIds: lessonMemoryEntryIds,
      includedHomeworkMemoryEntryIds: homeworkMemoryEntryIds,
    };
  }

  const latestReadySnapshot = await args.snapshots.getLatestReadyByStudentId(args.payload.studentId);
  const contextLimits = resolveIncrementalContextLimits({
    trigger: args.payload.trigger,
    hasParentSnapshot: Boolean(latestReadySnapshot),
  });
  const context = await loadIncrementalSnapshotContext({
    payload: args.payload,
    lessonMemory: args.lessonMemory,
    homeworkMemory: args.homeworkMemory,
    limits: contextLimits,
  });
  const prompt = buildIncrementalStudentMemorySnapshotPrompt({
    previousSnapshot: latestReadySnapshot,
    triggerSource: context.triggerSource,
    supportingLessonMemoryEntries: context.supportingLessonMemoryEntries,
    supportingHomeworkMemoryEntries: context.supportingHomeworkMemoryEntries,
  });
  const envelope = buildIncrementalStudentMemorySnapshotEnvelope({
    previousSnapshot: latestReadySnapshot,
    triggerSource: context.triggerSource,
    supportingLessonMemoryEntries: context.supportingLessonMemoryEntries,
    supportingHomeworkMemoryEntries: context.supportingHomeworkMemoryEntries,
  });
  const includedLessonMemoryEntryIds = uniqueIds([
    ...(context.triggerSource.kind === 'lesson_memory' ? [context.triggerSource.entry.id] : []),
    ...context.supportingLessonMemoryEntries.map((entry) => entry.id),
  ]);
  const includedHomeworkMemoryEntryIds = uniqueIds([
    ...(context.triggerSource.kind === 'homework_memory' ? [context.triggerSource.entry.id] : []),
    ...context.supportingHomeworkMemoryEntries.map((entry) => entry.id),
  ]);
  const previousCoverage = resolvePreviousSnapshotCoverage(latestReadySnapshot);
  const lessonMemoryEntryIds = uniqueIds([
    ...previousCoverage.lessonMemoryEntryIds,
    ...includedLessonMemoryEntryIds,
  ]);
  const homeworkMemoryEntryIds = uniqueIds([
    ...previousCoverage.homeworkMemoryEntryIds,
    ...includedHomeworkMemoryEntryIds,
  ]);

  return {
    strategy: latestReadySnapshot ? 'incremental_v1_1' : 'bootstrap_incremental_v1_1',
    parentSnapshotId: latestReadySnapshot?.id ?? null,
    prompt,
    envelope,
    lessonMemoryEntryIds,
    homeworkMemoryEntryIds,
    includedLessonMemoryEntryIds,
    includedHomeworkMemoryEntryIds,
  };
}

async function loadIncrementalSnapshotContext(args: {
  payload: ProcessStudentMemorySnapshotJobPayload;
  lessonMemory: ProcessStudentMemorySnapshotJobDependencies['lessonMemory'];
  homeworkMemory: ProcessStudentMemorySnapshotJobDependencies['homeworkMemory'];
  limits: {
    lessonMemory: number;
    homeworkMemory: number;
  };
}): Promise<{
  triggerSource: IncrementalStudentMemorySnapshotTriggerSource;
  supportingLessonMemoryEntries: LessonMemoryRecord[];
  supportingHomeworkMemoryEntries: HomeworkMemoryRecord[];
}> {
  const sourceEntryId = args.payload.sourceEntryId?.trim();
  if (!sourceEntryId) {
    throw new Error('Incremental student-memory snapshot refresh requires sourceEntryId');
  }

  if (args.payload.trigger === 'lesson-memory-ready') {
    const triggerEntry = await args.lessonMemory.getById(sourceEntryId);
    if (!triggerEntry || triggerEntry.status !== 'ready') {
      throw new Error(`Ready lesson memory trigger source not found: ${sourceEntryId}`);
    }
    if (triggerEntry.studentId !== args.payload.studentId) {
      throw new Error('Lesson memory trigger source belongs to a different student');
    }
    const supportingLessonMemoryEntries = await args.lessonMemory.listRecentReadyByStudentId(
      args.payload.studentId,
      {
        limit: args.limits.lessonMemory,
        excludeTranscriptId: triggerEntry.transcriptId,
      },
    );
    const supportingHomeworkMemoryEntries = await args.homeworkMemory.listRecentReadyByStudentId(
      args.payload.studentId,
      {
        limit: args.limits.homeworkMemory,
      },
    );
    return {
      triggerSource: {
        kind: 'lesson_memory',
        entry: triggerEntry,
      },
      supportingLessonMemoryEntries: excludeEntryById(supportingLessonMemoryEntries, triggerEntry.id),
      supportingHomeworkMemoryEntries,
    };
  }

  const triggerEntry = await args.homeworkMemory.getById(sourceEntryId);
  if (!triggerEntry || triggerEntry.status !== 'ready') {
    throw new Error(`Ready homework memory trigger source not found: ${sourceEntryId}`);
  }
  if (triggerEntry.studentId !== args.payload.studentId) {
    throw new Error('Homework memory trigger source belongs to a different student');
  }
  const supportingLessonMemoryEntries = await args.lessonMemory.listRecentReadyByStudentId(
    args.payload.studentId,
    {
      limit: args.limits.lessonMemory,
    },
  );
  const supportingHomeworkMemoryEntries = await args.homeworkMemory.listRecentReadyByStudentId(
    args.payload.studentId,
    {
      limit: args.limits.homeworkMemory,
      excludeAssignmentLineageKey: triggerEntry.assignmentLineageKey,
    },
  );
  return {
    triggerSource: {
      kind: 'homework_memory',
      entry: triggerEntry,
    },
    supportingLessonMemoryEntries,
    supportingHomeworkMemoryEntries: excludeEntryById(
      supportingHomeworkMemoryEntries,
      triggerEntry.id,
    ),
  };
}

function resolveIncrementalContextLimits(args: {
  trigger: Exclude<ProcessStudentMemorySnapshotJobPayload['trigger'], 'manual-replay'>;
  hasParentSnapshot: boolean;
}): {
  lessonMemory: number;
  homeworkMemory: number;
} {
  if (args.hasParentSnapshot) {
    return {
      lessonMemory: 2,
      homeworkMemory: 1,
    };
  }

  return {
    lessonMemory: args.trigger === 'lesson-memory-ready' ? 4 : 5,
    homeworkMemory: args.trigger === 'homework-memory-ready' ? 2 : 3,
  };
}

function resolveManualSnapshotRefreshStrategy(args: {
  payload: ProcessStudentMemorySnapshotJobPayload;
  pendingGenerationNotes: Record<string, unknown> | null;
}): Extract<StudentMemorySnapshotRefreshStrategy, 'manual_rebuild_v1_1' | 'full_rebuild_v1'> {
  const strategy = args.payload.strategy ?? args.pendingGenerationNotes?.strategy;
  const operatorReason =
    args.payload.operatorReason ?? args.pendingGenerationNotes?.operatorReason ?? null;

  if (strategy !== 'manual_rebuild_v1_1' && strategy !== 'full_rebuild_v1') {
    throw new Error('Manual student-memory snapshot replay requires an explicit rebuild strategy');
  }
  if (typeof operatorReason !== 'string' || !operatorReason.trim()) {
    throw new Error('Manual student-memory snapshot replay requires an operator reason');
  }
  return strategy;
}

function resolvePreviousSnapshotCoverage(snapshot: StudentMemorySnapshotRecord | null): {
  lessonMemoryEntryIds: string[];
  homeworkMemoryEntryIds: string[];
} {
  if (!snapshot) {
    return {
      lessonMemoryEntryIds: [],
      homeworkMemoryEntryIds: [],
    };
  }

  const notes = snapshot.generationNotes ?? {};
  return {
    lessonMemoryEntryIds: Array.isArray(notes.coveredLessonMemoryEntryIds)
      ? notes.coveredLessonMemoryEntryIds.filter((id): id is string => typeof id === 'string')
      : snapshot.lessonMemoryEntryIds,
    homeworkMemoryEntryIds: Array.isArray(notes.coveredHomeworkMemoryEntryIds)
      ? notes.coveredHomeworkMemoryEntryIds.filter((id): id is string => typeof id === 'string')
      : snapshot.homeworkMemoryEntryIds,
  };
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function excludeEntryById<T extends { id: string }>(entries: T[], excludedId: string): T[] {
  return entries.filter((entry) => entry.id !== excludedId);
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
  generationNotes?: StudentMemorySnapshotV11GenerationNotes | null;
}): Promise<void> {
  const maxAttempts = args.maxAttempts ?? 1;
  const attemptNumber = (args.attemptsMade ?? 0) + 1;
  if (attemptNumber < maxAttempts) {
    return;
  }

  await args.snapshots.markFailed({
    id: args.payload.pendingEntryId,
    errorMessage: args.error instanceof Error ? args.error.message : String(args.error),
    generationNotes: args.generationNotes ?? undefined,
  });
}
