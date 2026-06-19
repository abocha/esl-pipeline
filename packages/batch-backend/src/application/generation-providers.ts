import type { GenerateDraftUsage, GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import {
  flattenGenerationRequestEnvelope,
  type GenerationRequestEnvelopeV1,
} from './generation-request-envelope.js';

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
  maxOutputTokens?: number;
}

function resolveProviderPrompt(request: {
  prompt?: string;
  envelope?: GenerationRequestEnvelopeV1;
}): string {
  if (request.envelope) {
    return flattenGenerationRequestEnvelope(request.envelope);
  }
  if (request.prompt?.trim()) {
    return request.prompt;
  }
  throw new Error('Provider generation request requires prompt or envelope');
}

export interface ProviderExecutionResult {
  text: string;
  providerRequestId?: string;
  usage?: GenerateDraftUsage;
  finishReason?: string;
}

export interface ProviderStructuredExecutionResult {
  output: unknown;
  rawText: string;
  providerRequestId?: string;
  usage?: GenerateDraftUsage;
  finishReason?: string;
}

export class ProviderExecutionError extends Error {
  readonly provider: GenerationProvider;
  readonly status?: number;
  readonly code?: string;
  readonly rawText?: string;
  readonly retryAfterMs?: number;

  constructor(args: {
    provider: GenerationProvider;
    message: string;
    status?: number;
    code?: string;
    rawText?: string;
    retryAfterMs?: number;
  }) {
    super(args.message);
    this.name = 'ProviderExecutionError';
    this.provider = args.provider;
    this.status = args.status;
    this.code = args.code;
    this.rawText = args.rawText;
    this.retryAfterMs = args.retryAfterMs;
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

function extractJsonValue(text: string): unknown {
  const direct = text.trim();
  if (!direct) {
    throw new Error('Structured output text was empty');
  }

  try {
    return JSON.parse(direct);
  } catch {
    // noop
  }

  const objectStart = direct.indexOf('{');
  const objectEnd = direct.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    try {
      return JSON.parse(direct.slice(objectStart, objectEnd + 1));
    } catch {
      // noop
    }
  }

  const arrayStart = direct.indexOf('[');
  const arrayEnd = direct.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(direct.slice(arrayStart, arrayEnd + 1));
    } catch {
      // noop
    }
  }

  throw new Error('Structured output text did not contain valid JSON');
}

function setUsageField<Key extends keyof GenerateDraftUsage>(
  usage: GenerateDraftUsage,
  key: Key,
  value: GenerateDraftUsage[Key] | undefined,
): void {
  if (value === undefined) {
    return;
  }
  usage[key] = value;
}

function parseOpenAiUsage(payload: Record<string, unknown>): GenerateDraftUsage | undefined {
  const usage = payload.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const cast = usage as Record<string, unknown>;
  const inputTokens = typeof cast.input_tokens === 'number' ? cast.input_tokens : undefined;
  const outputTokens = typeof cast.output_tokens === 'number' ? cast.output_tokens : undefined;
  const totalTokens = typeof cast.total_tokens === 'number' ? cast.total_tokens : undefined;

  const inputDetails = cast.input_tokens_details as Record<string, unknown> | undefined;
  const outputDetails = cast.output_tokens_details as Record<string, unknown> | undefined;
  const cachedTokens =
    inputDetails && typeof inputDetails.cached_tokens === 'number'
      ? inputDetails.cached_tokens
      : undefined;
  const reasoningTokens =
    outputDetails && typeof outputDetails.reasoning_tokens === 'number'
      ? outputDetails.reasoning_tokens
      : undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  const parsed: GenerateDraftUsage = {};
  setUsageField(parsed, 'inputTokens', inputTokens);
  setUsageField(parsed, 'outputTokens', outputTokens);
  setUsageField(parsed, 'totalTokens', totalTokens);
  setUsageField(parsed, 'cachedTokens', cachedTokens);
  setUsageField(parsed, 'reasoningTokens', reasoningTokens);

  return parsed;
}

function extractOpenAiText(payload: Record<string, unknown>): string | null {
  if (typeof payload.output_text === 'string' && payload.output_text.trim().length > 0) {
    return payload.output_text;
  }

  const output = payload.output;
  if (!Array.isArray(output)) return null;

  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string' && text.length > 0) {
        chunks.push(text);
      }
    }
  }

  if (chunks.length === 0) return null;
  return chunks.join('');
}

