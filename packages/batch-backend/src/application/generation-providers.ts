import type { GenerateDraftUsage, GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';

export interface ProviderExecutionRequest {
  model: string;
  prompt: string;
  maxOutputTokens?: number;
  stream?: boolean;
}

export interface ProviderExecutionResult {
  text: string;
  providerRequestId?: string;
  usage?: GenerateDraftUsage;
}

export class ProviderExecutionError extends Error {
  readonly provider: GenerationProvider;
  readonly status?: number;
  readonly code?: string;

  constructor(args: {
    provider: GenerationProvider;
    message: string;
    status?: number;
    code?: string;
  }) {
    super(args.message);
    this.name = 'ProviderExecutionError';
    this.provider = args.provider;
    this.status = args.status;
    this.code = args.code;
  }
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

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
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

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
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

  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cachedTokens !== undefined ? { cachedTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
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
      body: JSON.stringify({
        model: args.request.model,
        input: args.request.prompt,
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
      message: parseErrorMessage(payload, `Google AI Studio request failed (HTTP ${response.status})`),
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
  };
}
