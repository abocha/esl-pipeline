import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  getLessonMemoryEntryById,
  markLessonMemoryEntryFailed,
  supersedePendingLessonMemoryEntriesForTranscript,
} from '../domain/lesson-memory-repository.js';
import { getPromptPackageById } from '../domain/prompt-package-repository.js';
import { getTranscriptByRecordingId } from '../domain/transcript-repository.js';
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

export interface ProcessLessonMemoryJobPayload {
  kind: 'lesson-memory-generate';
  transcriptId: string;
  recordingId: string;
  studentId: string;
  promptPackageId?: string | null;
  pendingEntryId: string;
  provider: GenerationProvider;
  model: string;
}

export interface ProcessLessonMemoryJobDependencies {
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingId;
  };
  promptPackages: {
    getById: typeof getPromptPackageById;
  };
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
  pacer: StudentMemoryGenerationPacer;
}

export async function processLessonMemoryJob(args: {
  config: BatchBackendConfig;
  payload: ProcessLessonMemoryJobPayload;
  attemptsMade?: number;
  maxAttempts?: number;
  overrides?: Partial<ProcessLessonMemoryJobDependencies & GenerateLessonMemoryEntryDependencies>;
}): Promise<void> {
  const transcripts = args.overrides?.transcripts ?? {
    getByRecordingId: getTranscriptByRecordingId,
  };
  const promptPackages = args.overrides?.promptPackages ?? {
    getById: getPromptPackageById,
  };
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
  const pacer = args.overrides?.pacer ?? createStudentMemoryGenerationPacer(args.config);

  const pendingEntry = await lessonMemory.getById(args.payload.pendingEntryId);
  if (!pendingEntry || pendingEntry.status !== 'pending') {
    return;
  }

  const transcript = await transcripts.getByRecordingId(args.payload.recordingId);
  if (!transcript || transcript.id !== args.payload.transcriptId) {
    await markFailureIfFinalAttempt({
      payload: args.payload,
      attemptsMade: args.attemptsMade,
      maxAttempts: args.maxAttempts,
      lessonMemory,
      error: new Error('Lesson-memory transcript could not be resolved from recording lineage'),
    });
    return;
  }

  const storage = storageFactory(transcript.storageUri);
  const transcriptText = await storage.getText(transcript.storageUri);
  const promptPackage = args.payload.promptPackageId
    ? await promptPackages.getById(args.payload.promptPackageId)
    : null;

  try {
    const prompt = buildLessonMemoryPrompt({
      transcriptText,
      teacherNotes: promptPackage?.notes ?? null,
    });
    const envelope = buildLessonMemoryEnvelope({
      transcriptId: args.payload.transcriptId,
      transcriptText,
      teacherNotes: promptPackage?.notes ?? null,
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
            prompt,
            envelope,
          },
          overrides: args.overrides,
        }),
    });

    await lessonMemory.supersedePendingForTranscript({
      transcriptId: args.payload.transcriptId,
      supersededById: result.entry.id,
      supersededAt: result.entry.generatedAt,
    });
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
