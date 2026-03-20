import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getLatestReadyHomeworkMemoryByAssignmentLineageKey,
  insertCanonicalReadyHomeworkMemoryEntry,
  listRecentReadyHomeworkMemoryByStudentId,
} from '../src/domain/homework-memory-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) {
  requirePgTestEnv();
}

async function truncateHomeworkMemoryTables() {
  await withPgClient(async (client) => {
    await client.query(
      'TRUNCATE TABLE homework_memory_entries, drafts, prompt_packages, lesson_memory_entries, transcripts, recordings, jobs, students, users RESTART IDENTITY CASCADE',
    );
  });
}

const describeIfPg = hasPgTestEnv ? describe : describe.skip;

describeIfPg('domain/homework-memory-repository', () => {
  beforeAll(async () => {
    await truncateHomeworkMemoryTables();
  });

  afterAll(async () => {
    await truncateHomeworkMemoryTables();
    await closePgPool();
  });

  beforeEach(async () => {
    await truncateHomeworkMemoryTables();
  });

  it('inserts canonical ready homework memory and supersedes older ready rows for the lineage', async () => {
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const promptPackageId = randomUUID();
    const draftId = randomUUID();
    const rootJobId = randomUUID();
    const rerunJobId = randomUUID();

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Lena', NOW(), NOW())`,
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
      await client.query(
        `
        INSERT INTO prompt_packages (
          id, recording_id, transcript_id, student_id, template_version, storage_uri, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, 'v4.4', 'local://prompt-packages/prompt.txt', NOW(), NOW())
        `,
        [promptPackageId, recordingId, transcriptId, studentId],
      );
      await client.query(
        `
        INSERT INTO drafts (id, prompt_package_id, storage_uri, created_at, updated_at)
        VALUES ($1, $2, 'local://drafts/draft.md', NOW(), NOW())
        `,
        [draftId, promptPackageId],
      );
      await client.query(
        `
        INSERT INTO jobs (
          id, state, md, student_id, recording_id, transcript_id, prompt_package_id, draft_id,
          publish_target, finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', 'lesson.md', $2, $3, $4, $5, $6, 'notion', NOW(), NOW(), NOW())
        `,
        [rootJobId, studentId, recordingId, transcriptId, promptPackageId, draftId],
      );
      await client.query(
        `
        INSERT INTO jobs (
          id, state, md, student_id, recording_id, transcript_id, prompt_package_id, draft_id,
          source_job_id, publish_target, finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', 'lesson.md', $2, $3, $4, $5, $6, $7, 'html', NOW(), NOW(), NOW())
        `,
        [rerunJobId, studentId, recordingId, transcriptId, promptPackageId, draftId, rootJobId],
      );
    });

    const first = await insertCanonicalReadyHomeworkMemoryEntry({
      studentId,
      jobId: rootJobId,
      assignmentLineageKey: rootJobId,
      promptPackageId,
      draftId,
      recordingId,
      transcriptId,
      schemaVersion: 'homework-memory.v1',
      provider: 'openrouter',
      model: 'qwen/qwen3.5',
      generationNotes: null,
      homeworkSummary: 'Initial publish',
      topic: 'Travel advice',
      grammarTargets: [],
      vocabularyTargets: [],
      reviewTargets: [],
      taskList: [],
      pronunciationFocus: [],
      studyTextType: 'dialogue',
      inputType: 'authentic',
      communicativeOutcome: 'Give advice.',
      teacherFollowUpCues: [],
      publishedAt: new Date('2026-03-20T10:00:00.000Z'),
      contentHash: 'sha-1',
      publishTargets: [
        {
          target: 'notion',
          url: 'https://notion.so/root',
          jobId: rootJobId,
          publishedAt: '2026-03-20T10:00:00.000Z',
        },
      ],
    });

    const second = await insertCanonicalReadyHomeworkMemoryEntry({
      studentId,
      jobId: rerunJobId,
      assignmentLineageKey: rootJobId,
      promptPackageId,
      draftId,
      recordingId,
      transcriptId,
      schemaVersion: 'homework-memory.v1',
      provider: 'openrouter',
      model: 'qwen/qwen3.5',
      generationNotes: null,
      homeworkSummary: 'Expanded publish targets',
      topic: 'Travel advice',
      grammarTargets: [],
      vocabularyTargets: [],
      reviewTargets: [],
      taskList: [],
      pronunciationFocus: [],
      studyTextType: 'dialogue',
      inputType: 'authentic',
      communicativeOutcome: 'Give advice.',
      teacherFollowUpCues: [],
      publishedAt: new Date('2026-03-20T11:00:00.000Z'),
      contentHash: 'sha-1',
      publishTargets: [
        {
          target: 'html',
          url: 'https://example.test/hw',
          jobId: rerunJobId,
          publishedAt: '2026-03-20T11:00:00.000Z',
        },
        {
          target: 'notion',
          url: 'https://notion.so/root',
          jobId: rootJobId,
          publishedAt: '2026-03-20T10:00:00.000Z',
        },
      ],
    });

    const latest = await getLatestReadyHomeworkMemoryByAssignmentLineageKey(rootJobId);
    const recent = await listRecentReadyHomeworkMemoryByStudentId(studentId, { limit: 5 });

    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    expect(latest?.id).toBe(second.id);
    expect(latest?.publishTargets.map((target) => target.target)).toEqual(['html', 'notion']);
    expect(recent).toHaveLength(1);

    const supersededFirst = await withPgClient(async (client) => {
      const result = await client.query<{ status: string; superseded_by_id: string | null }>(
        `SELECT status, superseded_by_id FROM homework_memory_entries WHERE id = $1`,
        [first.id],
      );
      return result.rows[0];
    });

    expect(supersededFirst?.status).toBe('superseded');
    expect(supersededFirst?.superseded_by_id).toBe(second.id);
  });
});
