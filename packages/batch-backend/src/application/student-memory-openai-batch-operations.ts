import { randomUUID } from 'node:crypto';

import type { BatchBackendConfig } from '../config/env.js';
import {
  createStudentMemoryOpenAiBatchRun,
  markStudentMemoryOpenAiBatchRunSubmitted,
} from '../domain/student-memory-openai-batch-repository.js';
import type { GenerationRequestEnvelopeV1 } from './generation-request-envelope.js';
import {
  buildStudentMemoryOpenAiBatchJsonl,
  createStudentMemoryOpenAiBatchTransport,
  type StudentMemoryBatchWorkload,
} from './student-memory-openai-batch.js';

export interface StudentMemoryOpenAiBatchPlanItem {
  id?: string;
  retryOfItemId?: string | null;
  studentId: string;
  customId: string;
  model: string;
  body: Record<string, unknown>;
  canonicalScopeKey: string;
  sourceVersionHash: string;
  requestEnvelope: GenerationRequestEnvelopeV1;
  responseSchemaFingerprint: string;
  sourceRefs: Record<string, unknown>;
}

export interface StudentMemoryOpenAiBatchPlanSummary {
  workload: StudentMemoryBatchWorkload;
  model: string;
  itemCount: number;
  inputBytes: number;
  inputJsonlSha256: string;
  customIds: string[];
}

export async function createStudentMemoryOpenAiBatchPlan(args: {
  workload: StudentMemoryBatchWorkload;
  model: string;
  items: StudentMemoryOpenAiBatchPlanItem[];
  persist: boolean;
  parentRetryRunId?: string | null;
  repository?: {
    createRun: typeof createStudentMemoryOpenAiBatchRun;
  };
}): Promise<{
  summary: StudentMemoryOpenAiBatchPlanSummary;
  jsonl: string;
  runId?: string;
}> {
  const jsonl = buildStudentMemoryOpenAiBatchJsonl({
    workload: args.workload,
    model: args.model,
    items: args.items.map((item) => ({
      customId: item.customId,
      model: item.model,
      body: item.body,
    })),
  });
  const summary = {
    workload: args.workload,
    model: args.model,
    itemCount: jsonl.itemCount,
    inputBytes: jsonl.byteLength,
    inputJsonlSha256: jsonl.sha256,
    customIds: args.items
      .map((item) => item.customId)
      .sort((left, right) => left.localeCompare(right)),
  } satisfies StudentMemoryOpenAiBatchPlanSummary;

  if (!args.persist) {
    return { summary, jsonl: jsonl.jsonl };
  }
  const repository = args.repository ?? { createRun: createStudentMemoryOpenAiBatchRun };
  const run = await repository.createRun({
    workload: args.workload,
    model: args.model,
    parentRetryRunId: args.parentRetryRunId ?? null,
    inputJsonlSha256: jsonl.sha256,
    inputBytes: jsonl.byteLength,
    items: args.items.map((item) => ({
      id: item.id ?? randomUUID(),
      retryOfItemId: item.retryOfItemId ?? null,
      studentId: item.studentId,
      customId: item.customId,
      canonicalScopeKey: item.canonicalScopeKey,
      sourceVersionHash: item.sourceVersionHash,
      requestEnvelope: item.requestEnvelope,
      responseSchemaFingerprint: item.responseSchemaFingerprint,
      requestBody: item.body,
      sourceRefs: item.sourceRefs,
    })),
  });
  return { summary, jsonl: jsonl.jsonl, runId: run.id };
}

export async function submitStudentMemoryOpenAiBatchPlan(args: {
  config: BatchBackendConfig;
  model: string;
  runId: string;
  jsonl: string;
  transport?: ReturnType<typeof createStudentMemoryOpenAiBatchTransport>;
  repository?: {
    markSubmitted: typeof markStudentMemoryOpenAiBatchRunSubmitted;
  };
}): Promise<{ remoteInputFileId: string; remoteBatchId: string }> {
  const transport = args.transport ?? createStudentMemoryOpenAiBatchTransport();
  const repository = args.repository ?? { markSubmitted: markStudentMemoryOpenAiBatchRunSubmitted };
  const uploaded = await transport.uploadInput({
    config: args.config,
    model: args.model,
    jsonl: args.jsonl,
  });
  const batch = await transport.createBatch({
    config: args.config,
    model: args.model,
    inputFileId: uploaded.id,
  });
  if (!batch.id) {
    throw new Error('OpenAI Batch create response did not include an id');
  }
  await repository.markSubmitted({
    runId: args.runId,
    remoteInputFileId: uploaded.id,
    remoteBatchId: batch.id,
  });
  return { remoteInputFileId: uploaded.id, remoteBatchId: batch.id };
}
