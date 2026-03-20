import { describe, expect, it, vi } from 'vitest';

import { processStudentMemorySnapshotJob } from '../src/application/process-student-memory-snapshot-job.js';

describe('application/process-student-memory-snapshot-job', () => {
  it('builds a snapshot from ready lesson-memory entries', async () => {
    const generator = vi.fn().mockResolvedValue(null);

    await processStudentMemorySnapshotJob({
      config: {
        defaultProvider: 'openai',
      } as never,
      payload: {
        kind: 'student-memory-snapshot-refresh',
        studentId: 'student-1',
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
        generator,
      },
    });

    expect(generator).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          studentId: 'student-1',
          lessonMemoryEntryIds: ['lesson-1'],
          homeworkMemoryEntryIds: [],
          provider: 'openai',
          model: 'gpt-5.2',
        }),
      }),
    );
  });
});
