import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, expect, vi } from 'vitest';

import {
  executeOpenAiStructuredGeneration,
  type ProviderStructuredExecutionRequest,
} from '../../src/application/generation-providers.js';
import { loadConfig } from '../../src/config/env.js';

afterEach(() => vi.unstubAllGlobals());

interface CapturedWireBody {
  instructions: string;
  input: string;
  text: { format: { schema: unknown } };
}

// Synthetic fixtures only. Capture the actual wire bodies, keeping schemas compact by hash.
export async function captureMemoryRequest(request: ProviderStructuredExecutionRequest) {
  const base = loadConfig().generation;
  const config = {
    ...base,
    providers: {
      openai: { ...base.providers.openai, apiKey: 'fixture' },
    },
  };
  const bodies: Record<string, CapturedWireBody> = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as CapturedWireBody;
      const schemaHash = createHash('sha256')
        .update(JSON.stringify(body.text.format.schema))
        .digest('hex');
      body.text.format.schema = schemaHash;
      bodies.openai = body;
      return new Response(JSON.stringify({ output_text: '{}' }), { status: 200 });
    }),
  );
  await executeOpenAiStructuredGeneration({ config, request });
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
    openai: { ...captured.openai, instructions: undefined, input: undefined, model: undefined },
  });
  expect(metadata(bodies)).toEqual(metadata(before));
}
