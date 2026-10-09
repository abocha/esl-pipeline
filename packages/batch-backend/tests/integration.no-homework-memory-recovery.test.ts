import './support/bootstrap-pg-test-env.js';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ProcessLessonMemoryJobPayload,
  processLessonMemoryJob,
} from '../src/application/process-lesson-memory-job.js';
import { processStudentMemorySnapshotJob } from '../src/application/process-student-memory-snapshot-job.js';
import {
  enqueuePendingProfileInitialEnrichments,
  reconcileProfileInitialEnrichmentOperation,
} from '../src/application/profile-initial-enrichment.js';
import { reconcileMemoryDelivery } from '../src/application/reconcile-memory-delivery.js';
import {
  enqueueConfirmedLessonMemoryIntent,
  requestLessonMemoryGeneration,
} from '../src/application/request-lesson-memory-generation.js';
import { requestStudentMemorySnapshotRefresh } from '../src/application/request-student-memory-snapshot-refresh.js';
import { refreshStudentProfileCandidatesFromCanonicalMemory } from '../src/application/student-profile-candidates.js';
import { getStudentTeachingContext } from '../src/application/student-teaching-context.js';
import { getTranscriptProcessingStatus } from '../src/application/transcript-processing-status.js';
import { loadConfig } from '../src/config/env.js';
import {
  ensurePendingLessonMemoryEntry,
  getLessonMemoryEntryById,
  insertCanonicalReadyLessonMemoryEntry,
  publishConfirmedLessonMemoryEntry,
} from '../src/domain/lesson-memory-repository.js';
import {
  listReadyLessonMemoryMissingSnapshotObligations,
  listRecoverableMemoryDeliveries,
} from '../src/domain/memory-replay-delivery.js';
import { createStudentMemoryOpenAiBatchRun } from '../src/domain/student-memory-openai-batch-repository.js';
import {
  getLatestReadyStudentMemorySnapshotByStudentId,
  insertCanonicalReadyStudentMemorySnapshot,
  StudentMemorySnapshotIntentObsoleteError,
} from '../src/domain/student-memory-snapshot-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import {
  closeStudentMemoryQueue,
  createStudentMemoryQueue,
  createStudentMemoryWorker,
} from '../src/infrastructure/student-memory-queue.js';
import {
  insertLessonMemory,
  makeLessonMemorySourcesHistorical,
} from './support/student-memory-fixture.js';
import { requirePgTestEnv, requireRedisTestEnv } from './support/test-env.js';

requirePgTestEnv();
requireRedisTestEnv();
process.env.STUDENT_MEMORY_QUEUE_NAME = `no-homework-recovery-${randomUUID()}`;
const config = loadConfig();
const hash = createHash('sha256').update('A').digest('hex');
const pacer = { run: async (args: { execute: () => Promise<unknown> }) => args.execute() };
const lessonContent = {
  lessonTitle: null,
  lessonSummary: 'Lesson evidence',
  topicsDiscussed: [],
  mistakePatterns: [],
  grammarReviewed: [],
  grammarWatchlist: [],
  vocabularyFocus: [],
  pronunciationFocus: [],
  studentFacts: [],
  progressSignals: [],
  followUpRecommendations: [],
};
const snapshotContent = {
  stableStrengths: [],
  recurringIssues: [],
  activeReviewBacklog: [],
  recentProgress: [],
  personalFacts: [],
  recommendedAssignmentDirections: [],
  unresolvedIssues: [],
  snapshotSummary: 'Updated from confirmed lesson',
};

