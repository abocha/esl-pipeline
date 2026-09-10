import { describe, expect, it, vi } from 'vitest';

import { processHomeworkMemoryJob } from '../src/application/process-homework-memory-job.js';
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

describe('application/process-homework-memory-job', () => {
  it('returns early when the pending homework-memory entry is no longer pending', async () => {
    const sourceResolver = vi.fn();
    const generator = vi.fn();
    const requestRefresh = vi.fn();

    await processHomeworkMemoryJob({
      config: createTestConfig(),
      payload: {
        kind: 'homework-memory-generate',
        jobId: 'job-1',
        studentId: 'student-1',
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      overrides: {
        sourceResolver,
        generator,
        homeworkMemory: {
          getById: vi.fn().mockResolvedValue({
            id: 'pending-1',
            status: 'superseded',
          }),
          getLatestReadyByAssignmentLineageKey: vi.fn(),
          markFailed: vi.fn(),
          supersedePendingForAssignmentLineage: vi.fn(),
        },
        snapshots: {
          requestRefresh,
        },
      },
    });

    expect(sourceResolver).not.toHaveBeenCalled();
    expect(generator).not.toHaveBeenCalled();
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it('reconciles the same canonical snapshot request on retry when enqueue failed after commit', async () => {
    const sourcePending = {
      id: 'pending-1',
      status: 'pending',
      jobId: 'correction-1',
      studentId: 'student-1',
      assignmentLineageKey: 'root-1',
      contentHash: 'hash-1',
      generatedAt: new Date('2026-03-20T00:00:00.000Z'),
      generationNotes: { trigger: 'publish-correction-succeeded' },
    };
    const canonicalEntry = {
      id: 'ready-1',
      status: 'ready',
      jobId: 'correction-1',
      studentId: 'student-1',
      assignmentLineageKey: 'root-1',
      contentHash: 'hash-1',
      generationNotes: { pendingEntryId: 'pending-1' },
      generatedAt: new Date('2026-03-20T00:01:00.000Z'),
    };
    const getById = vi
      .fn()
      .mockResolvedValueOnce(sourcePending)
      .mockResolvedValueOnce({ ...sourcePending, status: 'superseded', supersededById: 'ready-1' })
      .mockResolvedValueOnce(canonicalEntry);
    const generator = vi.fn().mockResolvedValue({
      outcome: 'canonical_committed',
      entry: canonicalEntry,
    });
    const requestRefresh = vi.fn().mockRejectedValueOnce(new Error('snapshot queue unavailable'));

    const args = {
      config: createTestConfig(),
      payload: {
        kind: 'homework-memory-generate' as const,
        jobId: 'correction-1',
        studentId: 'student-1',
        pendingEntryId: 'pending-1',
        provider: 'openai' as const,
        model: 'gpt-5.2',
      },
      overrides: {
        sourceResolver: vi.fn().mockResolvedValue({
          jobId: 'correction-1',
          assignmentLineageKey: 'root-1',
          studentId: 'student-1',
          publishedAt: new Date('2026-03-20T00:00:00.000Z'),
          publishedMarkdown: '# Corrected homework',
          contentHash: 'hash-1',
          publishTargets: [],
          normalizedMarkdown: {
            frontmatter: null,
            sections: [],
            plainText: '# Corrected homework',
          },
        }),
        generator,
        homeworkMemory: {
          getById,
          getLatestReadyByAssignmentLineageKey: vi.fn().mockResolvedValue(null),
          markFailed: vi.fn(),
          supersedePendingForAssignmentLineage: vi.fn(),
        },
        snapshots: { requestRefresh },
      },
    };

    await expect(processHomeworkMemoryJob(args as never)).rejects.toThrow(
      'snapshot queue unavailable',
    );
    await processHomeworkMemoryJob(args as never);

    expect(generator).toHaveBeenCalledTimes(1);
    expect(requestRefresh).toHaveBeenCalledTimes(2);
    expect(requestRefresh).toHaveBeenLastCalledWith({
      config: args.config,
      params: {
        studentId: 'student-1',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'ready-1',
      },
    });
  });

  it('marks the pending homework-memory entry failed on the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processHomeworkMemoryJob({
        config: createTestConfig(),
        payload: {
          kind: 'homework-memory-generate',
          jobId: 'job-1',
          studentId: 'student-1',
          pendingEntryId: 'pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: {
          sourceResolver: vi.fn().mockRejectedValue(new Error('provider failed')),
          generator: vi.fn(),
          homeworkMemory: {
            getById: vi.fn().mockResolvedValue({
              id: 'pending-1',
              status: 'pending',
              generatedAt: new Date('2026-03-20T00:00:00.000Z'),
              generationNotes: { trigger: 'publish-succeeded' },
            }),
            getLatestReadyByAssignmentLineageKey: vi.fn().mockResolvedValue(null),
            markFailed,
            supersedePendingForAssignmentLineage: vi.fn(),
          },
          snapshots: {
            requestRefresh: vi.fn(),
          },
        },
      }),
    ).rejects.toThrow('provider failed');

    expect(markFailed).toHaveBeenCalledWith({
      id: 'pending-1',
      errorMessage: 'provider failed',
    });
  });

  it('generates canonical homework memory from the pending lineage and requests snapshot refresh', async () => {
    const generator = vi.fn().mockResolvedValue({
      outcome: 'canonical_committed',
      entry: {
        id: 'homework-memory-1',
        generatedAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    });
    const requestRefresh = vi.fn().mockResolvedValue(null);
    const supersedePendingForAssignmentLineage = vi.fn().mockResolvedValue([]);

    await processHomeworkMemoryJob({
      config: createTestConfig(),
      payload: {
        kind: 'homework-memory-generate',
        jobId: 'job-1',
        studentId: 'student-1',
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      overrides: {
        sourceResolver: vi.fn().mockResolvedValue({
          jobId: 'job-1',
          assignmentLineageKey: 'lineage-1',
          studentId: 'student-1',
          promptPackageId: 'prompt-1',
          draftId: 'draft-1',
          recordingId: 'recording-1',
          transcriptId: 'transcript-1',
          publishedAt: new Date('2026-03-20T00:00:00.000Z'),
          publishedMarkdown: '# Assignment',
          contentHash: 'hash-1',
          publishTargets: [
            {
              target: 'html',
              url: 'https://example.com/homework',
              jobId: 'job-1',
              publishedAt: '2026-03-20T00:00:00.000Z',
            },
          ],
          normalizedMarkdown: {
            frontmatter: 'student: Test',
            sections: [{ heading: 'Mission', content: 'Explain the problem and give advice.' }],
            plainText: 'Mission Explain the problem and give advice.',
          },
        }),
        generator,
        homeworkMemory: {
          getById: vi.fn().mockResolvedValue({
            id: 'pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T00:00:00.000Z'),
            generationNotes: {
              trigger: 'publish-succeeded',
              requestedAt: '2026-03-20T00:00:00.000Z',
            },
          }),
          getLatestReadyByAssignmentLineageKey: vi.fn().mockResolvedValue(null),
          markFailed: vi.fn(),
          supersedePendingForAssignmentLineage,
        },
        snapshots: {
          requestRefresh,
        },
      },
    });

    expect(generator).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          source: expect.objectContaining({
            assignmentLineageKey: 'lineage-1',
            studentId: 'student-1',
          }),
          pendingEntryId: 'pending-1',
          pendingGenerationNotes: {
            trigger: 'publish-succeeded',
            requestedAt: '2026-03-20T00:00:00.000Z',
          },
          provider: 'openai',
          model: 'gpt-5.2',
          prompt: expect.stringContaining('[PUBLISH_METADATA]'),
        }),
      }),
    );
    expect(supersedePendingForAssignmentLineage).toHaveBeenCalledWith({
      assignmentLineageKey: 'lineage-1',
      supersededById: 'homework-memory-1',
      supersededAt: new Date('2026-03-20T00:00:00.000Z'),
      maxGeneratedAt: new Date('2026-03-20T00:00:00.000Z'),
    });
    expect(requestRefresh).toHaveBeenCalledWith({
      config: expect.objectContaining({
        generation: expect.objectContaining({ defaultProvider: 'openai' }),
      }),
      params: {
        studentId: 'student-1',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-memory-1',
      },
    });
  });

  it('supersedes pending work without regenerating when canonical ready homework already exists for the same content', async () => {
    const sourceResolver = vi.fn().mockResolvedValue({
      jobId: 'job-1',
      assignmentLineageKey: 'lineage-1',
      studentId: 'student-1',
      publishedAt: new Date('2026-03-20T00:00:00.000Z'),
      publishedMarkdown: '# Assignment',
      contentHash: 'hash-1',
      publishTargets: [],
      normalizedMarkdown: {
        frontmatter: null,
        sections: [],
        plainText: '# Assignment',
      },
    });
    const generator = vi.fn();
    const supersedePendingForAssignmentLineage = vi.fn().mockResolvedValue([]);
    const requestRefresh = vi.fn();

    await processHomeworkMemoryJob({
      config: createTestConfig(),
      payload: {
        kind: 'homework-memory-generate',
        jobId: 'job-1',
        studentId: 'student-1',
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      overrides: {
        sourceResolver,
        generator,
        homeworkMemory: {
          getById: vi.fn().mockResolvedValue({
            id: 'pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T00:30:00.000Z'),
            generationNotes: { trigger: 'publish-succeeded' },
          }),
          getLatestReadyByAssignmentLineageKey: vi.fn().mockResolvedValue({
            id: 'ready-1',
            contentHash: 'hash-1',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
          }),
          markFailed: vi.fn(),
          supersedePendingForAssignmentLineage,
        },
        snapshots: {
          requestRefresh,
        },
      },
    });

    expect(generator).not.toHaveBeenCalled();
    expect(supersedePendingForAssignmentLineage).toHaveBeenCalledWith({
      assignmentLineageKey: 'lineage-1',
      supersededById: 'ready-1',
      supersededAt: new Date('2026-03-20T01:00:00.000Z'),
      maxGeneratedAt: new Date('2026-03-20T00:30:00.000Z'),
    });
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it('does not refresh student memory when a stale correction result is discarded at canonical commit', async () => {
    const generator = vi.fn().mockResolvedValue({
      outcome: 'stale_discarded',
      entry: null,
    });
    const requestRefresh = vi.fn();
    const supersedePendingForAssignmentLineage = vi.fn();

    await processHomeworkMemoryJob({
      config: createTestConfig(),
      payload: {
        kind: 'homework-memory-generate',
        jobId: 'correction-a',
        studentId: 'student-1',
        pendingEntryId: 'pending-a',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      overrides: {
        sourceResolver: vi.fn().mockResolvedValue({
          jobId: 'correction-a',
          assignmentLineageKey: 'root-job',
          studentId: 'student-1',
          publishedAt: new Date('2026-03-20T10:00:00.000Z'),
          publishedMarkdown: '# Earlier correction',
          contentHash: 'hash-a',
          publishTargets: [],
          normalizedMarkdown: {
            frontmatter: null,
            sections: [],
            plainText: '# Earlier correction',
          },
        }),
        generator,
        homeworkMemory: {
          getById: vi.fn().mockResolvedValue({
            id: 'pending-a',
            status: 'pending',
            generatedAt: new Date('2026-03-20T10:00:00.000Z'),
            generationNotes: { trigger: 'publish-correction-succeeded' },
          }),
          getLatestReadyByAssignmentLineageKey: vi.fn().mockResolvedValue(null),
          markFailed: vi.fn(),
          supersedePendingForAssignmentLineage,
        },
        snapshots: { requestRefresh },
      },
    });

    expect(supersedePendingForAssignmentLineage).not.toHaveBeenCalled();
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it('honors forceRegenerate and still rebuilds homework memory when same-content ready rows exist', async () => {
    const generator = vi.fn().mockResolvedValue({
      outcome: 'canonical_committed',
      entry: {
        id: 'homework-memory-replay-1',
        generatedAt: new Date('2026-03-20T02:00:00.000Z'),
      },
    });
    const supersedePendingForAssignmentLineage = vi.fn().mockResolvedValue([]);
    const requestRefresh = vi.fn().mockResolvedValue(null);

    await processHomeworkMemoryJob({
      config: createTestConfig(),
      payload: {
        kind: 'homework-memory-generate',
        jobId: 'job-1',
        studentId: 'student-1',
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      overrides: {
        sourceResolver: vi.fn().mockResolvedValue({
          jobId: 'job-1',
          assignmentLineageKey: 'lineage-1',
          studentId: 'student-1',
          publishedAt: new Date('2026-03-20T00:00:00.000Z'),
          publishedMarkdown: '# Assignment',
          contentHash: 'hash-1',
          publishTargets: [],
          normalizedMarkdown: {
            frontmatter: null,
            sections: [],
            plainText: '# Assignment',
          },
        }),
        generator,
        homeworkMemory: {
          getById: vi.fn().mockResolvedValue({
            id: 'pending-1',
            status: 'pending',
            generatedAt: new Date('2026-03-20T01:30:00.000Z'),
            generationNotes: {
              trigger: 'publish-succeeded',
              forceRegenerate: true,
            },
          }),
          getLatestReadyByAssignmentLineageKey: vi.fn().mockResolvedValue({
            id: 'ready-1',
            contentHash: 'hash-1',
            generatedAt: new Date('2026-03-20T01:00:00.000Z'),
          }),
          markFailed: vi.fn(),
          supersedePendingForAssignmentLineage,
        },
        snapshots: {
          requestRefresh,
        },
      },
    });

    expect(generator).toHaveBeenCalled();
    expect(supersedePendingForAssignmentLineage).toHaveBeenCalledWith({
      assignmentLineageKey: 'lineage-1',
      supersededById: 'homework-memory-replay-1',
      supersededAt: new Date('2026-03-20T02:00:00.000Z'),
      maxGeneratedAt: new Date('2026-03-20T01:30:00.000Z'),
    });
    expect(requestRefresh).toHaveBeenCalledWith({
      config: expect.objectContaining({
        generation: expect.objectContaining({ defaultProvider: 'openai' }),
      }),
      params: {
        studentId: 'student-1',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-memory-replay-1',
      },
    });
  });

  it('keeps a pending homework-memory row pending when pacing defers the provider call', async () => {
    const markFailed = vi.fn();
    const deferred = new StudentMemoryPacingDeferredError({
      reason: 'provider_rate_limit',
      provider: 'openai',
      model: 'gpt-5.4-mini',
      notBefore: new Date('2026-06-21T10:12:00.000Z'),
      estimatedTokens: 400,
    });
    const run = vi.fn().mockRejectedValue(deferred);

    await expect(
      processHomeworkMemoryJob({
        config: createTestConfig(),
        payload: {
          kind: 'homework-memory-generate',
          jobId: 'job-1',
          studentId: 'student-1',
          pendingEntryId: 'pending-1',
          provider: 'openai',
          model: 'gpt-5.4-mini',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: {
          sourceResolver: vi.fn().mockResolvedValue({
            assignmentLineageKey: 'lineage-1',
            studentId: 'student-1',
            publishedAt: new Date('2026-06-21T10:00:00.000Z'),
            publishedMarkdown: '# Assignment',
            contentHash: 'hash-1',
            publishTargets: [],
            normalizedMarkdown: { frontmatter: null, sections: [], plainText: '# Assignment' },
          }),
          generator: vi.fn(),
          homeworkMemory: {
            getById: vi.fn().mockResolvedValue({
              id: 'pending-1',
              status: 'pending',
              generatedAt: new Date('2026-06-21T10:00:00.000Z'),
              generationNotes: null,
            }),
            getLatestReadyByAssignmentLineageKey: vi.fn().mockResolvedValue(null),
            markFailed,
            supersedePendingForAssignmentLineage: vi.fn(),
          },
          snapshots: { requestRefresh: vi.fn() },
          pacer: { run } as never,
        } as never,
      }),
    ).rejects.toBe(deferred);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        workload: 'homework_memory',
        provider: 'openai',
        model: 'gpt-5.4-mini',
      }),
    );
    expect(markFailed).not.toHaveBeenCalled();
  });
});
