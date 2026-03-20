import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { HomeworkMemoryRecord } from '../domain/homework-memory-model.js';
import { insertCanonicalReadyHomeworkMemoryEntry } from '../domain/homework-memory-repository.js';
import type { ProviderStructuredExecutionResult } from './generation-providers.js';
import {
  extractHomeworkMemoryContent,
  type ExtractHomeworkMemoryContentRequest,
} from './homework-memory-extraction.js';
import type { HomeworkMemorySourceBundle } from './homework-memory-source.js';

export const HOMEWORK_MEMORY_SCHEMA_VERSION = 'homework-memory.v1';

export interface GenerateHomeworkMemoryFromSourceRequest {
  source: HomeworkMemorySourceBundle;
  provider: GenerationProvider;
  model: string;
  prompt: string;
  maxOutputTokens?: number;
}

export interface GenerateHomeworkMemoryFromSourceResult {
  entry: HomeworkMemoryRecord;
  providerRequestId?: string;
  usage?: ProviderStructuredExecutionResult['usage'];
}

export interface HomeworkMemoryGenerationDependencies {
  extractor: typeof extractHomeworkMemoryContent;
  repository: {
    insertCanonicalReady: typeof insertCanonicalReadyHomeworkMemoryEntry;
  };
  now: () => Date;
}

export async function generateHomeworkMemoryFromSource(args: {
  config: BatchBackendConfig['generation'];
  request: GenerateHomeworkMemoryFromSourceRequest;
  overrides?: Partial<HomeworkMemoryGenerationDependencies>;
}): Promise<GenerateHomeworkMemoryFromSourceResult> {
  const extractor = args.overrides?.extractor ?? extractHomeworkMemoryContent;
  const repository = args.overrides?.repository ?? {
    insertCanonicalReady: insertCanonicalReadyHomeworkMemoryEntry,
  };
  const now = args.overrides?.now ?? (() => new Date());

  const extraction = await extractor({
    config: args.config,
    request: {
      provider: args.request.provider,
      model: args.request.model,
      prompt: args.request.prompt,
      maxOutputTokens: args.request.maxOutputTokens,
    } satisfies ExtractHomeworkMemoryContentRequest,
  });

  const generatedAt = now();
  const entry = await repository.insertCanonicalReady({
    studentId: args.request.source.studentId,
    jobId: args.request.source.jobId,
    assignmentLineageKey: args.request.source.assignmentLineageKey,
    promptPackageId: args.request.source.promptPackageId ?? null,
    draftId: args.request.source.draftId ?? null,
    recordingId: args.request.source.recordingId ?? null,
    transcriptId: args.request.source.transcriptId ?? null,
    schemaVersion: HOMEWORK_MEMORY_SCHEMA_VERSION,
    generatedAt,
    provider: args.request.provider,
    model: args.request.model,
    contentHash: args.request.source.contentHash,
    generationNotes: {
      providerRequestId: extraction.providerRequestId ?? null,
      usage: extraction.usage ?? null,
    },
    homeworkSummary: extraction.content.homeworkSummary,
    topic: extraction.content.topic,
    grammarTargets: extraction.content.grammarTargets,
    vocabularyTargets: extraction.content.vocabularyTargets,
    reviewTargets: extraction.content.reviewTargets,
    taskList: extraction.content.taskList,
    pronunciationFocus: extraction.content.pronunciationFocus,
    studyTextType: extraction.content.studyTextType,
    inputType: extraction.content.inputType,
    communicativeOutcome: extraction.content.communicativeOutcome,
    teacherFollowUpCues: extraction.content.teacherFollowUpCues,
    publishedAt: args.request.source.publishedAt,
    publishTargets: args.request.source.publishTargets,
  });

  return {
    entry,
    providerRequestId: extraction.providerRequestId,
    usage: extraction.usage,
  };
}
