import './support/bootstrap-pg-test-env.js';
import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateHomeworkMemoryFromSource } from '../src/application/homework-memory-generation.js';
import { processHomeworkMemoryJob } from '../src/application/process-homework-memory-job.js';
import { processStudentMemorySnapshotJob } from '../src/application/process-student-memory-snapshot-job.js';
import { reconcileMemoryDelivery } from '../src/application/reconcile-memory-delivery.js';
import { requestHomeworkMemoryGeneration } from '../src/application/request-homework-memory-generation.js';
import { requestStudentMemorySnapshotRefresh } from '../src/application/request-student-memory-snapshot-refresh.js';
import { loadConfig } from '../src/config/env.js';
import {
  commitCanonicalReadyHomeworkMemoryEntry,
  ensurePendingHomeworkMemoryEntry,
  getHomeworkMemoryEntryById,
} from '../src/domain/homework-memory-repository.js';
import {
  cancelMemoryReplayIntent,
  listRecoverableMemoryDeliveries,
} from '../src/domain/memory-replay-delivery.js';
import {
  captureStudentMemoryCurrentness,
  type StudentMemoryCurrentness,
} from '../src/domain/student-memory-currentness.js';
import {
  ensurePendingStudentMemorySnapshot,
  getStudentMemorySnapshotById,
  insertCanonicalReadyStudentMemorySnapshot,
  StudentMemorySnapshotIntentObsoleteError,
} from '../src/domain/student-memory-snapshot-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import {
  closeStudentMemoryQueue,
  createStudentMemoryQueue,
} from '../src/infrastructure/student-memory-queue.js';
import { insertLessonMemory } from './support/student-memory-fixture.js';
import { requirePgTestEnv, requireRedisTestEnv } from './support/test-env.js';

requirePgTestEnv();
requireRedisTestEnv();
process.env.STUDENT_MEMORY_QUEUE_NAME = `memory-replay-${randomUUID()}`;
const config = loadConfig();
const snapshotContent = {
  stableStrengths: [],
  recurringIssues: [],
  activeReviewBacklog: [],
  recentProgress: [],
  personalFacts: [],
  recommendedAssignmentDirections: [],
  unresolvedIssues: [],
  snapshotSummary: 'Replay fixture',
};
const homeworkContent = {
  homeworkSummary: 'Homework fixture',
  topic: 'travel',
  grammarTargets: [],
  vocabularyTargets: [],
  reviewTargets: [],
  taskList: [],
  pronunciationFocus: [],
  teacherFollowUpCues: [],
  studyTextType: null,
  inputType: null,
  communicativeOutcome: null,
};
const pacer = { run: async (args: { execute: () => Promise<unknown> }) => args.execute() };

async function seed() {
  const studentId = randomUUID();
  const jobId = randomUUID();
  const publishedAt = new Date('2026-10-01T00:00:00Z');
  await withPgClient(async (client) => {
    await client.query("INSERT INTO students (id, student) VALUES ($1, 'Replay learner')", [
      studentId,
    ]);
    await client.query(
      `INSERT INTO jobs (id, student_id, state, md, publication_sequence, finished_at)
      VALUES ($1, $2, 'succeeded', '# Homework', 1, $3)`,
      [jobId, studentId, publishedAt],
    );
  });
  return {
    studentId,
    jobId,
    assignmentLineageKey: jobId,
    schemaVersion: 'homework-memory.v1',
    provider: 'openai' as const,
    model: config.generation.targets.homework_memory.model,
    contentHash: 'a'.repeat(64),
    publishedAt,
    publishTargets: [],
    normalizedMarkdown: { frontmatter: null, sections: [], plainText: '# Homework' },
    publishedMarkdown: '# Homework',
  };
}

async function pendingSnapshot(
  studentId: string,
  replayKey: string = randomUUID(),
  requestCandidateRefresh = false,
) {
  return (
    await ensurePendingStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory-snapshot.v1',
      provider: 'openai',
      model: config.generation.targets.student_memory_snapshot.model,
      replayKey,
      generationNotes: {
        trigger: 'manual-replay',
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Integration replay',
        requestCandidateRefresh,
      },
    })
  ).entry;
}

