import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AssignmentV1 } from '@esl-pipeline/contracts';

import { createPipeline, noopLogger, noopMetrics } from '../../src/index.js';
import { assignmentFixture } from '../../tests/assignment-fixture.js';

const fastify = Fastify({ logger: false });
let fixturesDir: string;

beforeAll(async () => {
  fixturesDir = await mkdtemp(join(tmpdir(), 'esl-service-example-'));
  const pipeline = createPipeline({
    cwd: fixturesDir,
    logger: noopLogger,
    metrics: noopMetrics,
  });

  fastify.post('/jobs', async (request, reply) => {
    const body = request.body as { md?: string; assignment?: AssignmentV1 };
    if (!body.md || !body.assignment) {
      reply.code(400);
      return { error: 'Missing md path' };
    }
    const result = await pipeline.newAssignment({
      assignment: body.assignment,
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
  await rm(fixturesDir, { recursive: true, force: true });
});

describe('service example', () => {
  it('rejects legacy Markdown-only input', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/jobs',
      payload: { md: 'lesson.md' },
    });
    expect(response.statusCode).toBe(400);
  });
  it('accepts a job payload', async () => {
    const addr = fastify.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ md: 'lesson.json', assignment: assignmentFixture() }),
    });
    expect(response.status).toBe(200);
    const data = (await response.json()) as { result: { steps: string[]; manifestPath?: string } };
    expect(data.result.steps).toEqual(['validate', 'skip:import', 'add-audio', 'manifest']);
    expect(typeof data.result.manifestPath).toBe('string');
  });
});
