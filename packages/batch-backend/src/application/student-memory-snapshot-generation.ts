import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import type { StudentMemorySnapshotRecord } from '../domain/student-memory-snapshot-model.js';
import { insertCanonicalReadyStudentMemorySnapshot } from '../domain/student-memory-snapshot-repository.js';
import type { ProviderStructuredExecutionResult } from './generation-providers.js';
import type { GenerationRequestEnvelopeV1 } from './generation-request-envelope.js';
import {
  type ExtractStudentMemorySnapshotContentRequest,
  extractStudentMemorySnapshotContent,
} from './student-memory-snapshot-extraction.js';
import { hashStudentMemorySnapshotContent } from './student-memory-snapshot-hashes.js';

export const STUDENT_MEMORY_SNAPSHOT_SCHEMA_VERSION = 'student-memory-snapshot.v1';

export interface GenerateStudentMemorySnapshotRequest {
  studentId: string;
  lessonMemoryEntryIds: string[];
  homeworkMemoryEntryIds: string[];
  pendingEntryId?: string | null;
  pendingGenerationNotes?: Record<string, unknown> | null;
  provider: GenerationProvider;
  model: string;
  prompt: string;
  envelope?: GenerationRequestEnvelopeV1;
  maxOutputTokens?: number;
}

export interface GenerateStudentMemorySnapshotResult {
  snapshot: StudentMemorySnapshotRecord;
  providerRequestId?: string;
  usage?: ProviderStructuredExecutionResult['usage'];
}

export interface GenerateStudentMemorySnapshotDependencies {
  extractor: typeof extractStudentMemorySnapshotContent;
  repository: {
    insertCanonicalReady: typeof insertCanonicalReadyStudentMemorySnapshot;
  };
  now: () => Date;
}

export async function generateStudentMemorySnapshot(args: {
  config: BatchBackendConfig['generation'];
  request: GenerateStudentMemorySnapshotRequest;
  overrides?: Partial<GenerateStudentMemorySnapshotDependencies>;
}): Promise<GenerateStudentMemorySnapshotResult> {
  const extractor = args.overrides?.extractor ?? extractStudentMemorySnapshotContent;
  const repository = args.overrides?.repository ?? {
    insertCanonicalReady: insertCanonicalReadyStudentMemorySnapshot,
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
    } satisfies ExtractStudentMemorySnapshotContentRequest,
  });

  const generatedAt = now();
  const contentHash = hashStudentMemorySnapshotContent(extraction.content);

  const snapshot = await repository.insertCanonicalReady({
    studentId: args.request.studentId,
    schemaVersion: STUDENT_MEMORY_SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    provider: args.request.provider,
    model: args.request.model,
    lessonMemoryEntryIds: args.request.lessonMemoryEntryIds,
    homeworkMemoryEntryIds: args.request.homeworkMemoryEntryIds,
    contentHash,
    generationNotes: {
      ...args.request.pendingGenerationNotes,
      pendingEntryId: args.request.pendingEntryId ?? null,
      providerRequestId: extraction.providerRequestId ?? null,
      usage: extraction.usage ?? null,
    },
    stableStrengths: extraction.content.stableStrengths,
    recurringIssues: extraction.content.recurringIssues,
    activeReviewBacklog: extraction.content.activeReviewBacklog,
    recentProgress: extraction.content.recentProgress,
    personalFacts: extraction.content.personalFacts,
    recommendedAssignmentDirections: extraction.content.recommendedAssignmentDirections,
    unresolvedIssues: extraction.content.unresolvedIssues,
    snapshotSummary: extraction.content.snapshotSummary,
  });

  return {
    snapshot,
    providerRequestId: extraction.providerRequestId,
    usage: extraction.usage,
  };
}
