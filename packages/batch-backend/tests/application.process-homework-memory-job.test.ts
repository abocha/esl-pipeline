import { describe, expect, it, vi } from 'vitest';

import { processHomeworkMemoryJob } from '../src/application/process-homework-memory-job.js';

describe('application/process-homework-memory-job', () => {
  it('returns early when the pending homework-memory entry is no longer pending', async () => {
    const sourceResolver = vi.fn();
    const generator = vi.fn();
    const requestRefresh = vi.fn();

    await processHomeworkMemoryJob({
      config: {
        defaultProvider: 'openai',
      } as never,
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

  it('marks the pending homework-memory entry failed on the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processHomeworkMemoryJob({
        config: {
          defaultProvider: 'openai',
        } as never,
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
      entry: {
        id: 'homework-memory-1',
        generatedAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    });
    const requestRefresh = vi.fn().mockResolvedValue(null);
    const supersedePendingForAssignmentLineage = vi.fn().mockResolvedValue([]);

    await processHomeworkMemoryJob({
      config: {
        defaultProvider: 'openai',
      } as never,
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
      config: {
        generation: {
          defaultProvider: 'openai',
        },
      },
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
      config: {
        defaultProvider: 'openai',
      } as never,
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

  it('honors forceRegenerate and still rebuilds homework memory when same-content ready rows exist', async () => {
    const generator = vi.fn().mockResolvedValue({
      entry: {
        id: 'homework-memory-replay-1',
        generatedAt: new Date('2026-03-20T02:00:00.000Z'),
      },
    });
    const supersedePendingForAssignmentLineage = vi.fn().mockResolvedValue([]);
    const requestRefresh = vi.fn().mockResolvedValue(null);

    await processHomeworkMemoryJob({
      config: {
        defaultProvider: 'openai',
      } as never,
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
      config: {
        generation: {
          defaultProvider: 'openai',
        },
      },
      params: {
        studentId: 'student-1',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-memory-replay-1',
      },
    });
  });
});
