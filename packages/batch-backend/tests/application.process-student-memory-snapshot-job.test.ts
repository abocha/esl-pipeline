import { describe, expect, it, vi } from 'vitest';

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

describe('application/process-student-memory-snapshot-job', () => {
  it('builds a snapshot from ready lesson-memory entries', async () => {
    const generator = vi.fn().mockResolvedValue({
      snapshot: {
        id: 'snapshot-ready-1',
        generatedAt: new Date('2026-03-20T02:00:00.000Z'),
      },
    });
    const supersedePendingForStudent = vi.fn().mockResolvedValue([]);
    const requestRefresh = vi.fn().mockImplementation(async () => {});

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
              trigger: 'lesson-memory-ready',
            },
          }),
          markFailed: vi.fn(),
          supersedePendingForStudent,
        },
        profileCandidates: {
          requestRefresh,
        },
        generator,
      },
    });

    expect(generator).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          studentId: 'student-1',
          lessonMemoryEntryIds: ['lesson-1'],
          homeworkMemoryEntryIds: [],
          pendingEntryId: 'snapshot-pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
        }),
      }),
    );
    expect(supersedePendingForStudent).toHaveBeenCalled();
    expect(requestRefresh).toHaveBeenCalledWith({
      params: {
        studentId: 'student-1',
        sourceSnapshotId: 'snapshot-ready-1',
        trigger: 'student-memory-snapshot-ready',
      },
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
              },
            }),
            markFailed,
            supersedePendingForStudent: vi.fn(),
          },
          profileCandidates: {
            requestRefresh: vi.fn().mockImplementation(async () => {}),
          },
          generator: vi.fn().mockRejectedValue(new Error('structured output failed')),
        },
      }),
    ).rejects.toThrow('structured output failed');

    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: 'structured output failed',
    });
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
              generationNotes: null,
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
