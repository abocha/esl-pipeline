import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { runHistoricalProvenanceBackfill } from '../src/tools/historical-profile-provenance.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

const REJECT_CONSTRAINT = 'historical_provenance_test_reject';

async function resetFixtures(): Promise<void> {
  await withPgClient(async (client) => {
    await client.query(`ALTER TABLE profiles DROP CONSTRAINT IF EXISTS ${REJECT_CONSTRAINT}`);
    await client.query('TRUNCATE TABLE profiles CASCADE');
  });
}

async function cutoff(): Promise<Date> {
  return withPgClient(async (client) => {
    const result = await client.query<{ applied_at: Date }>(
      "SELECT applied_at FROM schema_migrations WHERE id = '0056_first_profile_onboarding'",
    );
    if (!result.rows[0]) throw new Error('Migration 0056 is missing in test database.');
    return result.rows[0].applied_at;
  });
}

async function insertQualifyingProfile(id: string, createdAt: Date): Promise<void> {
  const revisionId = randomUUID();
  await withPgClient(async (client) => {
    await client.query('INSERT INTO profiles (id, label, created_at) VALUES ($1, $2, $3)', [
      id,
      'Test profile',
      createdAt,
    ]);
    await client.query(
      `INSERT INTO profile_revisions
        (id, profile_id, content, content_hash, source, status, created_at, activated_at)
       VALUES ($1, $2, 'Test content', $3, 'lesson_population', 'active', $4, $4)`,
      [revisionId, id, 'a'.repeat(64), createdAt],
    );
    await client.query('UPDATE profiles SET active_revision_id = $2 WHERE id = $1', [
      id,
      revisionId,
    ]);
  });
}

describe('historical provenance backfill PostgreSQL transaction', () => {
  beforeEach(resetFixtures);
  afterAll(async () => {
    await resetFixtures();
    await closePgPool();
  });

  it('updates only historical unknown rows, keeps post-migration unknown and existing classifications untouched', async () => {
    const migrationAt = await cutoff();
    const historicalId = `a-${randomUUID()}.md`;
    const laterId = `z-${randomUUID()}.md`;
    await insertQualifyingProfile(historicalId, new Date(migrationAt.getTime() - 86_400_000));
    await insertQualifyingProfile(laterId, new Date(migrationAt.getTime() + 86_400_000));
    const before = await withPgClient(async (client) =>
      client.query<{ id: string; updated_at: Date }>(
        'SELECT id, updated_at FROM profiles ORDER BY id',
      ),
    );
    const dry = await runHistoricalProvenanceBackfill({});
    expect(dry.counts).toMatchObject({ classify: 1, keepUnknown: 0, outsideHistoricalCohort: 1 });
    expect(dry.databaseContext.cohortCutoff).toBe(migrationAt.toISOString());
    const applied = await runHistoricalProvenanceBackfill({
      apply: true,
      fingerprint: dry.fingerprint,
    });
    expect(applied.updated).toBe(1);
    const after = await withPgClient(async (client) =>
      client.query<{
        id: string;
        provenance: string;
        initial_enrichment_completed_at: Date | null;
        updated_at: Date;
      }>(
        'SELECT id, provenance, initial_enrichment_completed_at, updated_at FROM profiles ORDER BY id',
      ),
    );
    expect(after.rows.find((row) => row.id === historicalId)).toMatchObject({
      provenance: 'evidence_enriched',
      initial_enrichment_completed_at: new Date(migrationAt.getTime() - 86_400_000),
    });
    expect(after.rows.find((row) => row.id === laterId)).toMatchObject({
      provenance: 'unknown',
      initial_enrichment_completed_at: null,
    });
    expect(after.rows.map((row) => row.updated_at.toISOString())).toEqual(
      before.rows.map((row) => row.updated_at.toISOString()),
    );
    const repeat = await runHistoricalProvenanceBackfill({});
    expect(
      (await runHistoricalProvenanceBackfill({ apply: true, fingerprint: repeat.fingerprint }))
        .updated,
    ).toBe(0);
  });

  it('rolls back every profile update if a later guarded update fails', async () => {
    const migrationAt = await cutoff();
    const firstId = `a-${randomUUID()}.md`;
    const rejectedId = `b-${randomUUID()}.md`;
    const historicalAt = new Date(migrationAt.getTime() - 86_400_000);
    await insertQualifyingProfile(firstId, historicalAt);
    await insertQualifyingProfile(rejectedId, historicalAt);
    const dry = await runHistoricalProvenanceBackfill({});
    expect(dry.counts.classify).toBe(2);
    await withPgClient(async (client) =>
      client.query(
        `ALTER TABLE profiles ADD CONSTRAINT ${REJECT_CONSTRAINT}
       CHECK (id <> '${rejectedId}' OR provenance <> 'evidence_enriched')`,
      ),
    );
    await expect(
      runHistoricalProvenanceBackfill({ apply: true, fingerprint: dry.fingerprint }),
    ).rejects.toThrow();
    const rows = await withPgClient(async (client) =>
      client.query<{
        id: string;
        provenance: string;
        initial_enrichment_completed_at: Date | null;
      }>('SELECT id, provenance, initial_enrichment_completed_at FROM profiles ORDER BY id'),
    );
    expect(rows.rows).toHaveLength(2);
    expect(
      rows.rows.every(
        (row) => row.provenance === 'unknown' && row.initial_enrichment_completed_at === null,
      ),
    ).toBe(true);
  });
});
