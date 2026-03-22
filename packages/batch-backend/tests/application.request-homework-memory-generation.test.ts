import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  enqueueMock,
  resolveHomeworkMemorySourceFromSucceededJobMock,
  ensurePendingHomeworkMemoryEntryMock,
} = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  resolveHomeworkMemorySourceFromSucceededJobMock: vi.fn(),
  ensurePendingHomeworkMemoryEntryMock: vi.fn(),
}));

vi.mock('../src/infrastructure/student-memory-queue.js', () => ({
  createStudentMemoryQueue: vi.fn(() => ({
    enqueue: enqueueMock,
  })),
}));

vi.mock('../src/application/generation-policy.js', () => ({
  resolveGenerationCandidates: vi.fn((args?: { providerOverride?: string; modelOverride?: string }) => [
    {
      provider: args?.providerOverride ?? 'openrouter',
      model: args?.modelOverride ?? 'qwen/qwen3.5',
    },
  ]),
}));

vi.mock('../src/application/homework-memory-source.js', async () => {
  const actual = await vi.importActual('../src/application/homework-memory-source.js');
  return {
    ...actual,
    resolveHomeworkMemorySourceFromSucceededJob: resolveHomeworkMemorySourceFromSucceededJobMock,
  };
});

vi.mock('../src/domain/homework-memory-repository.js', () => ({
  ensurePendingHomeworkMemoryEntry: ensurePendingHomeworkMemoryEntryMock,
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
    resolveHomeworkMemorySourceFromSucceededJobMock.mockResolvedValue({
      jobId: 'job-2',
      assignmentLineageKey: 'job-2',
      studentId: 'student-1',
      publishedAt: new Date('2026-03-20T00:00:00.000Z'),
      publishedMarkdown: '# Homework',
      contentHash: 'hash-1',
      publishTargets: [],
      normalizedMarkdown: {
        frontmatter: null,
        sections: [],
        plainText: '# Homework',
      },
    });
    ensurePendingHomeworkMemoryEntryMock.mockResolvedValue({
      outcome: 'created',
      entry: {
        id: 'pending-1',
      },
    });
  });

  it('uses the pending entry id as the BullMQ job key so forced reruns enqueue fresh work', async () => {
    await requestHomeworkMemoryGeneration({
      config: {
        generation: {},
      } as never,
      params: {
        jobId: 'job-2',
        studentId: 'student-1',
      },
    });

    expect(resolveHomeworkMemorySourceFromSucceededJobMock).toHaveBeenCalledWith('job-2');
    expect(ensurePendingHomeworkMemoryEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assignmentLineageKey: 'job-2',
        contentHash: 'hash-1',
        schemaVersion: 'homework-memory.v1',
      }),
    );
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'homework-memory-generate',
        jobId: 'job-2',
        studentId: 'student-1',
        pendingEntryId: 'pending-1',
      }),
      expect.objectContaining({
        jobId: 'homework-memory:pending-1',
      }),
    );
  });

  it('re-enqueues an existing pending row so replay can recover from transient queue misses', async () => {
    ensurePendingHomeworkMemoryEntryMock.mockResolvedValue({
      outcome: 'pending_exists',
      entry: {
        id: 'pending-1',
      },
    });

    const result = await requestHomeworkMemoryGeneration({
      config: {
        generation: {},
      } as never,
      params: {
        jobId: 'job-2',
        studentId: 'student-1',
      },
    });

    expect(result?.outcome).toBe('pending_exists');
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'homework-memory-generate',
        jobId: 'job-2',
        studentId: 'student-1',
        pendingEntryId: 'pending-1',
      }),
      expect.objectContaining({
        jobId: 'homework-memory:pending-1',
      }),
    );
  });

  it('lets replay flows bypass same-content ready deduplication', async () => {
    await requestHomeworkMemoryGeneration({
      config: {
        generation: {},
      } as never,
      params: {
        jobId: 'job-2',
        studentId: 'student-1',
        forceRegenerate: true,
      },
    });

    expect(ensurePendingHomeworkMemoryEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        bypassReadyReuse: true,
        generationNotes: expect.objectContaining({
          forceRegenerate: true,
        }),
      }),
    );
  });

  it('honors provider and model overrides for operator replay flows', async () => {
    await requestHomeworkMemoryGeneration({
      config: {
        generation: {},
      } as never,
      params: {
        jobId: 'job-2',
        studentId: 'student-1',
        providerOverride: 'openai',
        modelOverride: 'gpt-5.4-mini',
      },
    });

    expect(ensurePendingHomeworkMemoryEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.4-mini',
      }),
    );
    expect(enqueueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.4-mini',
      }),
      expect.any(Object),
    );
  });

  it('skips rerun descendant jobs so only canonical root assignments generate homework memory', async () => {
    resolveHomeworkMemorySourceFromSucceededJobMock.mockResolvedValue({
      jobId: 'job-rerun',
      assignmentLineageKey: 'job-root',
      studentId: 'student-1',
      publishedAt: new Date('2026-03-20T00:00:00.000Z'),
      publishedMarkdown: '# Homework',
      contentHash: 'hash-1',
      publishTargets: [],
      normalizedMarkdown: {
        frontmatter: null,
        sections: [],
        plainText: '# Homework',
      },
    });

    const result = await requestHomeworkMemoryGeneration({
      config: {
        generation: {},
      } as never,
      params: {
        jobId: 'job-rerun',
        studentId: 'student-1',
      },
    });

    expect(result).toBeNull();
    expect(ensurePendingHomeworkMemoryEntryMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
