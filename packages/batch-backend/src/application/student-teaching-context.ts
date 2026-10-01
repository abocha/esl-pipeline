import type { HomeworkMemoryRecord } from '../domain/homework-memory-model.js';
import { listRecentReadyHomeworkMemoryByStudentId } from '../domain/homework-memory-repository.js';
import type { LessonMemoryRecord } from '../domain/lesson-memory-model.js';
import { listRecentReadyLessonMemoryByStudentId } from '../domain/lesson-memory-repository.js';
import type { ProfileRevisionSource } from '../domain/profile-revision-model.js';
import { getActiveProfileRevision } from '../domain/profile-revision-repository.js';
import type { StudentMemorySnapshotRecord } from '../domain/student-memory-snapshot-model.js';
import { getLatestReadyStudentMemorySnapshotByStudentId } from '../domain/student-memory-snapshot-repository.js';
import { getStudentById } from '../domain/student-repository.js';
import {
  deriveFoundationalProfileFromMarkdown,
  type FoundationalProfile,
  normalizeFoundationalProfile,
} from './foundational-profile.js';

export const TEACHING_CONTEXT_SCHEMA_VERSION = 'teaching_context.v1';

const RECENT_LESSON_LIMIT = 3;
const RECENT_HOMEWORK_LIMIT = 2;
const SECTION_ITEM_LIMIT = 5;

export interface TeachingContext {
  schemaVersion: typeof TEACHING_CONTEXT_SCHEMA_VERSION;
  student: { id: string; name: string };
  profile: FoundationalProfile | null;
  memorySnapshot: {
    stableStrengths: StudentMemorySnapshotRecord['stableStrengths'];
    recurringIssues: StudentMemorySnapshotRecord['recurringIssues'];
    activeReviewBacklog: StudentMemorySnapshotRecord['activeReviewBacklog'];
    recentProgress: StudentMemorySnapshotRecord['recentProgress'];
    unresolvedIssues: StudentMemorySnapshotRecord['unresolvedIssues'];
  } | null;
  recentLessons: Array<{
    generatedAt: string;
    title: string | null;
    summary: string | null;
    topicsDiscussed: LessonMemoryRecord['topicsDiscussed'];
    mistakePatterns: Array<
      Pick<
        LessonMemoryRecord['mistakePatterns'][number],
        'label' | 'explanation' | 'reviewRecommended' | 'confidence'
      >
    >;
    grammarWatchlist: LessonMemoryRecord['grammarWatchlist'];
    vocabularyFocus: LessonMemoryRecord['vocabularyFocus'];
    pronunciationFocus: Array<
      Pick<LessonMemoryRecord['pronunciationFocus'][number], 'label' | 'note' | 'confidence'>
    >;
    followUpRecommendations: LessonMemoryRecord['followUpRecommendations'];
  }>;
  recentHomework: Array<{
    generatedAt: string;
    publishedAt: string;
    summary: string | null;
    topic: string | null;
    grammarTargets: HomeworkMemoryRecord['grammarTargets'];
    vocabularyTargets: HomeworkMemoryRecord['vocabularyTargets'];
    reviewTargets: HomeworkMemoryRecord['reviewTargets'];
    communicativeOutcome: string | null;
    teacherFollowUpCues: HomeworkMemoryRecord['teacherFollowUpCues'];
  }>;
  provenance: {
    profile: {
      studentId: string;
      revisionId: string;
      versionLabel: string;
      source: ProfileRevisionSource;
      activatedAt: string | null;
      contentOrigin: 'stored_structured' | 'legacy_markdown_derived' | 'unavailable';
    } | null;
    memorySnapshot: { snapshotId: string; generatedAt: string } | null;
    recentLessonMemoryEntryIds: string[];
    recentHomeworkMemoryEntryIds: string[];
  };
}

interface TeachingContextDependencies {
  getStudent: typeof getStudentById;
  getRevision: typeof getActiveProfileRevision;
  getSnapshot: typeof getLatestReadyStudentMemorySnapshotByStudentId;
  listLessons: typeof listRecentReadyLessonMemoryByStudentId;
  listHomework: typeof listRecentReadyHomeworkMemoryByStudentId;
}

function projectSnapshot(
  snapshot: StudentMemorySnapshotRecord | null,
): TeachingContext['memorySnapshot'] {
  if (!snapshot) return null;
  return {
    stableStrengths: snapshot.stableStrengths.slice(0, SECTION_ITEM_LIMIT).map(projectLabeledNote),
    recurringIssues: snapshot.recurringIssues.slice(0, SECTION_ITEM_LIMIT).map((issue) => ({
      label: issue.label,
      issueType: issue.issueType,
      note: issue.note,
      confidence: issue.confidence,
    })),
    activeReviewBacklog: snapshot.activeReviewBacklog
      .slice(0, SECTION_ITEM_LIMIT)
      .map(projectLabeledNote),
    recentProgress: snapshot.recentProgress.slice(0, SECTION_ITEM_LIMIT).map(projectLabeledNote),
    unresolvedIssues: snapshot.unresolvedIssues.slice(0, SECTION_ITEM_LIMIT).map((issue) => ({
      label: issue.label,
      issueType: issue.issueType,
      note: issue.note,
      priority: issue.priority,
    })),
  };
}

function projectLabeledNote(note: { label: string; note: string }) {
  return { label: note.label, note: note.note };
}

