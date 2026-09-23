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
  StudentMemorySnapshotParentChangedError,
  StudentMemorySnapshotSourcesChangedError,
  supersedePendingStudentMemorySnapshotsForStudent,
  updateStudentMemorySnapshotGenerationNotes,
} from '../domain/student-memory-snapshot-repository.js';
import { logger } from '../infrastructure/logger.js';
import { estimateGenerationTokens } from './generation-budget-guard.js';
import { requestStudentProfileCandidateRefresh } from './request-student-profile-candidate-refresh.js';
import {
  createStudentMemoryGenerationPacer,
  isStudentMemoryPacingDeferredError,
  type StudentMemoryGenerationPacer,
} from './student-memory-generation-pacing.js';
import type { StudentMemorySnapshotContent } from './student-memory-snapshot-content-schema.js';
import {
  type GenerateStudentMemorySnapshotDependencies,
  generateStudentMemorySnapshot,
} from './student-memory-snapshot-generation.js';
import {
  buildStudentMemorySnapshotGenerationNotes,
  resolveStudentMemorySnapshotTriggerSourceKind,
  type StudentMemorySnapshotBudgetDecision,
  type StudentMemorySnapshotCandidateRefreshEnqueueStatus,
  type StudentMemorySnapshotFailureDetails,
  type StudentMemorySnapshotPromptBudgetFailureDetails,
  type StudentMemorySnapshotRefreshStrategy,
  type StudentMemorySnapshotV11GenerationNotes,
} from './student-memory-snapshot-generation-notes.js';
import {
  hashStudentMemorySnapshotContent,
  hashStudentMemorySnapshotDurablePreferencesConstraints,
  hashStudentMemorySnapshotPersonalFacts,
} from './student-memory-snapshot-hashes.js';
import {
  buildIncrementalStudentMemorySnapshotEnvelope,
  buildIncrementalStudentMemorySnapshotPrompt,
  buildStudentMemorySnapshotEnvelope,
  buildStudentMemorySnapshotPrompt,
  type IncrementalStudentMemorySnapshotTriggerSource,
} from './student-memory-snapshot-prompt.js';
import { isProfileWorthyStudentFact } from './student-profile-candidate-facts.js';

export const STUDENT_MEMORY_SNAPSHOT_INCREMENTAL_TARGET_INPUT_TOKENS = 25_000;
export const STUDENT_MEMORY_SNAPSHOT_INCREMENTAL_HARD_INPUT_TOKENS = 35_000;
export const STUDENT_MEMORY_SNAPSHOT_FULL_REBUILD_WARN_INPUT_TOKENS = 60_000;

interface StudentMemorySnapshotPromptBudget {
  incrementalTargetInputTokens: number;
  incrementalHardInputTokens: number;
  fullRebuildWarnInputTokens: number;
}

const DEFAULT_STUDENT_MEMORY_SNAPSHOT_PROMPT_BUDGET: StudentMemorySnapshotPromptBudget = {
  incrementalTargetInputTokens: STUDENT_MEMORY_SNAPSHOT_INCREMENTAL_TARGET_INPUT_TOKENS,
  incrementalHardInputTokens: STUDENT_MEMORY_SNAPSHOT_INCREMENTAL_HARD_INPUT_TOKENS,
  fullRebuildWarnInputTokens: STUDENT_MEMORY_SNAPSHOT_FULL_REBUILD_WARN_INPUT_TOKENS,
};

class StudentMemorySnapshotPromptBudgetError extends Error {
  readonly generationNotes: StudentMemorySnapshotV11GenerationNotes;

