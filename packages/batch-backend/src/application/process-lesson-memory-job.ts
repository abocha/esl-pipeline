import { createHash } from 'node:crypto';

import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  getLessonMemoryEntryById,
  markLessonMemoryEntryFailed,
  supersedePendingLessonMemoryEntriesForTranscript,
} from '../domain/lesson-memory-repository.js';
import { logger } from '../infrastructure/logger.js';
import {
  createTranscriptionStorageForUri,
  type TranscriptionStorage,
} from '../infrastructure/transcription-storage.js';
import {
  type GenerateLessonMemoryEntryDependencies,
  generateLessonMemoryEntry,
} from './generate-lesson-memory-entry.js';
import { buildLessonMemoryEnvelope, buildLessonMemoryPrompt } from './lesson-memory-prompt.js';
import { requestStudentMemorySnapshotRefresh } from './request-student-memory-snapshot-refresh.js';
import {
  createStudentMemoryGenerationPacer,
  isStudentMemoryPacingDeferredError,
  type StudentMemoryGenerationPacer,
} from './student-memory-generation-pacing.js';
import { applyGeneratedLessonTitleIfPlaceholder } from './student-schedule-billing.js';

export interface ProcessLessonMemoryJobPayload {
  kind: 'lesson-memory-generate';
  transcriptId: string;
  recordingId: string;
  studentId: string;
  sourceStorageUri: string;
  sourceContentHash: string;
  lessonId?: string | null;
  pendingEntryId: string;
  provider: GenerationProvider;
  model: string;
}

export interface ProcessLessonMemoryJobDependencies {
  storageFactory: (uri: string) => TranscriptionStorage;
  generator: typeof generateLessonMemoryEntry;
  lessonMemory: {
    getById: typeof getLessonMemoryEntryById;
    markFailed: typeof markLessonMemoryEntryFailed;
    supersedePendingForTranscript: typeof supersedePendingLessonMemoryEntriesForTranscript;
  };
  snapshots: {
    requestRefresh: typeof requestStudentMemorySnapshotRefresh;
  };
  lessons: {
    applyGeneratedTitleIfPlaceholder: typeof applyGeneratedLessonTitleIfPlaceholder;
  };
  pacer: StudentMemoryGenerationPacer;
}

export async function processLessonMemoryJob(args: {
  config: BatchBackendConfig;
  payload: ProcessLessonMemoryJobPayload;
  attemptsMade?: number;
  maxAttempts?: number;
  overrides?: Partial<ProcessLessonMemoryJobDependencies & GenerateLessonMemoryEntryDependencies>;
}): Promise<void> {
  const storageFactory = args.overrides?.storageFactory ?? createTranscriptionStorageForUri;
  const generator = args.overrides?.generator ?? generateLessonMemoryEntry;
  const lessonMemory = args.overrides?.lessonMemory ?? {
    getById: getLessonMemoryEntryById,
    markFailed: markLessonMemoryEntryFailed,
    supersedePendingForTranscript: supersedePendingLessonMemoryEntriesForTranscript,
  };
  const snapshots = args.overrides?.snapshots ?? {
    requestRefresh: requestStudentMemorySnapshotRefresh,
  };
  const lessons = args.overrides?.lessons ?? {
    applyGeneratedTitleIfPlaceholder: applyGeneratedLessonTitleIfPlaceholder,
  };
  const pacer = args.overrides?.pacer ?? createStudentMemoryGenerationPacer(args.config);

  const pendingEntry = await lessonMemory.getById(args.payload.pendingEntryId);
  if (!pendingEntry || pendingEntry.status !== 'pending') {
    return;
  }

  if (
    pendingEntry.sourceStorageUri !== args.payload.sourceStorageUri ||
    pendingEntry.sourceContentHash !== args.payload.sourceContentHash
  ) {
    return;
  }

  const storage = storageFactory(args.payload.sourceStorageUri);
  const transcriptText = await storage.getText(args.payload.sourceStorageUri);

  try {
    const actualHash = createHash('sha256').update(transcriptText, 'utf8').digest('hex');
    if (actualHash !== args.payload.sourceContentHash) {
      throw new Error('Confirmed lesson-memory source hash mismatch');
    }
    const prompt = buildLessonMemoryPrompt({
      transcriptText,
      teacherNotes: null,
    });
    const envelope = buildLessonMemoryEnvelope({
      transcriptId: args.payload.transcriptId,
      transcriptText,
      teacherNotes: null,
    });

    const result = await pacer.run({
      workload: 'lesson_memory',
      provider: args.payload.provider,
      model: args.payload.model,
      prompt,
      execute: () =>
        generator({
          config: args.config.generation,
          request: {
            studentId: args.payload.studentId,
            transcriptId: args.payload.transcriptId,
            recordingId: args.payload.recordingId,
            provider: args.payload.provider,
            model: args.payload.model,
            pendingEntryId: args.payload.pendingEntryId,
            sourceStorageUri: args.payload.sourceStorageUri,
            sourceContentHash: args.payload.sourceContentHash,
            prompt,
            envelope,
          },
          overrides: args.overrides,
        }),
    });

    if (args.payload.lessonId && result.entry.lessonTitle) {
      try {
        await lessons.applyGeneratedTitleIfPlaceholder({
          studentId: args.payload.studentId,
          lessonId: args.payload.lessonId,
          title: result.entry.lessonTitle,
        });
      } catch (error) {
        logger.warn('Generated lesson title application failed; continuing memory refresh', {
          event: 'lesson_memory_title_apply_failed',
          lessonId: args.payload.lessonId,
          lessonMemoryEntryId: result.entry.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await snapshots.requestRefresh({
      config: args.config,
      params: {
        studentId: args.payload.studentId,
        trigger: 'lesson-memory-ready',
        sourceEntryId: result.entry.id,
      },
    });
  } catch (error) {
    if (isStudentMemoryPacingDeferredError(error)) {
      throw error;
    }
    await markFailureIfFinalAttempt({
      payload: args.payload,
      attemptsMade: args.attemptsMade,
      maxAttempts: args.maxAttempts,
      lessonMemory,
      error,
    });
    throw error;
  }
}

async function markFailureIfFinalAttempt(args: {
  payload: ProcessLessonMemoryJobPayload;
  attemptsMade?: number;
  maxAttempts?: number;
  lessonMemory: {
    markFailed: typeof markLessonMemoryEntryFailed;
  };
  error: unknown;
}): Promise<void> {
  const maxAttempts = args.maxAttempts ?? 1;
  const attemptNumber = (args.attemptsMade ?? 0) + 1;
  const isFinalAttempt = attemptNumber >= maxAttempts;
  if (!isFinalAttempt) {
    return;
  }

  await args.lessonMemory.markFailed({
    id: args.payload.pendingEntryId,
    errorMessage: args.error instanceof Error ? args.error.message : String(args.error),
  });
}
