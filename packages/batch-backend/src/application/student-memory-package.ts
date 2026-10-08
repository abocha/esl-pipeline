import type { StudentMemoryAvailability } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { HomeworkMemoryRecord } from '../domain/homework-memory-model.js';
import { listRecentReadyHomeworkMemoryByStudentId } from '../domain/homework-memory-repository.js';
import type { LessonMemoryRecord } from '../domain/lesson-memory-model.js';
import { listRecentReadyLessonMemoryByStudentId } from '../domain/lesson-memory-repository.js';
import type { StudentMemorySnapshotRecord } from '../domain/student-memory-snapshot-model.js';
import {
  describeStudentMemoryAvailability,
  loadStudentMemorySelection,
} from './student-memory-availability.js';

export interface StudentMemoryPackageContext {
  availability?: StudentMemoryAvailability;
  studentMemorySnapshotBlock: string;
  recentLessonMemoryBlock: string;
  recentHomeworkMemoryBlock: string;
  unresolvedIssuesBlock: string;
  studentMemorySnapshotId: string | null;
  studentMemorySnapshotHash: string | null;
  selectedLessonMemoryIds: string[];
  selectedHomeworkMemoryIds: string[];
  retrievalPolicyVersion: string | null;
  source: 'canonical' | 'unavailable' | 'none';
}

type StudentMemoryRetrievalResult<T> = { value: T; error: null } | { value: T; error: unknown };

export async function buildStudentMemoryPackageContext(args: {
  studentId: string | null;
  currentTranscriptId: string;
  config?: BatchBackendConfig;
}): Promise<StudentMemoryPackageContext> {
  if (!args.studentId) {
    return {
      studentMemorySnapshotBlock:
        'Not applicable for this prompt package because no student is bound to the recording.',
      recentLessonMemoryBlock:
        'Not applicable for this prompt package because no student is bound to the recording.',
      recentHomeworkMemoryBlock:
        'Not applicable for this prompt package because no student is bound to the recording.',
      unresolvedIssuesBlock:
        'Not applicable for this prompt package because no student is bound to the recording.',
      studentMemorySnapshotId: null,
      studentMemorySnapshotHash: null,
      selectedLessonMemoryIds: [],
      selectedHomeworkMemoryIds: [],
      retrievalPolicyVersion: null,
      source: 'none',
    };
  }

  const pgEnabled = Boolean(
    (args.config as { pg?: { enabled?: boolean } } | undefined)?.pg?.enabled,
  );
  if (!pgEnabled) {
    return {
      studentMemorySnapshotBlock:
        'Not available for this prompt package because canonical student-memory retrieval is disabled.',
      recentLessonMemoryBlock:
        'Not available for this prompt package because canonical student-memory retrieval is disabled.',
      recentHomeworkMemoryBlock:
        'Not available for this prompt package because canonical student-memory retrieval is disabled.',
      unresolvedIssuesBlock:
        'Not available for this prompt package because canonical student-memory retrieval is disabled.',
      studentMemorySnapshotId: null,
      studentMemorySnapshotHash: null,
      selectedLessonMemoryIds: [],
      selectedHomeworkMemoryIds: [],
      retrievalPolicyVersion: null,
      source: 'none',
    };
  }

  const studentId = args.studentId;
  const [snapshotResult, recentLessonsResult, recentHomeworkResult] = await Promise.all([
    loadStudentMemorySelection(studentId),
    captureStudentMemoryRetrieval(
      () =>
        listRecentReadyLessonMemoryByStudentId(studentId, {
          excludeTranscriptId: args.currentTranscriptId,
          limit: 3,
        }),
      [] as LessonMemoryRecord[],
    ),
    captureStudentMemoryRetrieval(
      () =>
        listRecentReadyHomeworkMemoryByStudentId(studentId, {
          limit: 2,
        }),
      [] as HomeworkMemoryRecord[],
    ),
  ]);
  const snapshot = snapshotResult.snapshot;
  const availability = snapshotResult.availability;
  const recentLessons = recentLessonsResult.value;
  const recentHomework = recentHomeworkResult.value;
  const retrievalUnavailable =
    availability.state === 'repository_unavailable' ||
    Boolean(recentLessonsResult.error) ||
    Boolean(recentHomeworkResult.error);

  if (
    snapshot ||
    recentLessons.length > 0 ||
    recentHomework.length > 0 ||
    retrievalUnavailable ||
    availability.state === 'repair_required'
  ) {
    return {
      ...formatStudentMemoryPackageContext({
        snapshot,
        recentLessons,
        recentHomework,
        availability,
        recentLessonsRetrievalError: recentLessonsResult.error,
        recentHomeworkRetrievalError: recentHomeworkResult.error,
      }),
      availability,
      studentMemorySnapshotId: snapshot?.id ?? null,
      studentMemorySnapshotHash: snapshot?.contentHash ?? null,
      selectedLessonMemoryIds: recentLessons.map((entry) => entry.id),
      selectedHomeworkMemoryIds: recentHomework.map((entry) => entry.id),
      retrievalPolicyVersion: 'student-memory-v1',
      source:
        snapshot || recentLessons.length > 0 || recentHomework.length > 0
          ? 'canonical'
          : 'unavailable',
    };
  }

  return {
    availability,
    studentMemorySnapshotBlock: describeStudentMemoryAvailability(availability),
    recentLessonMemoryBlock: 'No recent lesson-memory entries available for retrieval.',
    recentHomeworkMemoryBlock: 'No recent homework-memory entries available for retrieval.',
    unresolvedIssuesBlock:
      'No unresolved issues available because no student-memory snapshot is available yet.',
    studentMemorySnapshotId: null,
    studentMemorySnapshotHash: null,
    selectedLessonMemoryIds: [],
    selectedHomeworkMemoryIds: [],
    retrievalPolicyVersion: null,
    source: 'none',
  };
}

