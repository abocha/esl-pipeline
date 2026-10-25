import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  getJobById,
  recoverAssignmentShareJob,
  updateJobStateAndResult,
} from '../src/domain/job-repository.js';
import { withPgClientSessionContext } from '../src/infrastructure/db.js';
import {
  createJobQueue,
  createJobWorker,
  recoverAssignmentShareQueue,
} from '../src/infrastructure/queue-bullmq.js';
import { assignmentArtifactFixture, promptPackageFixture } from './assignment-v1.test-harness.js';
import { requirePgTestEnv, requireRedisTestEnv, resolveTestTimeout } from './support/test-env.js';

requirePgTestEnv();
requireRedisTestEnv();
const timeout = resolveTestTimeout(30_000);

async function waitFor(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

describe('assignment Share recovery (requires PostgreSQL and Redis)', () => {
  const queueName = `assignment-share-recovery-${randomUUID()}`;
  let service: ReturnType<typeof createJobQueue>;
  let worker: ReturnType<typeof createJobWorker> | null = null;

  beforeAll(async () => {
    process.env.BATCH_JOBS_QUEUE_NAME = queueName;
    service = createJobQueue();
    await service.queue.waitUntilReady();
    await service.queueEvents.waitUntilReady();
  }, timeout);

  afterAll(async () => {
    await worker?.close();
    await service.queue.obliterate({ force: true }).catch(() => undefined);
    await service.queueEvents.close();
    await service.queue.close();
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query('TRUNCATE TABLE assignment_sessions, jobs RESTART IDENTITY CASCADE'),
    );
  }, timeout);

  it(
    'reactivates a retained completed root only after the failed DB row is committed queued',
    async () => {
      const userId = randomUUID();
      const workspaceId = randomUUID();
      const studentId = randomUUID();
      const recordingId = randomUUID();
      const transcriptId = randomUUID();
      const promptPackageId = randomUUID();
      const draftId = randomUUID();
      const sessionId = randomUUID();
      const jobId = randomUUID();
      const draftUri = `local://drafts/content/${'b'.repeat(64)}.json`;
      const assignmentArtifact = {
        ...assignmentArtifactFixture(),
        contentHash: 'b'.repeat(64),
        storageUri: draftUri,
      };
      const transcriptUri = `local://transcripts/${transcriptId}.txt`;
      const snapshot = {
        student: { studentId },
        source: {
          lessonId: null,
          recordingId,
          transcriptId,
          transcriptWorkingVersion: 1,
          transcriptStorageUri: transcriptUri,
          transcriptHash: 'a'.repeat(64),
        },
        context: {
          teacherNotes: null,
          profileId: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
        create: {
          promptPackageId,
          draftId,
          draftWorkingVersion: 1,
          draftStorageUri: draftUri,
          draftHash: 'b'.repeat(64),
          artifact: assignmentArtifact,
        },
      };
      await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
        await client.query('TRUNCATE TABLE assignment_sessions, jobs RESTART IDENTITY CASCADE');
        await client.query(
          `INSERT INTO users (id, email, password_hash, role)
           VALUES ($1, $2, 'hash', 'user') ON CONFLICT (id) DO NOTHING`,
          [userId, `${userId}@example.test`],
        );
        await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Recovery test')`, [
          workspaceId,
        ]);
        await client.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role)
           VALUES ($1, $2, 'owner')`,
          [workspaceId, userId],
        );
        await client.query(
          `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Recovery learner', $2)`,
          [studentId, workspaceId],
        );
        await client.query(
          `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
           VALUES ($1, 'upload', $2, 'local://recording.opus', 1, 'transcribed')`,
          [recordingId, studentId],
        );
        await client.query(
          `INSERT INTO transcripts
             (id, recording_id, storage_uri, working_version, content_hash, stt_provider,
              mode, model, language, fallback_used)
           VALUES ($1, $2, $3, 1, $4, 'deepgram', 'timeline', 'nova-3', 'multi', false)`,
          [transcriptId, recordingId, transcriptUri, 'a'.repeat(64)],
        );
        await client.query(
          `INSERT INTO prompt_packages
             (id, recording_id, transcript_id, student_id, template_version, storage_uri, request_envelope)
           VALUES ($1, $2, $3, $4, 'template-v1', 'local://prompt.txt', $5::jsonb)`,
          [
            promptPackageId,
            recordingId,
            transcriptId,
            studentId,
            JSON.stringify(promptPackageFixture().requestEnvelope),
          ],
        );
        await client.query(
          `INSERT INTO drafts (id, prompt_package_id, student_id, storage_uri, working_version, content_hash, created_by, format)
           VALUES ($1, $2, $3, $4, 1, $5, $6, 'assignment_v1')`,
          [draftId, promptPackageId, studentId, draftUri, 'b'.repeat(64), userId],
        );
        await client.query(
          `INSERT INTO jobs (id, state, md_storage_uri, recording_id, transcript_id, prompt_package_id, draft_id,
              publish_target, user_id, student_id, assignment_artifact, assignment_renderer_version)
           VALUES ($1, 'queued', $2, $3, $4, $5, $6, 'html', $7, $8, $9::jsonb, 2)`,
          [
            jobId,
            draftUri,
            recordingId,
            transcriptId,
            promptPackageId,
            draftId,
            userId,
            studentId,
            JSON.stringify(assignmentArtifact),
          ],
        );
        await client.query(
          `INSERT INTO assignment_sessions
             (id, user_id, student_id, recording_id, transcript_id, prompt_package_id, draft_id,
              share_job_id, revision, confirmed_step, confirmed_snapshot)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 5, 'share', $9::jsonb)`,
          [
            sessionId,
            userId,
            studentId,
            recordingId,
            transcriptId,
            promptPackageId,
            draftId,
            jobId,
            JSON.stringify(snapshot),
          ],
        );
      });

      let deliveries = 0;
      let releaseCancelledExecution!: () => void;
      const cancelledExecutionMayReturn = new Promise<void>((resolve) => {
        releaseCancelledExecution = resolve;
      });
      let firstRunning!: () => void;
      const firstExecutionIsRunning = new Promise<void>((resolve) => {
        firstRunning = resolve;
      });
      const processor = async () => {
        deliveries += 1;
        const running = await updateJobStateAndResult({
          id: jobId,
          expectedState: 'queued',
          nextState: 'running',
          startedAt: new Date(),
        });
        if (!running) return;
        if (deliveries === 1) {
          firstRunning();
          await cancelledExecutionMayReturn;
        }
        await updateJobStateAndResult({
          id: jobId,
          expectedState: 'running',
          nextState: 'succeeded',
          htmlUrl: 'https://example.test/recovered',
          publishedContentHash: 'b'.repeat(64),
          finishedAt: new Date(),
        });
      };
      worker = createJobWorker(processor);

      await service.enqueue({ jobId });
      await firstExecutionIsRunning;
      await updateJobStateAndResult({
        id: jobId,
        expectedState: 'running',
        nextState: 'failed',
        error: 'cancelled',
        finishedAt: new Date(),
      });
      releaseCancelledExecution();
      await waitFor(async () => {
        const retained = await service.queue.getJob(jobId);
        return retained ? (await retained.getState()) === 'completed' : false;
      }, 'the cancelled execution was not retained as completed');
      expect(await getJobById(jobId)).toMatchObject({ state: 'failed', htmlUrl: null });
      await worker.close();
      worker = null;

      await expect(
        recoverAssignmentShareJob({ sessionId, userId, jobId }, async () => {
          expect(await getJobById(jobId)).toMatchObject({ state: 'queued' });
          throw new Error('simulated Redis interruption');
        }),
      ).rejects.toThrow('simulated Redis interruption');
      expect(await getJobById(jobId)).toMatchObject({ state: 'queued', htmlUrl: null });
      expect(await service.queue.getJob(jobId)).not.toBeNull();
      expect(await (await service.queue.getJob(jobId))!.getState()).toBe('completed');

      const recovered = await Promise.all([
        recoverAssignmentShareJob({ sessionId, userId, jobId }, () =>
          recoverAssignmentShareQueue({ jobId }),
        ),
        recoverAssignmentShareJob({ sessionId, userId, jobId }, () =>
          recoverAssignmentShareQueue({ jobId }),
        ),
      ]);
      expect(recovered).toEqual([
        expect.objectContaining({
          id: jobId,
          state: 'queued',
          mdStorageUri: draftUri,
          sourceJobId: null,
        }),
        expect.objectContaining({
          id: jobId,
          state: 'queued',
          mdStorageUri: draftUri,
          sourceJobId: null,
        }),
      ]);
      worker = createJobWorker(processor);
      await waitFor(
        async () => (await getJobById(jobId))?.state === 'succeeded',
        'the recovered execution did not persist success',
      );
      expect(await getJobById(jobId)).toMatchObject({
        state: 'succeeded',
        htmlUrl: 'https://example.test/recovered',
        mdStorageUri: draftUri,
        draftId,
        sourceJobId: null,
      });
      expect(deliveries).toBe(2);
      const count = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query<{ count: string }>(
          'SELECT COUNT(*)::text AS count FROM jobs WHERE id = $1 OR source_job_id = $1',
          [jobId],
        ),
      );
      expect(count.rows[0]?.count).toBe('1');
      const unexpectedReactivation = vi.fn();
      await expect(
        recoverAssignmentShareJob({ sessionId, userId, jobId }, unexpectedReactivation),
      ).resolves.toBeNull();
      expect(unexpectedReactivation).not.toHaveBeenCalled();
    },
    timeout,
  );
});
