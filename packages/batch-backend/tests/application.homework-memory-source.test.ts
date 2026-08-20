import './support/bootstrap-pg-test-env.js';

import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  evaluateHomeworkMemoryGenerationForSucceededJob,
  resolveHomeworkMemorySourceFromSucceededJob,
} from '../src/application/homework-memory-source.js';
import { insertCanonicalReadyHomeworkMemoryEntry } from '../src/domain/homework-memory-repository.js';
import { closePgPool, withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) {
  requirePgTestEnv();
}

let tempDir: string;

async function truncateHomeworkMemoryScope() {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      'TRUNCATE TABLE homework_memory_entries, drafts, prompt_packages, lesson_memory_entries, transcripts, recordings, jobs, students, users RESTART IDENTITY CASCADE',
    );
  });
}

async function insertSucceededHomeworkSourceJob(args: {
  id: string;
  studentId: string;
  markdownPath: string;
  sourceJobId?: string | null;
  publishedContentHash?: string | null;
  publishTarget?: 'html' | null;
  htmlUrl?: string | null;
}) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO jobs (
        id, state, md, student_id, source_job_id, published_content_hash,
        publish_target, html_url, finished_at, created_at, updated_at
      )
      VALUES ($1, 'succeeded', $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
      `,
      [
        args.id,
        args.markdownPath,
        args.studentId,
        args.sourceJobId ?? null,
        args.publishedContentHash ?? null,
        args.publishTarget ?? null,
        args.htmlUrl ?? null,
      ],
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

  it('merges persisted same-content history without reading its unavailable markdown artifact', async () => {
    const studentId = randomUUID();
    const rootJobId = randomUUID();
    const historicalRerunJobId = randomUUID();
    const currentJobId = randomUUID();
    const currentMarkdownPath = path.join(tempDir, `${currentJobId}.md`);
    const markdown = '### F. Your Mission\nGive travel advice.\n';
    const contentHash = createHash('sha256').update(markdown, 'utf8').digest('hex');
    await writeFile(currentMarkdownPath, markdown, 'utf8');

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Nadia', NOW(), NOW())`,
        [studentId],
      );
      await client.query(
        `
        INSERT INTO jobs (
          id, state, md, student_id, publish_target, html_url, published_content_hash,
          finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', $2, $3, 'html', 'https://example.test/history', $4, NOW(), NOW(), NOW())
        `,
        [rootJobId, path.join(tempDir, 'unavailable-history.md'), studentId, contentHash],
      );
      await client.query(
        `
        INSERT INTO jobs (
          id, state, md, student_id, source_job_id, publish_target, html_url, published_content_hash,
          finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', $2, $3, $4, 'html', 'https://example.test/latest-history', $5,
                NOW() + INTERVAL '1 minute', NOW(), NOW())
        `,
        [
          historicalRerunJobId,
          path.join(tempDir, 'unavailable-latest-history.md'),
          studentId,
          rootJobId,
          contentHash,
        ],
      );
      await client.query(
        `
        INSERT INTO jobs (
          id, state, md, student_id, source_job_id, published_content_hash,
          finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', $2, $3, $4, $5, NOW(), NOW(), NOW())
        `,
        [currentJobId, currentMarkdownPath, studentId, rootJobId, contentHash],
      );
    });

    const source = await resolveHomeworkMemorySourceFromSucceededJob(currentJobId);

    expect(source.publishedMarkdown).toBe(markdown);
    expect(source.contentHash).toBe(contentHash);
    expect(source.publishTargets).toEqual([
      expect.objectContaining({
        target: 'html',
        jobId: historicalRerunJobId,
        url: 'https://example.test/latest-history',
      }),
    ]);
    expect(source.normalizedMarkdown.sections).toEqual(
      expect.arrayContaining([expect.objectContaining({ heading: 'F. Your Mission' })]),
    );
  });

  it('skips persisted changed-content history without reading its unavailable markdown artifact', async () => {
    const studentId = randomUUID();
    const currentJobId = randomUUID();
    const currentMarkdownPath = path.join(tempDir, `${currentJobId}.md`);
    const markdown = '### F. Your Mission\nCurrent content.\n';
    await writeFile(currentMarkdownPath, markdown, 'utf8');
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Mai', NOW(), NOW())`,
        [studentId],
      );
    });
    await insertSucceededHomeworkSourceJob({
      id: currentJobId,
      studentId,
      markdownPath: currentMarkdownPath,
      publishedContentHash: createHash('sha256').update(markdown, 'utf8').digest('hex'),
    });
    await insertSucceededHomeworkSourceJob({
      id: randomUUID(),
      studentId,
      markdownPath: path.join(tempDir, 'unavailable-changed-history.md'),
      sourceJobId: currentJobId,
      publishedContentHash: 'c'.repeat(64),
      publishTarget: 'html',
      htmlUrl: 'https://example.test/changed',
    });

    const source = await resolveHomeworkMemorySourceFromSucceededJob(currentJobId);

    expect(source.publishTargets).toEqual([]);
  });

  it('uses readable legacy same-content history as a fallback', async () => {
    const studentId = randomUUID();
    const currentJobId = randomUUID();
    const currentMarkdownPath = path.join(tempDir, `${currentJobId}.md`);
    const legacyMarkdownPath = path.join(tempDir, `${currentJobId}-legacy.md`);
    const markdown = '### F. Your Mission\nKeep this content.\n';
    await Promise.all([
      writeFile(currentMarkdownPath, markdown, 'utf8'),
      writeFile(legacyMarkdownPath, markdown, 'utf8'),
    ]);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Lan', NOW(), NOW())`,
        [studentId],
      );
    });
    await insertSucceededHomeworkSourceJob({
      id: currentJobId,
      studentId,
      markdownPath: currentMarkdownPath,
    });
    const legacyJobId = randomUUID();
    await insertSucceededHomeworkSourceJob({
      id: legacyJobId,
      studentId,
      markdownPath: legacyMarkdownPath,
      sourceJobId: currentJobId,
      publishTarget: 'html',
      htmlUrl: 'https://example.test/legacy-same',
    });

    const source = await resolveHomeworkMemorySourceFromSucceededJob(currentJobId);

    expect(source.publishTargets).toEqual([
      expect.objectContaining({ jobId: legacyJobId, url: 'https://example.test/legacy-same' }),
    ]);
  });

  it('ignores changed and unreadable legacy history without a persisted hash', async () => {
    const studentId = randomUUID();
    const currentJobId = randomUUID();
    const currentMarkdownPath = path.join(tempDir, `${currentJobId}.md`);
    const changedMarkdownPath = path.join(tempDir, `${currentJobId}-changed.md`);
    await Promise.all([
      writeFile(currentMarkdownPath, '### F. Your Mission\nCurrent content.\n', 'utf8'),
      writeFile(changedMarkdownPath, '### F. Your Mission\nChanged content.\n', 'utf8'),
    ]);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'An', NOW(), NOW())`,
        [studentId],
      );
    });
    await insertSucceededHomeworkSourceJob({
      id: currentJobId,
      studentId,
      markdownPath: currentMarkdownPath,
    });
    await insertSucceededHomeworkSourceJob({
      id: randomUUID(),
      studentId,
      markdownPath: changedMarkdownPath,
      sourceJobId: currentJobId,
      publishTarget: 'html',
      htmlUrl: 'https://example.test/legacy-changed',
    });
    await insertSucceededHomeworkSourceJob({
      id: randomUUID(),
      studentId,
      markdownPath: path.join(tempDir, 'unavailable-legacy.md'),
      sourceJobId: currentJobId,
      publishTarget: 'html',
      htmlUrl: 'https://example.test/legacy-unavailable',
    });

    const source = await resolveHomeworkMemorySourceFromSucceededJob(currentJobId);

    expect(source.publishTargets).toEqual([]);
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

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
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
        INSERT INTO drafts (
          id, prompt_package_id, storage_uri, working_version, content_hash, created_at, updated_at
        )
        VALUES ($1, $2, 'local://drafts/draft.md', 1, repeat('a', 64), NOW(), NOW())
        `,
        [draftId, promptPackageId],
      );
      await client.query(
        `
        INSERT INTO jobs (
          id, state, md, student_id, recording_id, transcript_id, prompt_package_id, draft_id,
          publish_target, html_url, finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', $2, $3, $4, $5, $6, $7, 'html', 'https://example.test/root', NOW(), NOW(), NOW())
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
        [
          rerunJobId,
          markdownPath,
          studentId,
          recordingId,
          transcriptId,
          promptPackageId,
          draftId,
          rootJobId,
        ],
      );
    });

    const source = await resolveHomeworkMemorySourceFromSucceededJob(rerunJobId);

    expect(source.assignmentLineageKey).toBe(rootJobId);
    expect(source.publishTargets.map((target) => target.target)).toEqual(['html']);
    expect(source.contentHash).toHaveLength(64);
    expect(
      source.normalizedMarkdown.sections.some((section) =>
        section.heading.includes('Your Mission'),
      ),
    ).toBe(true);
  });

  it('treats publish-target expansion as non-material when the published markdown is unchanged', async () => {
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const rootJobId = randomUUID();
    const rerunJobId = randomUUID();
    const markdownPath = path.join(tempDir, `${rootJobId}-expanded.md`);

    await writeFile(markdownPath, '### F. Your Mission\nRetell and advise.\n', 'utf8');

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
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
          id, state, md, student_id, recording_id, transcript_id, publish_target, html_url, finished_at, created_at, updated_at
        )
        VALUES ($1, 'succeeded', $2, $3, $4, $5, 'html', 'https://example.test/root', NOW(), NOW(), NOW())
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
      publishTargets: initialSource.publishTargets.filter((target) => target.target === 'html'),
    });

    const decision = await evaluateHomeworkMemoryGenerationForSucceededJob(rerunJobId);

    expect(decision.shouldGenerate).toBe(false);
    expect(decision.reason).toBe('no_material_change');
    expect(decision.source.publishTargets.map((target) => target.target)).toEqual(['html']);
  });
});
