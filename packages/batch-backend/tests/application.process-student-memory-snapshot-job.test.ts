import { describe, expect, it, vi } from 'vitest';

import { estimateGenerationTokens } from '../src/application/generation-budget-guard.js';
import { processStudentMemorySnapshotJob } from '../src/application/process-student-memory-snapshot-job.js';
import { StudentMemoryPacingDeferredError } from '../src/application/student-memory-generation-pacing.js';
import { loadConfig } from '../src/config/env.js';

function createTestConfig() {
  const base = loadConfig();
  return {
    ...base,
    generation: {
      ...base.generation,
      strictNoPaid: false,
      safetyMode: 'off' as const,
    },
  };
}

function lessonMemoryEntry(id: string, generatedAt: string, summary = id) {
  return {
    id,
    studentId: 'student-1',
    transcriptId: `transcript-${id}`,
    recordingId: `recording-${id}`,
    schemaVersion: 'lesson-memory.v1',
    generatedAt: new Date(generatedAt),
    provider: 'openai',
    model: 'gpt-5.2',
    status: 'ready',
    lessonSummary: summary,
    topicsDiscussed: [],
    mistakePatterns: [],
    grammarReviewed: [],
    grammarWatchlist: [],
    vocabularyFocus: [],
    pronunciationFocus: [],
    studentFacts: [],
    progressSignals: [],
    followUpRecommendations: [],
  };
}

function homeworkMemoryEntry(id: string, generatedAt: string, summary = id) {
  return {
    id,
    studentId: 'student-1',
    jobId: `job-${id}`,
    assignmentLineageKey: `assignment-${id}`,
    schemaVersion: 'homework-memory.v1',
    generatedAt: new Date(generatedAt),
    provider: 'openai',
    model: 'gpt-5.2',
    status: 'ready',
    homeworkSummary: summary,
    topic: 'travel',
    grammarTargets: [],
    vocabularyTargets: [],
    reviewTargets: [],
    taskList: [],
    pronunciationFocus: [],
    teacherFollowUpCues: [],
  };
}

function readySnapshot() {
  return {
    id: 'snapshot-ready-parent',
    studentId: 'student-1',
    schemaVersion: 'student-memory-snapshot.v1',
    generatedAt: new Date('2026-03-19T23:00:00.000Z'),
    provider: 'openai',
    model: 'gpt-5.2',
    status: 'ready',
    sourceKind: 'student_memory_rollup',
    lessonMemoryEntryIds: ['lesson-parent'],
    homeworkMemoryEntryIds: ['homework-parent'],
    contentHash: 'parent-hash',
    generationNotes: {
      strategy: 'full_rebuild_v1',
      coveredLessonMemoryEntryIds: ['lesson-parent'],
      coveredHomeworkMemoryEntryIds: ['homework-parent'],
    },
    stableStrengths: [{ label: 'Speaking confidence', note: 'Answers with less hesitation.' }],
    recurringIssues: [],
    activeReviewBacklog: [{ label: 'Tense contrast', note: 'Review travel story tense choices.' }],
    recentProgress: [],
    personalFacts: [],
    recommendedAssignmentDirections: [],
    unresolvedIssues: [],
    snapshotSummary: 'Parent snapshot summary',
  };
}