function extractOpenAiFinishReason(payload: Record<string, unknown>): string | undefined {
  const output = payload.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!item || typeof item !== 'object') continue;
      const finishReason = (item as Record<string, unknown>).finish_reason;
      if (typeof finishReason === 'string' && finishReason.trim().length > 0) {
        return finishReason;
      }
    }
  }

  const status = payload.status;
  if (typeof status === 'string' && status.trim().length > 0) {
    return status;
  }

  const incompleteDetails = payload.incomplete_details;
  if (incompleteDetails && typeof incompleteDetails === 'object') {
    const reason = (incompleteDetails as Record<string, unknown>).reason;
    if (typeof reason === 'string' && reason.trim().length > 0) {
      return `incomplete:${reason}`;
    }
  }

  return undefined;
}

function parseGoogleUsage(payload: Record<string, unknown>): GenerateDraftUsage | undefined {
  const usage = payload.usageMetadata;
  if (!usage || typeof usage !== 'object') return undefined;
  const cast = usage as Record<string, unknown>;
  const inputTokens = typeof cast.promptTokenCount === 'number' ? cast.promptTokenCount : undefined;
  const outputTokens =
    typeof cast.candidatesTokenCount === 'number' ? cast.candidatesTokenCount : undefined;
  const totalTokens = typeof cast.totalTokenCount === 'number' ? cast.totalTokenCount : undefined;
  const cachedTokens =
    typeof cast.cachedContentTokenCount === 'number' ? cast.cachedContentTokenCount : undefined;
  const reasoningTokens =
    typeof cast.thoughtsTokenCount === 'number' ? cast.thoughtsTokenCount : undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  const parsed: GenerateDraftUsage = {};
  setUsageField(parsed, 'inputTokens', inputTokens);
  setUsageField(parsed, 'outputTokens', outputTokens);
  setUsageField(parsed, 'totalTokens', totalTokens);
  setUsageField(parsed, 'cachedTokens', cachedTokens);
  setUsageField(parsed, 'reasoningTokens', reasoningTokens);

  return parsed;
}

function extractGoogleText(payload: Record<string, unknown>): string | null {
  if (typeof payload.text === 'string' && payload.text.trim().length > 0) {
    return payload.text;
  }

  const candidates = payload.candidates;
  if (!Array.isArray(candidates)) return null;
  const first = candidates[0];
  if (!first || typeof first !== 'object') return null;
  const content = (first as Record<string, unknown>).content;
  if (!content || typeof content !== 'object') return null;
  const parts = (content as Record<string, unknown>).parts;
  if (!Array.isArray(parts)) return null;

  const chunks: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const text = (part as Record<string, unknown>).text;
    if (typeof text === 'string' && text.length > 0) {
      chunks.push(text);
    }
  }

  if (chunks.length === 0) return null;
  return chunks.join('');
}

function extractGoogleFinishReason(payload: Record<string, unknown>): string | undefined {
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  const first = candidates[0];
  if (!first || typeof first !== 'object') return undefined;
  const finishReason = (first as Record<string, unknown>).finishReason;
  if (typeof finishReason === 'string' && finishReason.trim().length > 0) {
    return finishReason;
  }
  return undefined;
}

function parseOpenRouterUsage(payload: Record<string, unknown>): GenerateDraftUsage | undefined {
  const usage = payload.usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const cast = usage as Record<string, unknown>;

  const inputTokens = typeof cast.prompt_tokens === 'number' ? cast.prompt_tokens : undefined;
  const outputTokens =
    typeof cast.completion_tokens === 'number' ? cast.completion_tokens : undefined;
  const totalTokens = typeof cast.total_tokens === 'number' ? cast.total_tokens : undefined;

  const promptDetails = cast.prompt_tokens_details as Record<string, unknown> | undefined;
  const completionDetails = cast.completion_tokens_details as Record<string, unknown> | undefined;
  const cachedTokens =
    promptDetails && typeof promptDetails.cached_tokens === 'number'
      ? promptDetails.cached_tokens
      : undefined;
  const reasoningTokens =
    completionDetails && typeof completionDetails.reasoning_tokens === 'number'
      ? completionDetails.reasoning_tokens
      : undefined;

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined &&
    cachedTokens === undefined &&
    reasoningTokens === undefined
  ) {
    return undefined;
  }

  const parsed: GenerateDraftUsage = {};
  setUsageField(parsed, 'inputTokens', inputTokens);
  setUsageField(parsed, 'outputTokens', outputTokens);
  setUsageField(parsed, 'totalTokens', totalTokens);
  setUsageField(parsed, 'cachedTokens', cachedTokens);
  setUsageField(parsed, 'reasoningTokens', reasoningTokens);

  return parsed;
}

