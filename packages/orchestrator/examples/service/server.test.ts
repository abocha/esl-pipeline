import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assignmentFixture } from '../../tests/assignment-fixture.js';
import { createService } from './app.js';

let fastify: ReturnType<typeof createService>;
let fixturesDir: string;

beforeAll(async () => {
  fixturesDir = await mkdtemp(join(tmpdir(), 'esl-service-example-'));
  fastify = createService({
    pipelineRoot: fixturesDir,
    logger: false,
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
