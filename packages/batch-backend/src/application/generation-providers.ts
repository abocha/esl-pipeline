import type { GenerateDraftUsage, GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { type GenerationRequestEnvelopeV1 } from './generation-request-envelope.js';
import {
  buildOpenAiResponsesRequestBody,
  parseOpenAiAssignmentResponsesPayload,
  parseOpenAiResponsesPayload,
} from './openai-responses-contract.js';

export interface ProviderExecutionRequest {
  model: string;
  prompt?: string;
  envelope?: GenerationRequestEnvelopeV1;
  maxOutputTokens?: number;
  stream?: boolean;
}

export interface StructuredOutputSchema {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ProviderStructuredExecutionRequest {
  model: string;
  prompt?: string;
  envelope?: GenerationRequestEnvelopeV1;
  responseSchema: StructuredOutputSchema;
  settings?: GenerationRequestEnvelopeV1['settings'];
  maxOutputTokens?: number;
  store?: boolean;
  admission?: 'assignment_v1';
}

export interface ProviderExecutionResult {
  text: string;
  model?: string;
  providerRequestId?: string;
  usage?: GenerateDraftUsage;
  finishReason?: string;
}

export interface ProviderStructuredExecutionResult {
  output: unknown;
  rawText: string;
  model?: string;
  providerRequestId?: string;
  usage?: GenerateDraftUsage;
  finishReason?: string;
}

export interface ProviderStructuredRawExecutionResult {
  rawText: string;
  model?: string;
  providerRequestId?: string;
  usage?: GenerateDraftUsage;
  finishReason?: string;
  contractError?: string;
}

export type StructuredJsonParseResult =
  | { status: 'parsed'; output: unknown; extraction: 'direct' | 'object' | 'array' }
  | { status: 'malformed'; reason: 'empty' | 'invalid_json' };

export class ProviderExecutionError extends Error {
  readonly provider: GenerationProvider;
  readonly status?: number;
  readonly code?: string;
  readonly rawText?: string;
  readonly retryAfterMs?: number;
  readonly usage?: GenerateDraftUsage;
  readonly providerRequestId?: string;
  readonly finishReason?: string;

  constructor(args: {
    provider: GenerationProvider;
    message: string;
    status?: number;
    code?: string;
    rawText?: string;
    retryAfterMs?: number;
    usage?: GenerateDraftUsage;
    providerRequestId?: string;
    finishReason?: string;
  }) {
    super(args.message);
    this.name = 'ProviderExecutionError';
    this.provider = args.provider;
    this.status = args.status;
    this.code = args.code;
    this.rawText = args.rawText;
    this.retryAfterMs = args.retryAfterMs;
    this.usage = args.usage;
    this.providerRequestId = args.providerRequestId;
    this.finishReason = args.finishReason;
  }
}

function parseRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const targetMs = Date.parse(raw);
  if (Number.isNaN(targetMs)) return undefined;
  return Math.max(0, targetMs - Date.now());
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseErrorMessage(errorBody: unknown, fallback: string): string {
  if (!errorBody || typeof errorBody !== 'object') return fallback;
  const body = errorBody as Record<string, unknown>;

  const topMessage = body.message;
  if (typeof topMessage === 'string' && topMessage.trim().length > 0) {
    return topMessage;
  }

  const nestedError = body.error;
  if (nestedError && typeof nestedError === 'object') {
    const nestedMessage = (nestedError as Record<string, unknown>).message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim().length > 0) {
      return nestedMessage;
    }
  }

  return fallback;
}

export function parseStructuredJsonText(text: string): StructuredJsonParseResult {
  const direct = text.trim();
  if (!direct) {
    return { status: 'malformed', reason: 'empty' };
  }

  try {
    return { status: 'parsed', output: JSON.parse(direct), extraction: 'direct' };
  } catch {
    // noop
  }

  const objectStart = direct.indexOf('{');
  const objectEnd = direct.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    try {
      return {
        status: 'parsed',
        output: JSON.parse(direct.slice(objectStart, objectEnd + 1)),
        extraction: 'object',
      };
    } catch {
      // noop
    }
  }

  const arrayStart = direct.indexOf('[');
  const arrayEnd = direct.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    try {
      return {
        status: 'parsed',
        output: JSON.parse(direct.slice(arrayStart, arrayEnd + 1)),
        extraction: 'array',
      };
    } catch {
      // noop
    }
  }

  return { status: 'malformed', reason: 'invalid_json' };
}