  constructor(args: { message: string; generationNotes: StudentMemorySnapshotV11GenerationNotes }) {
    super(args.message);
    this.name = 'StudentMemorySnapshotPromptBudgetError';
    this.generationNotes = args.generationNotes;
  }
}

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
  requestCandidateRefresh?: boolean | null;
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
    updateGenerationNotes: typeof updateStudentMemorySnapshotGenerationNotes;
  };
  profileCandidates: {
    requestRefresh: typeof requestStudentProfileCandidateRefresh;
  };
  generator: typeof generateStudentMemorySnapshot;
  pacer: StudentMemoryGenerationPacer;
  snapshotPromptBudget: StudentMemorySnapshotPromptBudget;
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
  const defaultSnapshots = {
    getById: getStudentMemorySnapshotById,
    getLatestReadyByStudentId: getLatestReadyStudentMemorySnapshotByStudentId,
    markFailed: markStudentMemorySnapshotFailed,
    supersedePendingForStudent: supersedePendingStudentMemorySnapshotsForStudent,
    updateGenerationNotes: updateStudentMemorySnapshotGenerationNotes,
  };
  const snapshots = {
    ...defaultSnapshots,
    ...(args.overrides?.snapshots ?? {}),
    ...(args.overrides?.snapshots && !args.overrides.snapshots.updateGenerationNotes
      ? { updateGenerationNotes: async () => null }
      : {}),
  };
  const profileCandidates = args.overrides?.profileCandidates ?? {
    requestRefresh: requestStudentProfileCandidateRefresh,
  };
  const generator = args.overrides?.generator ?? generateStudentMemorySnapshot;
  const pacer = args.overrides?.pacer ?? createStudentMemoryGenerationPacer(args.config);
  const snapshotPromptBudget =
    args.overrides?.snapshotPromptBudget ?? DEFAULT_STUDENT_MEMORY_SNAPSHOT_PROMPT_BUDGET;

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
      snapshotPromptBudget,
    });
    const { prompt, envelope, lessonMemoryEntryIds, homeworkMemoryEntryIds } = buildResult;
    const { promptByteLength, inputTokenEstimate } = buildResult.promptMetrics;
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
      budgetDecision: buildResult.budgetDecision,
      failureDetails: buildResult.failureDetails,
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
      budgetDecision: generationNotes.budgetDecision,
    });

    if (buildResult.budgetDecision.action === 'warn_allow') {
      logger.warn('Student-memory snapshot manual rebuild prompt exceeds warning budget', {
        event: 'student_memory_snapshot_manual_rebuild_prompt_over_warning_budget',
        studentId: args.payload.studentId,
        pendingEntryId: pendingEntry.id,
        strategy: generationNotes.strategy,
        inputTokenEstimate,
        promptByteLength,
        fullRebuildWarnInputTokens: buildResult.budgetDecision.fullRebuildWarnInputTokens,
      });
    }

    if (buildResult.failureDetails) {
      logger.warn('Student-memory snapshot prompt failed budget preflight', {
        event: 'student_memory_snapshot_prompt_budget_preflight_failed',
        studentId: args.payload.studentId,
        pendingEntryId: pendingEntry.id,
        strategy: generationNotes.strategy,
        trigger: generationNotes.trigger,
        inputTokenEstimate,
        promptByteLength,
        failureDetails: buildResult.failureDetails,
      });
      throw new StudentMemorySnapshotPromptBudgetError({
        message: buildResult.failureDetails.message,
        generationNotes,
      });
    }

    const candidateRefreshState: {
      decision: ReturnType<typeof buildCandidateRefreshDecision> | null;
    } = { decision: null };
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
            finalizeGenerationNotes: ({ content }) => {
              const decision = buildCandidateRefreshDecision({
                payload: args.payload,
                pendingGenerationNotes: pendingEntry.generationNotes ?? null,
                parentSnapshot: buildResult.parentSnapshot,
                generatedSnapshot: content,
                triggerProfileWorthyStudentFactCount:
                  buildResult.triggerProfileWorthyStudentFactCount,
              });
              candidateRefreshState.decision = decision;
              return {
                materialChange: decision.materialChange,
                candidateRefresh: decision.metadata,
              };
            },
            ...(isGuardedSnapshotRefreshStrategy(buildResult.strategy)
              ? { expectedLatestReadySnapshotId: buildResult.parentSnapshotId }
              : {}),
          },
          overrides: args.overrides,
        }),
    });

    const candidateRefreshDecision = candidateRefreshState.decision;
    if (!candidateRefreshDecision) {
      throw new Error('Snapshot generator did not finalize candidate refresh intent');
    }
    generationNotes = (result.snapshot.generationNotes ??
      generationNotes) as StudentMemorySnapshotV11GenerationNotes;

    await snapshots.supersedePendingForStudent({
      studentId: args.payload.studentId,
      supersededById: result.snapshot.id,
      supersededAt: result.snapshot.generatedAt,
      maxGeneratedAt: pendingEntry.generatedAt,
    });

    if (!candidateRefreshDecision.requested) {
      logger.info('Student profile candidate refresh skipped after snapshot generation', {
        event: 'student_profile_candidate_refresh_skipped_no_profile_worthy_delta',
        studentId: args.payload.studentId,
        sourceSnapshotId: result.snapshot.id,
        candidateRefresh: candidateRefreshDecision.metadata,
      });
      return;
    }

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
      generationNotes = setCandidateRefreshEnqueueStatus(generationNotes, 'enqueued');
      await snapshots.updateGenerationNotes({
        id: result.snapshot.id,
        generationNotes,
      });
    } catch (enqueueError) {
      generationNotes = setCandidateRefreshEnqueueStatus(generationNotes, 'failed');
      await snapshots.updateGenerationNotes({
        id: result.snapshot.id,
        generationNotes,
      });
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
    if (error instanceof StudentMemorySnapshotPromptBudgetError) {
      generationNotes = error.generationNotes;
      await snapshots.markFailed({
        id: args.payload.pendingEntryId,
        errorMessage: error.message,
        generationNotes,
      });
      throw error;
    }
    if (error instanceof StudentMemorySnapshotParentChangedError) {
      generationNotes = addParentChangedFailureDetails({
        generationNotes,
        error,
      });
      logger.warn('Student-memory snapshot parent changed before ready finalization; retrying', {
        event: 'student_memory_snapshot_parent_changed_retry',
        studentId: args.payload.studentId,
        pendingEntryId: args.payload.pendingEntryId,
        expectedLatestReadySnapshotId: error.expectedLatestReadySnapshotId,
        actualLatestReadySnapshotId: error.actualLatestReadySnapshotId,
      });
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
    if (error instanceof StudentMemorySnapshotSourcesChangedError) {
      generationNotes = addSourcesChangedFailureDetails({
        generationNotes,
        error,
      });
      if (!isFinalAttempt(args.attemptsMade, args.maxAttempts)) {
        logger.warn('Student-memory snapshot sources changed before ready finalization; retrying', {
          event: 'student_memory_snapshot_sources_changed_retry',
          studentId: args.payload.studentId,
          pendingEntryId: args.payload.pendingEntryId,
          unavailableLessonMemoryEntryIds: error.unavailableLessonMemoryEntryIds,
        });
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

function isGuardedSnapshotRefreshStrategy(strategy: StudentMemorySnapshotRefreshStrategy): boolean {
  return strategy === 'incremental_v1_1' || strategy === 'bootstrap_incremental_v1_1';
}

function addParentChangedFailureDetails(args: {
  generationNotes?: StudentMemorySnapshotV11GenerationNotes | null;
  error: StudentMemorySnapshotParentChangedError;
}): StudentMemorySnapshotV11GenerationNotes | null {
  if (!args.generationNotes) {
    return null;
  }
  return {
    ...args.generationNotes,
    failureDetails: {
      code: 'student_memory_snapshot_parent_changed_before_finalize',
      stage: 'snapshot_ready_finalization',
      message: args.error.message,
      expectedLatestReadySnapshotId: args.error.expectedLatestReadySnapshotId,
      actualLatestReadySnapshotId: args.error.actualLatestReadySnapshotId,
    },
  };
}

function addSourcesChangedFailureDetails(args: {
  generationNotes?: StudentMemorySnapshotV11GenerationNotes | null;
  error: StudentMemorySnapshotSourcesChangedError;
}): StudentMemorySnapshotV11GenerationNotes | null {
  if (!args.generationNotes) {
    return null;
  }
  return {
    ...args.generationNotes,
    failureDetails: {
      code: 'student_memory_snapshot_sources_changed_before_finalize',
      stage: 'snapshot_ready_finalization',
      message: args.error.message,
      unavailableLessonMemoryEntryIds: args.error.unavailableLessonMemoryEntryIds,
    },
  };
}

async function buildSnapshotRefreshRequest(args: {
  payload: ProcessStudentMemorySnapshotJobPayload;
  pendingGenerationNotes: Record<string, unknown> | null;
  lessonMemory: ProcessStudentMemorySnapshotJobDependencies['lessonMemory'];
  homeworkMemory: ProcessStudentMemorySnapshotJobDependencies['homeworkMemory'];
  snapshots: Pick<
    ProcessStudentMemorySnapshotJobDependencies['snapshots'],
    'getLatestReadyByStudentId'
  >;
  snapshotPromptBudget: StudentMemorySnapshotPromptBudget;
}): Promise<{
  strategy: StudentMemorySnapshotRefreshStrategy;
  parentSnapshotId: string | null;
  prompt: string;
  envelope: ReturnType<typeof buildStudentMemorySnapshotEnvelope>;
  lessonMemoryEntryIds: string[];
  homeworkMemoryEntryIds: string[];
  includedLessonMemoryEntryIds: string[];
  includedHomeworkMemoryEntryIds: string[];
  promptMetrics: StudentMemorySnapshotPromptMetrics;
  budgetDecision: StudentMemorySnapshotBudgetDecision;
  failureDetails: StudentMemorySnapshotFailureDetails | null;
  parentSnapshot: StudentMemorySnapshotRecord | null;
  triggerProfileWorthyStudentFactCount: number;
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
    const promptMetrics = estimateStudentMemorySnapshotPromptMetrics(prompt);
    const budgetDecision = buildManualSnapshotBudgetDecision({
      budget: args.snapshotPromptBudget,
      promptMetrics,
    });
    return {
      strategy,
      parentSnapshotId: null,
      prompt,
      envelope,
      lessonMemoryEntryIds,
      homeworkMemoryEntryIds,
      includedLessonMemoryEntryIds: lessonMemoryEntryIds,
      includedHomeworkMemoryEntryIds: homeworkMemoryEntryIds,
      promptMetrics,
      budgetDecision,
      failureDetails: null,
      parentSnapshot: null,
      triggerProfileWorthyStudentFactCount: 0,
    };
  }

  const latestReadySnapshot = await args.snapshots.getLatestReadyByStudentId(
    args.payload.studentId,
  );
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
  const previousCoverage = resolvePreviousSnapshotCoverage(latestReadySnapshot);
  const incrementalResult = buildBudgetedIncrementalSnapshotRequest({
    strategy: latestReadySnapshot ? 'incremental_v1_1' : 'bootstrap_incremental_v1_1',
    parentSnapshotId: latestReadySnapshot?.id ?? null,
    previousSnapshot: latestReadySnapshot,
    context,
    previousCoverage,
    budget: args.snapshotPromptBudget,
  });

  return {
    ...incrementalResult,
    parentSnapshot: latestReadySnapshot,
    triggerProfileWorthyStudentFactCount: countProfileWorthyTriggerStudentFacts(
      context.triggerSource,
    ),
  };
}

interface StudentMemorySnapshotCandidateRefreshMetadata {
  requested: boolean;
  enqueueStatus: StudentMemorySnapshotCandidateRefreshEnqueueStatus;
  reasons: CandidateRefreshReason[];
  triggerProfileWorthyStudentFactCount: number;
  personalFactsHashBefore: string;
  personalFactsHashAfter: string;
  personalFactsHashChanged: boolean;
  durablePreferencesConstraintsHashBefore: string;
  durablePreferencesConstraintsHashAfter: string;
  durablePreferencesConstraintsHashChanged: boolean;
  snapshotContentHashBefore: string | null;
  snapshotContentHashAfter: string;
  snapshotContentHashChanged: boolean;
  manualReplayRequestedCandidateRefresh: boolean;
  skippedNoProfileWorthyDeltaCount: number;
}

type CandidateRefreshReason =
  | 'trigger_profile_worthy_student_fact'
  | 'personal_facts_hash_changed'
  | 'durable_preferences_constraints_changed'
  | 'manual_replay_requested_candidate_refresh';

function buildCandidateRefreshDecision(args: {
  payload: ProcessStudentMemorySnapshotJobPayload;
  pendingGenerationNotes: Record<string, unknown> | null;
  parentSnapshot: StudentMemorySnapshotRecord | null;
  generatedSnapshot: StudentMemorySnapshotContent;
  triggerProfileWorthyStudentFactCount: number;
}): {
  requested: boolean;
  materialChange: boolean;
  metadata: StudentMemorySnapshotCandidateRefreshMetadata;
} {
  const personalFactsHashBefore = hashStudentMemorySnapshotPersonalFacts(
    args.parentSnapshot?.personalFacts,
  );
  const personalFactsHashAfter = hashStudentMemorySnapshotPersonalFacts(
    args.generatedSnapshot.personalFacts,
  );
  const durablePreferencesConstraintsHashBefore =
    hashStudentMemorySnapshotDurablePreferencesConstraints(args.parentSnapshot?.personalFacts);
  const durablePreferencesConstraintsHashAfter =
    hashStudentMemorySnapshotDurablePreferencesConstraints(args.generatedSnapshot.personalFacts);
  const snapshotContentHashBefore = args.parentSnapshot
    ? hashStudentMemorySnapshotContent(args.parentSnapshot)
    : null;
  const snapshotContentHashAfter = hashStudentMemorySnapshotContent(args.generatedSnapshot);
  const personalFactsHashChanged = personalFactsHashBefore !== personalFactsHashAfter;
  const durablePreferencesConstraintsHashChanged =
    durablePreferencesConstraintsHashBefore !== durablePreferencesConstraintsHashAfter;
  const snapshotContentHashChanged = snapshotContentHashBefore !== snapshotContentHashAfter;
  const manualReplayRequestedCandidateRefresh =
    args.payload.trigger === 'manual-replay' &&
    resolveCandidateRefreshBoolean(
      args.payload.requestCandidateRefresh ??
        args.pendingGenerationNotes?.requestCandidateRefresh ??
        null,
    );
  const reasons: CandidateRefreshReason[] = [];

  if (manualReplayRequestedCandidateRefresh) {
    reasons.push('manual_replay_requested_candidate_refresh');
  } else if (args.payload.trigger !== 'manual-replay') {
    if (args.triggerProfileWorthyStudentFactCount > 0) {
      reasons.push('trigger_profile_worthy_student_fact');
    }
    if (personalFactsHashChanged) {
      reasons.push('personal_facts_hash_changed');
    }
    if (durablePreferencesConstraintsHashChanged) {
      reasons.push('durable_preferences_constraints_changed');
    }
  }

  const requested = reasons.length > 0;
  return {
    requested,
    materialChange: snapshotContentHashChanged,
    metadata: {
      requested,
      enqueueStatus: requested ? 'pending' : 'not_requested',
      reasons,
      triggerProfileWorthyStudentFactCount: args.triggerProfileWorthyStudentFactCount,
      personalFactsHashBefore,
      personalFactsHashAfter,
      personalFactsHashChanged,
      durablePreferencesConstraintsHashBefore,
      durablePreferencesConstraintsHashAfter,
      durablePreferencesConstraintsHashChanged,
      snapshotContentHashBefore,
      snapshotContentHashAfter,
      snapshotContentHashChanged,
      manualReplayRequestedCandidateRefresh,
      skippedNoProfileWorthyDeltaCount: requested ? 0 : 1,
    },
  };
}

function setCandidateRefreshEnqueueStatus(
  generationNotes: StudentMemorySnapshotV11GenerationNotes,
  enqueueStatus: Extract<StudentMemorySnapshotCandidateRefreshEnqueueStatus, 'enqueued' | 'failed'>,
): StudentMemorySnapshotV11GenerationNotes {
  if (!generationNotes.candidateRefresh) {
    throw new Error('Candidate refresh decision metadata is required before enqueue');
  }
  return {
    ...generationNotes,
    candidateRefresh: {
      ...generationNotes.candidateRefresh,
      enqueueStatus,
    },
  };
}

function countProfileWorthyTriggerStudentFacts(
  triggerSource: IncrementalStudentMemorySnapshotTriggerSource,
): number {
  if (triggerSource.kind !== 'lesson_memory') {
    return 0;
  }
  return triggerSource.entry.studentFacts.filter(isProfileWorthyStudentFact).length;
}

function resolveCandidateRefreshBoolean(value: unknown): boolean {
  return value === true;
}

interface StudentMemorySnapshotPromptMetrics {
  inputTokenEstimate: number;
  promptByteLength: number;
}

function estimateStudentMemorySnapshotPromptMetrics(
  prompt: string,
): StudentMemorySnapshotPromptMetrics {
  return {
    promptByteLength: Buffer.byteLength(prompt, 'utf8'),
    inputTokenEstimate: estimateGenerationTokens({
      prompt,
      hardCap: 0,
    }),
  };
}

function buildManualSnapshotBudgetDecision(args: {
  budget: StudentMemorySnapshotPromptBudget;
  promptMetrics: StudentMemorySnapshotPromptMetrics;
}): StudentMemorySnapshotBudgetDecision {
  const overWarning =
    args.promptMetrics.inputTokenEstimate > args.budget.fullRebuildWarnInputTokens;
  return {
    action: overWarning ? 'warn_allow' : 'allow',
    inputTokenEstimate: args.promptMetrics.inputTokenEstimate,
    promptByteLength: args.promptMetrics.promptByteLength,
    incrementalTargetInputTokens: args.budget.incrementalTargetInputTokens,
    incrementalHardInputTokens: args.budget.incrementalHardInputTokens,
    fullRebuildWarnInputTokens: args.budget.fullRebuildWarnInputTokens,
    optionalSupportingContextDropped: false,
    ...(overWarning
      ? {
          warningCode: 'manual_full_rebuild_prompt_over_warning_budget' as const,
          message: `Explicit manual student-memory snapshot rebuild prompt is estimated at ${args.promptMetrics.inputTokenEstimate} input tokens, above the ${args.budget.fullRebuildWarnInputTokens} warning threshold.`,
        }
      : {}),
  };
}

function buildBudgetedIncrementalSnapshotRequest(args: {
  strategy: Extract<
    StudentMemorySnapshotRefreshStrategy,
    'incremental_v1_1' | 'bootstrap_incremental_v1_1'
  >;
  parentSnapshotId: string | null;
  previousSnapshot: StudentMemorySnapshotRecord | null;
  context: {
    triggerSource: IncrementalStudentMemorySnapshotTriggerSource;
    supportingLessonMemoryEntries: LessonMemoryRecord[];
    supportingHomeworkMemoryEntries: HomeworkMemoryRecord[];
  };
  previousCoverage: {
    lessonMemoryEntryIds: string[];
    homeworkMemoryEntryIds: string[];
  };
  budget: StudentMemorySnapshotPromptBudget;
}): {
  strategy: StudentMemorySnapshotRefreshStrategy;
  parentSnapshotId: string | null;
  prompt: string;
  envelope: ReturnType<typeof buildStudentMemorySnapshotEnvelope>;
  lessonMemoryEntryIds: string[];
  homeworkMemoryEntryIds: string[];
  includedLessonMemoryEntryIds: string[];
  includedHomeworkMemoryEntryIds: string[];
  promptMetrics: StudentMemorySnapshotPromptMetrics;
  budgetDecision: StudentMemorySnapshotBudgetDecision;
  failureDetails: StudentMemorySnapshotFailureDetails | null;
} {
  const initial = buildIncrementalSnapshotRequestFromContext({
    strategy: args.strategy,
    parentSnapshotId: args.parentSnapshotId,
    previousSnapshot: args.previousSnapshot,
    triggerSource: args.context.triggerSource,
    supportingLessonMemoryEntries: args.context.supportingLessonMemoryEntries,
    supportingHomeworkMemoryEntries: args.context.supportingHomeworkMemoryEntries,
    previousCoverage: args.previousCoverage,
  });

  if (initial.promptMetrics.inputTokenEstimate <= args.budget.incrementalTargetInputTokens) {
    return {
      ...initial,
      budgetDecision: buildIncrementalSnapshotBudgetDecision({
        budget: args.budget,
        promptMetrics: initial.promptMetrics,
        optionalSupportingContextDropped: false,
      }),
      failureDetails: null,
    };
  }

  const compacted = buildIncrementalSnapshotRequestFromContext({
    strategy: args.strategy,
    parentSnapshotId: args.parentSnapshotId,
    previousSnapshot: args.previousSnapshot,
    triggerSource: args.context.triggerSource,
    supportingLessonMemoryEntries: [],
    supportingHomeworkMemoryEntries: [],
    previousCoverage: args.previousCoverage,
  });
  const overHard =
    compacted.promptMetrics.inputTokenEstimate > args.budget.incrementalHardInputTokens;
  const failureDetails = overHard
    ? buildIncrementalSnapshotBudgetFailure({
        budget: args.budget,
        promptMetrics: compacted.promptMetrics,
      })
    : null;

  return {
    ...compacted,
    budgetDecision: buildIncrementalSnapshotBudgetDecision({
      budget: args.budget,
      promptMetrics: compacted.promptMetrics,
      optionalSupportingContextDropped: true,
      initialPromptMetrics: initial.promptMetrics,
      failureDetails,
    }),
    failureDetails,
  };
}

function buildIncrementalSnapshotRequestFromContext(args: {
  strategy: Extract<
    StudentMemorySnapshotRefreshStrategy,
    'incremental_v1_1' | 'bootstrap_incremental_v1_1'
  >;
  parentSnapshotId: string | null;
  previousSnapshot: StudentMemorySnapshotRecord | null;
  triggerSource: IncrementalStudentMemorySnapshotTriggerSource;
  supportingLessonMemoryEntries: LessonMemoryRecord[];
  supportingHomeworkMemoryEntries: HomeworkMemoryRecord[];
  previousCoverage: {
    lessonMemoryEntryIds: string[];
    homeworkMemoryEntryIds: string[];
  };
}): {
  strategy: StudentMemorySnapshotRefreshStrategy;
  parentSnapshotId: string | null;
  prompt: string;
  envelope: ReturnType<typeof buildStudentMemorySnapshotEnvelope>;
  lessonMemoryEntryIds: string[];
  homeworkMemoryEntryIds: string[];
  includedLessonMemoryEntryIds: string[];
  includedHomeworkMemoryEntryIds: string[];
  promptMetrics: StudentMemorySnapshotPromptMetrics;
} {
  const prompt = buildIncrementalStudentMemorySnapshotPrompt({
    previousSnapshot: args.previousSnapshot,
    triggerSource: args.triggerSource,
    supportingLessonMemoryEntries: args.supportingLessonMemoryEntries,
    supportingHomeworkMemoryEntries: args.supportingHomeworkMemoryEntries,
  });
  const envelope = buildIncrementalStudentMemorySnapshotEnvelope({
    previousSnapshot: args.previousSnapshot,
    triggerSource: args.triggerSource,
    supportingLessonMemoryEntries: args.supportingLessonMemoryEntries,
    supportingHomeworkMemoryEntries: args.supportingHomeworkMemoryEntries,
  });
  const includedLessonMemoryEntryIds = uniqueIds([
    ...(args.triggerSource.kind === 'lesson_memory' ? [args.triggerSource.entry.id] : []),
    ...args.supportingLessonMemoryEntries.map((entry) => entry.id),
  ]);
  const includedHomeworkMemoryEntryIds = uniqueIds([
    ...(args.triggerSource.kind === 'homework_memory' ? [args.triggerSource.entry.id] : []),
    ...args.supportingHomeworkMemoryEntries.map((entry) => entry.id),
  ]);
  return {
    strategy: args.strategy,
    parentSnapshotId: args.parentSnapshotId,
    prompt,
    envelope,
    lessonMemoryEntryIds: uniqueIds([
      ...args.previousCoverage.lessonMemoryEntryIds,
      ...includedLessonMemoryEntryIds,
    ]),
    homeworkMemoryEntryIds: uniqueIds([
      ...args.previousCoverage.homeworkMemoryEntryIds,
      ...includedHomeworkMemoryEntryIds,
    ]),
    includedLessonMemoryEntryIds,
    includedHomeworkMemoryEntryIds,
    promptMetrics: estimateStudentMemorySnapshotPromptMetrics(prompt),
  };
}

function buildIncrementalSnapshotBudgetDecision(args: {
  budget: StudentMemorySnapshotPromptBudget;
  promptMetrics: StudentMemorySnapshotPromptMetrics;
  optionalSupportingContextDropped: boolean;
  initialPromptMetrics?: StudentMemorySnapshotPromptMetrics;
  failureDetails?: StudentMemorySnapshotPromptBudgetFailureDetails | null;
}): StudentMemorySnapshotBudgetDecision {
  return {
    action: args.failureDetails
      ? 'fail_before_provider'
      : args.optionalSupportingContextDropped
        ? 'drop_optional_context'
        : 'allow',
    inputTokenEstimate: args.promptMetrics.inputTokenEstimate,
    promptByteLength: args.promptMetrics.promptByteLength,
    incrementalTargetInputTokens: args.budget.incrementalTargetInputTokens,
    incrementalHardInputTokens: args.budget.incrementalHardInputTokens,
    fullRebuildWarnInputTokens: args.budget.fullRebuildWarnInputTokens,
    optionalSupportingContextDropped: args.optionalSupportingContextDropped,
    ...(args.initialPromptMetrics
      ? {
          initialInputTokenEstimate: args.initialPromptMetrics.inputTokenEstimate,
          initialPromptByteLength: args.initialPromptMetrics.promptByteLength,
        }
      : {}),
    ...(args.failureDetails
      ? {
          failureCode: args.failureDetails.code,
          message: args.failureDetails.message,
        }
      : {}),
  };
}

function buildIncrementalSnapshotBudgetFailure(args: {
  budget: StudentMemorySnapshotPromptBudget;
  promptMetrics: StudentMemorySnapshotPromptMetrics;
}): StudentMemorySnapshotPromptBudgetFailureDetails {
  return {
    code: 'incremental_prompt_input_tokens_exceeded_hard_budget',
    stage: 'snapshot_prompt_budget_preflight',
    inputTokenEstimate: args.promptMetrics.inputTokenEstimate,
    hardInputTokens: args.budget.incrementalHardInputTokens,
    targetInputTokens: args.budget.incrementalTargetInputTokens,
    message: `Student-memory snapshot incremental prompt exceeds hard input-token budget after dropping optional supporting context (estimated ${args.promptMetrics.inputTokenEstimate} input tokens, hard budget ${args.budget.incrementalHardInputTokens}).`,
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
      supportingLessonMemoryEntries: excludeEntryById(
        supportingLessonMemoryEntries,
        triggerEntry.id,
      ),
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

  return {
    lessonMemoryEntryIds: snapshot.lessonMemoryEntryIds,
    homeworkMemoryEntryIds: snapshot.homeworkMemoryEntryIds,
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
      canonicalOnly: true,
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
  if (!isFinalAttempt(args.attemptsMade, args.maxAttempts)) {
    return;
  }

  await args.snapshots.markFailed({
    id: args.payload.pendingEntryId,
    errorMessage: args.error instanceof Error ? args.error.message : String(args.error),
    generationNotes: args.generationNotes ?? undefined,
  });
}

function isFinalAttempt(attemptsMade?: number, maxAttempts?: number): boolean {
  return (attemptsMade ?? 0) + 1 >= (maxAttempts ?? 1);
}
