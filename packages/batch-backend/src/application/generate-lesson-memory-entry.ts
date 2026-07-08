import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { LessonMemoryRecord } from '../domain/lesson-memory-model.js';
import { insertCanonicalReadyLessonMemoryEntry } from '../domain/lesson-memory-repository.js';
import type { ProviderStructuredExecutionResult } from './generation-providers.js';
import type { GenerationRequestEnvelopeV1 } from './generation-request-envelope.js';
import {
  type ExtractLessonMemoryContentRequest,
  extractLessonMemoryContent,
} from './lesson-memory-extraction.js';

export const LESSON_MEMORY_SCHEMA_VERSION = 'lesson-memory.v1';

export interface GenerateLessonMemoryEntryRequest {
  studentId: string;
  transcriptId: string;
  recordingId: string;
  provider: GenerationProvider;
  model: string;
  prompt: string;
  envelope?: GenerationRequestEnvelopeV1;
  maxOutputTokens?: number;
}

export interface GenerateLessonMemoryEntryResult {
  entry: LessonMemoryRecord;
  providerRequestId?: string;
  usage?: ProviderStructuredExecutionResult['usage'];
}

export interface GenerateLessonMemoryEntryDependencies {
  extractor: typeof extractLessonMemoryContent;
  repository: {
    insertCanonicalReady: typeof insertCanonicalReadyLessonMemoryEntry;
  };
  now: () => Date;
}

export async function generateLessonMemoryEntry(args: {
  config: BatchBackendConfig['generation'];
  request: GenerateLessonMemoryEntryRequest;
  overrides?: Partial<GenerateLessonMemoryEntryDependencies>;
}): Promise<GenerateLessonMemoryEntryResult> {
  const extractor = args.overrides?.extractor ?? extractLessonMemoryContent;
  const repository = args.overrides?.repository ?? {
    insertCanonicalReady: insertCanonicalReadyLessonMemoryEntry,
  };
  const now = args.overrides?.now ?? (() => new Date());

  const extraction = await extractor({
    config: args.config,
    request: {
      provider: args.request.provider,
      model: args.request.model,
      prompt: args.request.prompt,
      ...(args.request.envelope ? { envelope: args.request.envelope } : {}),
      maxOutputTokens: args.request.maxOutputTokens,
    } satisfies ExtractLessonMemoryContentRequest,
  });

  const generatedAt = now();
  const entry = await repository.insertCanonicalReady({
    studentId: args.request.studentId,
    transcriptId: args.request.transcriptId,
    recordingId: args.request.recordingId,
    schemaVersion: LESSON_MEMORY_SCHEMA_VERSION,
    generatedAt,
    provider: args.request.provider,
    model: args.request.model,
    generationNotes: {
      providerRequestId: extraction.providerRequestId ?? null,
      usage: extraction.usage ?? null,
    },
    lessonTitle: extraction.content.lessonTitle ?? null,
    lessonSummary: extraction.content.lessonSummary,
    topicsDiscussed: extraction.content.topicsDiscussed,
    mistakePatterns: extraction.content.mistakePatterns,
    grammarReviewed: extraction.content.grammarReviewed,
    grammarWatchlist: extraction.content.grammarWatchlist,
    vocabularyFocus: extraction.content.vocabularyFocus,
    pronunciationFocus: extraction.content.pronunciationFocus,
    studentFacts: extraction.content.studentFacts,
    progressSignals: extraction.content.progressSignals,
    followUpRecommendations: extraction.content.followUpRecommendations,
  });

  return {
    entry,
    providerRequestId: extraction.providerRequestId,
    usage: extraction.usage,
  };
}
