import type { HomeworkMemoryRecord } from '../domain/homework-memory-model.js';
import type {
  FactEvidence,
  LessonMemoryRecord,
  StudentFact,
} from '../domain/lesson-memory-model.js';
import type { StudentMemorySnapshotRecord } from '../domain/student-memory-snapshot-model.js';
import { createGenerationRequestEnvelope } from './generation-request-envelope.js';
import {
  STUDENT_MEMORY_SNAPSHOT_CONTENT_JSON_SCHEMA,
  STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_DESCRIPTION,
  STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_NAME,
} from './student-memory-snapshot-content-schema.js';

export interface BuildStudentMemorySnapshotPromptParams {
  lessonMemoryEntries: LessonMemoryRecord[];
  homeworkMemoryEntries: HomeworkMemoryRecord[];
}

export type IncrementalStudentMemorySnapshotTriggerSource =
  | {
      kind: 'lesson_memory';
      entry: LessonMemoryRecord;
    }
  | {
      kind: 'homework_memory';
      entry: HomeworkMemoryRecord;
    };

export interface BuildIncrementalStudentMemorySnapshotPromptParams {
  previousSnapshot: StudentMemorySnapshotRecord | null;
  triggerSource: IncrementalStudentMemorySnapshotTriggerSource;
  supportingLessonMemoryEntries: LessonMemoryRecord[];
  supportingHomeworkMemoryEntries: HomeworkMemoryRecord[];
}

export function buildStudentMemorySnapshotEnvelope(params: BuildStudentMemorySnapshotPromptParams) {
  const sources = [
    ...params.lessonMemoryEntries.map((entry) => ({
      id: `lesson-memory:${entry.id}`,
      label: 'LESSON_MEMORY_ENTRY',
      content: JSON.stringify(entry),
    })),
    ...params.homeworkMemoryEntries.map((entry) => ({
      id: `homework-memory:${entry.id}`,
      label: 'HOMEWORK_MEMORY_ENTRY',
      content: JSON.stringify(entry),
    })),
  ];
  return createGenerationRequestEnvelope({
    workload: 'student_memory_snapshot',
    promptVersion: 'learner_memory_generation_v2',
    instructions: [
      'You are generating a canonical long-term student-memory snapshot for ESL homework generation.',
      'Treat lesson-memory and homework-memory entries as co-equal canonical history sources.',
      'Use lesson memory for observed performance and use homework memory for assigned practice, review loops, task continuity, and teacher follow-up intent.',
      'Surface stable strengths, recurring issues, active review backlog, recent progress, personal facts, recommended assignment directions, and unresolved issues.',
      'Be selective and confidence-aware. Preserve authority and confidence for personal facts.',
      'Be selective and confidence-aware; omit unsupported claims.',
      'Every personal-fact evidence item must cite a sourceId from the source manifest and preserve a short excerpt.',
    ].join('\n'),
    sources,
    responseSchema: {
      name: STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_NAME,
      description: STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_DESCRIPTION,
      schema: STUDENT_MEMORY_SNAPSHOT_CONTENT_JSON_SCHEMA,
      strict: true,
    },
  });
}

export function buildIncrementalStudentMemorySnapshotEnvelope(
  params: BuildIncrementalStudentMemorySnapshotPromptParams,
) {
  const sources = [
    ...(params.previousSnapshot
      ? [
          {
            id: `student-memory-snapshot:${params.previousSnapshot.id}`,
            label: 'PREVIOUS_STUDENT_MEMORY_SNAPSHOT',
            content: JSON.stringify(buildPreviousSnapshotPayload(params.previousSnapshot)),
          },
        ]
      : []),
    {
      id:
        params.triggerSource.kind === 'lesson_memory'
          ? `lesson-memory:${params.triggerSource.entry.id}`
          : `homework-memory:${params.triggerSource.entry.id}`,
      label:
        params.triggerSource.kind === 'lesson_memory'
          ? 'TRIGGER_LESSON_MEMORY_ENTRY'
          : 'TRIGGER_HOMEWORK_MEMORY_ENTRY',
      content: JSON.stringify(buildTriggerSourcePayload(params.triggerSource)),
    },
    ...params.supportingLessonMemoryEntries.map((entry) => ({
      id: `lesson-memory:${entry.id}`,
      label: 'SUPPORTING_LESSON_MEMORY_ENTRY',
      content: JSON.stringify(buildLessonMemoryPayload(entry)),
    })),
    ...params.supportingHomeworkMemoryEntries.map((entry) => ({
      id: `homework-memory:${entry.id}`,
      label: 'SUPPORTING_HOMEWORK_MEMORY_ENTRY',
      content: JSON.stringify(buildHomeworkMemoryPayload(entry)),
    })),
  ];
  return createGenerationRequestEnvelope({
    workload: 'student_memory_snapshot',
    promptVersion: 'learner_memory_generation_v2',
    instructions: [
      'You are updating a canonical long-term student-memory snapshot for ESL homework generation.',
      'Use previous snapshot state, one new canonical trigger source, and bounded supporting context.',
      'Do not rebuild from full history. Use the previous snapshot as durable state, incorporate the new canonical source, and use supporting context only to avoid local contradictions or duplicate backlog items.',
      'Preserve still-valid long-term facts from the previous snapshot. Remove or de-emphasize stale items only when the new evidence clearly contradicts them.',
      'Do not invent facts. Do not duplicate semantically identical items. Keep the snapshot compact and useful for homework generation.',
      'Be selective and confidence-aware; omit unsupported claims.',
      'When preserving prior personal facts, cite the previous snapshot source unless the trigger or supporting sources provide newer evidence.',
      'Every personal-fact evidence item must cite a sourceId from the source manifest and preserve a short excerpt.',
    ].join('\n'),
    sources,
    responseSchema: {
      name: STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_NAME,
      description: STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_DESCRIPTION,
      schema: STUDENT_MEMORY_SNAPSHOT_CONTENT_JSON_SCHEMA,
      strict: true,
    },
  });
}

