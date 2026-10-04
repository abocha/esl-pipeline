import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { serializeAssignmentV1 } from '@esl-pipeline/contracts';

import { approveJobForPipeline } from '../src/application/approve-job.js';
import * as getJobStatusModule from '../src/application/get-job-status.js';
import * as submitJobModule from '../src/application/submit-job.js';
import { insertApprovalJob } from '../src/domain/job-repository.js';
import { withPgClient } from '../src/infrastructure/db.js';
import * as orchestratorService from '../src/infrastructure/orchestrator-service.js';
import { FilesystemTranscriptionStorage } from '../src/infrastructure/transcription-storage.js';
import { startWorker } from '../src/transport/worker-runner.js';
import { assignmentFixture, promptPackageFixture } from './assignment-v1.test-harness.js';
import { requirePgTestEnv, requireRedisTestEnv, resolveTestTimeout } from './support/test-env.js';

/**
 * Intent:
 * - High-value, slower integration that approximates the full flow:
 *   Native approval -> BullMQ enqueue -> worker -> processQueueJob -> runAssignmentJob -> DB state.
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

// Use real approval/getJobStatus implementations (no mocks) to exercise actual flow.
const runAssignmentJobMock = vi.spyOn(orchestratorService, 'runAssignmentJob');

let app: ReturnType<typeof Fastify>;
let workerStop: (() => Promise<void>) | null = null;
let assignmentFixtureDir: string | null = null;

async function seedNativeApproval() {
  const workspaceId = randomUUID();
  const studentId = randomUUID();
  const recordingId = randomUUID();
  const transcriptId = randomUUID();
  const promptPackageId = randomUUID();
  const draftId = randomUUID();
  const storage = new FilesystemTranscriptionStorage(assignmentFixtureDir!);
  const artifact = await storage.putDraft({
    draftId,
    format: 'assignment_v1',
    text: serializeAssignmentV1(assignmentFixture()),
  });
  await withPgClient(async (client) => {
    await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Worker test')`, [
      workspaceId,
    ]);
    await client.query(
      `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Eval Persona One', $2)`,
      [studentId, workspaceId],
    );
    await client.query(
      `INSERT INTO recordings (id, student_id, source, storage_uri, bytes, status)
       VALUES ($1, $2, 'upload', 'local://test.mp3', 1, 'transcribed')`,
      [recordingId, studentId],
    );
    await client.query(
      `INSERT INTO transcripts (id, recording_id, storage_uri, stt_provider, mode, model, language, fallback_used)
       VALUES ($1, $2, 'local://test.txt', 'deepgram', 'timeline', 'nova-3', 'auto', false)`,
      [transcriptId, recordingId],
    );
    await client.query(
      `INSERT INTO prompt_packages (id, recording_id, transcript_id, student_id, template_version, storage_uri, request_envelope)
       VALUES ($1, $2, $3, $4, 'assignment-v1', 'local://prompt.txt', $5::jsonb)`,
      [
        promptPackageId,
        recordingId,
        transcriptId,
        studentId,
        JSON.stringify(promptPackageFixture().requestEnvelope),
      ],
    );
    await client.query(
      `INSERT INTO drafts (id, prompt_package_id, student_id, format, storage_uri, working_version, content_hash)
       VALUES ($1, $2, $3, 'assignment_v1', $4, 1, $5)`,
      [draftId, promptPackageId, studentId, artifact.uri, artifact.sha256],
    );
  });
  return insertApprovalJob({
    recordingId,
    transcriptId,
    promptPackageId,
    draftId,
    studentId,
    mdStorageUri: artifact.uri,
    assignmentArtifact: {
      format: 'assignment_v1',
      schemaVersion: 1,
      serializationVersion: 1,
      workingVersion: 1,
      storageUri: artifact.uri,
      contentHash: artifact.sha256,
    },
    assignmentRendererVersion: 2,
    withTts: false,
    upload: 'none',
  });
}

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
    assignmentFixtureDir = await fs.mkdtemp(path.join(testTmpRoot, 'worker-runner-integration-'));
    vi.stubEnv('FILESYSTEM_UPLOAD_DIR', assignmentFixtureDir);

    // Start HTTP server on ephemeral port.
    // http-server.ts currently binds directly; for tests we simulate by creating Fastify
    // and wiring identical routes inline for inject()-based calls.
    app = Fastify({ logger: false });

    app.post(
      '/jobs/:jobId/approve',
      async (request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) => {
        const job = await approveJobForPipeline(request.params.jobId);
        return reply.code(job ? 202 : 404).send({ jobId: job?.id });
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
    if (assignmentFixtureDir) {
      await fs.rm(assignmentFixtureDir, { recursive: true, force: true });
      assignmentFixtureDir = null;
    }
    vi.unstubAllEnvs();
    await truncateJobs();
  }, integrationTimeout);

  it('rejects retired Markdown submission before queue or provider execution', async () => {
    runAssignmentJobMock.mockClear();
    await expect(submitJobModule.submitJob({ md: 'historical.md' })).rejects.toMatchObject({
      code: 'legacy_assignment_read_only',
    });
    const count = await withPgClient((client) => client.query('SELECT count(*) FROM jobs'));
    expect(Number(count.rows[0].count)).toBe(0);
    expect(runAssignmentJobMock).not.toHaveBeenCalled();
  });

  it(
    'runs job to succeeded when orchestrator succeeds',
    async () => {
      runAssignmentJobMock.mockResolvedValue({
        manifestPath: '/manifests/integration.json',
      });

      const approvalJob = await seedNativeApproval();
      const submitRes = await app.inject({
        method: 'POST',
        url: `/jobs/${approvalJob.id}/approve`,
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

      const approvalJob = await seedNativeApproval();
      const submitRes = await app.inject({
        method: 'POST',
        url: `/jobs/${approvalJob.id}/approve`,
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
