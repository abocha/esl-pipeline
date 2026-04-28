import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ensurePendingLessonMemoryEntry,
  getLatestReadyLessonMemoryByTranscriptId,
  insertCanonicalReadyLessonMemoryEntry,
  listLessonMemoryEntries,
  listRecentReadyLessonMemoryByStudentId,
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

  it('creates a new pending lesson-memory row when the transcript was edited after the latest ready row', async () => {
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
    expect(entries.some((entry) => entry.status === 'ready')).toBe(true);
    expect(entries.some((entry) => entry.status === 'pending')).toBe(true);
  });
});
