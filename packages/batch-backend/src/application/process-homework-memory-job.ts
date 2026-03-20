import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { buildHomeworkMemoryPrompt } from './homework-memory-prompt.js';
import { generateHomeworkMemoryFromSource } from './homework-memory-generation.js';
import { evaluateHomeworkMemoryGenerationForSucceededJob } from './homework-memory-source.js';
import { requestStudentMemorySnapshotRefresh } from './request-student-memory-snapshot-refresh.js';

export interface ProcessHomeworkMemoryJobPayload {
  kind: 'homework-memory-generate';
  jobId: string;
  studentId: string;
  provider: GenerationProvider;
  model: string;
}

export interface ProcessHomeworkMemoryJobDependencies {
  sourceEvaluator: typeof evaluateHomeworkMemoryGenerationForSucceededJob;
  generator: typeof generateHomeworkMemoryFromSource;
  snapshots: {
    requestRefresh: typeof requestStudentMemorySnapshotRefresh;
  };
}

export async function processHomeworkMemoryJob(args: {
  config: BatchBackendConfig['generation'];
  payload: ProcessHomeworkMemoryJobPayload;
  overrides?: Partial<ProcessHomeworkMemoryJobDependencies>;
}): Promise<void> {
  const sourceEvaluator =
    args.overrides?.sourceEvaluator ?? evaluateHomeworkMemoryGenerationForSucceededJob;
  const generator = args.overrides?.generator ?? generateHomeworkMemoryFromSource;
  const snapshots = args.overrides?.snapshots ?? {
    requestRefresh: requestStudentMemorySnapshotRefresh,
  };

  const decision = await sourceEvaluator(args.payload.jobId);
  if (!decision.shouldGenerate) {
    return;
  }

  const prompt = buildHomeworkMemoryPrompt({
    normalizedMarkdown: decision.source.normalizedMarkdown,
    source: decision.source,
  });

  const result = await generator({
    config: args.config,
    request: {
      source: decision.source,
      provider: args.payload.provider,
      model: args.payload.model,
      prompt,
    },
  });

  await snapshots.requestRefresh({
    config: { generation: args.config } as BatchBackendConfig,
    params: {
      studentId: args.payload.studentId,
      trigger: 'homework-memory-ready',
      sourceEntryId: result.entry.id,
    },
  });
}
