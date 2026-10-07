import { describe, expect, it, vi } from 'vitest';

import { processLessonMemoryJob } from '../src/application/process-lesson-memory-job.js';
import { StudentMemoryPacingDeferredError } from '../src/application/student-memory-generation-pacing.js';
import { loadConfig } from '../src/config/env.js';

function createTestConfig() {
  const base = loadConfig();
  return {
    ...base,
    generation: {
      ...base.generation,

      safetyMode: 'off' as const,
    },
  };
}

describe('application/process-lesson-memory-job', () => {
  it('retries ready publication only through snapshot handoff without storage, pacing, or extraction', async () => {
    const generator = vi.fn();
    const storageFactory = vi.fn();
    const run = vi.fn();
    const requestRefresh = vi.fn();
    const markFailed = vi.fn();
    await processLessonMemoryJob({
      config: createTestConfig(),
      payload: {
        kind: 'lesson-memory-generate',
        studentId: 'student-1',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        pendingEntryId: 'ready-1',
        sourceStorageUri: 'local://a',
        sourceContentHash: 'a'.repeat(64),
        provider: 'openai',
        model: 'fixture',
      },
      overrides: {
        generator,
        storageFactory,
        pacer: { run },
        snapshots: { requestRefresh },
        lessonMemory: {
          getById: vi.fn().mockResolvedValue({
            id: 'ready-1',
            studentId: 'student-1',
            status: 'ready',
            sourceStorageUri: 'local://a',
            sourceContentHash: 'a'.repeat(64),
          }),
          markFailed,
          supersedePendingForTranscript: vi.fn(),
        },
      } as never,
    });
    expect(requestRefresh).toHaveBeenCalledWith({
      config: expect.any(Object),
      params: { studentId: 'student-1', trigger: 'lesson-memory-ready', sourceEntryId: 'ready-1' },
    });
    expect(generator).not.toHaveBeenCalled();
    expect(storageFactory).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('does not mark canonical ready extraction failed when snapshot handoff fails on the final attempt', async () => {
    const markFailed = vi.fn();
    await expect(
      processLessonMemoryJob({
        config: createTestConfig(),
        maxAttempts: 1,
        payload: {
          kind: 'lesson-memory-generate',
          studentId: 'student-1',
          transcriptId: 'transcript-1',
          recordingId: 'recording-1',
          pendingEntryId: 'pending-1',
          sourceStorageUri: 'local://a',
          sourceContentHash: '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
          provider: 'openai',
          model: 'fixture',
        },
        overrides: {
          storageFactory: () => ({ getText: async () => 'A' }),
          pacer: { run: async (args: { execute: () => Promise<unknown> }) => args.execute() },
          generator: vi.fn().mockResolvedValue({ entry: { id: 'pending-1', status: 'ready' } }),
          snapshots: {
            requestRefresh: vi.fn().mockRejectedValue(new Error('handoff interrupted')),
          },
          lessonMemory: {
            getById: vi.fn().mockResolvedValue({
              id: 'pending-1',
              studentId: 'student-1',
              status: 'pending',
              sourceStorageUri: 'local://a',
              sourceContentHash: '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
            }),
            markFailed,
            supersedePendingForTranscript: vi.fn(),
          },
        } as never,
      }),
    ).rejects.toThrow('handoff interrupted');
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('marks the pending lesson-memory entry failed on the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processLessonMemoryJob({
        config: createTestConfig(),
        payload: {
          kind: 'lesson-memory-generate',
          transcriptId: 'transcript-1',
          recordingId: 'recording-1',
          studentId: 'student-1',
          sourceStorageUri: 'local://confirmed/a.txt',
          sourceContentHash: '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
          pendingEntryId: 'pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: {
          storageFactory: vi.fn().mockReturnValue({
            getText: vi.fn().mockResolvedValue('A'),
          }),
          generator: vi.fn().mockRejectedValue(new Error('provider failed')),
          lessonMemory: {
            getById: vi.fn().mockResolvedValue({
              id: 'pending-1',
              status: 'pending',
              sourceStorageUri: 'local://confirmed/a.txt',
              sourceContentHash: '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
            }),
            markFailed,
            supersedePendingForTranscript: vi.fn(),
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

  it('marks immutable source read failures on the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processLessonMemoryJob({
        config: createTestConfig(),
        payload: {
          kind: 'lesson-memory-generate',
          transcriptId: 'transcript-1',
          recordingId: 'recording-1',
          studentId: 'student-1',
          sourceStorageUri: 'local://confirmed/a.txt',
          sourceContentHash: 'a'.repeat(64),
          pendingEntryId: 'pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: {
          storageFactory: vi.fn().mockReturnValue({
            getText: vi.fn().mockRejectedValue(new Error('confirmed source unavailable')),
          }),
          generator: vi.fn(),
          lessonMemory: {
            getById: vi.fn().mockResolvedValue({
              id: 'pending-1',
              status: 'pending',
              sourceStorageUri: 'local://confirmed/a.txt',
              sourceContentHash: 'a'.repeat(64),
            }),
            markFailed,
            supersedePendingForTranscript: vi.fn(),
          },
          snapshots: { requestRefresh: vi.fn() },
        } as never,
      }),
    ).rejects.toThrow('confirmed source unavailable');

    expect(markFailed).toHaveBeenCalledWith({
      id: 'pending-1',
      errorMessage: 'confirmed source unavailable',
    });
  });

  it('publishes the same confirmed pending intent and refreshes student memory', async () => {
    const generator = vi.fn().mockResolvedValue({
      entry: {
        id: 'pending-1',
        lessonTitle: 'Travel Plans Review',
        generatedAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    });
    const applyGeneratedTitleIfPlaceholder = vi.fn().mockResolvedValue(true);
    const requestRefresh = vi.fn().mockResolvedValue(undefined);

    await processLessonMemoryJob({
      config: createTestConfig(),
      payload: {
        kind: 'lesson-memory-generate',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        studentId: 'student-1',
        lessonId: 'lesson-1',
        sourceStorageUri: 'local://confirmed/a.txt',
        sourceContentHash: '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      overrides: {
        storageFactory: vi.fn().mockReturnValue({
          getText: vi.fn().mockResolvedValue('A'),
        }),
        generator,
        lessonMemory: {
          getById: vi.fn().mockResolvedValue({
            id: 'pending-1',
            status: 'pending',
            sourceStorageUri: 'local://confirmed/a.txt',
            sourceContentHash: '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
          }),
          markFailed: vi.fn(),
          supersedePendingForTranscript: vi.fn(),
        },
        snapshots: {
          requestRefresh,
        },
        lessons: {
          applyGeneratedTitleIfPlaceholder,
        },
      },
    });

    expect(generator).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          pendingEntryId: 'pending-1',
          sourceStorageUri: 'local://confirmed/a.txt',
        }),
      }),
    );
    expect(applyGeneratedTitleIfPlaceholder).toHaveBeenCalledWith({
      studentId: 'student-1',
      lessonId: 'lesson-1',
      title: 'Travel Plans Review',
    });
    expect(requestRefresh).toHaveBeenCalledWith({
      config: expect.any(Object),
      params: {
        studentId: 'student-1',
        trigger: 'lesson-memory-ready',
        sourceEntryId: 'pending-1',
      },
    });
  });

  it('keeps a pending lesson-memory row pending when pacing defers the provider call', async () => {
    const markFailed = vi.fn();
    const deferred = new StudentMemoryPacingDeferredError({
      reason: 'budget_tpm_minute',
      provider: 'openai',
      model: 'gpt-5.4-mini',
      notBefore: new Date('2026-06-21T10:12:00.000Z'),
      estimatedTokens: 400,
    });
    const run = vi.fn().mockRejectedValue(deferred);

    await expect(
      processLessonMemoryJob({
        config: createTestConfig(),
        payload: {
          kind: 'lesson-memory-generate',
          transcriptId: 'transcript-1',
          recordingId: 'recording-1',
          studentId: 'student-1',
          sourceStorageUri: 'local://confirmed/a.txt',
          sourceContentHash: '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
          pendingEntryId: 'pending-1',
          provider: 'openai',
          model: 'gpt-5.4-mini',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: {
          storageFactory: vi.fn().mockReturnValue({ getText: vi.fn().mockResolvedValue('A') }),
          generator: vi.fn(),
          lessonMemory: {
            getById: vi.fn().mockResolvedValue({
              id: 'pending-1',
              status: 'pending',
              sourceStorageUri: 'local://confirmed/a.txt',
              sourceContentHash: '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
            }),
            markFailed,
            supersedePendingForTranscript: vi.fn(),
          },
          snapshots: { requestRefresh: vi.fn() },
          pacer: { run } as never,
        } as never,
      }),
    ).rejects.toBe(deferred);

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        workload: 'lesson_memory',
        provider: 'openai',
        model: 'gpt-5.4-mini',
      }),
    );
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('reads only the confirmed URI and rejects content whose hash does not match', async () => {
    const getText = vi.fn().mockResolvedValue('B');
    const generator = vi.fn();
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processLessonMemoryJob({
        config: createTestConfig(),
        payload: {
          kind: 'lesson-memory-generate',
          transcriptId: 'transcript-1',
          recordingId: 'recording-1',
          studentId: 'student-1',
          sourceStorageUri: 'local://confirmed/a.txt',
          sourceContentHash: '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
          pendingEntryId: 'pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
        },
        overrides: {
          storageFactory: vi.fn().mockReturnValue({ getText }),
          generator,
          lessonMemory: {
            getById: vi.fn().mockResolvedValue({
              id: 'pending-1',
              status: 'pending',
              sourceStorageUri: 'local://confirmed/a.txt',
              sourceContentHash: '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd',
            }),
            markFailed,
            supersedePendingForTranscript: vi.fn(),
          },
          snapshots: { requestRefresh: vi.fn() },
        } as never,
      }),
    ).rejects.toThrow('hash');

    expect(getText).toHaveBeenCalledWith('local://confirmed/a.txt');
    expect(generator).not.toHaveBeenCalled();
  });
});
