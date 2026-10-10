import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, expect, vi } from 'vitest';

import {
  executeGoogleStructuredGeneration,
  executeOpenAiStructuredGeneration,
  executeOpenRouterStructuredGeneration,
  type ProviderStructuredExecutionRequest,
} from '../../src/application/generation-providers.js';
import { loadConfig } from '../../src/config/env.js';

afterEach(() => vi.unstubAllGlobals());

interface CapturedWireBody {
  instructions: string;
  input: string;
  text: { format: { schema: unknown } };
  generationConfig: { responseJsonSchema: unknown };
  response_format: { json_schema: { schema: unknown } };
  contents: [{ parts: [{ text: string }] }];
  messages: [{ content: string }];
}

// Synthetic fixtures only. Capture the actual wire bodies, keeping schemas compact by hash.
export async function captureMemoryRequest(request: ProviderStructuredExecutionRequest) {
  const base = loadConfig().generation;
  const config = {
    ...base,
    providers: {
      openai: { ...base.providers.openai, apiKey: 'fixture' },
      googleAiStudio: { ...base.providers.googleAiStudio, apiKey: 'fixture' },
      openrouter: { ...base.providers.openrouter, apiKey: 'fixture' },
    },
  };
  const bodies: Record<string, CapturedWireBody> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as CapturedWireBody;
      const provider = url.includes('openrouter')
        ? 'openrouter'
        : url.includes('google')
          ? 'google'
          : 'openai';
      const schema =
        provider === 'openai'
          ? body.text.format.schema
          : provider === 'google'
            ? body.generationConfig.responseJsonSchema
            : body.response_format.json_schema.schema;
      const schemaHash = createHash('sha256').update(JSON.stringify(schema)).digest('hex');
      if (provider === 'openai') body.text.format.schema = schemaHash;
      else if (provider === 'google') body.generationConfig.responseJsonSchema = schemaHash;
      else body.response_format.json_schema.schema = schemaHash;
      bodies[provider] = body;
      return new Response(
        JSON.stringify(
          provider === 'openai'
            ? { output_text: '{}' }
            : provider === 'google'
              ? { candidates: [{ content: { parts: [{ text: '{}' }] } }] }
              : { choices: [{ message: { content: '{}' } }] },
        ),
        { status: 200 },
      );
    }),
  );
  await executeOpenAiStructuredGeneration({ config, request });
  await executeGoogleStructuredGeneration({ config, request });
  await executeOpenRouterStructuredGeneration({ config, request });
  vi.unstubAllGlobals();
  return bodies;
}

export async function assertMemoryRequest(
  name: string,
  request: ProviderStructuredExecutionRequest,
) {
  // A conflicting old copy must never override the authoritative envelope on the wire.
  const bodies = await captureMemoryRequest({ ...request, prompt: 'obsolete short prompt copy' });
  expect(request.envelope).toBeDefined();
  const effectiveText = `${request.envelope!.instructions}\n\n${request.envelope!.input}`;
  expect(request.prompt).toBe(effectiveText);
  expect(bodies.openai!.instructions).toBe(request.envelope!.instructions);
  expect(bodies.openai!.input).toBe(request.envelope!.input);
  expect(bodies.google!.contents[0].parts[0].text).toBe(effectiveText);
  expect(bodies.openrouter!.messages[0].content).toBe(effectiveText);
  const before = JSON.parse(
    readFileSync(
      new URL(`../fixtures/memory-generation-before/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as Record<string, CapturedWireBody>;
  const afterPolicy = readFileSync(
    new URL(`../fixtures/memory-generation-after/${name}.txt`, import.meta.url),
    'utf8',
  ).trimEnd();
  expect(request.envelope!.instructions).toBe(afterPolicy);
  expect(request.envelope!.promptVersion).toBe('learner_memory_generation_v2');
  // Source content, schemas, caps, reasoning and verbosity stay pinned to the captured baseline.
  expect(bodies.openai!.input).toBe(before.openai!.input);
  const metadata = (captured: Record<string, CapturedWireBody>) => ({
    openai: { ...captured.openai, instructions: undefined, input: undefined },
    google: { ...captured.google, contents: undefined },
    openrouter: { ...captured.openrouter, messages: undefined },
  });
  expect(metadata(bodies)).toEqual(metadata(before));
}
