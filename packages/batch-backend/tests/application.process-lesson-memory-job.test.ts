import { describe, expect, it, vi } from 'vitest';

import { processLessonMemoryJob } from '../src/application/process-lesson-memory-job.js';

describe('application/process-lesson-memory-job', () => {
  it('marks the pending lesson-memory entry failed on the final attempt', async () => {
    const markFailed = vi.fn().mockResolvedValue(null);

    await expect(
      processLessonMemoryJob({
        config: {
          defaultProvider: 'openai',
        } as never,
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

    await processLessonMemoryJob({
      config: {
        defaultProvider: 'openai',
      } as never,
      payload: {
        kind: 'lesson-memory-generate',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        studentId: 'student-1',
        promptPackageId: 'prompt-1',
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
      },
    });

    expect(supersedePendingForTranscript).toHaveBeenCalledWith({
      transcriptId: 'transcript-1',
      supersededById: 'ready-1',
      supersededAt: new Date('2026-03-20T00:00:00.000Z'),
    });
  });
});
