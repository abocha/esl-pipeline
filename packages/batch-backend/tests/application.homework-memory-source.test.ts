import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  evaluateHomeworkMemoryGenerationForSucceededJob,
  resolveHomeworkMemorySourceFromSucceededJob,
} from '../src/application/homework-memory-source.js';
import { insertCanonicalReadyHomeworkMemoryEntry } from '../src/domain/homework-memory-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) {
  requirePgTestEnv();
}

let tempDir: string;

async function truncateHomeworkMemoryScope() {
  await withPgClient(async (client) => {
    await client.query(
      'TRUNCATE TABLE homework_memory_entries, drafts, prompt_packages, lesson_memory_entries, transcripts, recordings, jobs, students, users RESTART IDENTITY CASCADE',
    );
  });
}

const describeIfPg = hasPgTestEnv ? describe : describe.skip;

describeIfPg('application/homework-memory-source', () => {
  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'hw-memory-source-'));
    await truncateHomeworkMemoryScope();
  });

  afterAll(async () => {
    await truncateHomeworkMemoryScope();
    await closePgPool();
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await truncateHomeworkMemoryScope();
  });

  it('collects same-content publish targets across succeeded lineage jobs', async () => {
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const promptPackageId = randomUUID();
    const draftId = randomUUID();
    const rootJobId = randomUUID();
    const rerunJobId = randomUUID();
    const markdownPath = path.join(tempDir, `${rootJobId}.md`);

    await writeFile(
      markdownPath,
      `---\ntitle: Homework\n---\n### A. Notice the Grammar\nReview articles.\n\n### F. Your Mission\nGive travel advice.\n`,
      'utf8',
    );

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Nadia', NOW(), NOW())`,
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
          publish_target, notion_url, finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', $2, $3, $4, $5, $6, $7, 'notion', 'https://notion.so/root', NOW(), NOW(), NOW())
        `,
        [rootJobId, markdownPath, studentId, recordingId, transcriptId, promptPackageId, draftId],
      );
      await client.query(
        `
        INSERT INTO jobs (
          id, state, md, student_id, recording_id, transcript_id, prompt_package_id, draft_id,
          source_job_id, publish_target, html_url, finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', $2, $3, $4, $5, $6, $7, $8, 'html', 'https://example.test/hw', NOW(), NOW(), NOW())
        `,
        [rerunJobId, markdownPath, studentId, recordingId, transcriptId, promptPackageId, draftId, rootJobId],
      );
    });

    const source = await resolveHomeworkMemorySourceFromSucceededJob(rerunJobId);

    expect(source.assignmentLineageKey).toBe(rootJobId);
    expect(source.publishTargets.map((target) => target.target)).toEqual(['html', 'notion']);
    expect(source.contentHash).toHaveLength(64);
    expect(source.normalizedMarkdown.sections.some((section) => section.heading.includes('Your Mission'))).toBe(true);
  });

  it('requests regeneration when publish-target metadata expands for unchanged markdown', async () => {
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const rootJobId = randomUUID();
    const rerunJobId = randomUUID();
    const markdownPath = path.join(tempDir, `${rootJobId}-expanded.md`);

    await writeFile(markdownPath, '### F. Your Mission\nRetell and advise.\n', 'utf8');

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Mila', NOW(), NOW())`,
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
        INSERT INTO jobs (
          id, state, md, student_id, recording_id, transcript_id, publish_target, notion_url, finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', $2, $3, $4, $5, 'notion', 'https://notion.so/root', NOW(), NOW(), NOW())
        `,
        [rootJobId, markdownPath, studentId, recordingId, transcriptId],
      );
      await client.query(
        `
        INSERT INTO jobs (
          id, state, md, student_id, recording_id, transcript_id, source_job_id, publish_target, html_url, finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', $2, $3, $4, $5, $6, 'html', 'https://example.test/hw', NOW(), NOW(), NOW())
        `,
        [rerunJobId, markdownPath, studentId, recordingId, transcriptId, rootJobId],
      );
    });

    const initialSource = await resolveHomeworkMemorySourceFromSucceededJob(rootJobId);
    await insertCanonicalReadyHomeworkMemoryEntry({
      studentId,
      jobId: rootJobId,
      assignmentLineageKey: rootJobId,
      recordingId,
      transcriptId,
      schemaVersion: 'homework-memory.v1',
      provider: 'openrouter',
      model: 'qwen/qwen3.5',
      contentHash: initialSource.contentHash,
      generationNotes: null,
      homeworkSummary: 'Initial publish',
      topic: 'Advice',
      grammarTargets: [],
      vocabularyTargets: [],
      reviewTargets: [],
      taskList: [],
      pronunciationFocus: [],
      studyTextType: 'monologue',
      inputType: 'authentic',
      communicativeOutcome: 'Retell and advise.',
      teacherFollowUpCues: [],
      publishedAt: initialSource.publishedAt,
      publishTargets: initialSource.publishTargets.filter((target) => target.target === 'notion'),
    });

    const decision = await evaluateHomeworkMemoryGenerationForSucceededJob(rerunJobId);

    expect(decision.shouldGenerate).toBe(true);
    expect(decision.reason).toBe('publish_targets_expanded');
    expect(decision.source.publishTargets.map((target) => target.target)).toEqual(['html', 'notion']);
  });
});
