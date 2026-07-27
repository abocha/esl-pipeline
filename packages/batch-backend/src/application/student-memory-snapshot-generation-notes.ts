import type { StudentMemorySnapshotGenerationNotes } from '../domain/student-memory-snapshot-model.js';

export type StudentMemorySnapshotRefreshStrategy =
  | 'incremental_v1_1'
  | 'bootstrap_incremental_v1_1'
  | 'full_rebuild_v1'
  | 'manual_rebuild_v1_1';

export type StudentMemorySnapshotRefreshTrigger =
  | 'lesson-memory-ready'
  | 'homework-memory-ready'
  | 'manual-replay';

export type StudentMemorySnapshotTriggerSourceKind =
  | 'lesson_memory'
  | 'homework_memory'
  | 'manual'
  | null;

export type StudentMemorySnapshotBudgetAction =
  | 'allow'
  | 'drop_optional_context'
  | 'fail_before_provider'
  | 'warn_allow';

export interface StudentMemorySnapshotBudgetDecision {
  action: StudentMemorySnapshotBudgetAction;
  inputTokenEstimate: number;
  promptByteLength: number;
  incrementalTargetInputTokens: number;
  incrementalHardInputTokens: number;
  fullRebuildWarnInputTokens: number;
  optionalSupportingContextDropped: boolean;
  initialInputTokenEstimate?: number;
  initialPromptByteLength?: number;
  failureCode?: 'incremental_prompt_input_tokens_exceeded_hard_budget';
  warningCode?: 'manual_full_rebuild_prompt_over_warning_budget';
  message?: string;
}

export type StudentMemorySnapshotFailureDetails =
  | StudentMemorySnapshotPromptBudgetFailureDetails
  | StudentMemorySnapshotParentChangedFailureDetails
  | StudentMemorySnapshotSourcesChangedFailureDetails;

export interface StudentMemorySnapshotPromptBudgetFailureDetails {
  code: 'incremental_prompt_input_tokens_exceeded_hard_budget';
  stage: 'snapshot_prompt_budget_preflight';
  message: string;
  inputTokenEstimate: number;
  hardInputTokens: number;
  targetInputTokens: number;
}

export interface StudentMemorySnapshotParentChangedFailureDetails {
  code: 'student_memory_snapshot_parent_changed_before_finalize';
  stage: 'snapshot_ready_finalization';
  message: string;
  expectedLatestReadySnapshotId: string | null;
  actualLatestReadySnapshotId: string | null;
}

export interface StudentMemorySnapshotSourcesChangedFailureDetails {
  code: 'student_memory_snapshot_sources_changed_before_finalize';
  stage: 'snapshot_ready_finalization';
  message: string;
  unavailableLessonMemoryEntryIds: string[];
}

export interface StudentMemorySnapshotCandidateRefreshDecision {
  requested: boolean;
  enqueueStatus: StudentMemorySnapshotCandidateRefreshEnqueueStatus;
  reasons: (
    | 'trigger_profile_worthy_student_fact'
    | 'personal_facts_hash_changed'
    | 'durable_preferences_constraints_changed'
    | 'manual_replay_requested_candidate_refresh'
  )[];
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

export type StudentMemorySnapshotCandidateRefreshEnqueueStatus =
  | 'not_requested'
  | 'pending'
  | 'enqueued'
  | 'failed';

export type StudentMemorySnapshotV11GenerationNotes = StudentMemorySnapshotGenerationNotes & {
  strategy: StudentMemorySnapshotRefreshStrategy;
  trigger: StudentMemorySnapshotRefreshTrigger;
  sourceEntryId: string | null;
  triggerSourceKind: StudentMemorySnapshotTriggerSourceKind;
  triggerSourceEntryId: string | null;
  parentSnapshotId: string | null;
  includedLessonMemoryEntryIds: string[];
  includedHomeworkMemoryEntryIds: string[];
  coveredLessonMemoryEntryIds: string[];
  coveredHomeworkMemoryEntryIds: string[];
  includedLessonMemoryCount: number;
  includedHomeworkMemoryCount: number;
  coveredLessonMemoryCount: number;
  coveredHomeworkMemoryCount: number;
  inputTokenEstimate: number;
  promptByteLength: number;
  materialChange: boolean | null;
  budgetDecision?: StudentMemorySnapshotBudgetDecision;
  failureDetails?: StudentMemorySnapshotFailureDetails;
  candidateRefresh?: StudentMemorySnapshotCandidateRefreshDecision;
};

export interface BuildStudentMemorySnapshotGenerationNotesParams {
  existingNotes?: StudentMemorySnapshotGenerationNotes | null;
  strategy: StudentMemorySnapshotRefreshStrategy;
  trigger: StudentMemorySnapshotRefreshTrigger;
  triggerSourceKind: StudentMemorySnapshotTriggerSourceKind;
  triggerSourceEntryId: string | null;
  parentSnapshotId?: string | null;
  includedLessonMemoryEntryIds: string[];
  includedHomeworkMemoryEntryIds: string[];
  coveredLessonMemoryEntryIds: string[];
  coveredHomeworkMemoryEntryIds: string[];
  inputTokenEstimate: number;
  promptByteLength: number;
  materialChange: boolean | null;
  budgetDecision?: StudentMemorySnapshotBudgetDecision | null;
  failureDetails?: StudentMemorySnapshotFailureDetails | null;
}

export function buildStudentMemorySnapshotGenerationNotes(
  params: BuildStudentMemorySnapshotGenerationNotesParams,
): StudentMemorySnapshotV11GenerationNotes {
  return {
    ...(params.existingNotes ?? {}),
    strategy: params.strategy,
    trigger: params.trigger,
    sourceEntryId: params.triggerSourceEntryId,
    triggerSourceKind: params.triggerSourceKind,
    triggerSourceEntryId: params.triggerSourceEntryId,
    parentSnapshotId: params.parentSnapshotId ?? null,
    includedLessonMemoryEntryIds: params.includedLessonMemoryEntryIds,
    includedHomeworkMemoryEntryIds: params.includedHomeworkMemoryEntryIds,
    coveredLessonMemoryEntryIds: params.coveredLessonMemoryEntryIds,
    coveredHomeworkMemoryEntryIds: params.coveredHomeworkMemoryEntryIds,
    includedLessonMemoryCount: params.includedLessonMemoryEntryIds.length,
    includedHomeworkMemoryCount: params.includedHomeworkMemoryEntryIds.length,
    coveredLessonMemoryCount: params.coveredLessonMemoryEntryIds.length,
    coveredHomeworkMemoryCount: params.coveredHomeworkMemoryEntryIds.length,
    inputTokenEstimate: params.inputTokenEstimate,
    promptByteLength: params.promptByteLength,
    materialChange: params.materialChange,
    ...(params.budgetDecision ? { budgetDecision: params.budgetDecision } : {}),
    ...(params.failureDetails ? { failureDetails: params.failureDetails } : {}),
  };
}

export function resolveStudentMemorySnapshotTriggerSourceKind(
  trigger: StudentMemorySnapshotRefreshTrigger,
): StudentMemorySnapshotTriggerSourceKind {
  if (trigger === 'lesson-memory-ready') {
    return 'lesson_memory';
  }
  if (trigger === 'homework-memory-ready') {
    return 'homework_memory';
  }
  return 'manual';
}
