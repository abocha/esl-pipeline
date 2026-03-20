import type { BatchBackendConfig } from '../config/env.js';
import type { HomeworkMemoryRecord } from '../domain/homework-memory-model.js';
import { listRecentReadyHomeworkMemoryByStudentId } from '../domain/homework-memory-repository.js';
import type { LessonMemoryRecord } from '../domain/lesson-memory-model.js';
import { listRecentReadyLessonMemoryByStudentId } from '../domain/lesson-memory-repository.js';
import { getLatestReadyStudentMemorySnapshotByStudentId } from '../domain/student-memory-snapshot-repository.js';
import type { StudentMemorySnapshotRecord } from '../domain/student-memory-snapshot-model.js';
import {
  buildStudentLessonHistoryPackageContext,
  type StudentLessonHistoryPackageContext,
} from './student-lesson-history.js';

export interface StudentMemoryPackageContext {
  text: string | null;
  studentMemorySnapshotId: string | null;
  studentMemorySnapshotHash: string | null;
  selectedLessonMemoryIds: string[];
  selectedHomeworkMemoryIds: string[];
  retrievalPolicyVersion: string | null;
  source: 'canonical' | 'legacy' | 'none';
}

export async function buildStudentMemoryPackageContext(args: {
  studentId: string | null;
  currentTranscriptId: string;
  config?: BatchBackendConfig;
}): Promise<StudentMemoryPackageContext> {
  if (!args.studentId) {
    return {
      text: null,
      studentMemorySnapshotId: null,
      studentMemorySnapshotHash: null,
      selectedLessonMemoryIds: [],
      selectedHomeworkMemoryIds: [],
      retrievalPolicyVersion: null,
      source: 'none',
    };
  }

  const pgEnabled = Boolean((args.config as { pg?: { enabled?: boolean } } | undefined)?.pg?.enabled);
  if (!pgEnabled) {
    return {
      text: null,
      studentMemorySnapshotId: null,
      studentMemorySnapshotHash: null,
      selectedLessonMemoryIds: [],
      selectedHomeworkMemoryIds: [],
      retrievalPolicyVersion: null,
      source: 'none',
    };
  }

  const snapshot = await getLatestReadyStudentMemorySnapshotByStudentId(args.studentId).catch(
    () => null,
  );
  const recentLessons = await listRecentReadyLessonMemoryByStudentId(args.studentId, {
    excludeTranscriptId: args.currentTranscriptId,
    limit: 3,
  }).catch(() => [] as LessonMemoryRecord[]);
  const recentHomework = await listRecentReadyHomeworkMemoryByStudentId(args.studentId, {
    limit: 2,
  }).catch(() => [] as HomeworkMemoryRecord[]);

  if (snapshot || recentLessons.length > 0 || recentHomework.length > 0) {
    return {
      text: formatStudentMemoryPackageContext({
        snapshot,
        recentLessons,
        recentHomework,
      }),
      studentMemorySnapshotId: snapshot?.id ?? null,
      studentMemorySnapshotHash: snapshot?.contentHash ?? null,
      selectedLessonMemoryIds: recentLessons.map((entry) => entry.id),
      selectedHomeworkMemoryIds: recentHomework.map((entry) => entry.id),
      retrievalPolicyVersion: 'student-memory-v1',
      source: 'canonical',
    };
  }

  const legacy = await buildStudentLessonHistoryPackageContext({
    studentId: args.studentId,
    currentTranscriptId: args.currentTranscriptId,
    config: args.config,
  });

  return {
    text: legacy.text,
    studentMemorySnapshotId: null,
    studentMemorySnapshotHash: null,
    selectedLessonMemoryIds: legacy.selectedLessonMemoryIds,
    selectedHomeworkMemoryIds: [],
    retrievalPolicyVersion: null,
    source: legacy.source === 'legacy' ? 'legacy' : 'none',
  };
}

