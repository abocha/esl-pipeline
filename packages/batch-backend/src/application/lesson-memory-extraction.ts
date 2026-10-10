import type { ZodIssue } from 'zod';

import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { assertSupportedGenerationTarget } from './generation-policy.js';
import {
  executeOpenAiStructuredGeneration,
  type ProviderStructuredExecutionRequest,
  type ProviderStructuredExecutionResult,
} from './generation-providers.js';
import {
  type GenerationRequestEnvelopeV1,
  resolveGenerationRequestText,
} from './generation-request-envelope.js';
import {
  LESSON_MEMORY_CONTENT_JSON_SCHEMA,
  LESSON_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
  LESSON_MEMORY_RESPONSE_SCHEMA_NAME,
  type LessonMemoryContent,
  validateLessonMemoryContent,
} from './lesson-memory-content-schema.js';
import { assertEvidenceSourcesInEnvelope } from './source-evidence-validation.js';

type StructuredProviderExecutor = (args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}) => Promise<ProviderStructuredExecutionResult>;

const DEFAULT_STRUCTURED_EXECUTORS: Partial<
  Record<GenerationProvider, StructuredProviderExecutor>
> = {
  openai: executeOpenAiStructuredGeneration,
};

export interface ExtractLessonMemoryContentRequest {
  provider: GenerationProvider;
  model: string;
  prompt: string;
  envelope?: GenerationRequestEnvelopeV1;
  maxOutputTokens?: number;
}

export interface ExtractLessonMemoryContentResult {
  content: LessonMemoryContent;
  rawOutput: unknown;
  rawText: string;
  providerRequestId?: string;
  usage?: ProviderStructuredExecutionResult['usage'];
}

export class LessonMemoryExtractionValidationError extends Error {
  readonly issues: ZodIssue[];
  readonly rawOutput: unknown;

  constructor(args: { message: string; issues: ZodIssue[]; rawOutput: unknown }) {
    super(args.message);
    this.name = 'LessonMemoryExtractionValidationError';
    this.issues = args.issues;
    this.rawOutput = args.rawOutput;
  }
}

export async function extractLessonMemoryContent(args: {
  config: BatchBackendConfig['generation'];
  request: ExtractLessonMemoryContentRequest;
  executors?: Partial<Partial<Record<GenerationProvider, StructuredProviderExecutor>>>;
}): Promise<ExtractLessonMemoryContentResult> {
  assertSupportedGenerationTarget(args.request);
  const executors = {
    ...DEFAULT_STRUCTURED_EXECUTORS,
    ...args.executors,
  };

  const executor = executors[args.request.provider];
  if (!executor) {
    throw new Error(
      `No structured extraction executor configured for provider: ${args.request.provider}`,
    );
  }

  const result = await executor({
    config: args.config,
    request: {
      model: args.request.model,
      prompt: resolveGenerationRequestText(args.request),
      ...(args.request.envelope ? { envelope: args.request.envelope } : {}),
      maxOutputTokens: args.request.maxOutputTokens,
      responseSchema: {
        name: LESSON_MEMORY_RESPONSE_SCHEMA_NAME,
        description: LESSON_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
        schema: LESSON_MEMORY_CONTENT_JSON_SCHEMA,
        strict: true,
      },
    },
  });

  try {
    const content = validateLessonMemoryContent(result.output);
    assertEvidenceSourcesInEnvelope(content, args.request.envelope);
    return {
      content,
      rawOutput: result.output,
      rawText: result.rawText,
      providerRequestId: result.providerRequestId,
      usage: result.usage,
    };
  } catch (error) {
    if (error instanceof Error && 'issues' in error && Array.isArray(error.issues)) {
      throw new LessonMemoryExtractionValidationError({
        message: 'Lesson-memory extraction output failed schema validation',
        issues: error.issues as ZodIssue[],
        rawOutput: result.output,
      });
    }
    throw error;
  }
}
