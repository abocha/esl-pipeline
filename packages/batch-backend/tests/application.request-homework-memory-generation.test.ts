import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueMock, resolveHomeworkMemoryQueueScopeMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  resolveHomeworkMemoryQueueScopeMock: vi.fn(),
}));

vi.mock('../src/infrastructure/student-memory-queue.js', () => ({
  createStudentMemoryQueue: vi.fn(() => ({
    enqueue: enqueueMock,
  })),
}));

vi.mock('../src/application/generation-policy.js', () => ({
  resolveGenerationCandidates: vi.fn(() => [{ provider: 'openrouter', model: 'qwen/qwen3.5' }]),
}));

vi.mock('../src/application/homework-memory-source.js', () => ({
  resolveHomeworkMemoryQueueScope: resolveHomeworkMemoryQueueScopeMock,
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: {
    info: vi.fn(),
  },
}));

import { requestHomeworkMemoryGeneration } from '../src/application/request-homework-memory-generation.js';

describe('application/request-homework-memory-generation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveHomeworkMemoryQueueScopeMock.mockResolvedValue('lineage-1');
  });

  it('uses the succeeded job id as the BullMQ dedupe key so newer revisions are not collapsed away', async () => {
    await requestHomeworkMemoryGeneration({
      config: {
        generation: {},
      } as never,
      params: {
        jobId: 'job-2',
        studentId: 'student-1',
      },
    });

    expect(resolveHomeworkMemoryQueueScopeMock).toHaveBeenCalledWith('job-2');
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'homework-memory-generate',
        jobId: 'job-2',
        studentId: 'student-1',
      }),
      expect.objectContaining({
        jobId: 'homework-memory:job-2',
      }),
    );
  });
});