function extractOpenRouterText(payload: Record<string, unknown>): string | null {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== 'object') return null;
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return null;
  const content = (message as Record<string, unknown>).content;

  if (typeof content === 'string' && content.trim().length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const chunks: string[] = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string' && text.length > 0) {
        chunks.push(text);
      }
    }
    if (chunks.length > 0) {
      return chunks.join('');
    }
  }

  return null;
}

function extractOpenRouterFinishReason(payload: Record<string, unknown>): string | undefined {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!first || typeof first !== 'object') return undefined;
  const finishReason = (first as Record<string, unknown>).finish_reason;
  if (typeof finishReason === 'string' && finishReason.trim().length > 0) {
    return finishReason;
  }
  return undefined;
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

  const prompt = resolveProviderPrompt(args.request);
  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: args.request.model,
        input: args.request.envelope?.input ?? prompt,
        ...(args.request.envelope ? { instructions: args.request.envelope.instructions } : {}),
        ...(args.request.envelope
          ? {
              reasoning: { effort: args.request.envelope.settings.reasoningEffort },
              text: { verbosity: args.request.envelope.settings.textVerbosity },
            }
          : {}),
        stream: false,
        ...(typeof args.request.maxOutputTokens === 'number'
          ? { max_output_tokens: args.request.maxOutputTokens }
          : {}),
      }),
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

  if (!payload || typeof payload !== 'object') {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: 'OpenAI returned malformed payload',
      status: 502,
      code: 'malformed_payload',
    });
  }

  const cast = payload as Record<string, unknown>;
  const text = extractOpenAiText(cast);
  if (!text) {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: 'OpenAI response did not contain output text',
      status: 502,
      code: 'malformed_payload',
    });
  }

  return {
    text,
    providerRequestId: typeof cast.id === 'string' ? cast.id : undefined,
    usage: parseOpenAiUsage(cast),
    finishReason: extractOpenAiFinishReason(cast),
  };
}

export async function executeOpenAiStructuredGeneration(args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}): Promise<ProviderStructuredExecutionResult> {
  const apiKey = args.config.providers.openai.apiKey;
  if (!apiKey) {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: 'OPENAI_API_KEY is not configured',
      status: 401,
      code: 'missing_api_key',
    });
  }

  const prompt = resolveProviderPrompt(args.request);
  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/responses',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: args.request.model,
        input: args.request.envelope?.input ?? prompt,
        ...(args.request.envelope ? { instructions: args.request.envelope.instructions } : {}),
        stream: false,
        text: {
          ...(args.request.envelope
            ? { verbosity: args.request.envelope.settings.textVerbosity }
            : {}),
          format: {
            type: 'json_schema',
            name: args.request.responseSchema.name,
            schema: args.request.responseSchema.schema,
            strict: args.request.responseSchema.strict ?? true,
            ...(typeof args.request.responseSchema.description === 'string'
              ? { description: args.request.responseSchema.description }
              : {}),
          },
        },
        ...(args.request.envelope
          ? { reasoning: { effort: args.request.envelope.settings.reasoningEffort } }
          : {}),
        ...(typeof args.request.maxOutputTokens === 'number'
          ? { max_output_tokens: args.request.maxOutputTokens }
          : {}),
      }),
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

  if (!payload || typeof payload !== 'object') {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: 'OpenAI returned malformed payload',
      status: 502,
      code: 'malformed_payload',
    });
  }

  const cast = payload as Record<string, unknown>;
  const rawText = extractOpenAiText(cast);
  if (!rawText) {
    throw new ProviderExecutionError({
      provider: 'openai',
      message: 'OpenAI structured response did not contain output text',
      status: 502,
      code: 'malformed_payload',
    });
  }

  let output: unknown;
  try {
    output = extractJsonValue(rawText);
  } catch (error) {
    throw new ProviderExecutionError({
      provider: 'openai',
      message:
        error instanceof Error ? error.message : 'OpenAI structured response JSON parsing failed',
      status: 502,
      code: 'malformed_structured_output',
      rawText,
    });
  }

  return {
    output,
    rawText,
    providerRequestId: typeof cast.id === 'string' ? cast.id : undefined,
    usage: parseOpenAiUsage(cast),
    finishReason: extractOpenAiFinishReason(cast),
  };
}

