import type { BatchBackendConfig } from '../config/env.js';
import { getRecordingById, updateRecordingStudentId } from '../domain/recording-repository.js';
import { getTranscriptByRecordingId } from '../domain/transcript-repository.js';
import { requestLessonMemoryGeneration } from './request-lesson-memory-generation.js';
import { getStudentProfileById } from './student-profiles-store.js';
import { applyGeneratedLessonTitleIfPlaceholder } from './student-schedule-billing.js';

export interface RequestConfirmedLessonMemoryParams {
  studentId: string;
  recordingId: string;
  transcriptId: string;
  lessonId?: string | null;
}

export interface RequestConfirmedLessonMemoryResponse {
  outcome: 'created' | 'pending_exists' | 'ready_exists';
  lessonMemoryEntryId: string;
  lessonTitle?: string | null;
}

export class ConfirmedLessonMemoryRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ConfirmedLessonMemoryRequestError';
    this.code = code;
    this.status = status;
  }
}

export interface RequestConfirmedLessonMemoryDependencies {
  students: {
    getById: typeof getStudentProfileById;
  };
  recordings: {
    getById: typeof getRecordingById;
    updateStudentId: typeof updateRecordingStudentId;
  };
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingId;
  };
  lessonMemory: {
    requestGeneration: typeof requestLessonMemoryGeneration;
  };
  lessons: {
    applyGeneratedTitleIfPlaceholder: typeof applyGeneratedLessonTitleIfPlaceholder;
  };
}

export async function requestConfirmedLessonMemory(args: {
  config: BatchBackendConfig;
  params: RequestConfirmedLessonMemoryParams;
  overrides?: Partial<RequestConfirmedLessonMemoryDependencies>;
}): Promise<RequestConfirmedLessonMemoryResponse> {
  const dependencies: RequestConfirmedLessonMemoryDependencies = {
    students: args.overrides?.students ?? { getById: getStudentProfileById },
    recordings: args.overrides?.recordings ?? {
      getById: getRecordingById,
      updateStudentId: updateRecordingStudentId,
    },
    transcripts: args.overrides?.transcripts ?? { getByRecordingId: getTranscriptByRecordingId },
    lessonMemory: args.overrides?.lessonMemory ?? {
      requestGeneration: requestLessonMemoryGeneration,
    },
    lessons: args.overrides?.lessons ?? {
      applyGeneratedTitleIfPlaceholder: applyGeneratedLessonTitleIfPlaceholder,
    },
  };

  const student = await dependencies.students.getById(args.params.studentId, {
    config: args.config,
  });
  if (!student) {
    throw new ConfirmedLessonMemoryRequestError('student_not_found', 404, 'Student not found');
  }

  const recording = await dependencies.recordings.getById(args.params.recordingId);
  if (!recording) {
    throw new ConfirmedLessonMemoryRequestError('recording_not_found', 404, 'Recording not found');
  }

  const transcript = await dependencies.transcripts.getByRecordingId(args.params.recordingId);
  if (!transcript || transcript.id !== args.params.transcriptId) {
    throw new ConfirmedLessonMemoryRequestError(
      'transcript_recording_mismatch',
      400,
      'Transcript does not match the confirmed recording',
    );
  }

  if (recording.studentId !== args.params.studentId) {
    await dependencies.recordings.updateStudentId({
      id: args.params.recordingId,
      studentId: args.params.studentId,
    });
  }

  const result = await dependencies.lessonMemory.requestGeneration({
    config: args.config,
    params: {
      studentId: args.params.studentId,
      recordingId: args.params.recordingId,
      transcriptId: args.params.transcriptId,
      lessonId: args.params.lessonId ?? null,
      trigger: 'teacher-confirmed-transcript',
    },
  });

  if (!result) {
    throw new ConfirmedLessonMemoryRequestError(
      'lesson_memory_request_failed',
      500,
      'Lesson memory request could not be created',
    );
  }

  if (result.outcome === 'ready_exists' && args.params.lessonId && result.entry.lessonTitle) {
    await dependencies.lessons.applyGeneratedTitleIfPlaceholder({
      studentId: args.params.studentId,
      lessonId: args.params.lessonId,
      title: result.entry.lessonTitle,
    });
  }

  return {
    outcome: result.outcome,
    lessonMemoryEntryId: result.entry.id,
    lessonTitle: result.entry.lessonTitle ?? null,
  };
}
