import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { insertJob, getJobById, updateJobStateAndResult } from '../src/domain/job-repository';
import { withPgClient } from '../src/infrastructure/db';

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
  await withPgClient(async client => {
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
      expect(job.createdAt instanceof Date).toBe(true);
      expect(job.updatedAt instanceof Date).toBe(true);

      const loaded = await getJobById(job.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(job.id);
      expect(loaded!.state).toBe('queued');
      expect(loaded!.md).toBe('fixtures/ok.md');
    });

    it('returns null for unknown id', async () => {
      const loaded = await getJobById(randomUUID());
      expect(loaded).toBeNull();
    });
  });

  describe('updateJobStateAndResult', () => {
    it('performs queued -> running -> succeeded transitions with timestamps and manifestPath', async () => {
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
        finishedAt: new Date(),
      });

      expect(succeeded).not.toBeNull();
      expect(succeeded!.state).toBe('succeeded');
      expect(succeeded!.manifestPath).toBe('/manifests/test.json');
      expect(succeeded!.finishedAt).toBeInstanceOf(Date);
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
        } as any)
      ).rejects.toThrow();
    });
  });
});
