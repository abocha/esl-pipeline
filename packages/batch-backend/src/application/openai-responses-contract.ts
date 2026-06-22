import type { GenerateDraftUsage } from '@esl-pipeline/contracts';

import type { GenerationRequestEnvelopeV1 } from './generation-request-envelope.js';

export interface OpenAiResponsesSchema {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface OpenAiResponsesRequestBodyArgs {
  model: string;
  prompt?: string;
  envelope?: GenerationRequestEnvelopeV1;
  responseSchema?: OpenAiResponsesSchema;
  maxOutputTokens?: number;
}

export interface ParsedOpenAiResponsesPayload {
  text: string;
  model?: string;
  providerRequestId?: string;
  usage?: GenerateDraftUsage;
  finishReason?: string;
}

export function buildOpenAiResponsesRequestBody(
  args: OpenAiResponsesRequestBodyArgs,
): Record<string, unknown> {
  const input = args.envelope?.input ?? requirePrompt(args.prompt);
  const text = args.responseSchema
    ? {
        ...(args.envelope ? { verbosity: args.envelope.settings.textVerbosity } : {}),
        format: {
          type: 'json_schema',
          name: args.responseSchema.name,
          schema: args.responseSchema.schema,
          strict: args.responseSchema.strict ?? true,
          ...(typeof args.responseSchema.description === 'string'
            ? { description: args.responseSchema.description }
            : {}),
        },
      }
    : args.envelope
      ? { verbosity: args.envelope.settings.textVerbosity }
      : undefined;

  return {
    model: args.model,
    input,
    ...(args.envelope ? { instructions: args.envelope.instructions } : {}),
    stream: false,
    ...(text ? { text } : {}),
    ...(args.envelope ? { reasoning: { effort: args.envelope.settings.reasoningEffort } } : {}),
    ...(typeof args.maxOutputTokens === 'number'
      ? { max_output_tokens: args.maxOutputTokens }
      : {}),
  };
}

export function parseOpenAiResponsesPayload(payload: unknown): ParsedOpenAiResponsesPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('OpenAI returned malformed payload');
  }

  const cast = payload as Record<string, unknown>;
  const text = extractOpenAiText(cast);
  if (!text) {
    throw new Error('OpenAI response did not contain output text');
  }

  return {
    text,
    ...(typeof cast.model === 'string' ? { model: cast.model } : {}),
    ...(typeof cast.id === 'string' ? { providerRequestId: cast.id } : {}),
    ...(parseOpenAiUsage(cast) ? { usage: parseOpenAiUsage(cast) } : {}),
    ...(extractOpenAiFinishReason(cast) ? { finishReason: extractOpenAiFinishReason(cast) } : {}),
  };
}

export function parseOpenAiStructuredResponsesPayload(
  payload: unknown,
): ParsedOpenAiResponsesPayload & {
  output: unknown;
  rawText: string;
} {
  const parsed = parseOpenAiResponsesPayload(payload);
  return {
    ...parsed,
    output: extractJsonValue(parsed.text),
    rawText: parsed.text,
  };
}

function requirePrompt(prompt: string | undefined): string {
  const normalized = prompt?.trim();
  if (!normalized) {
    throw new Error('OpenAI Responses request requires prompt or envelope');
  }
  return normalized;
}

function extractJsonValue(text: string): unknown {
  const direct = text.trim();
  if (!direct) {
    throw new Error('Structured output text was empty');
  }

  try {
    return JSON.parse(direct);
  } catch {
    // Continue with tolerant object/array extraction for provider wrappers.
  }

  const objectStart = direct.indexOf('{');
  const objectEnd = direct.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    try {
      return JSON.parse(direct.slice(objectStart, objectEnd + 1));
    } catch {
      // Continue with array extraction.
    }
  }

  const arrayStart = direct.indexOf('[');
  const arrayEnd = direct.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(direct.slice(arrayStart, arrayEnd + 1));
    } catch {
      // Fall through to the stable error below.
    }
  }

  throw new Error('Structured output text did not contain valid JSON');
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
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(cachedTokens === undefined ? {} : { cachedTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
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

  return chunks.length > 0 ? chunks.join('') : null;
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
