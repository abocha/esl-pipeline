import { describe, expect, it } from 'vitest';

import { buildLessonMemoryEnvelope } from '../src/application/lesson-memory-prompt.js';
import {
  buildOpenAiResponsesRequestBody,
  parseOpenAiResponsesPayload,
} from '../src/application/openai-responses-contract.js';

describe('application/openai-responses-contract', () => {
  it('builds the same strict Responses body required by online and Batch extraction', () => {
    const envelope = buildLessonMemoryEnvelope({
      transcriptId: 'transcript-1',
      transcriptText: 'Student: I goed there.',
    });

    expect(
      buildOpenAiResponsesRequestBody({
        model: 'gpt-5.4-mini',
        envelope,
        responseSchema: envelope.responseSchema,
      }),
    ).toEqual({
      model: 'gpt-5.4-mini',
      input: envelope.input,
      instructions: envelope.instructions,
      stream: false,
      reasoning: { effort: 'medium' },
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: envelope.responseSchema?.name,
          description: envelope.responseSchema?.description,
          schema: envelope.responseSchema?.schema,
          strict: true,
        },
      },
    });
  });

  it('normalizes a structured Responses payload without a network dependency', () => {
    expect(
      parseOpenAiResponsesPayload({
        id: 'resp-1',
        model: 'gpt-5.4-mini-2026-06-01',
        status: 'completed',
        output: [{ content: [{ text: '{"value":"ok"}' }] }],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      }),
    ).toEqual({
      text: '{"value":"ok"}',
      model: 'gpt-5.4-mini-2026-06-01',
      providerRequestId: 'resp-1',
      usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
      finishReason: 'completed',
    });
  });
});
