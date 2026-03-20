import type { LessonMemoryRecord } from '../domain/lesson-memory-model.js';
import type { HomeworkMemoryRecord } from '../domain/homework-memory-model.js';

export interface BuildStudentMemorySnapshotPromptParams {
  lessonMemoryEntries: LessonMemoryRecord[];
  homeworkMemoryEntries: HomeworkMemoryRecord[];
}

export function buildStudentMemorySnapshotPrompt(
  params: BuildStudentMemorySnapshotPromptParams,
): string {
  const lessonPayload = params.lessonMemoryEntries.map((entry) => ({
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
  }));
  const homeworkPayload = params.homeworkMemoryEntries.map((entry) => ({
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
  }));

  return [
    'You are generating a canonical long-term student-memory snapshot for ESL homework generation.',
    'Treat lesson-memory entries and homework-memory entries as co-equal canonical history sources.',
    'Use lesson memory for observed performance and use homework memory for assigned practice, review loops, task continuity, and teacher follow-up intent.',
    'Surface stable strengths, recurring issues, active review backlog, recent progress, personal facts, recommended assignment directions, and unresolved issues.',
    'Be selective and confidence-aware. Preserve authority and confidence for personal facts.',
    '',
    '[LESSON_MEMORY_ENTRIES]',
    JSON.stringify(lessonPayload, null, 2),
    '',
    '[HOMEWORK_MEMORY_ENTRIES]',
    JSON.stringify(homeworkPayload, null, 2),
  ].join('\n');
}
