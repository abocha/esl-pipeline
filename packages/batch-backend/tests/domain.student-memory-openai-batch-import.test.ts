import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { getLessonMemoryEntryById } from '../src/domain/lesson-memory-repository.js';
import { importValidatedLessonMemoryOpenAiBatchItem } from '../src/domain/student-memory-openai-batch-import.js';
import {
  createStudentMemoryOpenAiBatchRun,
  listStudentMemoryOpenAiBatchItems,
} from '../src/domain/student-memory-openai-batch-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) requirePgTestEnv();
const describeIfPg = hasPgTestEnv ? describe : describe.skip;

describeIfPg('domain/student-memory-openai-batch-import', () => {
  beforeEach(async () => {
    await withPgClient((client) =>
      client.query(
        'TRUNCATE TABLE student_memory_openai_batch_claims, student_memory_openai_batch_items, student_memory_openai_batch_runs, lesson_memory_entries, transcripts, recordings, students RESTART IDENTITY CASCADE',
      ),
    );
  });
  afterAll(async () => closePgPool());

  it('atomically imports a fresh lesson result once and recovers the stable destination on repeat', async () => {
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const updatedAt = new Date('2026-06-21T00:00:00.000Z');
    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
      await client.query(
        `INSERT INTO recordings (id, source, student_id, source_path, storage_uri, bytes, status, created_at, updated_at) VALUES ($1, 'upload', $2, 'lesson.wav', 'local://lesson.wav', 1, 'ingested', NOW(), NOW())`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts (id, recording_id, storage_uri, mode, model, language, stt_provider, fallback_used, created_at, updated_at) VALUES ($1, $2, 'local://transcript', 'timeline', 'nova-3', 'en', 'deepgram', false, NOW(), $3)`,
        [transcriptId, recordingId, updatedAt],
      );
    });
    const run = await createStudentMemoryOpenAiBatchRun({
      workload: 'lesson_memory',
      model: 'gpt-5.4-nano',
      inputJsonlSha256: 'a'.repeat(64),
      inputBytes: 1,
      items: [
        {
          studentId,
          customId: `lesson:${randomUUID()}`,
          canonicalScopeKey: transcriptId,
          sourceVersionHash: 'b'.repeat(64),
          requestEnvelope: { sourceSelectionHash: 'selection-hash' },
          responseSchemaFingerprint: 'schema',
          requestBody: { model: 'gpt-5.4-nano' },
          sourceRefs: {
            transcriptId,
            recordingId,
            transcriptUpdatedAt: updatedAt.toISOString(),
            sourceSelectionHash: 'selection-hash',
          },
        },
      ],
    });
    const [item] = await listStudentMemoryOpenAiBatchItems({ runId: run.id });
    if (!item) throw new Error('Expected Batch item');
    const content = {
      lessonSummary: 'Past tense practice.',
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

    await expect(importValidatedLessonMemoryOpenAiBatchItem({ item, content })).resolves.toBe(
      item.id,
    );
    await expect(importValidatedLessonMemoryOpenAiBatchItem({ item, content })).resolves.toBe(
      item.id,
    );
    await expect(getLessonMemoryEntryById(item.id)).resolves.toMatchObject({
      id: item.id,
      status: 'ready',
    });
    await expect(listStudentMemoryOpenAiBatchItems({ runId: run.id })).resolves.toEqual([
      expect.objectContaining({ id: item.id, state: 'imported', claimState: 'imported' }),
    ]);
  });

  it('does not write a canonical lesson entry after online work supersedes the Batch claim', async () => {
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const updatedAt = new Date('2026-06-21T00:00:00.000Z');
    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
      await client.query(
        `INSERT INTO recordings (id, source, student_id, source_path, storage_uri, bytes, status, created_at, updated_at) VALUES ($1, 'upload', $2, 'lesson.wav', 'local://lesson.wav', 1, 'ingested', NOW(), NOW())`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts (id, recording_id, storage_uri, mode, model, language, stt_provider, fallback_used, created_at, updated_at) VALUES ($1, $2, 'local://transcript', 'timeline', 'nova-3', 'en', 'deepgram', false, NOW(), $3)`,
        [transcriptId, recordingId, updatedAt],
      );
    });
    const run = await createStudentMemoryOpenAiBatchRun({
      workload: 'lesson_memory',
      model: 'gpt-5.4-nano',
      inputJsonlSha256: 'a'.repeat(64),
      inputBytes: 1,
      items: [
        {
          studentId,
          customId: `lesson:${randomUUID()}`,
          canonicalScopeKey: transcriptId,
          sourceVersionHash: 'b'.repeat(64),
          requestEnvelope: { sourceSelectionHash: 'selection-hash' },
          responseSchemaFingerprint: 'schema',
          requestBody: { model: 'gpt-5.4-nano' },
          sourceRefs: {
            transcriptId,
            recordingId,
            transcriptUpdatedAt: updatedAt.toISOString(),
            sourceSelectionHash: 'selection-hash',
          },
        },
      ],
    });
    const [item] = await listStudentMemoryOpenAiBatchItems({ runId: run.id });
    if (!item) throw new Error('Expected Batch item');
    await withPgClient(async (client) => {
      await client.query(
        `UPDATE student_memory_openai_batch_items
         SET state = 'superseded_by_online', claim_state = 'superseded_by_online'
         WHERE id = $1`,
        [item.id],
      );
      await client.query(
        `UPDATE student_memory_openai_batch_claims SET state = 'superseded_by_online' WHERE item_id = $1`,
        [item.id],
      );
    });

    await expect(
      importValidatedLessonMemoryOpenAiBatchItem({
        item,
        content: {
          lessonSummary: 'Past tense practice.',
          topicsDiscussed: [],
          mistakePatterns: [],
          grammarReviewed: [],
          grammarWatchlist: [],
          vocabularyFocus: [],
          pronunciationFocus: [],
          studentFacts: [],
          progressSignals: [],
          followUpRecommendations: [],
        },
      }),
    ).rejects.toMatchObject({ name: 'StudentMemoryOpenAiBatchIneligibleClaimError' });
    await expect(getLessonMemoryEntryById(item.id)).resolves.toBeNull();
  });
});