function snapshotCommit(
  intent: Awaited<ReturnType<typeof pendingSnapshot>>,
  overrides: Record<string, unknown> = {},
) {
  return insertCanonicalReadyStudentMemorySnapshot({
    studentId: intent.studentId,
    pendingEntryId: intent.id,
    schemaVersion: intent.schemaVersion,
    provider: intent.provider,
    model: intent.model,
    expectedCurrentness: intent.generationNotes?.currentness as StudentMemoryCurrentness,
    ...snapshotContent,
    ...overrides,
  });
}

function runSnapshot(
  intent: Awaited<ReturnType<typeof pendingSnapshot>>,
  extractor = vi.fn().mockResolvedValue({ content: snapshotContent }),
  requestRefresh = vi.fn(),
) {
  return processStudentMemorySnapshotJob({
    config,
    payload: {
      kind: 'student-memory-snapshot-refresh',
      studentId: intent.studentId,
      pendingEntryId: intent.id,
      provider: 'openai',
      model: intent.model,
      trigger: 'manual-replay',
      strategy: 'manual_rebuild_v1_1',
      operatorReason: 'Integration replay',
    },
    overrides: { extractor, pacer, profileCandidates: { requestRefresh } } as never,
  });
}

function pausedExtraction(content: unknown) {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const extractor = vi.fn(async () => {
    started();
    await wait;
    return { content };
  });
  return { extractor, entered, release };
}

async function readyHomework(source: Awaited<ReturnType<typeof seed>>) {
  return (
    await commitCanonicalReadyHomeworkMemoryEntry({ ...source, homeworkSummary: 'Ready source' })
  ).entry!;
}