export async function executeGoogleGeneration(args: {
  config: BatchBackendConfig['generation'];
  request: ProviderExecutionRequest;
}): Promise<ProviderExecutionResult> {
  const apiKey = args.config.providers.googleAiStudio.apiKey;
  if (!apiKey) {
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message: 'GEMINI_API_KEY is not configured',
      status: 401,
      code: 'missing_api_key',
    });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.request.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: args.request.prompt }],
          },
        ],
        ...(typeof args.request.maxOutputTokens === 'number'
          ? { generationConfig: { maxOutputTokens: args.request.maxOutputTokens } }
          : {}),
      }),
    },
    args.config.providers.googleAiStudio.requestTimeoutMs,
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message: `Google AI Studio returned non-JSON response (HTTP ${response.status})`,
      status: response.status,
      code: 'malformed_payload',
    });
  }

  if (!response.ok) {
    const cast = payload as Record<string, unknown>;
    const errorBlock = cast.error as Record<string, unknown> | undefined;
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message: parseErrorMessage(
        payload,
        `Google AI Studio request failed (HTTP ${response.status})`,
      ),
      status: response.status,
      code:
        (typeof errorBlock?.status === 'string' ? errorBlock.status : undefined) ??
        (typeof cast.status === 'string' ? cast.status : undefined),
    });
  }

  if (!payload || typeof payload !== 'object') {
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message: 'Google AI Studio returned malformed payload',
      status: 502,
      code: 'malformed_payload',
    });
  }

  const cast = payload as Record<string, unknown>;
  const text = extractGoogleText(cast);
  if (!text) {
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message: 'Google AI Studio response did not contain output text',
      status: 502,
      code: 'malformed_payload',
    });
  }

  return {
    text,
    providerRequestId: typeof cast.responseId === 'string' ? cast.responseId : undefined,
    usage: parseGoogleUsage(cast),
    finishReason: extractGoogleFinishReason(cast),
  };
}

export async function executeGoogleStructuredGeneration(args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}): Promise<ProviderStructuredExecutionResult> {
  const apiKey = args.config.providers.googleAiStudio.apiKey;
  if (!apiKey) {
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message: 'GEMINI_API_KEY is not configured',
      status: 401,
      code: 'missing_api_key',
    });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.request.model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const generationConfig: Record<string, unknown> = {
    responseMimeType: 'application/json',
    responseJsonSchema: args.request.responseSchema.schema,
  };
  if (typeof args.request.maxOutputTokens === 'number') {
    generationConfig.maxOutputTokens = args.request.maxOutputTokens;
  }

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: args.request.prompt }],
          },
        ],
        generationConfig,
      }),
    },
    args.config.providers.googleAiStudio.requestTimeoutMs,
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message: `Google AI Studio returned non-JSON response (HTTP ${response.status})`,
      status: response.status,
      code: 'malformed_payload',
    });
  }

  if (!response.ok) {
    const cast = payload as Record<string, unknown>;
    const errorBlock = cast.error as Record<string, unknown> | undefined;
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message: parseErrorMessage(
        payload,
        `Google AI Studio request failed (HTTP ${response.status})`,
      ),
      status: response.status,
      code:
        (typeof errorBlock?.status === 'string' ? errorBlock.status : undefined) ??
        (typeof cast.status === 'string' ? cast.status : undefined),
    });
  }

  if (!payload || typeof payload !== 'object') {
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message: 'Google AI Studio returned malformed payload',
      status: 502,
      code: 'malformed_payload',
    });
  }

  const cast = payload as Record<string, unknown>;
  const rawText = extractGoogleText(cast);
  if (!rawText) {
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message: 'Google AI Studio structured response did not contain output text',
      status: 502,
      code: 'malformed_payload',
    });
  }

  let output: unknown;
  try {
    output = extractJsonValue(rawText);
  } catch (error) {
    throw new ProviderExecutionError({
      provider: 'google_ai_studio',
      message:
        error instanceof Error
          ? error.message
          : 'Google AI Studio structured response JSON parsing failed',
      status: 502,
      code: 'malformed_structured_output',
      rawText,
    });
  }

  return {
    output,
    rawText,
    providerRequestId: typeof cast.responseId === 'string' ? cast.responseId : undefined,
    usage: parseGoogleUsage(cast),
    finishReason: extractGoogleFinishReason(cast),
  };
}

