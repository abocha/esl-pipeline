import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getLatestReadyStudentMemorySnapshotByStudentIdMock,
  listRecentReadyLessonMemoryByStudentIdMock,
  listRecentReadyHomeworkMemoryByStudentIdMock,
} = vi.hoisted(() => ({
  getLatestReadyStudentMemorySnapshotByStudentIdMock: vi.fn(),
  listRecentReadyLessonMemoryByStudentIdMock: vi.fn(),
  listRecentReadyHomeworkMemoryByStudentIdMock: vi.fn(),
}));

vi.mock('../src/domain/student-memory-snapshot-repository.js', () => ({
  getLatestReadyStudentMemorySnapshotByStudentId:
    getLatestReadyStudentMemorySnapshotByStudentIdMock,
}));

vi.mock('../src/domain/lesson-memory-repository.js', () => ({
  listRecentReadyLessonMemoryByStudentId: listRecentReadyLessonMemoryByStudentIdMock,
}));

vi.mock('../src/domain/homework-memory-repository.js', () => ({
  listRecentReadyHomeworkMemoryByStudentId: listRecentReadyHomeworkMemoryByStudentIdMock,
}));

import { buildStudentMemoryPackageContext } from '../src/application/student-memory-package.js';

describe('application/student-memory-package', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds canonical prompt-package memory context from snapshot, lesson memory, and homework memory', async () => {
    getLatestReadyStudentMemorySnapshotByStudentIdMock.mockResolvedValue({
      id: 'snapshot-1',
      contentHash: 'snapshot-hash-1',
      snapshotSummary: 'Long-term summary',
      stableStrengths: [{ label: 'Uses advice phrases well', note: 'Stable' }],
      recurringIssues: [
        {
          label: 'Present perfect',
          issueType: 'grammar',
          note: 'Still unstable.',
          confidence: 'high',
        },
      ],
      activeReviewBacklog: [{ label: 'Advice connectors', note: 'Keep reviewing.' }],
      recentProgress: [{ label: 'Longer answers', note: 'Speaking more.' }],
      personalFacts: [
        {
          fact: 'Likes giving practical advice',
          category: 'preference',
          authority: 'model_inferred',
          confidence: 'medium',
          sourceArtifactIds: ['lesson-1'],
        },
      ],
      recommendedAssignmentDirections: [
        {
          direction: 'Use advice scenarios with short spoken responses',
          rationale: 'Build on the lesson topic.',
        },
      ],
      unresolvedIssues: [
        {
          priority: 'high',
          label: 'Past simple vs present perfect',
          note: 'Still unstable in spontaneous speech.',
        },
      ],
    });
    listRecentReadyLessonMemoryByStudentIdMock.mockResolvedValue([
      {
        id: 'lesson-1',
        generatedAt: new Date('2026-03-18T00:00:00.000Z'),
        lessonSummary: 'Worked on advice language.',
        topicsDiscussed: [{ topic: 'Advice', note: 'Advice language and framing.' }],
        grammarWatchlist: [{ name: 'Present perfect', note: 'Still unstable.' }],
        vocabularyFocus: [{ text: 'give advice', note: 'Useful phrase.' }],
        pronunciationFocus: [],
        followUpRecommendations: [{ label: 'Give advice with because', note: 'Carry forward.' }],
      },
    ]);
    listRecentReadyHomeworkMemoryByStudentIdMock.mockResolvedValue([
      {
        id: 'homework-1',
        generatedAt: new Date('2026-03-19T00:00:00.000Z'),
        homeworkSummary: 'Advice mission with review grammar.',
        topic: 'Giving advice',
        grammarTargets: [{ name: 'Should', note: 'Main target.', targetKind: 'mixed' }],
        reviewTargets: [{ label: 'Present perfect', note: 'Brief review.' }],
        taskList: [
          {
            section: 'Mission',
            task: 'Give advice to the person from the text.',
            taskType: 'mission',
            review: true,
          },
        ],
        pronunciationFocus: [],
        teacherFollowUpCues: [{ cueType: 'monitoring', note: 'Check should vs have to.' }],
      },
    ]);
    const result = await buildStudentMemoryPackageContext({
      studentId: 'student-1',
      currentTranscriptId: 'transcript-current',
      config: {
        pg: {
          enabled: true,
        },
      } as never,
    });

    expect(result).toMatchObject({
      studentMemorySnapshotId: 'snapshot-1',
      studentMemorySnapshotHash: 'snapshot-hash-1',
      selectedLessonMemoryIds: ['lesson-1'],
      selectedHomeworkMemoryIds: ['homework-1'],
      retrievalPolicyVersion: 'student-memory-v1',
      source: 'canonical',
    });
    expect(result.studentMemorySnapshotBlock).toContain('Long-term summary');
    expect(result.studentMemorySnapshotBlock).toContain('Stable strengths: Uses advice phrases well');
    expect(result.studentMemorySnapshotBlock).toContain('Recurring issues: Present perfect');
    expect(result.studentMemorySnapshotBlock).toContain(
      'Recommended assignment directions: Use advice scenarios with short spoken responses',
    );
    expect(result.studentMemorySnapshotBlock).toContain(
      'Personal facts: Likes giving practical advice',
    );
    expect(result.unresolvedIssuesBlock).toContain('(high) Past simple vs present perfect');
    expect(result.recentLessonMemoryBlock).toContain('Grammar watchlist: Present perfect');
    expect(result.recentHomeworkMemoryBlock).toContain('Review targets: Present perfect');
  });

  it('returns no runtime memory context when canonical memory is absent', async () => {
    getLatestReadyStudentMemorySnapshotByStudentIdMock.mockResolvedValue(null);
    listRecentReadyLessonMemoryByStudentIdMock.mockResolvedValue([]);
    listRecentReadyHomeworkMemoryByStudentIdMock.mockResolvedValue([]);

    const result = await buildStudentMemoryPackageContext({
      studentId: 'student-1',
      currentTranscriptId: 'transcript-current',
      config: {
        pg: {
          enabled: true,
        },
      } as never,
    });

    expect(result).toEqual({
      studentMemorySnapshotBlock: 'No long-term student-memory snapshot available yet.',
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
    });
  });
});