function formatStudentMemoryPackageContext(args: {
  snapshot: StudentMemorySnapshotRecord | null;
  recentLessons: LessonMemoryRecord[];
  recentHomework: HomeworkMemoryRecord[];
}): string {
  const parts: string[] = [];

  if (args.snapshot) {
    parts.push(
      '[STUDENT_MEMORY_SNAPSHOT]',
      args.snapshot.snapshotSummary ?? 'Student-memory snapshot available.',
    );

    if (args.snapshot.unresolvedIssues.length > 0) {
      parts.push(
        '',
        '[UNRESOLVED_ISSUES]',
        ...args.snapshot.unresolvedIssues.map(
          (issue) => `- (${issue.priority}) ${issue.label}: ${issue.note}`,
        ),
      );
    }
  } else {
    parts.push('[STUDENT_MEMORY_SNAPSHOT]', 'No long-term student-memory snapshot available yet.');
  }

  if (args.recentLessons.length > 0) {
    parts.push(
      '',
      '[RECENT_LESSON_MEMORY]',
      ...args.recentLessons.flatMap((entry) => formatLessonMemoryEntry(entry)),
    );
  }

  if (args.recentHomework.length > 0) {
    parts.push(
      '',
      '[RECENT_HOMEWORK_MEMORY]',
      ...args.recentHomework.flatMap((entry) => formatHomeworkMemoryEntry(entry)),
    );
  }

  return parts.join('\n');
}

function formatLessonMemoryEntry(entry: LessonMemoryRecord): string[] {
  const lines: string[] = [];
  const summary =
    typeof entry.lessonSummary === 'string' && entry.lessonSummary.trim().length > 0
      ? entry.lessonSummary.trim()
      : 'Lesson memory available.';

  lines.push(`- ${entry.generatedAt.toISOString()}: ${summary}`);

  const topics = summarizeValues(entry.topicsDiscussed.map((item) => item.topic), 3);
  if (topics) {
    lines.push(`  Topics: ${topics}`);
  }

  const grammar = summarizeValues(entry.grammarWatchlist.map((item) => item.name), 3);
  if (grammar) {
    lines.push(`  Grammar watchlist: ${grammar}`);
  }

  const vocabulary = summarizeValues(entry.vocabularyFocus.map((item) => item.text), 3);
  if (vocabulary) {
    lines.push(`  Vocabulary focus: ${vocabulary}`);
  }

  const pronunciation = summarizeValues(entry.pronunciationFocus.map((item) => item.label), 2);
  if (pronunciation) {
    lines.push(`  Pronunciation: ${pronunciation}`);
  }

  const followUp = summarizeValues(entry.followUpRecommendations.map((item) => item.label), 2);
  if (followUp) {
    lines.push(`  Follow-up: ${followUp}`);
  }

  return lines;
}

function formatHomeworkMemoryEntry(entry: HomeworkMemoryRecord): string[] {
  const lines: string[] = [];
  const summary =
    typeof entry.homeworkSummary === 'string' && entry.homeworkSummary.trim().length > 0
      ? entry.homeworkSummary.trim()
      : 'Homework memory available.';

  lines.push(`- ${entry.generatedAt.toISOString()}: ${summary}`);

  if (entry.topic?.trim()) {
    lines.push(`  Topic: ${entry.topic.trim()}`);
  }

  const grammarTargets = summarizeValues(entry.grammarTargets.map((item) => item.name), 3);
  if (grammarTargets) {
    lines.push(`  Grammar targets: ${grammarTargets}`);
  }

  const reviewTargets = summarizeValues(entry.reviewTargets.map((item) => item.label), 3);
  if (reviewTargets) {
    lines.push(`  Review targets: ${reviewTargets}`);
  }

  const taskTypes = summarizeValues(entry.taskList.map((item) => item.taskType), 3);
  if (taskTypes) {
    lines.push(`  Task types: ${taskTypes}`);
  }

  const pronunciation = summarizeValues(entry.pronunciationFocus.map((item) => item.target), 2);
  if (pronunciation) {
    lines.push(`  Pronunciation: ${pronunciation}`);
  }

  const followUp = summarizeValues(entry.teacherFollowUpCues.map((item) => item.note), 2);
  if (followUp) {
    lines.push(`  Teacher follow-up: ${followUp}`);
  }

  return lines;
}

function summarizeValues(values: string[], limit: number): string | null {
  const normalized = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, limit);

  if (normalized.length === 0) {
    return null;
  }

  return normalized.join('; ');
}