export async function executeOpenRouterGeneration(args: {
  config: BatchBackendConfig['generation'];
  request: ProviderExecutionRequest;
}): Promise<ProviderExecutionResult> {
  const apiKey = args.config.providers.openrouter.apiKey;
  if (!apiKey) {
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message: 'OPENROUTER_API_KEY is not configured',
      status: 401,
      code: 'missing_api_key',
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (args.config.providers.openrouter.httpReferer) {
    headers['HTTP-Referer'] = args.config.providers.openrouter.httpReferer;
  }
  if (args.config.providers.openrouter.xTitle) {
    headers['X-Title'] = args.config.providers.openrouter.xTitle;
  }

  const response = await fetchWithTimeout(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: args.request.model,
        stream: false,
        messages: [
          {
            role: 'user',
            content: args.request.prompt,
          },
        ],
        ...(typeof args.request.maxOutputTokens === 'number'
          ? { max_tokens: args.request.maxOutputTokens }
          : {}),
      }),
    },
    args.config.providers.openrouter.requestTimeoutMs,
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message: `OpenRouter returned non-JSON response (HTTP ${response.status})`,
      status: response.status,
      code: 'malformed_payload',
    });
  }

  if (!response.ok) {
    const cast = payload as Record<string, unknown>;
    const errorBlock = cast.error as Record<string, unknown> | undefined;
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message: parseErrorMessage(payload, `OpenRouter request failed (HTTP ${response.status})`),
      status: response.status,
      code:
        (typeof errorBlock?.code === 'string' ? errorBlock.code : undefined) ??
        (typeof cast.code === 'string' ? cast.code : undefined),
    });
  }

  if (!payload || typeof payload !== 'object') {
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message: 'OpenRouter returned malformed payload',
      status: 502,
      code: 'malformed_payload',
    });
  }

  const cast = payload as Record<string, unknown>;
  const text = extractOpenRouterText(cast);
  if (!text) {
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message: 'OpenRouter response did not contain output text',
      status: 502,
      code: 'malformed_payload',
    });
  }

  return {
    text,
    providerRequestId: typeof cast.id === 'string' ? cast.id : undefined,
    usage: parseOpenRouterUsage(cast),
    finishReason: extractOpenRouterFinishReason(cast),
  };
}

export async function executeOpenRouterStructuredGeneration(args: {
  config: BatchBackendConfig['generation'];
  request: ProviderStructuredExecutionRequest;
}): Promise<ProviderStructuredExecutionResult> {
  const apiKey = args.config.providers.openrouter.apiKey;
  if (!apiKey) {
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message: 'OPENROUTER_API_KEY is not configured',
      status: 401,
      code: 'missing_api_key',
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (args.config.providers.openrouter.httpReferer) {
    headers['HTTP-Referer'] = args.config.providers.openrouter.httpReferer;
  }
  if (args.config.providers.openrouter.xTitle) {
    headers['X-Title'] = args.config.providers.openrouter.xTitle;
  }

  const response = await fetchWithTimeout(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: args.request.model,
        stream: false,
        messages: [
          {
            role: 'user',
            content: args.request.prompt,
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: args.request.responseSchema.name,
            strict: args.request.responseSchema.strict ?? true,
            schema: args.request.responseSchema.schema,
            ...(typeof args.request.responseSchema.description === 'string'
              ? { description: args.request.responseSchema.description }
              : {}),
          },
        },
        ...(typeof args.request.maxOutputTokens === 'number'
          ? { max_tokens: args.request.maxOutputTokens }
          : {}),
      }),
    },
    args.config.providers.openrouter.requestTimeoutMs,
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message: `OpenRouter returned non-JSON response (HTTP ${response.status})`,
      status: response.status,
      code: 'malformed_payload',
    });
  }

  if (!response.ok) {
    const cast = payload as Record<string, unknown>;
    const errorBlock = cast.error as Record<string, unknown> | undefined;
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message: parseErrorMessage(payload, `OpenRouter request failed (HTTP ${response.status})`),
      status: response.status,
      code:
        (typeof errorBlock?.code === 'string' ? errorBlock.code : undefined) ??
        (typeof cast.code === 'string' ? cast.code : undefined),
    });
  }

  if (!payload || typeof payload !== 'object') {
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message: 'OpenRouter returned malformed payload',
      status: 502,
      code: 'malformed_payload',
    });
  }

  const cast = payload as Record<string, unknown>;
  const rawText = extractOpenRouterText(cast);
  if (!rawText) {
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message: 'OpenRouter structured response did not contain output text',
      status: 502,
      code: 'malformed_payload',
    });
  }

  let output: unknown;
  try {
    output = extractJsonValue(rawText);
  } catch (error) {
    throw new ProviderExecutionError({
      provider: 'openrouter',
      message:
        error instanceof Error
          ? error.message
          : 'OpenRouter structured response JSON parsing failed',
      status: 502,
      code: 'malformed_structured_output',
      rawText,
    });
  }

  return {
    output,
    rawText,
    providerRequestId: typeof cast.id === 'string' ? cast.id : undefined,
    usage: parseOpenRouterUsage(cast),
    finishReason: extractOpenRouterFinishReason(cast),
  };
}