function projectLesson(lesson: LessonMemoryRecord): TeachingContext['recentLessons'][number] {
  return {
    generatedAt: lesson.generatedAt.toISOString(),
    title: lesson.lessonTitle ?? null,
    summary: lesson.lessonSummary ?? null,
    topicsDiscussed: lesson.topicsDiscussed.slice(0, SECTION_ITEM_LIMIT).map((topic) => ({
      topic: topic.topic,
      note: topic.note,
    })),
    mistakePatterns: lesson.mistakePatterns.slice(0, SECTION_ITEM_LIMIT).map((pattern) => ({
      label: pattern.label,
      explanation: pattern.explanation,
      reviewRecommended: pattern.reviewRecommended,
      confidence: pattern.confidence,
    })),
    grammarWatchlist: lesson.grammarWatchlist.slice(0, SECTION_ITEM_LIMIT).map((note) => ({
      name: note.name,
      note: note.note,
    })),
    vocabularyFocus: lesson.vocabularyFocus.slice(0, SECTION_ITEM_LIMIT).map((note) => ({
      text: note.text,
      note: note.note,
    })),
    pronunciationFocus: lesson.pronunciationFocus.slice(0, SECTION_ITEM_LIMIT).map((focus) => ({
      label: focus.label,
      note: focus.note,
      confidence: focus.confidence,
    })),
    followUpRecommendations: lesson.followUpRecommendations
      .slice(0, SECTION_ITEM_LIMIT)
      .map(projectLabeledNote),
  };
}

function projectHomework(
  homework: HomeworkMemoryRecord,
): TeachingContext['recentHomework'][number] {
  return {
    generatedAt: homework.generatedAt.toISOString(),
    publishedAt: homework.publishedAt.toISOString(),
    summary: homework.homeworkSummary ?? null,
    topic: homework.topic ?? null,
    grammarTargets: homework.grammarTargets.slice(0, SECTION_ITEM_LIMIT).map((target) => ({
      name: target.name,
      note: target.note,
      targetKind: target.targetKind,
    })),
    vocabularyTargets: homework.vocabularyTargets.slice(0, SECTION_ITEM_LIMIT).map((target) => ({
      text: target.text,
      note: target.note,
      targetKind: target.targetKind,
    })),
    reviewTargets: homework.reviewTargets.slice(0, SECTION_ITEM_LIMIT).map(projectLabeledNote),
    communicativeOutcome: homework.communicativeOutcome ?? null,
    teacherFollowUpCues: homework.teacherFollowUpCues
      .slice(0, SECTION_ITEM_LIMIT)
      .map((cue) => ({ cueType: cue.cueType, note: cue.note })),
  };
}

/** The workspace ID must come from an authenticated caller, never from model input. */
export async function getStudentTeachingContext(args: {
  workspaceId: string;
  studentId: string;
  overrides?: Partial<TeachingContextDependencies>;
}): Promise<TeachingContext | null> {
  if (!args.workspaceId || !args.studentId) return null;

  const dependencies: TeachingContextDependencies = {
    getStudent: args.overrides?.getStudent ?? getStudentById,
    getRevision: args.overrides?.getRevision ?? getActiveProfileRevision,
    getSnapshot: args.overrides?.getSnapshot ?? getLatestReadyStudentMemorySnapshotByStudentId,
    listLessons: args.overrides?.listLessons ?? listRecentReadyLessonMemoryByStudentId,
    listHomework: args.overrides?.listHomework ?? listRecentReadyHomeworkMemoryByStudentId,
  };

  // The repository applies the workspace predicate in SQL. No student-owned state is read first.
  const student = await dependencies.getStudent(args.studentId, { workspaceId: args.workspaceId });
  if (!student || student.id !== args.studentId || student.workspaceId !== args.workspaceId) {
    return null;
  }

  const revision = await dependencies.getRevision(student.id);

  const [snapshot, lessons, homework] = await Promise.all([
    dependencies.getSnapshot(student.id),
    dependencies.listLessons(student.id, { limit: RECENT_LESSON_LIMIT }),
    dependencies.listHomework(student.id, { limit: RECENT_HOMEWORK_LIMIT }),
  ]);

  const activeRevision = revision?.status === 'active' ? revision : null;
  const profileContent = activeRevision
    ? (activeRevision.structuredContent ??
      deriveFoundationalProfileFromMarkdown(activeRevision.content))
    : null;
  const selectedLessons = lessons.slice(0, RECENT_LESSON_LIMIT);
  const selectedHomework = homework.slice(0, RECENT_HOMEWORK_LIMIT);

  return {
    schemaVersion: TEACHING_CONTEXT_SCHEMA_VERSION,
    student: { id: student.id, name: student.student },
    profile: profileContent ? normalizeFoundationalProfile(profileContent) : null,
    memorySnapshot: projectSnapshot(snapshot),
    recentLessons: selectedLessons.map(projectLesson),
    recentHomework: selectedHomework.map(projectHomework),
    provenance: {
      profile: activeRevision
        ? {
            studentId: student.id,
            revisionId: activeRevision.id,
            versionLabel: activeRevision.versionLabel,
            source: activeRevision.source,
            activatedAt: activeRevision.activatedAt?.toISOString() ?? null,
            contentOrigin: activeRevision.structuredContent
              ? 'stored_structured'
              : profileContent
                ? 'legacy_markdown_derived'
                : 'unavailable',
          }
        : null,
      memorySnapshot: snapshot
        ? { snapshotId: snapshot.id, generatedAt: snapshot.generatedAt.toISOString() }
        : null,
      recentLessonMemoryEntryIds: selectedLessons.map((entry) => entry.id),
      recentHomeworkMemoryEntryIds: selectedHomework.map((entry) => entry.id),
    },
  };
}
