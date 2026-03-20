import type { BatchBackendConfig } from '../config/env.js';
import {
  processHomeworkMemoryJob,
  type ProcessHomeworkMemoryJobPayload,
} from './process-homework-memory-job.js';
import {
  processLessonMemoryJob,
  type ProcessLessonMemoryJobPayload,
} from './process-lesson-memory-job.js';
import {
  processStudentMemorySnapshotJob,
  type ProcessStudentMemorySnapshotJobPayload,
} from './process-student-memory-snapshot-job.js';

export type StudentMemoryQueuePayload =
  | ProcessLessonMemoryJobPayload
  | ProcessHomeworkMemoryJobPayload
  | ProcessStudentMemorySnapshotJobPayload;

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
}
