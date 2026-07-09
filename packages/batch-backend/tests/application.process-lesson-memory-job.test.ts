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
      strictNoPaid: false,
      safetyMode: 'off' as const,
    },
  };
}

describe('application/process-lesson-memory-job', () => {
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
          pendingEntryId: 'pending-1',
          provider: 'openai',
          model: 'gpt-5.2',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: {
          transcripts: {
            getByRecordingId: vi.fn().mockResolvedValue({
              id: 'transcript-1',
              recordingId: 'recording-1',
              storageUri: 'local://transcript',
            }),
          },
          promptPackages: {
            getById: vi.fn().mockResolvedValue(null),
          },
          storageFactory: vi.fn().mockReturnValue({
            getText: vi.fn().mockResolvedValue('TRANSCRIPT'),
          }),
          generator: vi.fn().mockRejectedValue(new Error('provider failed')),
          lessonMemory: {
            getById: vi.fn().mockResolvedValue({
              id: 'pending-1',
              status: 'pending',
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

  it('supersedes pending lesson-memory entries after a successful ready write', async () => {
    const supersedePendingForTranscript = vi.fn().mockResolvedValue([]);
    const applyGeneratedTitleIfPlaceholder = vi.fn().mockResolvedValue(true);

    await processLessonMemoryJob({
      config: createTestConfig(),
      payload: {
        kind: 'lesson-memory-generate',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        studentId: 'student-1',
        promptPackageId: 'prompt-1',
        lessonId: 'lesson-1',
        pendingEntryId: 'pending-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      overrides: {
        transcripts: {
          getByRecordingId: vi.fn().mockResolvedValue({
            id: 'transcript-1',
            recordingId: 'recording-1',
            storageUri: 'local://transcript',
          }),
        },
        promptPackages: {
          getById: vi.fn().mockResolvedValue({
            id: 'prompt-1',
            notes: 'Teacher notes',
          }),
        },
        storageFactory: vi.fn().mockReturnValue({
          getText: vi.fn().mockResolvedValue('TRANSCRIPT'),
        }),
        generator: vi.fn().mockResolvedValue({
          entry: {
            id: 'ready-1',
            lessonTitle: 'Travel Plans Review',
            generatedAt: new Date('2026-03-20T00:00:00.000Z'),
          },
        }),
        lessonMemory: {
          getById: vi.fn().mockResolvedValue({
            id: 'pending-1',
            status: 'pending',
          }),
          markFailed: vi.fn(),
          supersedePendingForTranscript,
        },
        snapshots: {
          requestRefresh: vi.fn(),
        },
        lessons: {
          applyGeneratedTitleIfPlaceholder,
        },
      },
    });

    expect(supersedePendingForTranscript).toHaveBeenCalledWith({
      transcriptId: 'transcript-1',
      supersededById: 'ready-1',
      supersededAt: new Date('2026-03-20T00:00:00.000Z'),
    });
    expect(applyGeneratedTitleIfPlaceholder).toHaveBeenCalledWith({
      studentId: 'student-1',
      lessonId: 'lesson-1',
      title: 'Travel Plans Review',
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
          pendingEntryId: 'pending-1',
          provider: 'openai',
          model: 'gpt-5.4-mini',
        },
        attemptsMade: 4,
        maxAttempts: 5,
        overrides: {
          transcripts: {
            getByRecordingId: vi.fn().mockResolvedValue({
              id: 'transcript-1',
              recordingId: 'recording-1',
              storageUri: 'local://transcript',
            }),
          },
          promptPackages: { getById: vi.fn().mockResolvedValue(null) },
          storageFactory: vi.fn().mockReturnValue({ getText: vi.fn().mockResolvedValue('TEXT') }),
          generator: vi.fn(),
          lessonMemory: {
            getById: vi.fn().mockResolvedValue({ id: 'pending-1', status: 'pending' }),
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
});
