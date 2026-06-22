import { createHash } from 'node:crypto';

import type { GenerationRequestEnvelopeV1 } from './generation-request-envelope.js';
import { buildOpenAiResponsesRequestBody } from './openai-responses-contract.js';
import type { StudentMemoryBatchWorkload } from './student-memory-openai-batch.js';

export interface PlannedStudentMemoryOpenAiBatchItem {
  customId: string;
  model: string;
  body: Record<string, unknown>;
  canonicalScopeKey: string;
  sourceVersionHash: string;
  requestEnvelope: GenerationRequestEnvelopeV1;
  responseSchemaFingerprint: string;
  sourceRefs: Record<string, unknown>;
}

export function buildStudentMemoryOpenAiBatchItem(args: {
  workload: StudentMemoryBatchWorkload;
  model: string;
  canonicalScopeKey: string;
  sourceVersionHash: string;
  envelope: GenerationRequestEnvelopeV1;
  sourceRefs: Record<string, unknown>;
  maxOutputTokens?: number;
}): PlannedStudentMemoryOpenAiBatchItem {
  if (args.envelope.workload !== args.workload) {
    throw new Error(`Batch workload does not match request envelope: ${args.workload}`);
  }
  const responseSchema = args.envelope.responseSchema;
  if (!responseSchema?.strict) {
    throw new Error('Batch replay requires a canonical strict response schema');
  }
  const responseSchemaFingerprint = sha256(JSON.stringify(responseSchema));
  const customId = `student-memory-batch:v1:${args.workload}:${sha256(
    JSON.stringify({
      canonicalScopeKey: args.canonicalScopeKey,
      sourceVersionHash: args.sourceVersionHash,
      envelopeVersion: args.envelope.version,
      promptVersion: args.envelope.promptVersion,
      responseSchemaFingerprint,
      model: args.model,
    }),
  )}`;

  return {
    customId,
    model: args.model,
    body: buildOpenAiResponsesRequestBody({
      model: args.model,
      envelope: args.envelope,
      responseSchema,
      maxOutputTokens: args.maxOutputTokens,
    }),
    canonicalScopeKey: args.canonicalScopeKey,
    sourceVersionHash: args.sourceVersionHash,
    requestEnvelope: args.envelope,
    responseSchemaFingerprint,
    sourceRefs: args.sourceRefs,
  };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