describe('ordinary replay transactions and DB → BullMQ delivery', () => {
  it('serializes phantom canonical sources and Source-authority changes on the student lock', async () => {
    const source = await seed();
    const lessonId = await insertLessonMemory({
      studentId: source.studentId,
      status: 'ready',
      withConfirmedSource: true,
    });
    await withPgClient(async (guard) => {
      await guard.query('BEGIN');
      try {
        await guard.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [source.studentId]);
        await withPgClient(async (writer) => {
          await writer.query('BEGIN');
          await writer.query("SET LOCAL lock_timeout = '100ms'");
          try {
            await expect(
              writer.query(
                `INSERT INTO homework_memory_entries
              (student_id, job_id, assignment_lineage_key, schema_version, provider, model, status, published_at)
              VALUES ($1, $2, $2, 'homework-memory.v1', 'openai', 'fixture', 'ready', NOW())`,
                [source.studentId, source.jobId],
              ),
            ).rejects.toMatchObject({ code: '55P03' });
          } finally {
            await writer.query('ROLLBACK');
          }
          await writer.query('BEGIN');
          await writer.query("SET LOCAL lock_timeout = '100ms'");
          try {
            await expect(
              writer.query(
                `DELETE FROM assignment_source_bindings WHERE assignment_session_id =
              (SELECT assignment_session_id FROM lesson_memory_entries WHERE id = $1)`,
                [lessonId],
              ),
            ).rejects.toMatchObject({ code: '55P03' });
          } finally {
            await writer.query('ROLLBACK');
          }
        });
      } finally {
        await guard.query('ROLLBACK');
      }
    });
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

  it('atomically links one result through concurrent duplicate commits and response-loss retry', async () => {
    const source = await seed();
    const intent = await pendingSnapshot(source.studentId);
    const [first, duplicate] = await Promise.all([snapshotCommit(intent), snapshotCommit(intent)]);
    expect(duplicate.id).toBe(first.id);
    expect((await snapshotCommit(intent)).id).toBe(first.id);
    expect((await getStudentMemorySnapshotById(intent.id))?.supersededById).toBe(first.id);
    expect(first.generationNotes?.pendingEntryId).toBe(intent.id);
    const count = await withPgClient((client) =>
      client.query("SELECT id FROM student_memory_snapshots WHERE status = 'ready'"),
    );
    expect(count.rowCount).toBe(1);
    const newer = await insertCanonicalReadyStudentMemorySnapshot({
      studentId: source.studentId,
      schemaVersion: intent.schemaVersion,
      provider: intent.provider,
      model: intent.model,
      ...snapshotContent,
    });
    expect((await snapshotCommit(intent)).id).toBe(first.id);
    expect((await getStudentMemorySnapshotById(newer.id))?.status).toBe('ready');
  });

  it('rolls back insertion and intent linkage together when the canonical transaction fails', async () => {
    const source = await seed();
    const intent = await pendingSnapshot(source.studentId);
    await withPgClient((client) =>
      client.query(`CREATE FUNCTION replay_test_fail_link() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.superseded_by_id IS NOT NULL THEN RAISE EXCEPTION 'injected commit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER replay_test_fail_link BEFORE UPDATE ON student_memory_snapshots FOR EACH ROW EXECUTE FUNCTION replay_test_fail_link()`),
    );
    try {
      await expect(snapshotCommit(intent)).rejects.toThrow('injected commit failure');
    } finally {
      await withPgClient((client) =>
        client.query(
          'DROP TRIGGER replay_test_fail_link ON student_memory_snapshots; DROP FUNCTION replay_test_fail_link()',
        ),
      );
    }
    expect((await getStudentMemorySnapshotById(intent.id))?.status).toBe('pending');
    expect(
      (
        await withPgClient((client) =>
          client.query("SELECT id FROM student_memory_snapshots WHERE status = 'ready'"),
        )
      ).rowCount,
    ).toBe(0);
    await snapshotCommit(intent);
  });

  it('fences a manual replay against newer homework arriving during generation', async () => {
    const source = await seed();
    const ready = await readyHomework(source);
    const intent = await pendingSnapshot(source.studentId);
    const provider = pausedExtraction(snapshotContent);
    const work = runSnapshot(intent, provider.extractor);
    await provider.entered;
    const newer = await readyHomework(source);
    expect(newer.id).not.toBe(ready.id);
    provider.release();
    await work;
    expect((await getStudentMemorySnapshotById(intent.id))?.status).toBe('superseded');
    expect((await getStudentMemorySnapshotById(intent.id))?.supersededById).toBeNull();
  });

  it('fences a manual replay against a newer current snapshot', async () => {
    const source = await seed();
    await readyHomework(source);
    const intent = await pendingSnapshot(source.studentId);
    const provider = pausedExtraction(snapshotContent);
    const work = runSnapshot(intent, provider.extractor);
    await provider.entered;
    const newer = await insertCanonicalReadyStudentMemorySnapshot({
      studentId: source.studentId,
      schemaVersion: intent.schemaVersion,
      provider: intent.provider,
      model: intent.model,
      ...snapshotContent,
    });
    provider.release();
    await work;
    expect((await getStudentMemorySnapshotById(newer.id))?.status).toBe('ready');
    expect((await getStudentMemorySnapshotById(intent.id))?.supersededById).toBeNull();
  });

  it.each(['new canonical lesson', 'confirmed-source invalidation'])(
    'fences replay against %s in flight',
    async (change) => {
      const source = await seed();
      const lessonId = await insertLessonMemory({
        studentId: source.studentId,
        status: 'ready',
        withConfirmedSource: true,
      });
      const intent = await pendingSnapshot(source.studentId);
      const provider = pausedExtraction(snapshotContent);
      const work = runSnapshot(intent, provider.extractor);
      await provider.entered;
      if (change === 'new canonical lesson') {
        await insertLessonMemory({
          studentId: source.studentId,
          status: 'ready',
          withConfirmedSource: true,
        });
      } else {
        await withPgClient((client) =>
          client.query(
            `DELETE FROM assignment_source_bindings WHERE assignment_session_id =
        (SELECT assignment_session_id FROM lesson_memory_entries WHERE id = $1)`,
            [lessonId],
          ),
        );
      }
      provider.release();
      await work;
      expect((await getStudentMemorySnapshotById(intent.id))?.supersededById).toBeNull();
      expect((await getStudentMemorySnapshotById(intent.id))?.status).toBe('superseded');
    },
  );

  it('deduplicates resubmission and makes a new manual attempt supersede in-flight intent', async () => {
    const source = await seed();
    await readyHomework(source);
    const intent = await pendingSnapshot(source.studentId, 'operator-attempt-a');
    expect((await pendingSnapshot(source.studentId, 'operator-attempt-a')).id).toBe(intent.id);
    const provider = pausedExtraction(snapshotContent);
    const work = runSnapshot(intent, provider.extractor);
    await provider.entered;
    const next = await pendingSnapshot(source.studentId, 'operator-attempt-b');
    provider.release();
    await work;
    expect((await getStudentMemorySnapshotById(intent.id))?.supersededById).toBeNull();
    const canonical = await snapshotCommit(next);
    expect((await pendingSnapshot(source.studentId, 'operator-attempt-a')).id).toBe(intent.id);
    expect((await pendingSnapshot(source.studentId, 'operator-attempt-b')).id).toBe(next.id);
    expect((await getStudentMemorySnapshotById(canonical.id))?.status).toBe('ready');
    const failed = await pendingSnapshot(source.studentId, 'failed-attempt');
    await withPgClient((client) =>
      client.query("UPDATE student_memory_snapshots SET status = 'failed' WHERE id = $1", [
        failed.id,
      ]),
    );
    const replacement = await pendingSnapshot(source.studentId, 'replacement-attempt');
    expect((await pendingSnapshot(source.studentId, 'failed-attempt')).status).toBe('superseded');
    expect((await getStudentMemorySnapshotById(replacement.id))?.status).toBe('pending');
  });

  it('serializes two genuinely new replay requests racing for the same student', async () => {
    const source = await seed();
    const attempts = await Promise.all([
      pendingSnapshot(source.studentId, 'a'),
      pendingSnapshot(source.studentId, 'b'),
    ]);
    const commits = await Promise.allSettled(attempts.map((intent) => snapshotCommit(intent)));
    expect(commits.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(commits.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it.each(['before dispatch', 'in flight'])(
    'durably cancels snapshot work %s',
    async (boundary) => {
      const source = await seed();
      await readyHomework(source);
      const intent = await pendingSnapshot(source.studentId);
      const provider = pausedExtraction(snapshotContent);
      let work: Promise<void> | undefined;
      if (boundary === 'in flight') {
        work = runSnapshot(intent, provider.extractor);
        await provider.entered;
      }
      expect(
        await cancelMemoryReplayIntent({
          family: 'snapshot',
          studentId: source.studentId,
          pendingEntryId: intent.id,
          reason: 'Operator cancelled',
        }),
      ).toBe(true);
      provider.release();
      await (work ?? runSnapshot(intent, provider.extractor));
      expect(provider.extractor).toHaveBeenCalledTimes(boundary === 'in flight' ? 1 : 0);
      expect(
        (await getStudentMemorySnapshotById(intent.id))?.generationNotes?.cancellationReason,
      ).toBe('Operator cancelled');
      await expect(snapshotCommit(intent)).rejects.toBeInstanceOf(
        StudentMemorySnapshotIntentObsoleteError,
      );
      expect(
        (await pendingSnapshot(source.studentId, intent.generationNotes!.replayKey as string)).id,
      ).toBe(intent.id);
    },
  );

  it('detects already obsolete manual intent before calling the provider', async () => {
    const source = await seed();
    await readyHomework(source);
    const intent = await pendingSnapshot(source.studentId);
    await readyHomework(source);
    const extractor = vi.fn();
    await runSnapshot(intent, extractor);
    expect(extractor).not.toHaveBeenCalled();
    expect((await getStudentMemorySnapshotById(intent.id))?.status).toBe('superseded');
  });

  it('repairs the DB/enqueue crash for both families with frozen provider/model', async () => {
    const source = await seed();
    const enqueue = vi.fn().mockRejectedValue(new Error('crash before Redis enqueue'));
    const homework = requestHomeworkMemoryGeneration({
      config,
      params: { jobId: source.jobId, studentId: source.studentId, replayKey: 'homework-attempt' },
      overrides: {
        source: { resolveFromSucceededJob: vi.fn().mockResolvedValue(source) },
        queue: { reconcile: enqueue },
      },
    });
    await expect(homework).rejects.toThrow('crash before Redis enqueue');
    await expect(
      requestStudentMemorySnapshotRefresh({
        config,
        params: {
          studentId: source.studentId,
          trigger: 'manual-replay',
          replayKey: 'snapshot-attempt',
          strategy: 'manual_rebuild_v1_1',
          operatorReason: 'Replay',
        },
        overrides: { queue: { reconcile: enqueue } },
      }),
    ).rejects.toThrow('crash before Redis enqueue');
    const deliveries = await listRecoverableMemoryDeliveries();
    expect(deliveries).toHaveLength(2);
    await reconcileMemoryDelivery();
    const jobs = await createStudentMemoryQueue().queue.getJobs(['waiting']);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      const intended = deliveries.find(
        (payload) =>
          'pendingEntryId' in payload &&
          payload.pendingEntryId ===
            ('pendingEntryId' in job.data ? job.data.pendingEntryId : null),
      )!;
      expect('provider' in job.data && job.data.provider).toBe(
        'provider' in intended && intended.provider,
      );
      expect('model' in job.data && job.data.model).toBe('model' in intended && intended.model);
    }
    expect(
      (await captureStudentMemoryCurrentness(source.studentId)).latestReadySnapshotId,
    ).toBeNull();
  });

  it('recovers snapshot candidate delivery after canonical commit, without another generation', async () => {
    const source = await seed();
    await readyHomework(source);
    const intent = await pendingSnapshot(source.studentId, 'candidate-attempt', true);
    const extractor = vi.fn().mockResolvedValue({ content: snapshotContent });
    await runSnapshot(
      intent,
      extractor,
      vi.fn().mockRejectedValue(new Error('downstream queue failed')),
    );
    await reconcileMemoryDelivery();
    const delivery = (await createStudentMemoryQueue().queue.getJobs(['waiting'])).find(
      (job) => 'pendingEntryId' in job.data && job.data.pendingEntryId === intent.id,
    )!;
    expect(delivery).toBeDefined();
    const requestRefresh = vi.fn().mockResolvedValue({});
    await processStudentMemorySnapshotJob({
      config,
      payload: delivery.data as never,
      overrides: { extractor, pacer, profileCandidates: { requestRefresh } } as never,
    });
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(requestRefresh).toHaveBeenCalledTimes(1);
    expect(
      (await listRecoverableMemoryDeliveries()).filter(
        (p) => 'pendingEntryId' in p && p.pendingEntryId === intent.id,
      ),
    ).toHaveLength(0);
  });

  it('recovers retained completed delivery and suppresses duplicate BullMQ generation', async () => {
    const source = await seed();
    await readyHomework(source);
    const intent = await pendingSnapshot(source.studentId);
    await reconcileMemoryDelivery();
    const queue = createStudentMemoryQueue();
    await queue.queueEvents.waitUntilReady();
    // Simulate a completed delivery without its domain commit (e.g. old handler).
    const worker = new Worker(config.studentMemory.queueName, async () => {}, {
      connection: {
        host: process.env.REDIS_HOST!,
        port: Number(process.env.REDIS_PORT),
        maxRetriesPerRequest: null,
      },
    });
    try {
      const job = (await queue.queue.getJobs(['waiting', 'active', 'completed']))[0]!;
      await job.waitUntilFinished(queue.queueEvents, 5_000);
    } finally {
      await worker.close();
    }
    await reconcileMemoryDelivery();
    const delivery = (await queue.queue.getJobs(['waiting']))[0]!;
    const extractor = vi.fn().mockResolvedValue({ content: snapshotContent });
    await processStudentMemorySnapshotJob({
      config,
      payload: delivery.data as never,
      overrides: { extractor, pacer } as never,
    });
    await processStudentMemorySnapshotJob({
      config,
      payload: delivery.data as never,
      overrides: { extractor, pacer } as never,
    });
    expect(extractor).toHaveBeenCalledTimes(1);
    expect((await getStudentMemorySnapshotById(intent.id))?.supersededById).toBeTruthy();
  });

  it('reuses frozen targets on resubmission and distinguishes a new homework regeneration', async () => {
    const source = await seed();
    const online = (await ensurePendingHomeworkMemoryEntry({ ...source, model: 'online-frozen' }))
      .entry;
    const adopted = (
      await ensurePendingHomeworkMemoryEntry({
        ...source,
        replayKey: 'adopt-online',
        model: 'different-current',
      })
    ).entry;
    expect(adopted.id).toBe(online.id);
    expect(adopted.model).toBe('online-frozen');
    expect(adopted.generationNotes?.replayKey).toBe('adopt-online');
    const request = (
      replayKey: string,
      providerOverride: 'openai' | 'openrouter',
      modelOverride: string,
    ) =>
      requestHomeworkMemoryGeneration({
        config,
        params: {
          jobId: source.jobId,
          studentId: source.studentId,
          forceRegenerate: true,
          replayKey,
          providerOverride,
          modelOverride,
        },
        overrides: { source: { resolveFromSucceededJob: vi.fn().mockResolvedValue(source) } },
      });
    const original = (await request('a', 'openai', 'frozen-model'))!.entry;
    const same = (await request('a', 'openrouter', 'new-config-model'))!.entry;
    expect(same.id).toBe(original.id);
    expect(same.provider).toBe('openai');
    expect(same.model).toBe('frozen-model');
    const queued = (await createStudentMemoryQueue().queue.getJobs(['waiting']))[0]!;
    expect(queued.data).toMatchObject({ provider: 'openai', model: 'frozen-model' });
    const next = (await request('b', 'openrouter', 'new-config-model'))!.entry;
    expect(next.id).not.toBe(original.id);
    expect((await getHomeworkMemoryEntryById(original.id))?.status).toBe('superseded');
    const late = await commitCanonicalReadyHomeworkMemoryEntry({
      ...source,
      pendingEntryId: original.id,
      provider: original.provider,
      model: original.model,
    });
    expect(late.outcome).toBe('stale_discarded');

    const firstSnapshot = await requestStudentMemorySnapshotRefresh({
      config,
      params: {
        studentId: source.studentId,
        trigger: 'manual-replay',
        replayKey: 'snapshot-a',
        strategy: 'manual_rebuild_v1_1',
        operatorReason: 'Original',
        providerOverride: 'openai',
        modelOverride: 'snapshot-frozen',
      },
    });
    const sameSnapshot = await requestStudentMemorySnapshotRefresh({
      config,
      params: {
        studentId: source.studentId,
        trigger: 'manual-replay',
        replayKey: 'snapshot-a',
        strategy: 'full_rebuild_v1',
        operatorReason: 'Changed resubmission',
        providerOverride: 'openrouter',
        modelOverride: 'other',
      },
    });
    expect(sameSnapshot.entry.id).toBe(firstSnapshot.entry.id);
    expect(sameSnapshot.entry.model).toBe('snapshot-frozen');
    expect(sameSnapshot.entry.generationNotes?.strategy).toBe('manual_rebuild_v1_1');
  });

  it('does not recreate cancelled downstream snapshot intent on recovery or duplicate delivery', async () => {
    const source = await seed();
    const pending = (await ensurePendingHomeworkMemoryEntry({ ...source })).entry;
    const ready = (
      await commitCanonicalReadyHomeworkMemoryEntry({
        ...source,
        pendingEntryId: pending.id,
        generationNotes: { pendingEntryId: pending.id },
      })
    ).entry!;
    const snapshot = await requestStudentMemorySnapshotRefresh({
      config,
      params: {
        studentId: source.studentId,
        trigger: 'homework-memory-ready',
        sourceEntryId: ready.id,
      },
    });
    await cancelMemoryReplayIntent({
      family: 'snapshot',
      studentId: source.studentId,
      pendingEntryId: snapshot.entry.id,
      reason: 'Stop downstream work',
    });
    expect(await listRecoverableMemoryDeliveries()).toHaveLength(0);
    await processHomeworkMemoryJob({
      config,
      payload: {
        kind: 'homework-memory-generate',
        pendingEntryId: pending.id,
        studentId: source.studentId,
        jobId: source.jobId,
        provider: 'openai',
        model: pending.model,
      },
    });
    expect(await listRecoverableMemoryDeliveries()).toHaveLength(0);
    expect(
      await withPgClient(
        async (client) =>
          (
            await client.query('SELECT id FROM student_memory_snapshots WHERE student_id = $1', [
              source.studentId,
            ])
          ).rows,
      ),
    ).toHaveLength(1);
  });

  it('durably obsoletes homework intent when its source changes before dispatch', async () => {
    const source = await seed();
    const intent = (
      await ensurePendingHomeworkMemoryEntry({ ...source, replayKey: 'source-change' })
    ).entry;
    const generator = vi.fn();
    await processHomeworkMemoryJob({
      config,
      payload: {
        kind: 'homework-memory-generate',
        pendingEntryId: intent.id,
        studentId: source.studentId,
        jobId: source.jobId,
        provider: 'openai',
        model: intent.model,
      },
      overrides: {
        sourceResolver: vi.fn().mockResolvedValue({ ...source, contentHash: 'b'.repeat(64) }),
        generator,
      },
    });
    expect(generator).not.toHaveBeenCalled();
    expect((await getHomeworkMemoryEntryById(intent.id))?.generationNotes?.obsoleteReason).toBe(
      'source_changed',
    );
    expect(await listRecoverableMemoryDeliveries()).toHaveLength(0);
  });

  it('makes homework completion idempotent, and resumes downstream delivery after a post-commit crash', async () => {
    const source = await seed();
    const intent = (
      await ensurePendingHomeworkMemoryEntry({
        ...source,
        replayKey: 'homework-a',
        bypassReadyReuse: true,
        generationNotes: { forceRegenerate: true },
      })
    ).entry;
    const first = await commitCanonicalReadyHomeworkMemoryEntry({
      ...source,
      pendingEntryId: intent.id,
      generationNotes: { pendingEntryId: intent.id },
    });
    const duplicate = await commitCanonicalReadyHomeworkMemoryEntry({
      ...source,
      pendingEntryId: intent.id,
      generationNotes: { pendingEntryId: intent.id },
    });
    expect(duplicate.entry?.id).toBe(first.entry?.id);
    await reconcileMemoryDelivery();
    const delivery = (await createStudentMemoryQueue().queue.getJobs(['waiting']))[0]!;
    const generator = vi.fn();
    await processHomeworkMemoryJob({
      config,
      payload: delivery.data as never,
      overrides: { generator },
    });
    expect(generator).not.toHaveBeenCalled();
    expect(
      (await createStudentMemoryQueue().queue.getJobs(['waiting'])).some(
        (job) => job.data.kind === 'student-memory-snapshot-refresh',
      ),
    ).toBe(true);
  });

  it.each(['before dispatch', 'in flight'])(
    'durably cancels homework work %s',
    async (boundary) => {
      const source = await seed();
      const intent = (
        await ensurePendingHomeworkMemoryEntry({ ...source, replayKey: 'homework-a' })
      ).entry;
      const provider = pausedExtraction(homeworkContent);
      const run = () =>
        processHomeworkMemoryJob({
          config,
          payload: {
            kind: 'homework-memory-generate',
            pendingEntryId: intent.id,
            studentId: source.studentId,
            jobId: source.jobId,
            provider: 'openai',
            model: intent.model,
          },
          overrides: {
            sourceResolver: vi.fn().mockResolvedValue(source),
            pacer,
            generator: (args: Parameters<typeof generateHomeworkMemoryFromSource>[0]) =>
              generateHomeworkMemoryFromSource({
                ...args,
                overrides: { extractor: provider.extractor as never },
              }),
          } as never,
        });
      let work: Promise<void> | undefined;
      if (boundary === 'in flight') {
        work = run();
        await provider.entered;
      }
      await cancelMemoryReplayIntent({
        family: 'homework',
        studentId: source.studentId,
        pendingEntryId: intent.id,
        reason: 'Cancelled',
      });
      provider.release();
      await (work ?? run());
      expect(provider.extractor).toHaveBeenCalledTimes(boundary === 'in flight' ? 1 : 0);
      expect((await getHomeworkMemoryEntryById(intent.id))?.supersededById).toBeNull();
    },
  );
});
