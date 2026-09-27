import { describe, expect, it, vi } from 'vitest';

import { createEmptyFoundationalProfile } from '../src/application/foundational-profile.js';
import {
  getStudentTeachingContext,
  TEACHING_CONTEXT_SCHEMA_VERSION,
} from '../src/application/student-teaching-context.js';

const workspaceId = 'workspace-1';
const studentId = 'student-1';
const date = new Date('2026-09-25T10:00:00.000Z');

function student(overrides: Record<string, unknown> = {}) {
  return {
    id: studentId,
    student: 'Maya',
    workspaceId,
    profileId: 'maya.md',
    ...overrides,
  };
}

function dependencies() {
  return {
    getStudent: vi.fn().mockResolvedValue(student()),
    getActiveBinding: vi.fn(),
    getProfile: vi.fn().mockResolvedValue({ activeRevisionId: 'revision-2' }),
    getRevision: vi.fn().mockResolvedValue({
      id: 'revision-2',
      status: 'active',
      versionLabel: 'v2',
      source: 'profile_revision_refresh',
      activatedAt: date,
      structuredContent: {
        ...createEmptyFoundationalProfile(),
        overallLevel: 'B1',
        primaryGoals: ['Speak more confidently'],
        personalFacts: ['Unexpected legacy profile key'],
      },
      content: 'Private markdown profile',
    }),
    getSnapshot: vi.fn().mockResolvedValue({
      id: 'snapshot-1',
      generatedAt: date,
      stableStrengths: [
        { label: 'Fluency', note: 'Longer responses', privateKey: 'Unexpected snapshot key' },
      ],
      recurringIssues: [
        { label: 'Articles', issueType: 'grammar', note: 'Often omitted', confidence: 'high' },
      ],
      activeReviewBacklog: [{ label: 'Past tense', note: 'Review next lesson' }],
      recentProgress: [{ label: 'Vocabulary', note: 'Improved recall' }],
      unresolvedIssues: [],
      personalFacts: [{ fact: 'Private detail', evidence: [{ quote: 'Raw transcript' }] }],
      provider: 'internal-provider',
    }),
    listLessons: vi.fn().mockResolvedValue([
      {
        id: 'lesson-memory-1',
        generatedAt: date,
        lessonTitle: 'At the airport',
        lessonSummary: 'Practised travel questions.',
        topicsDiscussed: [
          { topic: 'Travel', note: 'Airport questions', privateKey: 'Unexpected lesson key' },
        ],
        mistakePatterns: [
          {
            label: 'Articles',
            explanation: 'Article omission',
            confidence: 'high',
            reviewRecommended: true,
            evidence: [{ evidenceQuote: 'Raw transcript' }],
          },
        ],
        grammarWatchlist: [{ name: 'Articles', note: 'Review' }],
        vocabularyFocus: [{ text: 'boarding pass', note: 'Reuse' }],
        pronunciationFocus: [
          {
            label: 'Stress',
            note: 'Word stress',
            confidence: 'medium',
            evidence: [{ evidenceQuote: 'Raw transcript' }],
          },
        ],
        followUpRecommendations: [{ label: 'Questions', note: 'Practise follow-up questions' }],
        studentFacts: [{ fact: 'Private detail' }],
        sourceStorageUri: 's3://private',
        transcriptId: 'transcript-1',
      },
    ]),
    listHomework: vi.fn().mockResolvedValue([
      {
        id: 'homework-memory-1',
        generatedAt: date,
        publishedAt: date,
        homeworkSummary: 'Practise travel dialogue.',
        topic: 'Travel',
        grammarTargets: [
          {
            name: 'Articles',
            note: 'Review',
            targetKind: 'review',
            privateKey: 'Unexpected homework key',
          },
        ],
        vocabularyTargets: [{ text: 'boarding pass', note: 'Reuse', targetKind: 'review' }],
        reviewTargets: [{ label: 'Questions', note: 'Practise' }],
        communicativeOutcome: 'Ask for help at an airport',
        teacherFollowUpCues: [{ cueType: 'warm_up', note: 'Ask about the journey' }],
        taskList: [{ section: 'Practice', task: 'Private task', taskType: 'other', review: false }],
        jobId: 'job-1',
        publishTargets: [{ target: 'notion', url: 'https://private.example' }],
      },
    ]),
  };
}

