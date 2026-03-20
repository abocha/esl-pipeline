import type { BatchBackendConfig } from '../config/env.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';
import { logger } from '../infrastructure/logger.js';
import { resolveGenerationCandidates } from './generation-policy.js';
import { resolveHomeworkMemoryQueueScope } from './homework-memory-source.js';

export async function requestHomeworkMemoryGeneration(args: {
  config: BatchBackendConfig;
  params: {
    jobId: string;
    studentId: string | null;
  };
}): Promise<void> {
  if (!args.params.studentId) {
    return;
  }

  const candidate = resolveGenerationCandidates({ config: args.config.generation })[0];
  if (!candidate) {
    throw new Error('No generation candidate is available for homework-memory extraction');
  }

  const queueScope = await resolveHomeworkMemoryQueueScope(args.params.jobId);

  await createStudentMemoryQueue().enqueue(
    {
      kind: 'homework-memory-generate',
      jobId: args.params.jobId,
      studentId: args.params.studentId,
      provider: candidate.provider,
      model: candidate.model,
    },
    {
      jobId: `homework-memory:${args.params.jobId}`,
    },
  );

  logger.info('Homework-memory generation requested', {
    event: 'homework_memory_generation_requested',
    jobId: args.params.jobId,
    queueScope,
    studentId: args.params.studentId,
  });
}