async function captureStudentMemoryRetrieval<T>(
  load: () => Promise<T>,
  fallback: T,
): Promise<StudentMemoryRetrievalResult<T>> {
  try {
    return {
      value: await load(),
      error: null,
    };
  } catch (error) {
    return {
      value: fallback,
      error,
    };
  }
}

function formatStudentMemoryPackageContext(args: {
  availability: StudentMemoryAvailability;
  snapshot: StudentMemorySnapshotRecord | null;
  recentLessons: LessonMemoryRecord[];
  recentHomework: HomeworkMemoryRecord[];
  recentLessonsRetrievalError?: unknown;
  recentHomeworkRetrievalError?: unknown;
}): Pick<
  StudentMemoryPackageContext,
  | 'studentMemorySnapshotBlock'
  | 'recentLessonMemoryBlock'
  | 'recentHomeworkMemoryBlock'
  | 'unresolvedIssuesBlock'
> {
  return {
    studentMemorySnapshotBlock: !args.snapshot
      ? describeStudentMemoryAvailability(args.availability)
      : formatStudentMemorySnapshotBlock(args.snapshot),
    recentLessonMemoryBlock: args.recentLessonsRetrievalError
      ? formatRetrievalUnavailableBlock('Recent lesson memory')
      : args.recentLessons.length > 0
        ? args.recentLessons.flatMap((entry) => formatLessonMemoryEntry(entry)).join('\n')
        : 'No recent lesson-memory entries available for retrieval.',
    recentHomeworkMemoryBlock: args.recentHomeworkRetrievalError
      ? formatRetrievalUnavailableBlock('Recent homework memory')
      : args.recentHomework.length > 0
        ? args.recentHomework.flatMap((entry) => formatHomeworkMemoryEntry(entry)).join('\n')
        : 'No recent homework-memory entries available for retrieval.',
    unresolvedIssuesBlock:
      !args.snapshot && args.availability.state !== 'absent'
        ? describeStudentMemoryAvailability(args.availability)
        : formatUnresolvedIssuesBlock(args.snapshot),
  };
}

function formatRetrievalUnavailableBlock(label: string): string {
  return `${label} retrieval was unavailable while building this prompt package. Treat this memory layer as unknown, not empty. Inspect backend logs for repository error details.`;
}

