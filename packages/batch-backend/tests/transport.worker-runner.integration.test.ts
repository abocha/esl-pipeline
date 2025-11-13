import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

import { startWorker } from '../src/transport/worker-runner';
import * as submitJobModule from '../src/application/submit-job';
import * as getJobStatusModule from '../src/application/get-job-status';
import * as orchestratorService from '../src/infrastructure/orchestrator-service';
import { withPgClient } from '../src/infrastructure/db';

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

async function truncateJobs() {
  await withPgClient(async client => {
    await client.query('TRUNCATE TABLE jobs');
  });
}

beforeAll(async () => {
  // Ensure clean DB state.
  await truncateJobs();

  // Start HTTP server on ephemeral port.
  // http-server.ts currently binds directly; for tests we simulate by creating Fastify
  // and wiring identical routes inline for inject()-based calls.
  app = Fastify({ logger: false });

  app.post('/jobs', async (request: any, reply: any) => {
    try {
      const body = request.body as any;
      const result = await submitJobModule.submitJob({
        md: body?.md,
        preset: body?.preset,
        withTts: body?.withTts,
        upload: body?.upload,
      });
      return reply.code(202).send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message ?? 'Failed to submit job' });
    }
  });

  app.get('/jobs/:jobId', async (request: any, reply: any) => {
    try {
      const { jobId } = request.params as any;
      const status = await getJobStatusModule.getJobStatus(jobId);
      if (!status) {
        return reply.code(404).send({ error: 'Job not found' });
      }
      return reply.send(status);
    } catch {
      return reply.code(500).send({ error: 'Failed to fetch job status' });
    }
  });

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
}, 60000);

afterAll(async () => {
  if (workerStop) {
    await workerStop();
  }
  if (app) {
    await app.close();
  }
  await truncateJobs();
}, 60000);

describe.skip('transport/worker-runner - full pipeline (requires Postgres + Redis)', () => {
  /**
   * NOTE:
   * - This suite is marked .skip by default to avoid requiring services locally.
   * - Enable in CI or dedicated integration pipeline where Postgres + Redis are available.
   */

  it('runs job to succeeded when orchestrator succeeds', async () => {
    runAssignmentJobMock.mockResolvedValue({
      manifestPath: '/manifests/integration.json',
    });

    const submitRes = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: { md: 'fixtures/ok.md' },
    });

    expect(submitRes.statusCode).toBe(202);
    const { jobId } = submitRes.json() as { jobId: string };
    expect(jobId).toBeDefined();

    // Poll GET /jobs/:jobId until job reaches succeeded or timeout.
    const deadline = Date.now() + 20000;
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

      await new Promise(r => setTimeout(r, 500));
    }

    expect(finalStatus).not.toBeNull();
    expect(finalStatus.state).toBe('succeeded');
    expect(finalStatus.manifestPath).toBe('/manifests/integration.json');
  }, 30000);

  it('eventually marks job failed when orchestrator consistently fails', async () => {
    runAssignmentJobMock.mockRejectedValue(new Error('orchestrator down'));

    const submitRes = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: { md: 'fixtures/ok.md' },
    });

    expect(submitRes.statusCode).toBe(202);
    const { jobId } = submitRes.json() as { jobId: string };
    expect(jobId).toBeDefined();

    const deadline = Date.now() + 30000;
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

      await new Promise(r => setTimeout(r, 1000));
    }

    expect(finalStatus).not.toBeNull();
    expect(finalStatus.state).toBe('failed');
    expect(finalStatus.error).toContain('orchestrator down');
  }, 40000);
});