async function seed(status: 'pending' | 'ready' = 'ready', intent: 'none' | 'create' = 'none') {
  const studentId = randomUUID();
  await withPgClient((client) =>
    client.query('INSERT INTO students(id, student) VALUES ($1, $2)', [
      studentId,
      `Recovery fixture ${studentId}`,
    ]),
  );
  const id = await insertLessonMemory({ studentId, status: 'ready', withConfirmedSource: true });
  await withPgClient(async (client) => {
    await client.query(
      `UPDATE assignment_sessions a SET homework_intent = $2,
      confirmed_snapshot = jsonb_set(confirmed_snapshot, '{source,transcriptHash}', to_jsonb($3::text))
      FROM lesson_memory_entries l WHERE l.id = $1 AND a.id = l.assignment_session_id`,
      [id, intent, hash],
    );
    await client.query(
      `UPDATE transcripts t SET content_hash = $2 FROM lesson_memory_entries l WHERE l.id = $1 AND t.id = l.transcript_id`,
      [id, hash],
    );
    await client.query(
      `UPDATE lesson_memory_entries SET status = $2, source_content_hash = $3 WHERE id = $1`,
      [id, status, hash],
    );
  });
  const entry = (await getLessonMemoryEntryById(id))!;
  const payload: ProcessLessonMemoryJobPayload = {
    kind: 'lesson-memory-generate',
    studentId,
    pendingEntryId: id,
    transcriptId: entry.transcriptId,
    recordingId: entry.recordingId,
    assignmentSessionId: entry.assignmentSessionId,
    lessonId: null,
    sourceStorageUri: entry.sourceStorageUri!,
    sourceContentHash: hash,
    provider: 'openai',
    model: entry.model,
  };
  return { id, studentId, sessionId: entry.assignmentSessionId!, payload };
}

async function snapshotRows(studentId: string) {
  return withPgClient(
    async (client) =>
      (
        await client.query(
          `SELECT * FROM student_memory_snapshots WHERE student_id = $1 ORDER BY created_at`,
          [studentId],
        )
      ).rows,
  );
}

async function complete(source: Awaited<ReturnType<typeof seed>>) {
  await withPgClient((client) =>
    client.query(
      `UPDATE assignment_sessions SET revision = revision + 1,
    transcript_completed_at = NOW(),
    transcript_completion_history = jsonb_build_array(jsonb_build_object(
      'completedAt', NOW(), 'expectedRevision', revision, 'resultingRevision', revision + 1,
      'studentId', student_id, 'source', confirmed_snapshot->'source')) WHERE id = $1`,
      [source.sessionId],
    ),
  );
}

async function refresh(
  source: Awaited<ReturnType<typeof seed>>,
  queue?: { reconcile: ReturnType<typeof createStudentMemoryQueue>['reconcile'] },
) {
  return requestStudentMemorySnapshotRefresh({
    config,
    params: {
      studentId: source.studentId,
      trigger: 'lesson-memory-ready',
      sourceEntryId: source.id,
    },
    overrides: queue ? { queue } : undefined,
  });
}

function lessonOverrides(
  extractor: () => Promise<unknown> = vi.fn().mockResolvedValue({ content: lessonContent }),
) {
  return { extractor, pacer, storageFactory: () => ({ getText: async () => 'A' }) } as never;
}

async function restartAndReconcile(
  source: Awaited<ReturnType<typeof seed>>,
  lessonExtractor: () => Promise<unknown>,
) {
  // Drop process-owned queue/DB connections, recreate the worker, and run the
  // same startup/periodic reconciler. No session/API/page revisit delivers work.
  await closeStudentMemoryQueue();
  await closePgPool();
  const snapshotExtractor = vi.fn().mockResolvedValue({ content: snapshotContent });
  const worker = createStudentMemoryWorker(async (job) => {
    if (job.data.kind === 'lesson-memory-generate') {
      await processLessonMemoryJob({
        config,
        payload: job.data,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        overrides: lessonOverrides(lessonExtractor),
      });
    } else if (job.data.kind === 'student-memory-snapshot-refresh') {
      await processStudentMemorySnapshotJob({
        config,
        payload: job.data,
        overrides: {
          extractor: snapshotExtractor,
          pacer,
          profileCandidates: { requestRefresh: vi.fn() },
        } as never,
      });
    } else throw new Error('Unexpected recovery workload');
  });
  try {
    await worker.waitUntilReady();
    await reconcileMemoryDelivery({ config });
    await expect
      .poll(
        async () =>
          (await getLatestReadyStudentMemorySnapshotByStudentId(source.studentId))?.snapshotSummary,
        { timeout: 15_000 },
      )
      .toBe(snapshotContent.snapshotSummary);
  } finally {
    await worker.close();
  }
  expect(snapshotExtractor).toHaveBeenCalledTimes(1);
  expect(
    (await getLatestReadyStudentMemorySnapshotByStudentId(source.studentId))?.lessonMemoryEntryIds,
  ).toContain(source.id);
  const rows = await snapshotRows(source.studentId);
  expect(rows.filter((row) => row.status === 'pending')).toHaveLength(0);
  expect(
    rows.filter(
      (row) =>
        row.generation_notes?.sourceEntryId === source.id && !row.generation_notes?.pendingEntryId,
    ),
  ).toHaveLength(1);
}

