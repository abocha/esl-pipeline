import type { BatchBackendConfig } from '../config/env.js';
import {
  type ProcessHomeworkMemoryJobPayload,
  processHomeworkMemoryJob,
} from './process-homework-memory-job.js';
import {
  type ProcessLessonMemoryJobPayload,
  processLessonMemoryJob,
} from './process-lesson-memory-job.js';
import {
  type ProcessStudentMemorySnapshotJobPayload,
  processStudentMemorySnapshotJob,
} from './process-student-memory-snapshot-job.js';
import {
  type ProcessStudentProfileCandidateRefreshJobPayload,
  processStudentProfileCandidateRefreshJob,
} from './process-student-profile-candidate-refresh-job.js';

export type StudentMemoryQueuePayload =
  | ProcessLessonMemoryJobPayload
  | ProcessHomeworkMemoryJobPayload
  | ProcessStudentMemorySnapshotJobPayload
  | ProcessStudentProfileCandidateRefreshJobPayload;

export async function processStudentMemoryJob(args: {
  config: BatchBackendConfig['generation'];
  payload: StudentMemoryQueuePayload;
  attemptsMade?: number;
  maxAttempts?: number;
}): Promise<void> {
  if (args.payload.kind === 'lesson-memory-generate') {
    await processLessonMemoryJob({
      config: args.config,
      payload: args.payload,
      attemptsMade: args.attemptsMade,
      maxAttempts: args.maxAttempts,
    });
    return;
  }

  if (args.payload.kind === 'student-memory-snapshot-refresh') {
    await processStudentMemorySnapshotJob({
      config: args.config,
      payload: args.payload,
      attemptsMade: args.attemptsMade,
      maxAttempts: args.maxAttempts,
    });
    return;
  }

  if (args.payload.kind === 'homework-memory-generate') {
    await processHomeworkMemoryJob({
      config: args.config,
      payload: args.payload,
      attemptsMade: args.attemptsMade,
      maxAttempts: args.maxAttempts,
    });
    return;
  }

  if (args.payload.kind === 'student-profile-candidate-refresh') {
    await processStudentProfileCandidateRefreshJob({
      payload: args.payload,
    });
  }
}