describe('getStudentTeachingContext', () => {
  it('composes a compact structured projection from authorized canonical sources', async () => {
    const overrides = dependencies();
    const context = await getStudentTeachingContext({ workspaceId, studentId, overrides });

    expect(overrides.getStudent).toHaveBeenCalledWith(studentId, { workspaceId });
    expect(overrides.getProfile).toHaveBeenCalledWith('maya.md');
    expect(overrides.getRevision).toHaveBeenCalledWith('maya.md', 'revision-2');
    expect(overrides.getSnapshot).toHaveBeenCalledWith(studentId);
    expect(overrides.listLessons).toHaveBeenCalledWith(studentId, { limit: 3 });
    expect(overrides.listHomework).toHaveBeenCalledWith(studentId, { limit: 2 });
    expect(context).toMatchObject({
      schemaVersion: TEACHING_CONTEXT_SCHEMA_VERSION,
      student: { id: studentId, name: 'Maya' },
      profile: { overallLevel: 'B1', primaryGoals: ['Speak more confidently'] },
      memorySnapshot: { recurringIssues: [{ label: 'Articles' }] },
      recentLessons: [{ title: 'At the airport', mistakePatterns: [{ label: 'Articles' }] }],
      recentHomework: [{ topic: 'Travel', grammarTargets: [{ name: 'Articles' }] }],
      provenance: {
        profile: {
          profileId: 'maya.md',
          revisionId: 'revision-2',
          versionLabel: 'v2',
          source: 'profile_revision_refresh',
          activatedAt: date.toISOString(),
          contentOrigin: 'stored_structured',
        },
        memorySnapshot: { snapshotId: 'snapshot-1', generatedAt: date.toISOString() },
        recentLessonMemoryEntryIds: ['lesson-memory-1'],
        recentHomeworkMemoryEntryIds: ['homework-memory-1'],
      },
    });
    const serialized = JSON.stringify(context);
    for (const sensitive of [
      'personalFacts',
      'studentFacts',
      'Raw transcript',
      's3://private',
      'job-1',
      'https://private.example',
      'internal-provider',
      'Private markdown profile',
      'Unexpected legacy profile key',
      'Unexpected snapshot key',
      'Unexpected lesson key',
      'Unexpected homework key',
    ]) {
      expect(serialized).not.toContain(sensitive);
    }
  });

  it('bounds recent selection and each structured memory section', async () => {
    const overrides = dependencies();
    const lesson = (await overrides.listLessons())[0];
    const homework = (await overrides.listHomework())[0];
    const snapshot = await overrides.getSnapshot();
    overrides.listLessons.mockResolvedValue(
      Array.from({ length: 8 }, (_, index) => ({
        ...lesson,
        id: `lesson-memory-${index}`,
        lessonTitle: `Lesson ${index}`,
        topicsDiscussed: Array.from({ length: 9 }, (_, item) => ({
          topic: `Topic ${item}`,
          note: 'Note',
        })),
      })),
    );
    overrides.listHomework.mockResolvedValue(
      Array.from({ length: 7 }, (_, index) => ({
        ...homework,
        id: `homework-memory-${index}`,
        topic: `Homework ${index}`,
        reviewTargets: Array.from({ length: 9 }, (_, item) => ({
          label: `Target ${item}`,
          note: 'Note',
        })),
      })),
    );
    overrides.getSnapshot.mockResolvedValue({
      ...snapshot,
      stableStrengths: Array.from({ length: 9 }, (_, index) => ({
        label: `Strength ${index}`,
        note: 'Note',
      })),
    });

    const context = await getStudentTeachingContext({ workspaceId, studentId, overrides });
    expect(context?.recentLessons.map((entry) => entry.title)).toEqual([
      'Lesson 0',
      'Lesson 1',
      'Lesson 2',
    ]);
    expect(context?.recentHomework.map((entry) => entry.topic)).toEqual([
      'Homework 0',
      'Homework 1',
    ]);
    expect(context?.recentLessons[0]?.topicsDiscussed).toHaveLength(5);
    expect(context?.recentHomework[0]?.reviewTargets).toHaveLength(5);
    expect(context?.memorySnapshot?.stableStrengths).toHaveLength(5);
    expect(context?.provenance.recentLessonMemoryEntryIds).toEqual([
      'lesson-memory-0',
      'lesson-memory-1',
      'lesson-memory-2',
    ]);
    expect(context?.provenance.recentHomeworkMemoryEntryIds).toEqual([
      'homework-memory-0',
      'homework-memory-1',
    ]);
  });

  it('uses the canonical legacy Markdown derivation for an active profile', async () => {
    const overrides = dependencies();
    overrides.getProfile.mockResolvedValue({ activeRevisionId: 'legacy-revision' });
    overrides.getRevision.mockResolvedValue({
      id: 'legacy-revision',
      status: 'active',
      versionLabel: 'v1',
      source: 'create',
      activatedAt: date,
      structuredContent: null,
      content:
        '# Foundational Profile\n**Current Level:** B1\n\n## Goals & Motivation\n- Speak more confidently.',
    });

    const context = await getStudentTeachingContext({ workspaceId, studentId, overrides });
    expect(context?.profile).toMatchObject({
      overallLevel: 'B1',
      primaryGoals: ['Speak more confidently.'],
    });
    expect(context?.provenance.profile).toMatchObject({
      profileId: 'maya.md',
      revisionId: 'legacy-revision',
      contentOrigin: 'legacy_markdown_derived',
    });
  });

  it('leaves missing optional layers explicit, including an unparseable active profile', async () => {
    const overrides = dependencies();
    overrides.getStudent.mockResolvedValue(student({ profileId: null }));
    overrides.getActiveBinding.mockResolvedValue({ profileId: 'bound.md' });
    overrides.getProfile.mockResolvedValue({ activeRevisionId: 'legacy-revision' });
    overrides.getRevision.mockResolvedValue({
      id: 'legacy-revision',
      status: 'active',
      versionLabel: 'v1',
      source: 'create',
      activatedAt: date,
      structuredContent: null,
      content: 'Legacy prose',
    });
    overrides.getSnapshot.mockResolvedValue(null);
    overrides.listLessons.mockResolvedValue([]);
    overrides.listHomework.mockResolvedValue([]);

    const context = await getStudentTeachingContext({ workspaceId, studentId, overrides });
    expect(overrides.getActiveBinding).toHaveBeenCalledWith(studentId);
    expect(overrides.getProfile).toHaveBeenCalledWith('bound.md');
    expect(context).toEqual({
      schemaVersion: TEACHING_CONTEXT_SCHEMA_VERSION,
      student: { id: studentId, name: 'Maya' },
      profile: null,
      memorySnapshot: null,
      recentLessons: [],
      recentHomework: [],
      provenance: {
        profile: {
          profileId: 'bound.md',
          revisionId: 'legacy-revision',
          versionLabel: 'v1',
          source: 'create',
          activatedAt: date.toISOString(),
          contentOrigin: 'unavailable',
        },
        memorySnapshot: null,
        recentLessonMemoryEntryIds: [],
        recentHomeworkMemoryEntryIds: [],
      },
    });
  });

  it('reports no profile lineage when no profile is bound', async () => {
    const overrides = dependencies();
    overrides.getStudent.mockResolvedValue(student({ profileId: null }));
    overrides.getActiveBinding.mockResolvedValue(null);
    overrides.getSnapshot.mockResolvedValue(null);
    overrides.listLessons.mockResolvedValue([]);
    overrides.listHomework.mockResolvedValue([]);

    const context = await getStudentTeachingContext({ workspaceId, studentId, overrides });
    expect(context?.profile).toBeNull();
    expect(context?.provenance.profile).toBeNull();
    expect(overrides.getProfile).not.toHaveBeenCalled();
    expect(overrides.getRevision).not.toHaveBeenCalled();
  });

  it.each([null, student({ workspaceId: 'foreign-workspace' })])(
    'returns non-enumerating absence before any profile or memory read for %s',
    async (resolvedStudent) => {
      const overrides = dependencies();
      overrides.getStudent.mockResolvedValue(resolvedStudent);

      const context = await getStudentTeachingContext({ workspaceId, studentId, overrides });
      expect(context).toBeNull();
      expect(overrides.getStudent).toHaveBeenCalledWith(studentId, { workspaceId });
      for (const dependency of [
        overrides.getActiveBinding,
        overrides.getProfile,
        overrides.getRevision,
        overrides.getSnapshot,
        overrides.listLessons,
        overrides.listHomework,
      ]) {
        expect(dependency).not.toHaveBeenCalled();
      }
    },
  );
});