describe('canonical no-homework memory durable recovery', () => {
  it('keeps historical extraction, publication, delivery and enrichment blocked while existing observations remain readable', async () => {
    const pending = await seed('pending', 'create');
    const ready = await seed('ready', 'create');
    const operationId = randomUUID();
    await withPgClient((client) =>
      client.query(
        `INSERT INTO profile_initial_enrichment_operations
      (id,student_id,assignment_session_id,recording_id,transcript_id,transcript_storage_uri,transcript_hash,
       source_identity_kind,source_fingerprint_scheme,source_fingerprint)
      SELECT $1,l.student_id,l.assignment_session_id,l.recording_id,l.transcript_id,l.source_storage_uri,l.source_content_hash,
       r.source_identity_kind,r.source_fingerprint_scheme,r.source_fingerprint
      FROM lesson_memory_entries l JOIN recordings r ON r.id=l.recording_id WHERE l.id=$2`,
        [operationId, ready.id],
      ),
    );
    await makeLessonMemorySourcesHistorical([pending.id, ready.id]);
    const before = await getLessonMemoryEntryById(pending.id);
    const extractor = vi.fn();
    await processLessonMemoryJob({
      config,
      payload: pending.payload,
      overrides: lessonOverrides(extractor),
    });
    expect(extractor).not.toHaveBeenCalled();
    await expect(
      requestLessonMemoryGeneration({
        config,
        params: { ...pending.payload, assignmentSessionId: pending.sessionId, trigger: 'replay' },
      }),
    ).rejects.toThrow('Historical');
    await expect(
      ensurePendingLessonMemoryEntry({
        ...pending.payload,
        assignmentSessionId: pending.sessionId,
        schemaVersion: 'lesson-memory.v1',
      }),
    ).rejects.toThrow('Historical');
    await expect(
      insertCanonicalReadyLessonMemoryEntry({
        ...pending.payload,
        assignmentSessionId: pending.sessionId,
        schemaVersion: 'lesson-memory.v1',
      }),
    ).rejects.toThrow('Historical');
    await expect(
      publishConfirmedLessonMemoryEntry({
        ...pending.payload,
        id: pending.id,
        assignmentSessionId: pending.sessionId,
        schemaVersion: 'lesson-memory.v1',
      }),
    ).resolves.toBeNull();
    expect(await listRecoverableMemoryDeliveries()).toEqual([]);
    expect(await listReadyLessonMemoryMissingSnapshotObligations()).toEqual([]);
    const reconcile = vi.fn();
    await enqueuePendingProfileInitialEnrichments({ reconcile });
    expect(reconcile).not.toHaveBeenCalled();
    const enrichmentGenerator = vi.fn();
    await reconcileProfileInitialEnrichmentOperation(operationId, config, enrichmentGenerator);
    expect(enrichmentGenerator).not.toHaveBeenCalled();
    expect(await getLessonMemoryEntryById(pending.id)).toEqual(before);
    const context = await getStudentTeachingContext({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      studentId: ready.studentId,
    });
    expect(context?.recentLessons).toHaveLength(1);
  });
  beforeEach(async () => {
    await createStudentMemoryQueue().queue.obliterate({ force: true });
    await withPgClient((client) =>
      client.query('TRUNCATE students, jobs, users RESTART IDENTITY CASCADE'),
    );
  });
  afterAll(async () => {
    await createStudentMemoryQueue().queue.obliterate({ force: true });
    await closeStudentMemoryQueue();
    await closePgPool();
  });

  it('recovers lost extraction delivery after restart using the canonical stable job and then updates snapshot', async () => {
    const source = await seed('pending');
    await complete(source);
    const lessonExtractor = vi.fn().mockResolvedValue({ content: lessonContent });
    expect(
      await createStudentMemoryQueue().queue.getJob(
        `lesson-memory__${source.payload.transcriptId}__${hash}`,
      ),
    ).toBeUndefined();
    expect(await listRecoverableMemoryDeliveries()).toContainEqual(source.payload);
    await restartAndReconcile(source, lessonExtractor);
    expect(lessonExtractor).toHaveBeenCalledTimes(1);
    expect((await getLessonMemoryEntryById(source.id))?.status).toBe('ready');
  });

  it('repairs failure after ready publication without relabeling extraction or calling its provider again', async () => {
    const source = await seed('pending');
    const lessonExtractor = vi.fn().mockResolvedValue({ content: lessonContent });
    await expect(
      processLessonMemoryJob({
        config,
        payload: source.payload,
        maxAttempts: 1,
        overrides: {
          ...(lessonOverrides(lessonExtractor) as object),
          snapshots: {
            requestRefresh: vi.fn().mockRejectedValue(new Error('interrupted after publication')),
          },
        } as never,
      }),
    ).rejects.toThrow('interrupted after publication');
    expect((await getLessonMemoryEntryById(source.id))?.status).toBe('ready');
    expect(await snapshotRows(source.studentId)).toHaveLength(0);
    expect(await getTranscriptProcessingStatus(source.sessionId)).toMatchObject({
      lessonMemory: 'ready',
      snapshot: 'pending',
    });
    await restartAndReconcile(source, lessonExtractor);
    expect(lessonExtractor).toHaveBeenCalledTimes(1);
    expect(await getTranscriptProcessingStatus(source.sessionId)).toMatchObject({
      lessonMemory: 'ready',
      snapshot: 'ready',
    });
  });

  it('discovers pre-existing ready extraction only after opting out, and restores snapshot enqueue lost after intent commit', async () => {
    const source = await seed('ready', 'create');
    expect(await listReadyLessonMemoryMissingSnapshotObligations()).toHaveLength(0);
    await withPgClient((client) =>
      client.query("UPDATE assignment_sessions SET homework_intent = 'none' WHERE id = $1", [
        source.sessionId,
      ]),
    );
    expect(await listReadyLessonMemoryMissingSnapshotObligations()).toEqual([
      { studentId: source.studentId, sourceEntryId: source.id },
    ]);
    await expect(
      refresh(source, { reconcile: vi.fn().mockRejectedValue(new Error('lost snapshot enqueue')) }),
    ).rejects.toThrow('lost snapshot enqueue');
    expect(await snapshotRows(source.studentId)).toHaveLength(1);
    const lessonExtractor = vi.fn();
    await restartAndReconcile(source, lessonExtractor);
    expect(lessonExtractor).not.toHaveBeenCalled();
  });

  it('converges direct ready retry and scanner, then reuses pending and fulfilled source obligations', async () => {
    const source = await seed();
    const extractor = vi.fn();
    await Promise.all([
      reconcileMemoryDelivery({ config }),
      processLessonMemoryJob({
        config,
        payload: source.payload,
        overrides: lessonOverrides(extractor),
      }),
    ]);
    const pending = await snapshotRows(source.studentId);
    expect(pending).toHaveLength(1);
    const repeated = await refresh(source);
    expect(repeated).toMatchObject({ outcome: 'pending_exists', entry: { id: pending[0].id } });
    await restartAndReconcile(source, extractor);
    const before = await snapshotRows(source.studentId);
    await refresh(source);
    await reconcileMemoryDelivery({ config });
    expect(await snapshotRows(source.studentId)).toHaveLength(before.length);
    expect(extractor).not.toHaveBeenCalled();
  });

  it('reuses eligible snapshot lineage even without source-specific request notes', async () => {
    const source = await seed();
    const existing = await insertCanonicalReadyStudentMemorySnapshot({
      studentId: source.studentId,
      schemaVersion: 'student-memory-snapshot.v1',
      provider: 'openai',
      model: 'fixture',
      lessonMemoryEntryIds: [source.id],
      ...snapshotContent,
    });
    expect(await listReadyLessonMemoryMissingSnapshotObligations()).toHaveLength(0);
    expect(await refresh(source)).toMatchObject({
      outcome: 'already_reconciled',
      entry: { id: existing.id },
    });
    expect(await snapshotRows(source.studentId)).toHaveLength(1);
  });

  it('projects ready snapshot with remapped corroborating lineage as superseded without read effects', async () => {
    const source = await seed();
    await complete(source);
    const corroboratingId = await insertLessonMemory({
      studentId: source.studentId,
      status: 'ready',
      withConfirmedSource: true,
    });
    const corroborating = (await getLessonMemoryEntryById(corroboratingId))!;
    const snapshot = await insertCanonicalReadyStudentMemorySnapshot({
      studentId: source.studentId,
      schemaVersion: 'student-memory-snapshot.v1',
      provider: 'openai',
      model: 'fixture',
      lessonMemoryEntryIds: [source.id, corroboratingId],
      ...snapshotContent,
    });
    expect((await getLatestReadyStudentMemorySnapshotByStudentId(source.studentId))?.id).toBe(
      snapshot.id,
    );
    expect(await getTranscriptProcessingStatus(source.sessionId)).toMatchObject({
      snapshot: 'ready',
    });
    await withPgClient((client) =>
      client.query(
        `UPDATE assignment_sessions SET confirmed_snapshot =
      jsonb_set(confirmed_snapshot, '{source,transcriptHash}', to_jsonb($2::text)) WHERE id = $1`,
        [corroborating.assignmentSessionId, 'b'.repeat(64)],
      ),
    );
    expect(await getLatestReadyStudentMemorySnapshotByStudentId(source.studentId)).toBeNull();
    const rowsBefore = await snapshotRows(source.studentId);
    const queueBefore = await createStudentMemoryQueue().queue.getJobCounts();
    expect(await getTranscriptProcessingStatus(source.sessionId)).toMatchObject({
      lessonMemory: 'ready',
      snapshot: 'superseded',
    });
    expect(await snapshotRows(source.studentId)).toEqual(rowsBefore);
    expect(await createStudentMemoryQueue().queue.getJobCounts()).toEqual(queueBefore);

    // A newer terminal source obligation stays visible despite the raw ready
    // row, while genuine eligible fulfillment retains its ready priority.
    const terminal = await refresh(source, { reconcile: vi.fn() });
    expect(terminal).toMatchObject({
      outcome: 'pending_exists',
      entry: { status: 'pending', generationNotes: { sourceEntryId: source.id } },
    });
    expect(await snapshotRows(source.studentId)).toHaveLength(2);
    await withPgClient((client) =>
      client.query("UPDATE student_memory_snapshots SET status='failed' WHERE id=$1", [
        terminal.entry.id,
      ]),
    );
    expect(await getTranscriptProcessingStatus(source.sessionId)).toMatchObject({
      snapshot: 'failed',
    });
    const valid = await insertCanonicalReadyStudentMemorySnapshot({
      studentId: source.studentId,
      schemaVersion: 'student-memory-snapshot.v1',
      provider: 'openai',
      model: 'fixture',
      lessonMemoryEntryIds: [source.id],
      generationNotes: {
        trigger: 'manual-replay',
        strategy: 'manual_rebuild_v1_1',
        replayKey: 'fixture-repair',
        operatorReason: 'Explicit fixture reconstruction',
      },
      ...snapshotContent,
    });
    expect((await getLatestReadyStudentMemorySnapshotByStudentId(source.studentId))?.id).toBe(
      valid.id,
    );
    expect(await getTranscriptProcessingStatus(source.sessionId)).toMatchObject({
      snapshot: 'ready',
    });
  });

  it.each(['failed', 'cancelled', 'obsolete', 'superseded'] as const)(
    'respects %s source obligation without redelivery/replacement',
    async (terminal) => {
      const source = await seed();
      const obligation = await refresh(source, { reconcile: vi.fn() });
      const status = terminal === 'failed' ? 'failed' : 'superseded';
      const notes =
        terminal === 'cancelled'
          ? { cancelledAt: new Date().toISOString() }
          : terminal === 'obsolete'
            ? { obsoleteReason: 'source changed' }
            : {};
      await withPgClient((client) =>
        client.query(
          `UPDATE student_memory_snapshots SET status = $2, generation_notes = generation_notes || $3::jsonb WHERE id = $1`,
          [obligation.entry.id, status, JSON.stringify(notes)],
        ),
      );
      const reconcile = vi.fn();
      expect(await refresh(source, { reconcile })).toMatchObject({
        outcome: 'already_reconciled',
        entry: { id: obligation.entry.id, status },
      });
      await reconcileMemoryDelivery({ config, queue: { reconcile } });
      expect(reconcile).not.toHaveBeenCalled();
      expect(await snapshotRows(source.studentId)).toHaveLength(1);
      expect(await getTranscriptProcessingStatus(source.sessionId)).toMatchObject({
        lessonMemory: 'ready',
        snapshot: status,
      });
    },
  );

  it('does not redeliver terminal extraction or replaced canonical owners', async () => {
    const failed = await seed('pending');
    await withPgClient((client) =>
      client.query("UPDATE lesson_memory_entries SET status = 'failed' WHERE id = $1", [failed.id]),
    );
    const replaced = await seed('pending');
    await withPgClient((client) =>
      client.query('DELETE FROM assignment_source_bindings WHERE assignment_session_id = $1', [
        replaced.sessionId,
      ]),
    );
    expect(await listRecoverableMemoryDeliveries()).toHaveLength(0);
    await expect(refresh(replaced)).rejects.toBeInstanceOf(
      StudentMemorySnapshotIntentObsoleteError,
    );
    expect(await snapshotRows(replaced.studentId)).toHaveLength(0);
  });

  it('repairs promoted authoritative finish evidence but cannot revive remapped evidence or unrelated historical ready lessons', async () => {
    const source = await seed();
    await complete(source);
    await withPgClient((client) =>
      client.query(
        `UPDATE assignment_sessions SET homework_intent = 'create',
      transcript_completed_at = NULL, homework_started_from_revision = revision, revision = revision + 1 WHERE id = $1`,
        [source.sessionId],
      ),
    );
    expect(await listReadyLessonMemoryMissingSnapshotObligations()).toEqual([
      { studentId: source.studentId, sourceEntryId: source.id },
    ]);
    await withPgClient((client) =>
      client.query(
        `UPDATE assignment_sessions SET confirmed_snapshot =
      jsonb_set(confirmed_snapshot, '{source,transcriptHash}', to_jsonb($2::text)) WHERE id = $1`,
        [source.sessionId, 'b'.repeat(64)],
      ),
    );
    await seed('ready', 'create');
    expect(await listReadyLessonMemoryMissingSnapshotObligations()).toHaveLength(0);
    await expect(refresh(source)).rejects.toBeInstanceOf(StudentMemorySnapshotIntentObsoleteError);
  });

  it('read-time intent reconciliation preserves terminal extraction and creates no queue effects', async () => {
    const source = await seed('pending');
    await withPgClient((client) =>
      client.query("UPDATE lesson_memory_entries SET status = 'failed' WHERE id = $1", [source.id]),
    );
    const reconcile = vi.fn();
    const result = await requestLessonMemoryGeneration({
      config,
      params: {
        studentId: source.studentId,
        transcriptId: source.payload.transcriptId,
        recordingId: source.payload.recordingId,
        assignmentSessionId: source.sessionId,
        sourceStorageUri: source.payload.sourceStorageUri,
        sourceContentHash: hash,
        trigger: 'replay',
        retryTerminal: false,
      },
      overrides: { queue: { reconcile } },
    });
    expect(result).toMatchObject({
      outcome: 'terminal_exists',
      entry: { id: source.id, status: 'failed' },
    });
    expect(reconcile).not.toHaveBeenCalled();
    expect(await getTranscriptProcessingStatus(source.sessionId)).toMatchObject({
      lessonMemory: 'failed',
      snapshot: 'not_requested',
    });
  });

  it.each(['terminalized', 'remapped'] as const)(
    'rechecks a %s lesson after scanner selection before queue or arbitration effects and before worker extraction',
    async (change) => {
      const source = await seed('pending');
      const stale = await listRecoverableMemoryDeliveries();
      await withPgClient((client) =>
        change === 'terminalized'
          ? client.query("UPDATE lesson_memory_entries SET status = 'failed' WHERE id = $1", [
              source.id,
            ])
          : client.query(
              'DELETE FROM assignment_source_bindings WHERE assignment_session_id = $1',
              [source.sessionId],
            ),
      );
      const reconcile = vi.fn();
      const supersedeBatchClaims = vi.fn();
      await reconcileMemoryDelivery({
        config,
        list: async () => stale,
        queue: { reconcile },
        supersedeBatchClaims,
      });
      expect(reconcile).not.toHaveBeenCalled();
      expect(supersedeBatchClaims).not.toHaveBeenCalled();
      const extractor = vi.fn();
      await processLessonMemoryJob({
        config,
        payload: source.payload,
        overrides: lessonOverrides(extractor),
      });
      expect(extractor).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'takes Batch claim before student using one transaction and preserves a later terminal decision=%s',
    async (terminal) => {
      const source = await seed('pending');
      const itemId = randomUUID();
      await createStudentMemoryOpenAiBatchRun({
        workload: 'lesson_memory',
        model: 'fixture',
        inputJsonlSha256: 'a'.repeat(64),
        inputBytes: 1,
        items: [
          {
            id: itemId,
            studentId: source.studentId,
            customId: itemId,
            canonicalScopeKey: source.payload.transcriptId,
            sourceVersionHash: hash,
            requestEnvelope: {},
            responseSchemaFingerprint: 'a'.repeat(64),
            requestBody: {},
            sourceRefs: {},
          },
        ],
      });
      const reconcile = vi.fn();
      let delivery!: Promise<void>;
      await withPgClient(async (importer) => {
        await importer.query('BEGIN');
        try {
          await importer.query(
            `SELECT item.id FROM student_memory_openai_batch_items item JOIN student_memory_openai_batch_claims claim ON claim.item_id=item.id WHERE item.id=$1 FOR UPDATE OF item, claim`,
            [itemId],
          );
          delivery = enqueueConfirmedLessonMemoryIntent(source.payload, { queue: { reconcile } });
          void delivery.catch(() => {});
          await expect
            .poll(async () => {
              await importer.query('SELECT pg_stat_clear_snapshot()');
              return (
                await importer.query(
                  `SELECT count(*)::int AS count FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%claim.workload = ''lesson_memory''%'`,
                )
              ).rows[0].count;
            })
            .toBe(1);
          // If delivery held student while a nested fence waited on claim this
          // NOWAIT fails, exposing the invisible cross-client deadlock directly.
          await importer.query('SELECT id FROM students WHERE id=$1 FOR UPDATE NOWAIT', [
            source.studentId,
          ]);
          if (terminal)
            await importer.query("UPDATE lesson_memory_entries SET status='failed' WHERE id=$1", [
              source.id,
            ]);
          await importer.query('COMMIT');
        } finally {
          await importer.query('ROLLBACK');
        }
      });
      await delivery;
      const state = await withPgClient(
        async (client) =>
          (
            await client.query(
              'SELECT state FROM student_memory_openai_batch_claims WHERE item_id=$1',
              [itemId],
            )
          ).rows[0].state,
      );
      expect(state).toBe(terminal ? 'active' : 'superseded_by_online');
      expect(reconcile).toHaveBeenCalledTimes(terminal ? 0 : 1);
    },
  );

  it('completed transcript sources retain tutor-only enrichment dispatch, publication and separate progress', async () => {
    const source = await seed();
    await complete(source);
    const operationId = randomUUID();
    await withPgClient((client) =>
      client.query(
        `INSERT INTO profile_initial_enrichment_operations
      (id,student_id,assignment_session_id,recording_id,transcript_id,transcript_storage_uri,transcript_hash,
        source_identity_kind,source_fingerprint_scheme,source_fingerprint)
      SELECT $1,l.student_id,l.assignment_session_id,l.recording_id,l.transcript_id,l.source_storage_uri,l.source_content_hash,
        r.source_identity_kind,r.source_fingerprint_scheme,r.source_fingerprint
      FROM lesson_memory_entries l JOIN recordings r ON r.id=l.recording_id WHERE l.id=$2`,
        [operationId, source.id],
      ),
    );
    expect(await getTranscriptProcessingStatus(source.sessionId)).toMatchObject({
      enrichment: 'pending',
      lessonMemory: 'ready',
      snapshot: 'pending',
    });
    const reconcile = vi.fn();
    await enqueuePendingProfileInitialEnrichments({ reconcile });
    expect(reconcile).toHaveBeenCalledWith(
      { kind: 'profile-initial-enrichment', operationId },
      expect.objectContaining({ requeueCompleted: true }),
    );
    const generator = vi.fn().mockResolvedValue({
      structuredProfile: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: null,
        primaryGoals: [],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      },
      usage: undefined,
    });
    await reconcileProfileInitialEnrichmentOperation(operationId, config, generator);
    expect(generator).toHaveBeenCalledTimes(1);
    expect(await getTranscriptProcessingStatus(source.sessionId)).toMatchObject({
      enrichment: 'ready',
      lessonMemory: 'ready',
      snapshot: 'pending',
    });
    const context = await getStudentTeachingContext({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      studentId: source.studentId,
    });
    const enriched = await withPgClient(
      async (client) =>
        (
          await client.query(
            'SELECT result_revision_id FROM profile_initial_enrichment_operations WHERE id=$1',
            [operationId],
          )
        ).rows[0],
    );
    expect(context?.provenance.profile?.revisionId).toBe(enriched.result_revision_id);
    expect(context?.provenance.recentLessonMemoryEntryIds).toContain(source.id);
    await withPgClient((client) =>
      client.query('UPDATE lesson_memory_entries SET student_facts=$2::jsonb WHERE id=$1', [
        source.id,
        JSON.stringify([
          {
            fact: 'Prefers short checklist practice',
            category: 'study preference',
            authority: 'teacher_confirmed',
            confidence: 'high',
            reviewNeeded: true,
            evidence: [{ sourceId: source.id, quote: 'Short checklist practice helps.' }],
          },
        ]),
      ]),
    );
    const candidateSnapshot = await insertCanonicalReadyStudentMemorySnapshot({
      studentId: source.studentId,
      schemaVersion: 'student-memory-snapshot.v1',
      provider: 'fixture',
      model: 'fixture',
      lessonMemoryEntryIds: [source.id],
      generationNotes: { triggerSourceKind: 'lesson_memory', triggerSourceEntryId: source.id },
      ...snapshotContent,
    });
    const candidates = await refreshStudentProfileCandidatesFromCanonicalMemory({
      studentId: source.studentId,
      sourceSnapshotId: candidateSnapshot.id,
    });
    expect(candidates?.created).toHaveLength(1);
    expect(candidates?.created[0]).toMatchObject({
      status: 'pending_review',
      promotedRevisionId: null,
    });
    expect(
      (
        await getStudentTeachingContext({
          workspaceId: '00000000-0000-4000-8000-000000000001',
          studentId: source.studentId,
        })
      )?.provenance.profile?.revisionId,
    ).toBe(enriched.result_revision_id);
    expect(
      await withPgClient(
        async (client) =>
          (
            await client.query(
              `SELECT confirmed_snapshot->'context' AS context FROM assignment_sessions WHERE id=$1`,
              [source.sessionId],
            )
          ).rows[0].context,
      ),
    ).toBeNull();
    expect(
      await withPgClient(
        async (client) =>
          (
            await client.query(
              'SELECT transcript_completed_at FROM assignment_sessions WHERE id=$1',
              [source.sessionId],
            )
          ).rows[0].transcript_completed_at,
      ),
    ).not.toBeNull();
  });
});
