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

export type StudentMemorySnapshotV11GenerationNotes = StudentMemorySnapshotGenerationNotes & {
  strategy: StudentMemorySnapshotRefreshStrategy;
  trigger: StudentMemorySnapshotRefreshTrigger;
  sourceEntryId: string | null;
  triggerSourceKind: StudentMemorySnapshotTriggerSourceKind;
  triggerSourceEntryId: string | null;
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
};

export interface BuildStudentMemorySnapshotGenerationNotesParams {
  existingNotes?: StudentMemorySnapshotGenerationNotes | null;
  strategy: StudentMemorySnapshotRefreshStrategy;
  trigger: StudentMemorySnapshotRefreshTrigger;
  triggerSourceKind: StudentMemorySnapshotTriggerSourceKind;
  triggerSourceEntryId: string | null;
  includedLessonMemoryEntryIds: string[];
  includedHomeworkMemoryEntryIds: string[];
  coveredLessonMemoryEntryIds: string[];
  coveredHomeworkMemoryEntryIds: string[];
  inputTokenEstimate: number;
  promptByteLength: number;
  materialChange: boolean | null;
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