function buildPreviousSnapshotPayload(snapshot: StudentMemorySnapshotRecord | null) {
  if (!snapshot) {
    return null;
  }
  return {
    id: snapshot.id,
    generatedAt: snapshot.generatedAt.toISOString(),
    snapshotSummary: snapshot.snapshotSummary ?? null,
    stableStrengths: snapshot.stableStrengths,
    recurringIssues: snapshot.recurringIssues,
    activeReviewBacklog: snapshot.activeReviewBacklog,
    recentProgress: snapshot.recentProgress,
    personalFacts: normalizePreviousSnapshotPersonalFacts(snapshot),
    recommendedAssignmentDirections: snapshot.recommendedAssignmentDirections,
    unresolvedIssues: snapshot.unresolvedIssues,
    contentHash: snapshot.contentHash ?? null,
  };
}

function normalizePreviousSnapshotPersonalFacts(
  snapshot: StudentMemorySnapshotRecord,
): StudentFact[] {
  const previousSnapshotSourceId = `student-memory-snapshot:${snapshot.id}`;
  return snapshot.personalFacts.map((fact) => ({
    ...fact,
    evidence: fact.evidence.map((evidence) =>
      normalizePreviousSnapshotEvidence(evidence, previousSnapshotSourceId),
    ),
  }));
}

function normalizePreviousSnapshotEvidence(
  evidence: FactEvidence,
  previousSnapshotSourceId: string,
): FactEvidence {
  const originalSourceId = evidence.sourceId?.trim() || null;
  const shouldPreserveOriginalSource =
    originalSourceId !== null && originalSourceId !== previousSnapshotSourceId;
  return {
    ...evidence,
    sourceId: previousSnapshotSourceId,
    evidenceNote: shouldPreserveOriginalSource
      ? appendEvidenceNote(evidence.evidenceNote, `Original sourceId: ${originalSourceId}`)
      : evidence.evidenceNote,
  };
}

function appendEvidenceNote(existing: string | null | undefined, addition: string): string {
  const normalized = existing?.trim();
  return normalized ? `${normalized} ${addition}` : addition;
}

function buildTriggerSourcePayload(source: IncrementalStudentMemorySnapshotTriggerSource) {
  return {
    kind: source.kind,
    ...(source.kind === 'lesson_memory'
      ? { lessonMemory: buildLessonMemoryPayload(source.entry) }
      : { homeworkMemory: buildHomeworkMemoryPayload(source.entry) }),
  };
}

function buildLessonMemoryPayload(entry: LessonMemoryRecord) {
  return {
    id: entry.id,
    generatedAt: entry.generatedAt.toISOString(),
    lessonSummary: entry.lessonSummary ?? null,
    topicsDiscussed: entry.topicsDiscussed,
    mistakePatterns: entry.mistakePatterns,
    grammarReviewed: entry.grammarReviewed,
    grammarWatchlist: entry.grammarWatchlist,
    vocabularyFocus: entry.vocabularyFocus,
    pronunciationFocus: entry.pronunciationFocus,
    studentFacts: entry.studentFacts,
    progressSignals: entry.progressSignals,
    followUpRecommendations: entry.followUpRecommendations,
  };
}

function buildHomeworkMemoryPayload(entry: HomeworkMemoryRecord) {
  return {
    id: entry.id,
    generatedAt: entry.generatedAt.toISOString(),
    homeworkSummary: entry.homeworkSummary ?? null,
    topic: entry.topic ?? null,
    grammarTargets: entry.grammarTargets,
    vocabularyTargets: entry.vocabularyTargets,
    reviewTargets: entry.reviewTargets,
    taskList: entry.taskList,
    pronunciationFocus: entry.pronunciationFocus,
    studyTextType: entry.studyTextType ?? null,
    inputType: entry.inputType ?? null,
    communicativeOutcome: entry.communicativeOutcome ?? null,
    teacherFollowUpCues: entry.teacherFollowUpCues,
  };
}
