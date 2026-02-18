import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getJobById,
  getReadinessMetrics,
  insertJob,
  listFailedJobErrorsForReadiness,
  updateJobStateAndResult,
} from '../src/domain/job-repository.js';
import { withPgClient } from '../src/infrastructure/db.js';

/**
 * Intent:
 * - Exercise JobRepository against a real Postgres connection (as configured for tests),
 *   validating mapping between rows & JobRecord and optimistic state transitions.
 * - Defends against schema drift, incorrect defaults, and broken concurrency guards.
 *
 * Notes:
 * - Assumes a "jobs" table compatible with the queries in the repository.
 * - Uses truncation between tests to keep them deterministic.
 */

const hasTestDb = !!process.env.BATCH_BACKEND_TEST_PG;
const describeIfDb = hasTestDb ? describe : describe.skip;

async function truncateJobs() {
  await withPgClient(async (client) => {
    await client.query('TRUNCATE TABLE jobs');
  });
}

describeIfDb('domain/job-repository', () => {
  beforeAll(async () => {
    await truncateJobs();
  });

  afterAll(async () => {
    await truncateJobs();
  });

  beforeEach(async () => {
    await truncateJobs();
  });

  describe('insertJob + getJobById', () => {
    it('inserts a queued job with expected defaults and can be loaded back', async () => {
      const job = await insertJob({
        md: 'fixtures/ok.md',
      });

      expect(job.state).toBe('queued');
      expect(job.md).toBe('fixtures/ok.md');
      expect(job.preset).toBeNull();
      expect(job.withTts).toBe(false);
      expect(job.upload).toBeNull();
      expect(job.voiceId).toBeNull();
      expect(job.voiceAccent).toBeNull();
      expect(job.forceTts).toBeNull();
      expect(job.notionDatabase).toBeNull();
      expect(job.ttsStrategy).toBeNull();
      expect(job.notionUrl).toBeNull();
      expect(job.recordingId).toBeNull();
      expect(job.transcriptId).toBeNull();
      expect(job.promptPackageId).toBeNull();
      expect(job.draftId).toBeNull();
      expect(job.createdAt instanceof Date).toBe(true);
      expect(job.updatedAt instanceof Date).toBe(true);

      const loaded = await getJobById(job.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(job.id);
      expect(loaded!.state).toBe('queued');
      expect(loaded!.md).toBe('fixtures/ok.md');
      expect(loaded!.voiceAccent).toBeNull();
      expect(loaded!.voiceId).toBeNull();
      expect(loaded!.notionDatabase).toBeNull();
    });

    it('persists optional metadata fields when provided', async () => {
      const recordingId = randomUUID();
      const transcriptId = randomUUID();
      const promptPackageId = randomUUID();
      const draftId = randomUUID();

      const job = await insertJob({
        md: 'fixtures/ok.md',
        recordingId,
        transcriptId,
        promptPackageId,
        draftId,
        preset: 'b1-default',
        withTts: true,
        upload: 's3',
        voiceId: 'voice_amanda',
        voiceAccent: 'american_female',
        forceTts: true,
        notionDatabase: 'db-123',
        ttsStrategy: 'dialogue',
      });

      expect(job.voiceId).toBe('voice_amanda');
      expect(job.voiceAccent).toBe('american_female');
      expect(job.forceTts).toBe(true);
      expect(job.notionDatabase).toBe('db-123');
      expect(job.ttsStrategy).toBe('dialogue');
      expect(job.notionUrl).toBeNull();
      expect(job.recordingId).toBe(recordingId);
      expect(job.transcriptId).toBe(transcriptId);
      expect(job.promptPackageId).toBe(promptPackageId);
      expect(job.draftId).toBe(draftId);
    });

    it('returns null for unknown id', async () => {
      const loaded = await getJobById(randomUUID());
      expect(loaded).toBeNull();
    });

    it('fails fast when loading a row with an unsupported mode', async () => {
      const id = randomUUID();

      await withPgClient(async (client) => {
        await client.query('INSERT INTO jobs (id, md, state, mode) VALUES ($1, $2, $3, $4)', [
          id,
          'fixtures/ok.md',
          'queued',
          'monologue',
        ]);
      });

      await expect(getJobById(id)).rejects.toThrow(/Unsupported jobs\.mode value "monologue"/);
    });
  });

  describe('updateJobStateAndResult', () => {
    it('performs queued -> running -> succeeded transitions with timestamps, Notion URL, and manifestPath', async () => {
      const job = await insertJob({
        md: 'fixtures/ok.md',
        preset: 'b1-default',
        withTts: true,
        upload: 's3',
      });

      const running = await updateJobStateAndResult({
        id: job.id,
        expectedState: 'queued',
        nextState: 'running',
        startedAt: new Date(),
      });

      expect(running).not.toBeNull();
      expect(running!.state).toBe('running');
      expect(running!.startedAt).toBeInstanceOf(Date);
      expect(running!.finishedAt).toBeNull();

      const succeeded = await updateJobStateAndResult({
        id: job.id,
        expectedState: 'running',
        nextState: 'succeeded',
        manifestPath: '/manifests/test.json',
        notionUrl: 'https://notion.so/job',
        finishedAt: new Date(),
      });

      expect(succeeded).not.toBeNull();
      expect(succeeded!.state).toBe('succeeded');
      expect(succeeded!.manifestPath).toBe('/manifests/test.json');
      expect(succeeded!.finishedAt).toBeInstanceOf(Date);
      expect(succeeded!.notionUrl).toBe('https://notion.so/job');
    });

    it('returns null when expectedState does not match (optimistic concurrency / race)', async () => {
      const job = await insertJob({
        md: 'fixtures/ok.md',
      });

      // Move state once correctly.
      const running = await updateJobStateAndResult({
        id: job.id,
        expectedState: 'queued',
        nextState: 'running',
        startedAt: new Date(),
      });
      expect(running).not.toBeNull();
      expect(running!.state).toBe('running');

      // Now simulate a stale updater expecting "queued" again.
      const conflicted = await updateJobStateAndResult({
        id: job.id,
        expectedState: 'queued',
        nextState: 'running',
        startedAt: new Date(),
      });
      expect(conflicted).toBeNull();
    });

    it('throws for invalid transitions based on assertTransition', async () => {
      const job = await insertJob({
        md: 'fixtures/ok.md',
      });

      await expect(
        updateJobStateAndResult({
          id: job.id,
          expectedState: 'succeeded', // invalid given current state is queued
          nextState: 'running',
        } as any),
      ).rejects.toThrow();
    });
  });

  describe('getReadinessMetrics', () => {
    it('returns publish outcomes, latency median, and first-session success counts', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      const base = new Date('2024-04-01T00:00:00.000Z');

      await withPgClient(async (client) => {
        await client.query(
          `
          INSERT INTO jobs (id, state, publish_target, user_id, created_at, updated_at, finished_at)
          VALUES
            ($1, 'succeeded', 'html', $5, $7, $7, $8),
            ($2, 'failed', 'html', $5, $9, $9, $10),
            ($3, 'succeeded', 'notion', $6, $11, $11, $12),
            ($4, 'queued', 'anytype', $6, $13, $13, NULL)
          `,
          [
            randomUUID(),
            randomUUID(),
            randomUUID(),
            randomUUID(),
            userA,
            userB,
            new Date(base.getTime() + 10_000),
            new Date(base.getTime() + 40_000), // 30s latency
            new Date(base.getTime() + 50_000),
            new Date(base.getTime() + 85_000), // failed row ignored for latency
            new Date(base.getTime() + 90_000),
            new Date(base.getTime() + 150_000), // 60s latency
            new Date(base.getTime() + 160_000),
          ],
        );
      });

      const result = await getReadinessMetrics({
        from: new Date('2024-03-31T00:00:00.000Z'),
        to: new Date('2024-04-02T00:00:00.000Z'),
        userId: null,
      });

      expect(result.publishSucceeded).toBe(2);
      expect(result.publishFailed).toBe(1);
      expect(result.publishTotal).toBe(3);
      expect(result.latencySampleSize).toBe(2);
      expect(result.medianPublishLatencyMs).toBe(45000); // median of 30s and 60s
      expect(result.firstSessionTotalUsers).toBe(2);
      expect(result.firstSessionSucceededUsers).toBe(2);
    });
  });

  describe('listFailedJobErrorsForReadiness', () => {
    it('returns only failed publish-job errors for the requested window and user scope', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      const base = new Date('2024-04-01T00:00:00.000Z');

      await withPgClient(async (client) => {
        await client.query(
          `
          INSERT INTO jobs (id, state, publish_target, user_id, created_at, updated_at, error)
          VALUES
            ($1, 'failed', 'html', $7, $10, $10, $13),
            ($2, 'failed', 'html', $7, $11, $11, $14),
            ($3, 'failed', 'html', $7, $12, $12, ''),
            ($4, 'failed', NULL, $7, $10, $10, $15),
            ($5, 'succeeded', 'html', $7, $10, $10, $16),
            ($6, 'failed', 'notion', $8, $10, $10, $17),
            ($9, 'failed', 'html', $7, $18, $18, $19),
            ($20, 'failed', 'html', $7, $21, $21, $22)
          `,
          [
            randomUUID(),
            randomUUID(),
            randomUUID(),
            randomUUID(),
            randomUUID(),
            randomUUID(),
            userA,
            userB,
            randomUUID(),
            new Date(base.getTime() + 1_000),
            new Date(base.getTime() + 2_000),
            new Date(base.getTime() + 3_000),
            'Text-to-Dialogue synthesis failed [provider_rate_limit]: HTTP 429',
            'Provider timed out while generating dialogue',
            'failed without publish target',
            'not failed',
            'User B provider failure',
            new Date(base.getTime() - 20_000),
            'Outside window failure',
            randomUUID(),
            new Date('2024-04-02T00:00:00.000Z'),
            'Boundary provider failure',
          ],
        );
      });

      const result = await listFailedJobErrorsForReadiness({
        from: new Date('2024-04-01T00:00:00.000Z'),
        to: new Date('2024-04-02T00:00:00.000Z'),
        userId: userA,
      });

      expect(result).toEqual(
        expect.arrayContaining([
          'Text-to-Dialogue synthesis failed [provider_rate_limit]: HTTP 429',
          'Provider timed out while generating dialogue',
          'Boundary provider failure',
        ]),
      );
      expect(result).toHaveLength(3);
    });

    it('includes all users when userId is null', async () => {
      const userA = randomUUID();
      const userB = randomUUID();
      const createdAt = new Date('2024-05-01T00:00:10.000Z');

      await withPgClient(async (client) => {
        await client.query(
          `
          INSERT INTO jobs (id, state, publish_target, user_id, created_at, updated_at, error)
          VALUES
            ($1, 'failed', 'html', $3, $5, $5, $7),
            ($2, 'failed', 'notion', $4, $6, $6, $8)
          `,
          [
            randomUUID(),
            randomUUID(),
            userA,
            userB,
            createdAt,
            new Date(createdAt.getTime() + 1000),
            'User A provider failure',
            'User B provider failure',
          ],
        );
      });

      const result = await listFailedJobErrorsForReadiness({
        from: new Date('2024-05-01T00:00:00.000Z'),
        to: new Date('2024-05-02T00:00:00.000Z'),
        userId: null,
      });

      expect(result).toEqual(expect.arrayContaining(['User A provider failure', 'User B provider failure']));
      expect(result).toHaveLength(2);
    });
  });
});
