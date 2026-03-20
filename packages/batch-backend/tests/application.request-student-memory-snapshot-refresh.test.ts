import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueMock, ensurePendingMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  ensurePendingMock: vi.fn(),
}));

vi.mock('../src/infrastructure/student-memory-queue.js', () => ({
  createStudentMemoryQueue: vi.fn(() => ({
    enqueue: enqueueMock,
  })),
}));

vi.mock('../src/domain/student-memory-snapshot-repository.js', () => ({
  ensurePendingStudentMemorySnapshot: ensurePendingMock,
}));

vi.mock('../src/application/generation-policy.js', () => ({
  resolveGenerationCandidates: vi.fn((args?: { providerOverride?: string; modelOverride?: string }) => [
    {
      provider: args?.providerOverride ?? 'openai',
      model: args?.modelOverride ?? 'gpt-5.2',
    },
  ]),
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
    ensurePendingMock.mockResolvedValue({
      outcome: 'created',
      entry: {
        id: 'snapshot-pending-1',
      },
    });
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
        pendingEntryId: 'snapshot-pending-1',
        sourceEntryId: 'lesson-memory-1',
      }),
      expect.objectContaining({
        jobId: 'student-memory-snapshot:student-1:snapshot-pending-1',
      }),
    );
  });

  it('uses the pending snapshot id as the queue key for manual replay too', async () => {
    await requestStudentMemorySnapshotRefresh({
      config: {
        generation: {},
      } as never,
      params: {
        studentId: 'student-1',
        trigger: 'manual-replay',
      },
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'student-memory-snapshot-refresh',
        pendingEntryId: 'snapshot-pending-1',
      }),
      expect.objectContaining({
        jobId: 'student-memory-snapshot:student-1:snapshot-pending-1',
      }),
    );
  });

  it('honors provider and model overrides for manual replay', async () => {
    await requestStudentMemorySnapshotRefresh({
      config: {
        generation: {},
      } as never,
      params: {
        studentId: 'student-1',
        trigger: 'manual-replay',
        providerOverride: 'openrouter',
        modelOverride: 'qwen/qwen3.5',
      },
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingEntryId: 'snapshot-pending-1',
        provider: 'openrouter',
        model: 'qwen/qwen3.5',
      }),
      expect.any(Object),
    );
  });

  it('reuses the existing pending snapshot row when the same source entry is requested again', async () => {
    ensurePendingMock.mockResolvedValueOnce({
      outcome: 'pending_exists',
      entry: {
        id: 'snapshot-pending-existing',
      },
    });

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

    expect(ensurePendingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        sourceEntryId: 'lesson-memory-1',
      }),
    );
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingEntryId: 'snapshot-pending-existing',
      }),
      expect.objectContaining({
        jobId: 'student-memory-snapshot:student-1:snapshot-pending-existing',
      }),
    );
  });

  it('creates a new queue job when the same source entry is retriggered after a new pending row is created', async () => {
    ensurePendingMock.mockResolvedValueOnce({
      outcome: 'created',
      entry: {
        id: 'snapshot-pending-2',
      },
    });

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
        pendingEntryId: 'snapshot-pending-2',
        sourceEntryId: 'lesson-memory-1',
      }),
      expect.objectContaining({
        jobId: 'student-memory-snapshot:student-1:snapshot-pending-2',
      }),
    );
  });
});
