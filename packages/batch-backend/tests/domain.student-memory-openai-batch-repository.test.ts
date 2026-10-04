import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { recordStudentMemoryOpenAiBatchRemoteStatus } from '../src/application/student-memory-openai-batch-operations.js';
import {
  createStudentMemoryOpenAiBatchRun,
  getStudentMemoryOpenAiBatchRunById,
  listStudentMemoryOpenAiBatchItems,
  markStudentMemoryOpenAiBatchItemImported,
  markStudentMemoryOpenAiBatchItemOutcome,
  markStudentMemoryOpenAiBatchRunSubmitted,
  supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork,
} from '../src/domain/student-memory-openai-batch-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) {
  requirePgTestEnv();
}

const describeIfPg = hasPgTestEnv ? describe : describe.skip;

async function truncateBatchReplayTables() {
  await withPgClient(async (client) => {
    await client.query(
      `TRUNCATE TABLE
        student_memory_openai_batch_claims,
        student_memory_openai_batch_items,
        student_memory_openai_batch_runs,
        students
      RESTART IDENTITY CASCADE`,
    );
  });
}

describeIfPg('domain/student-memory-openai-batch-repository', () => {
  beforeAll(async () => {
    await truncateBatchReplayTables();
  });

  beforeEach(async () => {
    await truncateBatchReplayTables();
  });

  afterAll(async () => {
    await truncateBatchReplayTables();
    await closePgPool();
  });

  it('refreshes stale cancellation and reconciled states using matching remote evidence', async () => {
    const id = randomUUID();
    await withPgClient((client) =>
      client.query(
        `INSERT INTO student_memory_openai_batch_runs
      (id,workload,model,state,input_jsonl_sha256,input_bytes,item_count,remote_batch_id,operator_audit)
      VALUES($1,'lesson_memory','test-model','cancelled',$2,1,1,'remote-batch','{"reason":"retained"}')`,
        [id, 'a'.repeat(64)],
      ),
    );
    await recordStudentMemoryOpenAiBatchRemoteStatus({
      runId: id,
      remote: { id: 'remote-batch', status: 'cancelling' },
    });
    const read = () =>
      withPgClient(
        async (client) =>
          (
            await client.query(
              'SELECT state,operator_audit FROM student_memory_openai_batch_runs WHERE id=$1',
              [id],
            )
          ).rows[0],
      );
    const cancelling = await read();
    expect(cancelling).toMatchObject({
      state: 'in_progress',
      operator_audit: {
        reason: 'retained',
        remoteStatusConfirmation: {
          batchId: 'remote-batch',
          status: 'cancelling',
          checkedAt: expect.any(String),
        },
      },
    });
    await expect(
      recordStudentMemoryOpenAiBatchRemoteStatus({
        runId: id,
        remote: { id: 'different-batch', status: 'cancelled' },
      }),
    ).rejects.toThrow('cannot record remote status');
    expect(await read()).toEqual(cancelling);
    await withPgClient((client) =>
      client.query("UPDATE student_memory_openai_batch_runs SET state='reconciled' WHERE id=$1", [
        id,
      ]),
    );
    await recordStudentMemoryOpenAiBatchRemoteStatus({
      runId: id,
      remote: { id: 'remote-batch', status: 'cancelled' },
    });
    expect(await read()).toMatchObject({
      state: 'reconciled',
      operator_audit: { reason: 'retained', remoteStatusConfirmation: { status: 'cancelled' } },
    });
    await recordStudentMemoryOpenAiBatchRemoteStatus({
      runId: id,
      remote: { id: 'remote-batch', status: 'cancelling' },
    });
    expect(await read()).toMatchObject({
      state: 'in_progress',
      operator_audit: { remoteStatusConfirmation: { status: 'cancelling' } },
    });
  });

  it('persists an immutable item snapshot and lets fresh online work supersede its active claim', async () => {
    const studentId = randomUUID();
    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at)
         VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
    });

    const run = await createStudentMemoryOpenAiBatchRun({
      workload: 'lesson_memory',
      model: 'gpt-5.2',
      inputJsonlSha256: 'a'.repeat(64),
      inputBytes: 123,
      items: [
        {
          id: randomUUID(),
          studentId,
          customId: 'lesson_memory:scope:version:envelope:gpt-5.2',
          canonicalScopeKey: 'transcript:scope',
          sourceVersionHash: 'b'.repeat(64),
          requestEnvelope: { version: 'generation_request_envelope_v1' },
          responseSchemaFingerprint: 'schema:lesson-memory.v1',
          requestBody: { model: 'gpt-5.2', input: 'student text is stored only in Postgres' },
          sourceRefs: { transcriptId: 'scope' },
        },
      ],
    });

    expect(run.state).toBe('planned');

    const [item] = await listStudentMemoryOpenAiBatchItems({ runId: run.id });
    if (!item) {
      throw new Error('Expected the persisted Batch item');
    }
    expect(item).toMatchObject({
      runId: run.id,
      workload: 'lesson_memory',
      claimState: 'active',
      state: 'planned',
      requestBody: { model: 'gpt-5.2', input: 'student text is stored only in Postgres' },
    });

    const superseded = await supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork({
      workload: 'lesson_memory',
      canonicalScopeKey: 'transcript:scope',
    });

    expect(superseded).toEqual([item.id]);
    await expect(listStudentMemoryOpenAiBatchItems({ runId: run.id })).resolves.toEqual([
      expect.objectContaining({
        id: item.id,
        claimState: 'superseded_by_online',
        state: 'superseded_by_online',
      }),
    ]);
  });

  it('persists only safe remote Batch identifiers and lifecycle state after submission', async () => {
    const studentId = randomUUID();
    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at)
         VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
    });
    const run = await createStudentMemoryOpenAiBatchRun({
      workload: 'lesson_memory',
      model: 'gpt-5.2',
      inputJsonlSha256: 'c'.repeat(64),
      inputBytes: 123,
      items: [
        {
          studentId,
          customId: `lesson_memory:submission:${randomUUID()}`,
          canonicalScopeKey: 'transcript:submission',
          sourceVersionHash: 'd'.repeat(64),
          requestEnvelope: { version: 'generation_request_envelope_v1' },
          responseSchemaFingerprint: 'schema:lesson-memory.v1',
          requestBody: { model: 'gpt-5.2' },
          sourceRefs: { transcriptId: 'submission' },
        },
      ],
    });

    await markStudentMemoryOpenAiBatchRunSubmitted({
      runId: run.id,
      remoteInputFileId: 'file_1',
      remoteBatchId: 'batch_1',
    });

    await expect(getStudentMemoryOpenAiBatchRunById(run.id)).resolves.toMatchObject({
      id: run.id,
      state: 'submitted',
      remoteInputFileId: 'file_1',
      remoteBatchId: 'batch_1',
    });
  });

  it('marks a stable canonical destination as imported idempotently', async () => {
    const studentId = randomUUID();
    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
    });
    const run = await createStudentMemoryOpenAiBatchRun({
      workload: 'lesson_memory',
      model: 'gpt-5.2',
      inputJsonlSha256: 'e'.repeat(64),
      inputBytes: 1,
      items: [
        {
          studentId,
          customId: `lesson_memory:import:${randomUUID()}`,
          canonicalScopeKey: 'transcript:import',
          sourceVersionHash: 'f'.repeat(64),
          requestEnvelope: {},
          responseSchemaFingerprint: 'schema',
          requestBody: { model: 'gpt-5.2' },
          sourceRefs: {},
        },
      ],
    });
    const [item] = await listStudentMemoryOpenAiBatchItems({ runId: run.id });
    if (!item) throw new Error('Expected item');

    await markStudentMemoryOpenAiBatchItemImported({ itemId: item.id, canonicalRecordId: item.id });
    await markStudentMemoryOpenAiBatchItemImported({ itemId: item.id, canonicalRecordId: item.id });

    await expect(listStudentMemoryOpenAiBatchItems({ runId: run.id })).resolves.toEqual([
      expect.objectContaining({ id: item.id, state: 'imported', claimState: 'imported' }),
    ]);
  });

  it('records a terminal stale outcome without retaining raw provider output', async () => {
    const studentId = randomUUID();
    await withPgClient((client) =>
      client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      ),
    );
    const run = await createStudentMemoryOpenAiBatchRun({
      workload: 'lesson_memory',
      model: 'gpt-5.2',
      inputJsonlSha256: '1'.repeat(64),
      inputBytes: 1,
      items: [
        {
          studentId,
          customId: `lesson_memory:stale:${randomUUID()}`,
          canonicalScopeKey: 'scope',
          sourceVersionHash: '2'.repeat(64),
          requestEnvelope: {},
          responseSchemaFingerprint: 'schema',
          requestBody: { model: 'gpt-5.2' },
          sourceRefs: {},
        },
      ],
    });
    const [item] = await listStudentMemoryOpenAiBatchItems({ runId: run.id });
    if (!item) throw new Error('Expected item');
    await markStudentMemoryOpenAiBatchItemOutcome({
      itemId: item.id,
      state: 'stale',
      normalizedError: { reason: 'source_stale' },
    });
    await expect(listStudentMemoryOpenAiBatchItems({ runId: run.id })).resolves.toEqual([
      expect.objectContaining({ id: item.id, state: 'stale', claimState: 'stale' }),
    ]);
  });
});
