import type { ZodIssue } from 'zod';

import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  executeGoogleStructuredGeneration,
  executeOpenAiStructuredGeneration,
  executeOpenRouterStructuredGeneration,
  type ProviderStructuredExecutionRequest,
  type ProviderStructuredExecutionResult,
} from './generation-providers.js';
import {
  HOMEWORK_MEMORY_CONTENT_JSON_SCHEMA,
  HOMEWORK_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
  HOMEWORK_MEMORY_RESPONSE_SCHEMA_NAME,
  type HomeworkMemoryContent,
  validateHomeworkMemoryContent,
} from './homework-memory-content-schema.js';

type StructuredProviderExecutor = (args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}) => Promise<ProviderStructuredExecutionResult>;

const DEFAULT_STRUCTURED_EXECUTORS: Record<GenerationProvider, StructuredProviderExecutor> = {
  openai: executeOpenAiStructuredGeneration,
  google_ai_studio: executeGoogleStructuredGeneration,
  openrouter: executeOpenRouterStructuredGeneration,
};

export interface ExtractHomeworkMemoryContentRequest {
  provider: GenerationProvider;
  model: string;
  prompt: string;
  maxOutputTokens?: number;
}

export interface ExtractHomeworkMemoryContentResult {
  content: HomeworkMemoryContent;
  rawOutput: unknown;
  rawText: string;
  providerRequestId?: string;
  usage?: ProviderStructuredExecutionResult['usage'];
}

export class HomeworkMemoryExtractionValidationError extends Error {
  readonly issues: ZodIssue[];
  readonly rawOutput: unknown;

  constructor(args: { message: string; issues: ZodIssue[]; rawOutput: unknown }) {
    super(args.message);
    this.name = 'HomeworkMemoryExtractionValidationError';
    this.issues = args.issues;
    this.rawOutput = args.rawOutput;
  }
}

export async function extractHomeworkMemoryContent(args: {
  config: BatchBackendConfig['generation'];
  request: ExtractHomeworkMemoryContentRequest;
  executors?: Partial<Record<GenerationProvider, StructuredProviderExecutor>>;
}): Promise<ExtractHomeworkMemoryContentResult> {
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
      prompt: args.request.prompt,
      maxOutputTokens: args.request.maxOutputTokens,
      responseSchema: {
        name: HOMEWORK_MEMORY_RESPONSE_SCHEMA_NAME,
        description: HOMEWORK_MEMORY_RESPONSE_SCHEMA_DESCRIPTION,
        schema: HOMEWORK_MEMORY_CONTENT_JSON_SCHEMA,
        strict: true,
      },
    },
  });

  try {
    const content = validateHomeworkMemoryContent(result.output);
    return {
      content,
      rawOutput: result.output,
      rawText: result.rawText,
      providerRequestId: result.providerRequestId,
      usage: result.usage,
    };
  } catch (error) {
    if (error instanceof Error && 'issues' in error && Array.isArray(error.issues)) {
      throw new HomeworkMemoryExtractionValidationError({
        message: 'Homework-memory extraction output failed schema validation',
        issues: error.issues as ZodIssue[],
        rawOutput: result.output,
      });
    }
    throw error;
  }
}
