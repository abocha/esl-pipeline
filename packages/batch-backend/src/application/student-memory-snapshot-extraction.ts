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
  type GenerationRequestEnvelopeV1,
  resolveGenerationRequestText,
} from './generation-request-envelope.js';
import { assertEvidenceSourcesInEnvelope } from './source-evidence-validation.js';
import {
  STUDENT_MEMORY_SNAPSHOT_CONTENT_JSON_SCHEMA,
  STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_DESCRIPTION,
  STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_NAME,
  type StudentMemorySnapshotContent,
  validateStudentMemorySnapshotContent,
} from './student-memory-snapshot-content-schema.js';

type StructuredProviderExecutor = (args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}) => Promise<ProviderStructuredExecutionResult>;

const DEFAULT_STRUCTURED_EXECUTORS: Record<GenerationProvider, StructuredProviderExecutor> = {
  openai: executeOpenAiStructuredGeneration,
  google_ai_studio: executeGoogleStructuredGeneration,
  openrouter: executeOpenRouterStructuredGeneration,
};

export interface ExtractStudentMemorySnapshotContentRequest {
  provider: GenerationProvider;
  model: string;
  prompt: string;
  envelope?: GenerationRequestEnvelopeV1;
  maxOutputTokens?: number;
}

export interface ExtractStudentMemorySnapshotContentResult {
  content: StudentMemorySnapshotContent;
  rawOutput: unknown;
  rawText: string;
  providerRequestId?: string;
  usage?: ProviderStructuredExecutionResult['usage'];
}

export class StudentMemorySnapshotExtractionValidationError extends Error {
  readonly issues: ZodIssue[];
  readonly rawOutput: unknown;

  constructor(args: { message: string; issues: ZodIssue[]; rawOutput: unknown }) {
    super(args.message);
    this.name = 'StudentMemorySnapshotExtractionValidationError';
    this.issues = args.issues;
    this.rawOutput = args.rawOutput;
  }
}

export async function extractStudentMemorySnapshotContent(args: {
  config: BatchBackendConfig['generation'];
  request: ExtractStudentMemorySnapshotContentRequest;
  executors?: Partial<Record<GenerationProvider, StructuredProviderExecutor>>;
}): Promise<ExtractStudentMemorySnapshotContentResult> {
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
        name: STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_NAME,
        description: STUDENT_MEMORY_SNAPSHOT_RESPONSE_SCHEMA_DESCRIPTION,
        schema: STUDENT_MEMORY_SNAPSHOT_CONTENT_JSON_SCHEMA,
        strict: true,
      },
    },
  });

  try {
    const content = validateStudentMemorySnapshotContent(result.output);
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
      throw new StudentMemorySnapshotExtractionValidationError({
        message: 'Student-memory snapshot extraction output failed schema validation',
        issues: error.issues as ZodIssue[],
        rawOutput: result.output,
      });
    }
    throw error;
  }
}
