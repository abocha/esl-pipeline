import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueMock, ensurePendingMock, supersedeClaimsMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  ensurePendingMock: vi.fn(),
  supersedeClaimsMock: vi.fn(),
}));

vi.mock('../src/infrastructure/student-memory-queue.js', () => ({
  createStudentMemoryQueue: vi.fn(() => ({ enqueue: enqueueMock })),
}));

vi.mock('../src/domain/lesson-memory-repository.js', () => ({
  ensurePendingLessonMemoryEntry: ensurePendingMock,
}));

vi.mock('../src/domain/student-memory-openai-batch-repository.js', () => ({
  supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork: supersedeClaimsMock,
}));

vi.mock('../src/application/generation-policy.js', () => ({
  resolveGenerationCandidates: vi.fn(() => [{ provider: 'openai', model: 'gpt-5.2' }]),
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: { info: vi.fn() },
}));

import { requestLessonMemoryGeneration } from '../src/application/request-lesson-memory-generation.js';

describe('application/request-lesson-memory-generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePendingMock.mockResolvedValue({ outcome: 'created', entry: { id: 'pending-1' } });
    supersedeClaimsMock.mockResolvedValue([]);
  });

  it('supersedes an eligible Batch claim and still immediately enqueues online work', async () => {
    await requestLessonMemoryGeneration({
      config: { generation: {} } as never,
      params: {
        studentId: 'student-1',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        trigger: 'replay',
      },
    });

    expect(supersedeClaimsMock).toHaveBeenCalledWith({
      workload: 'lesson_memory',
      canonicalScopeKey: 'transcript-1',
    });
    expect(ensurePendingMock).toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalled();
  });

  it('records teacher-confirmed transcript requests and carries the linked lesson into the queue', async () => {
    await requestLessonMemoryGeneration({
      config: { generation: {} } as never,
      params: {
        studentId: 'student-1',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        lessonId: 'lesson-1',
        trigger: 'teacher-confirmed-transcript',
      },
    });

    expect(ensurePendingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationNotes: expect.objectContaining({
          trigger: 'teacher-confirmed-transcript',
          lessonId: 'lesson-1',
        }),
      }),
    );
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lessonId: 'lesson-1',
      }),
      { jobId: 'lesson-memory:transcript-1' },
    );
  });
});