function formatStudentMemorySnapshotBlock(snapshot: StudentMemorySnapshotRecord | null): string {
  if (!snapshot) {
    return 'No long-term student-memory snapshot available yet.';
  }

  const lines = [
    snapshot.snapshotSummary?.trim() || 'Long-term student-memory snapshot available.',
  ];
  appendLabeledSummary(
    lines,
    'Stable strengths',
    snapshot.stableStrengths.map((item) => item.label),
    3,
  );
  appendLabeledSummary(
    lines,
    'Recurring issues',
    snapshot.recurringIssues.map((item) => item.label),
    3,
  );
  appendLabeledSummary(
    lines,
    'Active review backlog',
    snapshot.activeReviewBacklog.map((item) => item.label),
    3,
  );
  appendLabeledSummary(
    lines,
    'Recent progress',
    snapshot.recentProgress.map((item) => item.label),
    3,
  );
  appendLabeledSummary(
    lines,
    'Recommended assignment directions',
    snapshot.recommendedAssignmentDirections.map((item) => item.direction),
    3,
  );
  appendLabeledSummary(
    lines,
    'Personal facts',
    snapshot.personalFacts.map((item) => item.fact),
    3,
  );
  return lines.join('\n');
}

function formatUnresolvedIssuesBlock(snapshot: StudentMemorySnapshotRecord | null): string {
  if (!snapshot) {
    return 'No unresolved issues available because no student-memory snapshot is available yet.';
  }

  if (snapshot.unresolvedIssues.length === 0) {
    return 'No unresolved issues recorded in the current student-memory snapshot.';
  }

  return snapshot.unresolvedIssues
    .map((issue) => `- (${issue.priority}) ${issue.label}: ${issue.note}`)
    .join('\n');
}

function formatLessonMemoryEntry(entry: LessonMemoryRecord): string[] {
  const lines: string[] = [];
  const summary =
    typeof entry.lessonSummary === 'string' && entry.lessonSummary.trim().length > 0
      ? entry.lessonSummary.trim()
      : 'Lesson memory available.';

  lines.push(`- ${entry.generatedAt.toISOString()}: ${summary}`);

  const topics = summarizeValues(
    entry.topicsDiscussed.map((item) => item.topic),
    3,
  );
  if (topics) {
    lines.push(`  Topics: ${topics}`);
  }

  const grammar = summarizeValues(
    entry.grammarWatchlist.map((item) => item.name),
    3,
  );
  if (grammar) {
    lines.push(`  Grammar watchlist: ${grammar}`);
  }

  const vocabulary = summarizeValues(
    entry.vocabularyFocus.map((item) => item.text),
    3,
  );
  if (vocabulary) {
    lines.push(`  Vocabulary focus: ${vocabulary}`);
  }

  const pronunciation = summarizeValues(
    entry.pronunciationFocus.map((item) => item.label),
    2,
  );
  if (pronunciation) {
    lines.push(`  Pronunciation: ${pronunciation}`);
  }

  const followUp = summarizeValues(
    entry.followUpRecommendations.map((item) => item.label),
    2,
  );
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

  const grammarTargets = summarizeValues(
    entry.grammarTargets.map((item) => item.name),
    3,
  );
  if (grammarTargets) {
    lines.push(`  Grammar targets: ${grammarTargets}`);
  }

  const reviewTargets = summarizeValues(
    entry.reviewTargets.map((item) => item.label),
    3,
  );
  if (reviewTargets) {
    lines.push(`  Review targets: ${reviewTargets}`);
  }

  const taskTypes = summarizeValues(
    entry.taskList.map((item) => item.taskType),
    3,
  );
  if (taskTypes) {
    lines.push(`  Task types: ${taskTypes}`);
  }

  const pronunciation = summarizeValues(
    entry.pronunciationFocus.map((item) => item.target),
    2,
  );
  if (pronunciation) {
    lines.push(`  Pronunciation: ${pronunciation}`);
  }

  const followUp = summarizeValues(
    entry.teacherFollowUpCues.map((item) => item.note),
    2,
  );
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

function appendLabeledSummary(
  lines: string[],
  label: string,
  values: string[],
  limit: number,
): void {
  const summary = summarizeValues(values, limit);
  if (!summary) {
    return;
  }

  lines.push(`${label}: ${summary}`);
}
