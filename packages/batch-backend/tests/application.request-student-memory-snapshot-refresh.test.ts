import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enqueueMock, ensurePendingMock, supersedeClaimsMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  ensurePendingMock: vi.fn(),
  supersedeClaimsMock: vi.fn(),
}));

vi.mock('../src/infrastructure/student-memory-queue.js', () => ({
  createStudentMemoryQueue: vi.fn(() => ({
    reconcile: enqueueMock,
  })),
}));

vi.mock('../src/domain/student-memory-snapshot-repository.js', () => ({
  ensurePendingStudentMemorySnapshot: ensurePendingMock,
}));

vi.mock('../src/domain/student-memory-openai-batch-repository.js', () => ({
  supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork: supersedeClaimsMock,
}));

vi.mock('../src/application/generation-policy.js', () => ({
  resolveGenerationTarget: vi.fn(
    (args?: { providerOverride?: string; modelOverride?: string }) => ({
      provider: args?.providerOverride ?? 'openai',
      model: args?.modelOverride ?? 'gpt-5.2',
    }),
  ),
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
    ensurePendingMock.mockImplementation(async (params) => ({
      outcome: 'created',
      entry: { ...params, id: 'snapshot-pending-1' },
    }));
    supersedeClaimsMock.mockResolvedValue([]);
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
    expect(supersedeClaimsMock).toHaveBeenCalledWith({
      workload: 'student_memory_snapshot',
      canonicalScopeKey: 'student-1',
    });
  });

  it('supersedes an eligible Batch claim without delaying the fresh online request', async () => {
    await requestStudentMemorySnapshotRefresh({
      config: { generation: {} } as never,
      params: {
        studentId: 'student-1',
        trigger: 'manual-replay',
        replayKey: 'replay-1',
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Backfill missing alpha snapshots',
      },
    });

    expect(supersedeClaimsMock).toHaveBeenCalledWith({
      workload: 'student_memory_snapshot',
      canonicalScopeKey: 'student-1',
    });
    expect(ensurePendingMock).toHaveBeenCalled();
    expect(enqueueMock).toHaveBeenCalled();
  });

  it('uses the pending snapshot id as the queue key for manual replay too', async () => {
    await requestStudentMemorySnapshotRefresh({
      config: {
        generation: {},
      } as never,
      params: {
        studentId: 'student-1',
        trigger: 'manual-replay',
        replayKey: 'replay-1',
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Backfill missing alpha snapshots',
      },
    });

    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'student-memory-snapshot-refresh',
        pendingEntryId: 'snapshot-pending-1',
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Backfill missing alpha snapshots',
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
        replayKey: 'replay-1',
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Backfill missing alpha snapshots',
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

  it('carries explicit manual candidate-refresh requests into pending notes and the queue payload', async () => {
    await requestStudentMemorySnapshotRefresh({
      config: {
        generation: {},
      } as never,
      params: {
        studentId: 'student-1',
        trigger: 'manual-replay',
        replayKey: 'replay-1',
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Backfill missing alpha snapshots',
        requestCandidateRefresh: true,
      },
    });

    expect(ensurePendingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationNotes: expect.objectContaining({
          requestCandidateRefresh: true,
        }),
      }),
    );
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestCandidateRefresh: true,
      }),
      expect.any(Object),
    );
  });

  it('requires explicit strategy and operator reason for manual replay', async () => {
    await expect(
      requestStudentMemorySnapshotRefresh({
        config: { generation: {} } as never,
        params: { studentId: 'student-1', trigger: 'manual-replay', replayKey: 'replay-1' },
      }),
    ).rejects.toThrow('Manual student-memory snapshot replay requires --strategy');

    await expect(
      requestStudentMemorySnapshotRefresh({
        config: { generation: {} } as never,
        params: {
          studentId: 'student-1',
          trigger: 'manual-replay',
          replayKey: 'replay-1',
          strategy: 'manual_rebuild_v1_1',
        },
      }),
    ).rejects.toThrow('Manual student-memory snapshot replay requires --reason');
  });

  it('requires source entry id for normal lesson and homework refresh requests', async () => {
    await expect(
      requestStudentMemorySnapshotRefresh({
        config: { generation: {} } as never,
        params: { studentId: 'student-1', trigger: 'lesson-memory-ready' },
      }),
    ).rejects.toThrow('Student-memory snapshot refresh requires sourceEntryId');

    await expect(
      requestStudentMemorySnapshotRefresh({
        config: { generation: {} } as never,
        params: { studentId: 'student-1', trigger: 'homework-memory-ready', sourceEntryId: ' ' },
      }),
    ).rejects.toThrow('Student-memory snapshot refresh requires sourceEntryId');
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
    expect(supersedeClaimsMock).toHaveBeenCalledWith({
      workload: 'student_memory_snapshot',
      canonicalScopeKey: 'student-1',
    });
  });

  it('re-enqueues the same pending snapshot after queue insertion fails', async () => {
    ensurePendingMock
      .mockResolvedValueOnce({ outcome: 'created', entry: { id: 'snapshot-pending-1' } })
      .mockResolvedValueOnce({ outcome: 'pending_exists', entry: { id: 'snapshot-pending-1' } })
      .mockResolvedValueOnce({ outcome: 'pending_exists', entry: { id: 'snapshot-pending-1' } })
      .mockResolvedValueOnce({ outcome: 'pending_exists', entry: { id: 'snapshot-pending-1' } });
    enqueueMock.mockRejectedValueOnce(new Error('queue unavailable'));
    const args = {
      config: { generation: {} } as never,
      params: {
        studentId: 'student-1',
        trigger: 'homework-memory-ready' as const,
        sourceEntryId: 'homework-memory-1',
      },
    };

    await expect(requestStudentMemorySnapshotRefresh(args)).rejects.toThrow('queue unavailable');
    await requestStudentMemorySnapshotRefresh(args);

    expect(enqueueMock).toHaveBeenCalledTimes(2);
    expect(enqueueMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ pendingEntryId: 'snapshot-pending-1' }),
      expect.objectContaining({
        jobId: 'student-memory-snapshot:student-1:snapshot-pending-1',
      }),
    );
  });

  it('rechecks automatic homework coverage after batch arbitration before enqueueing', async () => {
    let concurrentBatchImportCompleted = false;
    ensurePendingMock.mockImplementation(async () =>
      concurrentBatchImportCompleted
        ? { outcome: 'already_reconciled', entry: { id: 'snapshot-ready-from-batch' } }
        : { outcome: 'created', entry: { id: 'snapshot-pending-1' } },
    );
    supersedeClaimsMock.mockImplementation(async () => {
      concurrentBatchImportCompleted = true;
      return [];
    });

    const result = await requestStudentMemorySnapshotRefresh({
      config: { generation: {} } as never,
      params: {
        studentId: 'student-1',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-memory-1',
      },
    });

    expect(result).toMatchObject({
      outcome: 'already_reconciled',
      entry: { id: 'snapshot-ready-from-batch' },
    });
    expect(ensurePendingMock).toHaveBeenCalledTimes(2);
    expect(supersedeClaimsMock).toHaveBeenCalledTimes(1);
    expect(supersedeClaimsMock.mock.invocationCallOrder[0]).toBeLessThan(
      ensurePendingMock.mock.invocationCallOrder[1] ?? Number.POSITIVE_INFINITY,
    );
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it('enqueues created automatic homework work after the second reconciliation retains its pending row', async () => {
    ensurePendingMock
      .mockResolvedValueOnce({ outcome: 'created', entry: { id: 'snapshot-pending-1' } })
      .mockResolvedValueOnce({ outcome: 'pending_exists', entry: { id: 'snapshot-pending-1' } });

    await requestStudentMemorySnapshotRefresh({
      config: { generation: {} } as never,
      params: {
        studentId: 'student-1',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-memory-1',
      },
    });

    expect(supersedeClaimsMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ pendingEntryId: 'snapshot-pending-1' }),
      expect.objectContaining({ jobId: 'student-memory-snapshot:student-1:snapshot-pending-1' }),
    );
  });

  it('re-enqueues existing automatic homework work after the second reconciliation retains its pending row', async () => {
    ensurePendingMock.mockResolvedValue({
      outcome: 'pending_exists',
      entry: { id: 'snapshot-pending-existing' },
    });

    await requestStudentMemorySnapshotRefresh({
      config: { generation: {} } as never,
      params: {
        studentId: 'student-1',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-memory-1',
      },
    });

    expect(ensurePendingMock).toHaveBeenCalledTimes(2);
    expect(supersedeClaimsMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ pendingEntryId: 'snapshot-pending-existing' }),
      expect.objectContaining({
        jobId: 'student-memory-snapshot:student-1:snapshot-pending-existing',
      }),
    );
  });

  it('does not enqueue a second automatic homework refresh after a ready snapshot covers its source', async () => {
    ensurePendingMock.mockResolvedValueOnce({
      outcome: 'already_reconciled',
      entry: { id: 'snapshot-ready-1' },
    });

    const result = await requestStudentMemorySnapshotRefresh({
      config: { generation: {} } as never,
      params: {
        studentId: 'student-1',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-memory-1',
      },
    });

    expect(result.outcome).toBe('already_reconciled');
    expect(ensurePendingMock).toHaveBeenCalledWith(
      expect.objectContaining({ reuseReadyHomeworkSource: true }),
    );
    expect(supersedeClaimsMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
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
