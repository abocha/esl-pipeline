import type { BatchBackendConfig } from '../config/env.js';
import {
  type GenerationRequestEnvelopeV1,
  isGenerationRequestEnvelope,
} from './generation-request-envelope.js';
import { extractHomeworkMemoryContent } from './homework-memory-extraction.js';
import { extractLessonMemoryContent } from './lesson-memory-extraction.js';
import { parseOpenAiStructuredResponsesPayload } from './openai-responses-contract.js';
import { extractStudentMemorySnapshotContent } from './student-memory-snapshot-extraction.js';

export async function validateStudentMemoryOpenAiBatchResponse(args: {
  config: BatchBackendConfig['generation'];
  item: {
    workload: 'lesson_memory' | 'homework_memory' | 'student_memory_snapshot';
    model: string;
    requestEnvelope: unknown;
  };
  response: unknown;
}): Promise<{
  content: unknown;
  providerRequestId?: string;
  returnedModel?: string;
  finishReason?: string;
  usage?: unknown;
}> {
  if (!isGenerationRequestEnvelope(args.item.requestEnvelope)) {
    throw new Error('Stored Batch item does not contain a valid generation request envelope');
  }
  const envelope = args.item.requestEnvelope;
  const parsed = parseOpenAiStructuredResponsesPayload(args.response);
  const executor = async () => ({
    output: parsed.output,
    rawText: parsed.rawText,
    model: parsed.model,
    providerRequestId: parsed.providerRequestId,
    usage: parsed.usage,
    finishReason: parsed.finishReason,
  });
  const common = {
    config: args.config,
    request: {
      provider: 'openai' as const,
      model: args.item.model,
      prompt: 'Batch response validation reuses the immutable request envelope.',
      envelope,
    },
    executors: { openai: executor },
  };

  switch (args.item.workload) {
    case 'lesson_memory': {
      const result = await extractLessonMemoryContent(common);
      return metadata(result.content, result, parsed);
    }
    case 'homework_memory': {
      const result = await extractHomeworkMemoryContent(common);
      return metadata(result.content, result, parsed);
    }
    case 'student_memory_snapshot': {
      const result = await extractStudentMemorySnapshotContent(common);
      return metadata(result.content, result, parsed);
    }
  }
}

function metadata(
  content: unknown,
  result: {
    providerRequestId?: string;
    usage?: unknown;
  },
  parsed: { model?: string; finishReason?: string },
) {
  return {
    content,
    ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
    ...(parsed.model ? { returnedModel: parsed.model } : {}),
    ...(parsed.finishReason ? { finishReason: parsed.finishReason } : {}),
    ...(result.usage ? { usage: result.usage } : {}),
  };
}
