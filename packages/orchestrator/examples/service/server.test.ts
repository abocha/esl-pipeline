import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPipeline,
  noopLogger,
  noopMetrics,
} from '../../src/index.js';

const fastify = Fastify({ logger: false });

beforeAll(async () => {
  const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));
  const pipeline = createPipeline({
    cwd: fixturesDir,
    logger: noopLogger,
    metrics: noopMetrics,
  });

  fastify.post('/jobs', async (request, reply) => {
    const body = request.body as { md?: string };
    if (!body.md) {
      reply.code(400);
      return { error: 'Missing md path' };
    }
    const result = await pipeline.newAssignment({
      md: resolve(fixturesDir, body.md ?? 'lesson.md'),
      withTts: false,
      dryRun: true,
      skipImport: true,
      skipTts: true,
      skipUpload: true,
    });
    return { result };
  });

  await fastify.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await fastify.close();
});

describe('service example', () => {
  it('accepts a job payload', async () => {
    const addr = fastify.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ md: 'lesson.md' }),
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { result: { steps: string[]; manifestPath?: string } };
    expect(data.result.steps).toEqual(['skip:validate', 'skip:import', 'manifest']);
    expect(typeof data.result.manifestPath).toBe('string');
  });
});
