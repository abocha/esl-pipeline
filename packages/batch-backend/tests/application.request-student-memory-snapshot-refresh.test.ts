import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueMock, randomUuidMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  randomUuidMock: vi.fn(),
}));

vi.mock('node:crypto', () => ({
  randomUUID: randomUuidMock,
}));

vi.mock('../src/infrastructure/student-memory-queue.js', () => ({
  createStudentMemoryQueue: vi.fn(() => ({
    enqueue: enqueueMock,
  })),
}));

vi.mock('../src/application/generation-policy.js', () => ({
  resolveGenerationCandidates: vi.fn(() => [{ provider: 'openai', model: 'gpt-5.2' }]),
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: {
    info: vi.fn(),
  },
}));

import { requestStudentMemorySnapshotRefresh } from '../src/application/request-student-memory-snapshot-refresh.js';

describe('application/request-student-memory-snapshot-refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    randomUuidMock.mockReturnValue('uuid-1');
  });

  it('uses the source entry id in the queue key when available so new source rows can trigger follow-up refreshes', async () => {
    await requestStudentMemorySnapshotRefresh({
      config: {
        generation: {},
      } as never,
      params: {
        studentId: 'student-1',
        trigger: 'lesson-memory-ready',
        sourceEntryId: 'lesson-memory-1',
      },
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'student-memory-snapshot-refresh',
        sourceEntryId: 'lesson-memory-1',
      }),
      expect.objectContaining({
        jobId: 'student-memory-snapshot:student-1:lesson-memory-1',
      }),
    );
  });

  it('uses a unique queue suffix for refreshes without a source entry id', async () => {
    await requestStudentMemorySnapshotRefresh({
      config: {
        generation: {},
      } as never,
      params: {
        studentId: 'student-1',
        trigger: 'manual-replay',
      },
    });

    expect(randomUuidMock).toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'student-memory-snapshot-refresh',
      }),
      expect.objectContaining({
        jobId: 'student-memory-snapshot:student-1:manual-replay:uuid-1',
      }),
    );
  });
});
