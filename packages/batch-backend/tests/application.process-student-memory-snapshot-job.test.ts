import { describe, expect, it, vi } from 'vitest';

import { processStudentMemorySnapshotJob } from '../src/application/process-student-memory-snapshot-job.js';

describe('application/process-student-memory-snapshot-job', () => {
  it('builds a snapshot from ready lesson-memory entries', async () => {
    const generator = vi.fn().mockResolvedValue({
      snapshot: {
        id: 'snapshot-ready-1',
        generatedAt: new Date('2026-03-20T02:00:00.000Z'),
      },
    });
    const supersedePendingForStudent = vi.fn().mockResolvedValue([]);

    await processStudentMemorySnapshotJob({
      config: {
        defaultProvider: 'openai',
      } as never,
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
  });

  it('marks the pending snapshot row failed on the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processStudentMemorySnapshotJob({
        config: {
          defaultProvider: 'openai',
        } as never,
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
          generator: vi.fn().mockRejectedValue(new Error('structured output failed')),
        },
      }),
    ).rejects.toThrow('structured output failed');

    expect(markFailed).toHaveBeenCalledWith({
      id: 'snapshot-pending-1',
      errorMessage: 'structured output failed',
    });
  });
});
