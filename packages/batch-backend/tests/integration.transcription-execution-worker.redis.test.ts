import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { processTranscribeJob } from '../src/application/process-transcribe-job.js';
import { reconcileTranscriptionDelivery } from '../src/application/reconcile-transcription-delivery.js';
import { loadConfig } from '../src/config/env.js';
import { insertRecording } from '../src/domain/recording-repository.js';
import {
  createQueuedTranscriptionRun,
  getTranscriptionRunById,
} from '../src/domain/transcription-run-repository.js';
import {
  createTranscribeQueue,
  createTranscribeWorker,
} from '../src/infrastructure/transcribe-queue.js';
import { closePgPool, createPgPool, withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requireRedisTestEnv, resolveTestTimeout } from './support/test-env.js';

requireRedisTestEnv();
const timeout = resolveTestTimeout(45_000);

describe('transcription execution worker (requires PostgreSQL and Redis)', () => {
  const queueName = `transcribe-production-processor-${randomUUID()}`;
  const originalPgPoolMax = process.env.PG_POOL_MAX;
  let service: ReturnType<typeof createTranscribeQueue>;
  let worker: ReturnType<typeof createTranscribeWorker> | null = null;

  beforeAll(async () => {
    // The execution must not retain a database connection through source
    // preparation or provider I/O; one connection is sufficient end-to-end.
    process.env.PG_POOL_MAX = '1';
    await closePgPool();
    expect((createPgPool() as unknown as { options: { max: number } }).options.max).toBe(1);
    process.env.TRANSCRIBE_QUEUE_NAME = queueName;
    service = createTranscribeQueue();
    await service.queue.waitUntilReady();
    await service.queueEvents.waitUntilReady();
  }, timeout);

  beforeEach(async () => {
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        'TRUNCATE TABLE transcripts, transcription_runs, recordings, students, workspace_memberships, workspaces, users RESTART IDENTITY CASCADE',
      ),
    );
  });

  afterAll(async () => {
    await worker?.close();
    await service.queue.obliterate({ force: true }).catch(() => undefined);
    await service.queueEvents.close();
    await service.queue.close();
    await closePgPool();
    if (originalPgPoolMax === undefined) delete process.env.PG_POOL_MAX;
    else process.env.PG_POOL_MAX = originalPgPoolMax;
  }, timeout);

  it(
    'reconciles one durable job and recovers retry_wait through the production processor',
    async () => {
      const tenant = await seedTenant();
      const recording = await insertRecording({
        workspaceId: tenant.workspaceId,
        source: 'upload',
        studentId: tenant.studentId,
        sourcePath: 'lesson.wav',
        storageUri: 'local://recordings/worker-integration.wav',
        bytes: 12,
        audioTopology: 'mixed_recording',
        status: 'queued',
      });
      const run = await createQueuedTranscriptionRun({
        recordingId: recording.id,
        workspaceId: tenant.workspaceId,
        provider: 'elevenlabs',
        requestProfile: 'ordinary_mixed_v1',
      });

      await reconcileTranscriptionDelivery({ limit: 10 });
      await reconcileTranscriptionDelivery({ limit: 10 });
      const job = await service.queue.getJob(run.id);
      expect(job?.id).toBe(run.id);
      expect(await service.queue.getJobCounts('waiting', 'delayed', 'active')).toMatchObject({
        waiting: 1,
      });

      let providerCalls = 0;
      worker = createTranscribeWorker(async (bullJob) =>
        processTranscribeJob(bullJob.data, {
          config: loadConfig(),
          storage: storageStub(),
          sttTranscribe: async () => {
            providerCalls += 1;
            if (providerCalls === 1) {
              throw Object.assign(new Error('controlled network boundary'), {
                code: 'PROVIDER_TRANSPORT_ERROR',
              });
            }
            return validResult();
          },
        }),
      );

      await job!.waitUntilFinished(service.queueEvents);
      expect(providerCalls).toBe(2);
      await expect(getTranscriptionRunById(run.id)).resolves.toMatchObject({
        state: 'succeeded',
        submissionSlotsReserved: 2,
      });
      await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
        const winner = await client.query(
          'SELECT count(*)::int AS count FROM transcripts WHERE recording_id = $1',
          [recording.id],
        );
        expect(winner.rows[0]?.count).toBe(1);
      });

      await service.queue.getJob(run.id).then((completed) => completed?.remove());
      await reconcileTranscriptionDelivery({ limit: 10 });
    expect(await service.queue.getJob(run.id)).toBeFalsy();
    },
    timeout,
  );
});

async function seedTenant() {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [
      workspaceId,
      'Worker test',
    ]);
    await client.query(
      "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'hash', 'user')",
      [userId, `${userId}@example.test`],
    );
    await client.query(
      "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
      [workspaceId, userId],
    );
    await client.query("INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Alex', $2)", [
      studentId,
      workspaceId,
    ]);
  });
  return { workspaceId, studentId };
}

function storageStub() {
  return {
    getStream: async () => {
      throw new Error('fake provider does not read audio');
    },
    putAudio: async () => {
      throw new Error('not used');
    },
    putTranscript: async ({ transcriptId }: { transcriptId: string; text: string }) => ({
      uri: `local://transcripts/${transcriptId}.txt`,
      sha256: 'a'.repeat(64),
    }),
    putRawResponse: async ({ transcriptId }: { transcriptId: string; json: unknown }) => ({
      uri: `local://transcripts/${transcriptId}.json`,
      sha256: 'b'.repeat(64),
    }),
    getText: async () => '',
    delete: async () => undefined,
  } as never;
}

function validResult() {
  return {
    provider: 'elevenlabs' as const,
    model: 'scribe_v2',
    language: 'auto',
    text: 'Tutor Student',
    segments: [
      { text: 'Tutor', speaker: 0, start: 0, end: 0.2 },
      { text: 'Student', speaker: 1, start: 0.3, end: 0.5 },
    ],
    rawResponse: null,
    fallbackUsed: false,
  };
}
