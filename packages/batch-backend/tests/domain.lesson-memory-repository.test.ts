import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ensurePendingLessonMemoryEntry,
  getLatestReadyLessonMemoryByTranscriptId,
  getLessonMemoryEntryById,
  insertCanonicalReadyLessonMemoryEntry,
  listLessonMemoryEntries,
  listRecentReadyLessonMemoryByStudentId,
  markLessonMemoryEntryFailed,
  publishConfirmedLessonMemoryEntry,
} from '../src/domain/lesson-memory-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) {
  requirePgTestEnv();
}

async function truncateLessonMemoryTables() {
  await withPgClient(async (client) => {
    await client.query(
      'TRUNCATE TABLE lesson_memory_entries, homework_memory_entries, student_memory_snapshots, transcripts, recordings, jobs, students, users RESTART IDENTITY CASCADE',
    );
  });
}

interface LessonMemoryFixture {
  studentId: string;
  recordingId: string;
  transcriptId: string;
}

async function createLessonMemoryFixture(student = 'Ari'): Promise<LessonMemoryFixture> {
  const studentId = randomUUID();
  const recordingId = randomUUID();
  const transcriptId = randomUUID();

  await withPgClient(async (client) => {
    await client.query(
      `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
      [studentId, student],
    );
    await client.query(
      `
      INSERT INTO recordings (id, source, student_id, source_path, storage_uri, bytes, status, created_at, updated_at)
      VALUES ($1, 'upload', $2, 'lesson.wav', 'local://recordings/lesson.wav', 100, 'ingested', NOW(), NOW())
      `,
      [recordingId, studentId],
    );
    await client.query(
      `
      INSERT INTO transcripts (
        id, recording_id, storage_uri, mode, model, language, stt_provider, fallback_used, created_at, updated_at
      )
      VALUES ($1, $2, 'local://transcripts/lesson.json', 'timeline', 'nova-3', 'multi', 'deepgram', FALSE, NOW(), NOW())
      `,
      [transcriptId, recordingId],
    );
  });

  return { studentId, recordingId, transcriptId };
}

function pendingParams(
  fixture: LessonMemoryFixture,
  overrides: Partial<Parameters<typeof ensurePendingLessonMemoryEntry>[0]> = {},
) {
  return {
    studentId: fixture.studentId,
    transcriptId: fixture.transcriptId,
    recordingId: fixture.recordingId,
    schemaVersion: 'lesson-memory.v1',
    generatedAt: new Date('2026-03-20T10:00:00.000Z'),
    provider: 'openai',
    model: 'gpt-5.2',
    generationNotes: null,
    sourceStorageUri: 'local://transcripts/lesson-a.txt',
    sourceContentHash: 'a'.repeat(64),
    ...overrides,
  } satisfies Parameters<typeof ensurePendingLessonMemoryEntry>[0];
}

async function publishPendingEntry(
  entryId: string,
  params: Parameters<typeof ensurePendingLessonMemoryEntry>[0],
) {
  return publishConfirmedLessonMemoryEntry({
    ...params,
    id: entryId,
    lessonSummary: 'Confirmed memory',
    topicsDiscussed: [],
    mistakePatterns: [],
    grammarReviewed: [],
    grammarWatchlist: [],
    vocabularyFocus: [],
    pronunciationFocus: [],
    studentFacts: [],
    progressSignals: [],
    followUpRecommendations: [],
  });
}

const describeIfPg = hasPgTestEnv ? describe : describe.skip;

describeIfPg('domain/lesson-memory-repository', () => {
  beforeAll(async () => {
    await truncateLessonMemoryTables();
  });

  afterAll(async () => {
    await truncateLessonMemoryTables();
    await closePgPool();
  });

  beforeEach(async () => {
    await truncateLessonMemoryTables();
  });

  it('uses confirmed source hash state instead of mutable transcript timestamps', async () => {
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
      await client.query(
        `
        INSERT INTO recordings (id, source, student_id, source_path, storage_uri, bytes, status, created_at, updated_at)
        VALUES ($1, 'upload', $2, 'lesson.wav', 'local://recordings/lesson.wav', 100, 'ingested', NOW(), NOW())
        `,
        [recordingId, studentId],
      );
      await client.query(
        `
        INSERT INTO transcripts (
          id, recording_id, storage_uri, mode, model, language, stt_provider, fallback_used, created_at, updated_at
        )
        VALUES ($1, $2, 'local://transcripts/lesson.json', 'timeline', 'nova-3', 'multi', 'deepgram', FALSE, NOW(), NOW())
        `,
        [transcriptId, recordingId],
      );
    });

    await insertCanonicalReadyLessonMemoryEntry({
      studentId,
      transcriptId,
      recordingId,
      schemaVersion: 'lesson-memory.v1',
      generatedAt: new Date('2026-03-20T10:00:00.000Z'),
      provider: 'openai',
      model: 'gpt-5.2',
      lessonSummary: 'Old memory',
      topicsDiscussed: [],
      mistakePatterns: [],
      grammarReviewed: [],
      grammarWatchlist: [],
      vocabularyFocus: [],
      pronunciationFocus: [],
      studentFacts: [],
      progressSignals: [],
      followUpRecommendations: [],
    });

    await withPgClient(async (client) => {
      await client.query(`UPDATE transcripts SET updated_at = $2 WHERE id = $1`, [
        transcriptId,
        new Date('2026-03-20T11:00:00.000Z'),
      ]);
    });

    const result = await ensurePendingLessonMemoryEntry({
      studentId,
      transcriptId,
      recordingId,
      schemaVersion: 'lesson-memory.v1',
      generatedAt: new Date('2026-03-20T11:30:00.000Z'),
      provider: 'openai',
      model: 'gpt-5.2',
      generationNotes: null,
      sourceStorageUri: 'local://transcripts/lesson-a.txt',
      sourceContentHash: 'a'.repeat(64),
    });

    const latestReady = await getLatestReadyLessonMemoryByTranscriptId(transcriptId);
    const recentReady = await listRecentReadyLessonMemoryByStudentId(studentId, {
      limit: 10,
    });
    const canonicalReadyEntries = await listLessonMemoryEntries({
      transcriptId,
      statuses: ['ready'],
      limit: 10,
      offset: 0,
    });
    const entries = await listLessonMemoryEntries({
      transcriptId,
      limit: 10,
      offset: 0,
    });

    expect(result.outcome).toBe('created');
    expect(result.entry.status).toBe('pending');
    expect(latestReady).toBeNull();
    expect(recentReady).toHaveLength(0);
    expect(canonicalReadyEntries).toHaveLength(0);
    expect(entries.some((entry) => entry.status === 'superseded')).toBe(true);
    expect(entries.some((entry) => entry.status === 'pending')).toBe(true);
  });

  it("does not reuse another student's ready lesson memory for the same transcript", async () => {
    const originalStudentId = randomUUID();
    const confirmedStudentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const generatedAt = new Date(Date.now() + 60_000);

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at)
         VALUES ($1, 'Ari', NOW(), NOW()), ($2, 'Bea', NOW(), NOW())`,
        [originalStudentId, confirmedStudentId],
      );
      await client.query(
        `INSERT INTO recordings (id, source, student_id, source_path, storage_uri, bytes, status, created_at, updated_at)
         VALUES ($1, 'upload', $2, 'lesson.wav', 'local://recordings/lesson.wav', 100, 'transcribed', NOW(), NOW())`,
        [recordingId, originalStudentId],
      );
      await client.query(
        `INSERT INTO transcripts (
           id, recording_id, storage_uri, mode, model, language, stt_provider, fallback_used, created_at, updated_at
         ) VALUES ($1, $2, 'local://transcripts/lesson.txt', 'timeline', 'nova-3', 'multi', 'deepgram', FALSE, NOW(), NOW())`,
        [transcriptId, recordingId],
      );
    });

    await insertCanonicalReadyLessonMemoryEntry({
      studentId: originalStudentId,
      transcriptId,
      recordingId,
      schemaVersion: 'lesson-memory.v1',
      generatedAt,
      provider: 'openai',
      model: 'gpt-5.2',
      lessonSummary: 'Ari lesson memory',
      topicsDiscussed: [],
      mistakePatterns: [],
      grammarReviewed: [],
      grammarWatchlist: [],
      vocabularyFocus: [],
      pronunciationFocus: [],
      studentFacts: [],
      progressSignals: [],
      followUpRecommendations: [],
    });

    const result = await ensurePendingLessonMemoryEntry({
      studentId: confirmedStudentId,
      transcriptId,
      recordingId,
      schemaVersion: 'lesson-memory.v1',
      generatedAt: new Date(generatedAt.getTime() + 60_000),
      provider: 'openai',
      model: 'gpt-5.2',
      generationNotes: null,
      sourceStorageUri: 'local://transcripts/lesson-b.txt',
      sourceContentHash: 'b'.repeat(64),
    });

    expect(result.outcome).toBe('created');
    expect(result.entry.studentId).toBe(confirmedStudentId);
  });

  it('reuses a matching pending entry without changing its confirmed source', async () => {
    const fixture = await createLessonMemoryFixture();
    const original = await ensurePendingLessonMemoryEntry(pendingParams(fixture));

    const reused = await ensurePendingLessonMemoryEntry(
      pendingParams(fixture, {
        generatedAt: new Date('2026-03-20T11:00:00.000Z'),
        provider: 'other-provider',
        model: 'other-model',
        sourceStorageUri: 'local://transcripts/retried-copy.txt',
      }),
    );
    const entries = await listLessonMemoryEntries({
      transcriptId: fixture.transcriptId,
      limit: 10,
      offset: 0,
    });

    expect(original.outcome).toBe('created');
    expect(reused).toMatchObject({
      outcome: 'pending_exists',
      entry: {
        id: original.entry.id,
        status: 'pending',
        sourceStorageUri: 'local://transcripts/lesson-a.txt',
        sourceContentHash: 'a'.repeat(64),
        provider: 'openai',
        model: 'gpt-5.2',
      },
    });
    expect(entries).toHaveLength(1);
  });

  it('preserves the ready-to-pending supersession chain when confirmed content changes again', async () => {
    const fixture = await createLessonMemoryFixture();
    const readyParams = pendingParams(fixture, {
      generatedAt: new Date('2026-03-20T09:00:00.000Z'),
      sourceStorageUri: 'local://transcripts/already-ready.txt',
      sourceContentHash: 'c'.repeat(64),
    });
    const readyPending = await ensurePendingLessonMemoryEntry(readyParams);
    const ready = await publishPendingEntry(readyPending.entry.id, readyParams);
    if (!ready) {
      throw new Error('Expected pending entry to publish as ready');
    }
    const original = await ensurePendingLessonMemoryEntry(pendingParams(fixture));

    const replacement = await ensurePendingLessonMemoryEntry(
      pendingParams(fixture, {
        generatedAt: new Date('2026-03-20T11:00:00.000Z'),
        sourceStorageUri: 'local://transcripts/lesson-b.txt',
        sourceContentHash: 'b'.repeat(64),
      }),
    );
    const originalAfterReplacement = await getLessonMemoryEntryById(original.entry.id);
    const readyAfterReplacement = await getLessonMemoryEntryById(ready.id);

    expect(replacement).toMatchObject({
      outcome: 'created',
      entry: {
        status: 'pending',
        sourceStorageUri: 'local://transcripts/lesson-b.txt',
        sourceContentHash: 'b'.repeat(64),
      },
    });
    expect(originalAfterReplacement).toMatchObject({
      status: 'superseded',
      supersededById: replacement.entry.id,
    });
    expect(readyAfterReplacement).toMatchObject({
      id: ready.id,
      status: 'superseded',
      supersededById: original.entry.id,
      studentId: fixture.studentId,
      sourceContentHash: 'c'.repeat(64),
    });
  });

  it('marks a pending entry failed once and leaves an already-ready entry unchanged', async () => {
    const fixture = await createLessonMemoryFixture();
    const pending = await ensurePendingLessonMemoryEntry(pendingParams(fixture));

    const firstFailure = await markLessonMemoryEntryFailed({
      id: pending.entry.id,
      errorMessage: 'provider timed out',
      providerRequestId: 'request-1',
      usage: { totalTokens: 42 },
    });
    const repeatedFailure = await markLessonMemoryEntryFailed({
      id: pending.entry.id,
      errorMessage: 'must not replace the first error',
      providerRequestId: 'request-2',
      usage: { totalTokens: 99 },
    });
    const pendingAfterFailures = await getLessonMemoryEntryById(pending.entry.id);

    const readyParams = pendingParams(fixture, {
      generatedAt: new Date('2026-03-20T11:00:00.000Z'),
      sourceStorageUri: 'local://transcripts/ready.txt',
      sourceContentHash: 'b'.repeat(64),
    });
    const readyPending = await ensurePendingLessonMemoryEntry(readyParams);
    const ready = await publishPendingEntry(readyPending.entry.id, readyParams);
    if (!ready) {
      throw new Error('Expected pending entry to publish as ready');
    }
    const readyFailure = await markLessonMemoryEntryFailed({
      id: ready.id,
      errorMessage: 'must not change ready entry',
    });
    const readyAfterFailure = await getLessonMemoryEntryById(ready.id);

    expect(firstFailure).toMatchObject({
      id: pending.entry.id,
      status: 'failed',
      generationNotes: {
        error: 'provider timed out',
        providerRequestId: 'request-1',
        usage: { totalTokens: 42 },
        failedAt: expect.any(String),
      },
    });
    expect(repeatedFailure).toBeNull();
    expect(pendingAfterFailures).toMatchObject({
      status: 'failed',
      generationNotes: firstFailure!.generationNotes,
    });
    expect(readyFailure).toBeNull();
    expect(readyAfterFailure).toMatchObject({
      id: ready.id,
      status: 'ready',
      generationNotes: null,
    });
  });
});
