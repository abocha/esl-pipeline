import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  executeGoogleStructuredGeneration,
  executeOpenAiStructuredGeneration,
  executeOpenRouterStructuredGeneration,
} from '../src/application/generation-providers.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import { loadConfig } from '../src/config/env.js';

function createGenerationConfig(): BatchBackendConfig['generation'] {
  const base = loadConfig();
  return {
    ...base.generation,
    providers: {
      openai: {
        ...base.generation.providers.openai,
        apiKey: 'openai-key',
        requestTimeoutMs: 2_000,
      },
      googleAiStudio: {
        ...base.generation.providers.googleAiStudio,
        apiKey: 'google-key',
        requestTimeoutMs: 2_000,
      },
      openrouter: {
        ...base.generation.providers.openrouter,
        apiKey: 'openrouter-key',
        httpReferer: 'https://example.test',
        xTitle: 'esl-pipeline-test',
        requestTimeoutMs: 2_000,
      },
    },
  };
}

function createJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe('application/generation-providers structured output', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends OpenAI structured-output requests and parses JSON text', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      createJsonResponse({
        id: 'resp-openai-1',
        output: [
          {
            content: [
              {
                text: '{"lessonSummary":"Summary","topicsDiscussed":[],"mistakePatterns":[],"grammarReviewed":[],"grammarWatchlist":[],"vocabularyFocus":[],"pronunciationFocus":[],"studentFacts":[],"progressSignals":[],"followUpRecommendations":[]}',
              },
            ],
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          total_tokens: 30,
        },
      }),
    );

    const result = await executeOpenAiStructuredGeneration({
      config: createGenerationConfig(),
      request: {
        model: 'gpt-5.4',
        prompt: 'Extract lesson memory',
        responseSchema: {
          name: 'lesson_memory_content',
          description: 'Lesson memory',
          schema: {
            type: 'object',
            properties: {
              lessonSummary: { type: 'string' },
            },
            required: ['lessonSummary'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });

    expect(result.output).toMatchObject({ lessonSummary: 'Summary' });
    expect(result.providerRequestId).toBe('resp-openai-1');
    expect(result.usage?.totalTokens).toBe(30);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.text.format).toEqual({
      type: 'json_schema',
      name: 'lesson_memory_content',
      description: 'Lesson memory',
      schema: {
        type: 'object',
        properties: {
          lessonSummary: { type: 'string' },
        },
        required: ['lessonSummary'],
        additionalProperties: false,
      },
      strict: true,
    });
  });

  it('sends Google structured-output requests and parses JSON text', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      createJsonResponse({
        responseId: 'google-response-1',
        candidates: [
          {
            content: {
              parts: [{ text: '{"lessonSummary":"Summary","topicsDiscussed":[]}' }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 3,
          candidatesTokenCount: 5,
          totalTokenCount: 8,
        },
      }),
    );

    const result = await executeGoogleStructuredGeneration({
      config: createGenerationConfig(),
      request: {
        model: 'gemini-3.1-pro-preview',
        prompt: 'Extract lesson memory',
        responseSchema: {
          name: 'lesson_memory_content',
          schema: {
            type: 'object',
            properties: {
              lessonSummary: { type: 'string' },
              topicsDiscussed: { type: 'array', items: { type: 'string' } },
            },
            required: ['lessonSummary', 'topicsDiscussed'],
            additionalProperties: false,
          },
        },
        maxOutputTokens: 512,
      },
    });

    expect(result.output).toMatchObject({ lessonSummary: 'Summary', topicsDiscussed: [] });
    expect(result.providerRequestId).toBe('google-response-1');

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: {
          lessonSummary: { type: 'string' },
          topicsDiscussed: { type: 'array', items: { type: 'string' } },
        },
        required: ['lessonSummary', 'topicsDiscussed'],
        additionalProperties: false,
      },
    });
  });

  it('sends OpenRouter structured-output requests and parses JSON text', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(
      createJsonResponse({
        id: 'or-response-1',
        choices: [
          {
            message: {
              content: '{"lessonSummary":"Summary","topicsDiscussed":[]}',
            },
          },
        ],
        usage: {
          prompt_tokens: 9,
          completion_tokens: 7,
          total_tokens: 16,
        },
      }),
    );

    const result = await executeOpenRouterStructuredGeneration({
      config: createGenerationConfig(),
      request: {
        model: 'qwen/qwen3.5',
        prompt: 'Extract lesson memory',
        responseSchema: {
          name: 'lesson_memory_content',
          description: 'Lesson memory',
          schema: {
            type: 'object',
            properties: {
              lessonSummary: { type: 'string' },
              topicsDiscussed: { type: 'array', items: { type: 'string' } },
            },
            required: ['lessonSummary', 'topicsDiscussed'],
            additionalProperties: false,
          },
          strict: true,
        },
      },
    });

    expect(result.output).toMatchObject({ lessonSummary: 'Summary', topicsDiscussed: [] });
    expect(result.providerRequestId).toBe('or-response-1');
    expect(result.usage?.totalTokens).toBe(16);

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'lesson_memory_content',
        description: 'Lesson memory',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            lessonSummary: { type: 'string' },
            topicsDiscussed: { type: 'array', items: { type: 'string' } },
          },
          required: ['lessonSummary', 'topicsDiscussed'],
          additionalProperties: false,
        },
      },
    });
  });
});
