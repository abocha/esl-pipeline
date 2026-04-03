import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import * as getJobStatusModule from '../src/application/get-job-status.js';
import * as submitJobModule from '../src/application/submit-job.js';
import { withPgClient } from '../src/infrastructure/db.js';
import * as orchestratorService from '../src/infrastructure/orchestrator-service.js';
import { startWorker } from '../src/transport/worker-runner.js';
import { requirePgTestEnv, requireRedisTestEnv, resolveTestTimeout } from './support/test-env.js';

/**
 * Intent:
 * - High-value, slower integration that approximates the full flow:
 *   POST /jobs -> insertJob + BullMQ enqueue -> worker -> processQueueJob -> runAssignmentJob -> DB state.
 * - Uses:
 *   - Real Postgres + Redis/BullMQ, as configured for tests (e.g. via docker-compose).
 *   - Mocked orchestrator (runAssignmentJob) to keep deterministic and fast.
 * - Focus:
 *   - End-to-end wiring, status transitions, and retry/terminal behavior.
 * - This suite is intentionally small and can be tagged/filtered as integration.
 */

vi.mock('../src/infrastructure/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
  createJobLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Use real submitJob/getJobStatus implementations (no mocks) to exercise actual flow.
const runAssignmentJobMock = vi.spyOn(orchestratorService, 'runAssignmentJob');

let app: ReturnType<typeof Fastify>;
let workerStop: (() => Promise<void>) | null = null;
let markdownFixtureDir: string | null = null;
let markdownFixturePath = '';
const integrationFixtureMarkdown = `---
title: 'Worker Runner Integration Fixture'
student: Integration Student
level: A2
topic: Integration Pipeline
input_type: generate
speaker_labels: [Alex, Mara]
---

## 1. This Week's Mission Briefing
text

## 2. Your Homework Roadmap
text

## 3. Input Material: The Source
:::study-text
[Alex]: Hi!
[Mara]: Hello!
:::

## 4. Language Toolkit: Useful Language
text

## 5. Practice & Pronunciation
### A. Controlled Practice
1. one
2. two
3. three
4. four
5. five
6. six
7. seven
8. eight
### B. Comprehension Check
1. question
2. question

### C. Pronunciation Micro-Focus
text

## 6. Your Turn: Complete the Mission!
text

## 7. Why This Mission Helps You
text

## 8. Answer Key & Sample Mission
:::toggle Answer Key
notes
:::

## 9. Teacher's Follow-up Plan
:::toggle Teacher's Follow-up Plan
notes
:::
`;

async function truncateJobs() {
  await withPgClient(async (client) => {
    await client.query('TRUNCATE TABLE job_action_history, jobs RESTART IDENTITY CASCADE');
  });
}

requirePgTestEnv();
requireRedisTestEnv();
const integrationTimeout = resolveTestTimeout(60_000);

describe('transport/worker-runner - full pipeline (requires Postgres + Redis)', () => {
  beforeAll(async () => {
    process.env.BATCH_JOBS_QUEUE_NAME = `worker-runner-integration-${randomUUID()}`;

    // Ensure clean DB state.
    await truncateJobs();
    const testTmpRoot = path.join(process.cwd(), '.tmp');
    await fs.mkdir(testTmpRoot, { recursive: true });
    markdownFixtureDir = await fs.mkdtemp(path.join(testTmpRoot, 'worker-runner-integration-'));
    markdownFixturePath = path.join(markdownFixtureDir, 'ok.md');
    await fs.writeFile(markdownFixturePath, integrationFixtureMarkdown, 'utf8');

    // Start HTTP server on ephemeral port.
    // http-server.ts currently binds directly; for tests we simulate by creating Fastify
    // and wiring identical routes inline for inject()-based calls.
    app = Fastify({ logger: false });

    app.post(
      '/jobs',
      async (
        request: FastifyRequest<{
          Body: {
            md: string;
            withTts?: boolean;
            upload?: 'auto' | 's3' | 'none';
          };
        }>,
        reply: FastifyReply,
      ) => {
        try {
          const body = request.body;
          const result = await submitJobModule.submitJob({
            md: body?.md,
            withTts: body?.withTts,
            upload: body?.upload,
          });
          return reply.code(202).send(result);
        } catch (error: unknown) {
          return reply
            .code(400)
            .send({ error: error instanceof Error ? error.message : 'Failed to submit job' });
        }
      },
    );

    app.get(
      '/jobs/:jobId',
      async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        try {
          const { jobId } = request.params;
          const status = await getJobStatusModule.getJobStatus(jobId);
          if (!status) {
            return reply.code(404).send({ error: 'Job not found' });
          }
          return reply.send(status);
        } catch {
          return reply.code(500).send({ error: 'Failed to fetch job status' });
        }
      },
    );

    await app.ready();

    // Start worker via startWorker; wrap so we can close worker on teardown.
    // We rely on BullMQ + Redis being available according to env for this package.
    workerStop = await (async () => {
      // startWorker does not expose a stop handle, so we approximate by:
      // - wrapping Worker construction via BullMQ mock or leaving it as-is.
      // For now, assume worker will be terminated with process; this test
      // is minimal and should not leak resources significantly.
      await startWorker();
      return async () => {
        // No-op; real shutdown is handled by process signals in implementation.
        // In CI, test runner will exit the process.
      };
    })();
  }, integrationTimeout);

  afterAll(async () => {
    if (workerStop) {
      await workerStop();
    }
    if (app) {
      await app.close();
    }
    if (markdownFixtureDir) {
      await fs.rm(markdownFixtureDir, { recursive: true, force: true });
      markdownFixtureDir = null;
      markdownFixturePath = '';
    }
    await truncateJobs();
  }, integrationTimeout);

  it(
    'runs job to succeeded when orchestrator succeeds',
    async () => {
      runAssignmentJobMock.mockResolvedValue({
        manifestPath: '/manifests/integration.json',
      });

      const submitRes = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { md: markdownFixturePath },
      });

      expect(submitRes.statusCode).toBe(202);
      const { jobId } = submitRes.json() as { jobId: string };
      expect(jobId).toBeDefined();

      // Poll GET /jobs/:jobId until job reaches succeeded or timeout.
      const deadline = Date.now() + 20_000;
      let finalStatus: any = null;

      while (Date.now() < deadline) {
        const statusRes = await app.inject({
          method: 'GET',
          url: `/jobs/${jobId}`,
        });

        if (statusRes.statusCode === 200) {
          const body = statusRes.json();
          if (body.state === 'succeeded') {
            finalStatus = body;
            break;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      expect(finalStatus).not.toBeNull();
      expect(finalStatus.state).toBe('succeeded');
      expect(finalStatus.manifestPath).toBe('/manifests/integration.json');
    },
    integrationTimeout,
  );

  it(
    'eventually marks job failed when orchestrator consistently fails',
    async () => {
      runAssignmentJobMock.mockRejectedValue(new Error('orchestrator down'));

      const submitRes = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { md: markdownFixturePath },
      });

      expect(submitRes.statusCode).toBe(202);
      const { jobId } = submitRes.json() as { jobId: string };
      expect(jobId).toBeDefined();

      const deadline = Date.now() + 30_000;
      let finalStatus: any = null;

      while (Date.now() < deadline) {
        const statusRes = await app.inject({
          method: 'GET',
          url: `/jobs/${jobId}`,
        });

        if (statusRes.statusCode === 200) {
          const body = statusRes.json();
          if (body.state === 'failed') {
            finalStatus = body;
            break;
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      expect(finalStatus).not.toBeNull();
      expect(finalStatus.state).toBe('failed');
      expect(finalStatus.error).toContain('orchestrator down');
    },
    integrationTimeout,
  );
});