export async function executeOpenAiGeneration(args: {
  config: BatchBackendConfig['generation'];
  request: ProviderExecutionRequest;
}): Promise<ProviderExecutionResult> {
  const apiKey = args.config.providers.openai.apiKey;
  if (!apiKey) {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: 'OPENAI_API_KEY is not configured',
      status: 401,
      code: 'missing_api_key',
    });
  }

  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOpenAiResponsesRequestBody(args.request)),
    },
    args.config.providers.openai.requestTimeoutMs,
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: `OpenAI returned non-JSON response (HTTP ${response.status})`,
      status: response.status,
      code: 'malformed_payload',
    });
  }

  if (!response.ok) {
    const cast = payload as Record<string, unknown>;
    const errorBlock = cast.error as Record<string, unknown> | undefined;
    throw new ProviderExecutionError({
      provider: 'openai',
      message: parseErrorMessage(payload, `OpenAI request failed (HTTP ${response.status})`),
      status: response.status,
      code:
        (typeof errorBlock?.code === 'string' ? errorBlock.code : undefined) ??
        (typeof cast.code === 'string' ? cast.code : undefined),
      retryAfterMs: parseRetryAfterMs(response),
    });
  }

  try {
    return parseOpenAiResponsesPayload(payload);
  } catch (error) {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: error instanceof Error ? error.message : 'OpenAI returned malformed payload',
      status: 502,
      code: 'malformed_payload',
    });
  }
}

export async function executeOpenAiStructuredGeneration(args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}): Promise<ProviderStructuredExecutionResult> {
  const raw = await executeOpenAiStructuredGenerationRaw(args);
  if (args.request.admission === 'assignment_v1') {
    const metadata = {
      usage: raw.usage,
      providerRequestId: raw.providerRequestId,
      finishReason: raw.finishReason,
    };
    if (raw.contractError)
      throw new ProviderExecutionError({
        provider: 'openai',
        message: raw.contractError,
        code: 'assignment_contract_error',
        ...metadata,
      });
    try {
      return { ...raw, output: JSON.parse(raw.rawText) };
    } catch {
      throw new ProviderExecutionError({
        provider: 'openai',
        message: 'Assignment response must contain direct JSON',
        code: 'malformed_structured_output',
        ...metadata,
      });
    }
  }
  const parsed = parseStructuredJsonText(raw.rawText);
  if (parsed.status === 'malformed') {
    throw new ProviderExecutionError({
      provider: 'openai',
      message:
        parsed.reason === 'empty'
          ? 'Structured output text was empty'
          : 'Structured output text did not contain valid JSON',
      status: 502,
      code: 'malformed_structured_output',
      rawText: raw.rawText,
      usage: raw.usage,
      providerRequestId: raw.providerRequestId,
      finishReason: raw.finishReason,
    });
  }
  return { ...raw, output: parsed.output };
}

export async function executeOpenAiStructuredGenerationRaw(args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}): Promise<ProviderStructuredRawExecutionResult> {
  const apiKey = args.config.providers.openai.apiKey;
  if (!apiKey) {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: 'OPENAI_API_KEY is not configured',
      status: 401,
      code: 'missing_api_key',
    });
  }

  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildOpenAiResponsesRequestBody(args.request)),
    },
    args.config.providers.openai.requestTimeoutMs,
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: `OpenAI returned non-JSON response (HTTP ${response.status})`,
      status: response.status,
      code: 'malformed_payload',
    });
  }

  if (!response.ok) {
    const cast = payload as Record<string, unknown>;
    const errorBlock = cast.error as Record<string, unknown> | undefined;
    throw new ProviderExecutionError({
      provider: 'openai',
      message: parseErrorMessage(payload, `OpenAI request failed (HTTP ${response.status})`),
      status: response.status,
      code:
        (typeof errorBlock?.code === 'string' ? errorBlock.code : undefined) ??
        (typeof cast.code === 'string' ? cast.code : undefined),
      retryAfterMs: parseRetryAfterMs(response),
    });
  }

  if (args.request.admission === 'assignment_v1')
    return parseOpenAiAssignmentResponsesPayload(payload);

  let parsed;
  try {
    parsed = parseOpenAiResponsesPayload(payload);
  } catch (error) {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: error instanceof Error ? error.message : 'OpenAI returned malformed payload',
      status: 502,
      code: 'malformed_payload',
    });
  }

  const { text, ...metadata } = parsed;
  return {
    rawText: text,
    ...metadata,
  };
}
