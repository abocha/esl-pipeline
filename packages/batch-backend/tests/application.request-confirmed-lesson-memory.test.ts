import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConfirmedLessonMemoryRequestError,
  requestConfirmedLessonMemory,
} from '../src/application/request-confirmed-lesson-memory.js';
import type { BatchBackendConfig } from '../src/config/env.js';

const config = { generation: {} } as BatchBackendConfig;

function createDependencies() {
  return {
    students: {
      getById: vi.fn().mockResolvedValue({ id: 'student-1', student: 'Cora' }),
    },
    recordings: {
      getById: vi.fn().mockResolvedValue({
        id: 'recording-1',
        studentId: 'student-1',
      }),
      updateStudentId: vi.fn().mockResolvedValue({
        id: 'recording-1',
        studentId: 'student-1',
      }),
    },
    transcripts: {
      getByRecordingId: vi.fn().mockResolvedValue({
        id: 'transcript-1',
        recordingId: 'recording-1',
      }),
    },
    lessonMemory: {
      requestGeneration: vi.fn().mockResolvedValue({
        outcome: 'created' as const,
        entry: { id: 'lesson-memory-1', lessonTitle: null },
      }),
    },
    lessons: {
      applyGeneratedTitleIfPlaceholder: vi.fn().mockResolvedValue(false),
    },
  };
}

describe('application/request-confirmed-lesson-memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queues lesson memory after the tutor confirms the transcript-student pairing', async () => {
    const dependencies = createDependencies();

    const result = await requestConfirmedLessonMemory({
      config,
      params: {
        studentId: 'student-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        lessonId: 'lesson-1',
      },
      overrides: dependencies,
    });

    expect(result).toEqual({
      outcome: 'created',
      lessonMemoryEntryId: 'lesson-memory-1',
      lessonTitle: null,
    });
    expect(dependencies.lessonMemory.requestGeneration).toHaveBeenCalledWith({
      config,
      params: {
        studentId: 'student-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        lessonId: 'lesson-1',
        trigger: 'teacher-confirmed-transcript',
      },
    });
  });

  it('rejects a transcript that does not belong to the confirmed recording', async () => {
    const dependencies = createDependencies();
    dependencies.transcripts.getByRecordingId.mockResolvedValue({
      id: 'other-transcript',
      recordingId: 'recording-1',
    });

    await expect(
      requestConfirmedLessonMemory({
        config,
        params: {
          studentId: 'student-1',
          recordingId: 'recording-1',
          transcriptId: 'transcript-1',
        },
        overrides: dependencies,
      }),
    ).rejects.toMatchObject({
      name: 'ConfirmedLessonMemoryRequestError',
      code: 'transcript_recording_mismatch',
      status: 400,
    } satisfies Partial<ConfirmedLessonMemoryRequestError>);

    expect(dependencies.lessonMemory.requestGeneration).not.toHaveBeenCalled();
  });

  it('updates the recording binding before enqueueing when the confirmed student changed', async () => {
    const dependencies = createDependencies();
    dependencies.recordings.getById.mockResolvedValue({
      id: 'recording-1',
      studentId: 'wrong-student',
    });

    await requestConfirmedLessonMemory({
      config,
      params: {
        studentId: 'student-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
      },
      overrides: dependencies,
    });

    expect(dependencies.recordings.updateStudentId).toHaveBeenCalledWith({
      id: 'recording-1',
      studentId: 'student-1',
    });
    expect(dependencies.lessonMemory.requestGeneration).toHaveBeenCalled();
  });

  it('does not enqueue duplicate work when current lesson memory is already ready', async () => {
    const dependencies = createDependencies();
    dependencies.lessonMemory.requestGeneration.mockResolvedValue({
      outcome: 'ready_exists' as const,
      entry: { id: 'ready-1', lessonTitle: 'Travel Small Talk' },
    });

    const result = await requestConfirmedLessonMemory({
      config,
      params: {
        studentId: 'student-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        lessonId: 'lesson-1',
      },
      overrides: dependencies,
    });

    expect(result).toEqual({
      outcome: 'ready_exists',
      lessonMemoryEntryId: 'ready-1',
      lessonTitle: 'Travel Small Talk',
    });
    expect(dependencies.lessons.applyGeneratedTitleIfPlaceholder).toHaveBeenCalledWith({
      studentId: 'student-1',
      lessonId: 'lesson-1',
      title: 'Travel Small Talk',
    });
  });
});