describe('application/process-student-memory-snapshot-job', () => {
  it('uses incremental lesson-memory refresh without calling full-history list-all paths', async () => {
    const generator = vi.fn().mockResolvedValue({
      snapshot: {
        id: 'snapshot-ready-1',
        generatedAt: new Date('2026-03-20T02:00:00.000Z'),
      },
    });
    const supersedePendingForStudent = vi.fn().mockResolvedValue([]);
    const requestRefresh = vi.fn().mockImplementation(async () => {});
    const listAllLessonMemory = vi.fn().mockRejectedValue(new Error('must not list all lessons'));
    const listAllHomeworkMemory = vi
      .fn()
      .mockRejectedValue(new Error('must not list all homework'));
    const triggerLesson = lessonMemoryEntry(
      'lesson-1',
      '2026-03-20T00:00:00.000Z',
      'Trigger lesson',
    );
    const supportingLesson = lessonMemoryEntry(
      'lesson-support',
      '2026-03-19T00:00:00.000Z',
      'Supporting lesson',
    );
    const supportingHomework = homeworkMemoryEntry(
      'homework-support',
      '2026-03-19T01:00:00.000Z',
      'Supporting homework',
    );

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'lesson-memory-ready',
        sourceEntryId: 'lesson-1',
      },
      overrides: {
        lessonMemory: {
          list: listAllLessonMemory,
          getById: vi.fn().mockResolvedValue(triggerLesson),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([supportingLesson]),
        },
        homeworkMemory: {
          list: listAllHomeworkMemory,
          getById: vi.fn().mockResolvedValue(null),
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([supportingHomework]),
        },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: {
              trigger: 'lesson-memory-ready',
            },
          }),
          getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
          markFailed: vi.fn(),
          supersedePendingForStudent,
        },
        profileCandidates: {
          requestRefresh,
        },
        generator,
      } as never,
    });

    expect(listAllLessonMemory).not.toHaveBeenCalled();
    expect(listAllHomeworkMemory).not.toHaveBeenCalled();
    expect(generator).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          studentId: 'student-1',
          lessonMemoryEntryIds: ['lesson-parent', 'lesson-1', 'lesson-support'],
          homeworkMemoryEntryIds: ['homework-parent', 'homework-support'],
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
        }),
      }),
    );
    const request = generator.mock.calls[0]?.[0].request;
    expect(request.pendingGenerationNotes).toMatchObject({
      trigger: 'lesson-memory-ready',
      sourceEntryId: 'lesson-1',
      strategy: 'incremental_v1_1',
      parentSnapshotId: 'snapshot-ready-parent',
      triggerSourceKind: 'lesson_memory',
      triggerSourceEntryId: 'lesson-1',
      includedLessonMemoryEntryIds: ['lesson-1', 'lesson-support'],
      includedHomeworkMemoryEntryIds: ['homework-support'],
      coveredLessonMemoryEntryIds: ['lesson-parent', 'lesson-1', 'lesson-support'],
      coveredHomeworkMemoryEntryIds: ['homework-parent', 'homework-support'],
      includedLessonMemoryCount: 2,
      includedHomeworkMemoryCount: 1,
      coveredLessonMemoryCount: 3,
      coveredHomeworkMemoryCount: 2,
      promptByteLength: Buffer.byteLength(request.prompt, 'utf8'),
      inputTokenEstimate: estimateGenerationTokens({
        prompt: request.prompt,
        hardCap: 0,
      }),
      materialChange: null,
    });
    expect(supersedePendingForStudent).toHaveBeenCalled();
    expect(requestRefresh).toHaveBeenCalledWith({
      params: {
        studentId: 'student-1',
        sourceSnapshotId: 'snapshot-ready-1',
        trigger: 'student-memory-snapshot-ready',
      },
    });
  });

  it('uses bootstrap incremental refresh for homework-memory jobs without a previous ready snapshot', async () => {
    const generator = vi.fn().mockResolvedValue({
      snapshot: {
        id: 'snapshot-ready-1',
        generatedAt: new Date('2026-03-20T02:00:00.000Z'),
      },
    });
    const listAllLessonMemory = vi.fn().mockRejectedValue(new Error('must not list all lessons'));
    const listAllHomeworkMemory = vi
      .fn()
      .mockRejectedValue(new Error('must not list all homework'));
    const triggerHomework = homeworkMemoryEntry(
      'homework-1',
      '2026-03-20T00:45:00.000Z',
      'Trigger homework',
    );
    const supportingLessons = Array.from({ length: 5 }, (_, index) =>
      lessonMemoryEntry(
        `lesson-support-${index + 1}`,
        `2026-03-19T0${index}:00:00.000Z`,
        `Supporting lesson ${index + 1}`,
      ),
    );
    const supportingHomework = [
      homeworkMemoryEntry('homework-support-1', '2026-03-19T01:00:00.000Z', 'Supporting homework 1'),
      homeworkMemoryEntry('homework-support-2', '2026-03-19T02:00:00.000Z', 'Supporting homework 2'),
    ];
    const listRecentLessonMemory = vi.fn().mockResolvedValue(supportingLessons);
    const listRecentHomeworkMemory = vi.fn().mockResolvedValue(supportingHomework);

    await processStudentMemorySnapshotJob({
      config: createTestConfig(),
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-1',
      },
      overrides: {
        lessonMemory: {
          list: listAllLessonMemory,
          getById: vi.fn().mockResolvedValue(null),
          listRecentReadyByStudentId: listRecentLessonMemory,
        },
        homeworkMemory: {
          list: listAllHomeworkMemory,
          getById: vi.fn().mockResolvedValue(triggerHomework),
          listRecentReadyByStudentId: listRecentHomeworkMemory,
        },
        snapshots: {
          getById: vi.fn().mockResolvedValue({
            id: 'snapshot-pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
            generationNotes: {
              trigger: 'homework-memory-ready',
            },
          }),
          getLatestReadyByStudentId: vi.fn().mockResolvedValue(null),
          markFailed: vi.fn(),
          supersedePendingForStudent: vi.fn().mockResolvedValue([]),
        },
        profileCandidates: {
          requestRefresh: vi.fn().mockImplementation(async () => {}),
        },
        generator,
      } as never,
    });

    expect(listAllLessonMemory).not.toHaveBeenCalled();
    expect(listAllHomeworkMemory).not.toHaveBeenCalled();
    expect(listRecentLessonMemory).toHaveBeenCalledWith('student-1', {
      limit: 5,
    });
    expect(listRecentHomeworkMemory).toHaveBeenCalledWith('student-1', {
      limit: 2,
      excludeAssignmentLineageKey: 'assignment-homework-1',
    });
    const request = generator.mock.calls[0]?.[0].request;
    const expectedLessonIds = supportingLessons.map((entry) => entry.id);
    expect(request.pendingGenerationNotes).toMatchObject({
      trigger: 'homework-memory-ready',
      strategy: 'bootstrap_incremental_v1_1',
      parentSnapshotId: null,
      triggerSourceKind: 'homework_memory',
      triggerSourceEntryId: 'homework-1',
      includedLessonMemoryEntryIds: expectedLessonIds,
      includedHomeworkMemoryEntryIds: ['homework-1', 'homework-support-1', 'homework-support-2'],
      coveredLessonMemoryEntryIds: expectedLessonIds,
      coveredHomeworkMemoryEntryIds: ['homework-1', 'homework-support-1', 'homework-support-2'],
      includedLessonMemoryCount: 5,
      includedHomeworkMemoryCount: 3,
    });
  });

  it('rejects a lesson-memory trigger source that belongs to another student', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'lesson-memory-ready',
          sourceEntryId: 'lesson-foreign',
        },
        attemptsMade: 0,
        maxAttempts: 1,
        overrides: {
          lessonMemory: {
            list: vi.fn(),
            getById: vi.fn().mockResolvedValue({
              ...lessonMemoryEntry('lesson-foreign', '2026-03-20T00:00:00.000Z'),
              studentId: 'student-2',
            }),
            listRecentReadyByStudentId: vi.fn(),
          },
          homeworkMemory: {
            list: vi.fn(),
            getById: vi.fn(),
            listRecentReadyByStudentId: vi.fn(),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: null,
            }),
            getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
            markFailed,
            supersedePendingForStudent: vi.fn(),
          },
          profileCandidates: { requestRefresh: vi.fn() },
          generator: vi.fn(),
        } as never,
      }),
    ).rejects.toThrow('Lesson memory trigger source belongs to a different student');

    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: 'Lesson memory trigger source belongs to a different student',
      generationNotes: undefined,
    });
  });

  it('rejects a homework-memory trigger source that belongs to another student', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'homework-memory-ready',
          sourceEntryId: 'homework-foreign',
        },
        attemptsMade: 0,
        maxAttempts: 1,
        overrides: {
          lessonMemory: {
            list: vi.fn(),
            getById: vi.fn(),
            listRecentReadyByStudentId: vi.fn(),
          },
          homeworkMemory: {
            list: vi.fn(),
            getById: vi.fn().mockResolvedValue({
              ...homeworkMemoryEntry('homework-foreign', '2026-03-20T00:00:00.000Z'),
              studentId: 'student-2',
            }),
            listRecentReadyByStudentId: vi.fn(),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: null,
            }),
            getLatestReadyByStudentId: vi.fn().mockResolvedValue(readySnapshot()),
            markFailed,
            supersedePendingForStudent: vi.fn(),
          },
          profileCandidates: { requestRefresh: vi.fn() },
          generator: vi.fn(),
        } as never,
      }),
    ).rejects.toThrow('Homework memory trigger source belongs to a different student');

    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: 'Homework memory trigger source belongs to a different student',
      generationNotes: undefined,
    });
  });

  it('marks the pending snapshot row failed on the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
          trigger: 'manual-replay',
          sourceEntryId: null,
          strategy: 'manual_rebuild_v1_1',
          operatorReason: 'Backfill missing alpha snapshot',
        },
        attemptsMade: 0,
        maxAttempts: 1,
        overrides: {
          lessonMemory: {
            list: vi.fn().mockResolvedValue([
              {
                id: 'lesson-1',
                generatedAt: new Date('2026-03-20T00:00:00.000Z'),
                lessonSummary: 'Strong lesson',
                topicsDiscussed: [],
                mistakePatterns: [],
                grammarReviewed: [],
                grammarWatchlist: [],
                vocabularyFocus: [],
                pronunciationFocus: [],
                studentFacts: [],
                progressSignals: [],
                followUpRecommendations: [],
              },
            ]),
          },
          homeworkMemory: {
            list: vi.fn().mockResolvedValue([]),
          },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T01:00:00.000Z'),
              generationNotes: {
                trigger: 'manual-replay',
                strategy: 'manual_rebuild_v1_1',
                operatorReason: 'Backfill missing alpha snapshot',
              },
            }),
            markFailed,
            supersedePendingForStudent: vi.fn(),
          },
          profileCandidates: {
            requestRefresh: vi.fn().mockImplementation(async () => {}),
          },
          generator: vi.fn().mockRejectedValue(new Error('structured output failed')),
        } as never,
      }),
    ).rejects.toThrow('structured output failed');

    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: 'structured output failed',
      generationNotes: expect.objectContaining({
        trigger: 'manual-replay',
        sourceEntryId: null,
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Backfill missing alpha snapshot',
        triggerSourceKind: 'manual',
        triggerSourceEntryId: null,
        parentSnapshotId: null,
        includedLessonMemoryEntryIds: ['lesson-1'],
        includedHomeworkMemoryEntryIds: [],
        coveredLessonMemoryEntryIds: ['lesson-1'],
        coveredHomeworkMemoryEntryIds: [],
        includedLessonMemoryCount: 1,
        includedHomeworkMemoryCount: 0,
        coveredLessonMemoryCount: 1,
        coveredHomeworkMemoryCount: 0,
        materialChange: null,
      }),
    });
    const failedNotes = markFailed.mock.calls[0]?.[0].generationNotes;
    expect(failedNotes.promptByteLength).toBeGreaterThan(0);
    expect(failedNotes.inputTokenEstimate).toBeGreaterThan(0);
  });

  it('keeps a pending snapshot row pending when pacing defers the provider call', async () => {
    const markFailed = vi.fn();
    const deferred = new StudentMemoryPacingDeferredError({
      reason: 'budget_rpm_minute',
      provider: 'openai',
      model: 'gpt-5.4-mini',
      notBefore: new Date('2026-06-21T10:12:00.000Z'),
      estimatedTokens: 400,
    });
    const run = vi.fn().mockRejectedValue(deferred);

    await expect(
      processStudentMemorySnapshotJob({
        config: createTestConfig(),
        payload: {
          kind: 'student-memory-snapshot-refresh',
          studentId: 'student-1',
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.4-mini',
          trigger: 'manual-replay',
          strategy: 'manual_rebuild_v1_1',
          operatorReason: 'Backfill missing alpha snapshot',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: {
          lessonMemory: {
            list: vi.fn().mockResolvedValue([
              {
                id: 'lesson-1',
                generatedAt: new Date('2026-06-21T10:00:00.000Z'),
                lessonSummary: 'Summary',
                topicsDiscussed: [],
                mistakePatterns: [],
                grammarReviewed: [],
                grammarWatchlist: [],
                vocabularyFocus: [],
                pronunciationFocus: [],
                studentFacts: [],
                progressSignals: [],
                followUpRecommendations: [],
              },
            ]),
          },
          homeworkMemory: { list: vi.fn().mockResolvedValue([]) },
          snapshots: {
            getById: vi.fn().mockResolvedValue({
              id: 'snapshot-pending-1',
              status: 'pending',
              generatedAt: new Date('2026-06-21T10:00:00.000Z'),
              generationNotes: {
                strategy: 'manual_rebuild_v1_1',
                operatorReason: 'Backfill missing alpha snapshot',
              },
            }),
            markFailed,
            supersedePendingForStudent: vi.fn(),
          },
          profileCandidates: { requestRefresh: vi.fn() },
          generator: vi.fn(),
          pacer: { run } as never,
        } as never,
      }),
    ).rejects.toBe(deferred);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        workload: 'student_memory_snapshot',
        provider: 'openai',
        model: 'gpt-5.4-mini',
      }),
    );
    expect(markFailed).not.toHaveBeenCalled();
  });
});
