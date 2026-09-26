import { describe, expect, it } from 'vitest';

import {
  classifyHistoricalProfile,
  type ProfileEvidence,
  runHistoricalProvenanceBackfill,
} from '../src/tools/historical-profile-provenance.js';

const date = '2026-07-22T10:00:00.000Z';
const later = '2026-07-23T10:00:00.000Z';
const cutoff = '2026-09-26T13:00:00.000Z';
const HASH = 'a'.repeat(64);

function fixture(): ProfileEvidence {
  return {
    profile: {
      id: 'learner.md',
      provenance: 'unknown',
      completion: null,
      activeRevisionId: null,
      createdAt: date,
    },
    revisions: [],
    links: [],
    promotions: [],
    observations: [],
    operations: [],
  };
}
function revision(id: string, changes: Partial<ProfileEvidence['revisions'][number]> = {}) {
  return {
    id,
    profileId: 'learner.md',
    hash: HASH,
    source: 'lesson_population',
    status: 'draft',
    createdAt: date,
    activatedAt: null,
    deprecatedAt: null,
    restoredFromRevisionId: null,
    ...changes,
  };
}
function action(e: ProfileEvidence) {
  return classifyHistoricalProfile(e, cutoff).action;
}

describe('historical profile provenance classifier', () => {
  it('excludes an otherwise qualifying profile created at or after migration 0056', () => {
    const e = fixture();
    e.revisions.push(revision('r1', { status: 'active', activatedAt: later }));
    e.profile.activeRevisionId = 'r1';
    e.profile.createdAt = cutoff;
    expect(classifyHistoricalProfile(e, cutoff)).toMatchObject({
      action: 'OUT_OF_SCOPE',
      reason: 'POST_0056_PROFILE',
    });
    e.profile.createdAt = '2026-09-27T00:00:00.000Z';
    expect(action(e)).toBe('OUT_OF_SCOPE');
    e.profile.createdAt = null;
    expect(classifyHistoricalProfile(e, cutoff)).toMatchObject({
      action: 'OUT_OF_SCOPE',
      reason: 'UNVERIFIABLE_PROFILE_CREATED_AT',
    });
  });

  it('requires activation of a generated revision', () => {
    const e = fixture();
    e.revisions.push(revision('r1'));
    expect(classifyHistoricalProfile(e, cutoff)).toMatchObject({
      action: 'KEEP_UNKNOWN',
      reason: 'NO_ACTIVATION_PROOF',
      evidenceRevisionIds: ['r1'],
    });
    e.revisions[0]!.status = 'active';
    e.revisions[0]!.activatedAt = date;
    e.profile.activeRevisionId = 'r1';
    expect(classifyHistoricalProfile(e, cutoff)).toMatchObject({
      action: 'CLASSIFY_EVIDENCE_ENRICHED',
      completedAt: date,
      timestampBasis: 'ACTIVATION',
    });
  });

  it('recognizes dated promotion or exact active prompt observation of a deprecated revision', () => {
    const e = fixture();
    e.revisions.push(revision('r1', { status: 'deprecated', deprecatedAt: later }));
    expect(action(e)).toBe('KEEP_UNKNOWN');
    e.promotions.push({
      candidateId: 'c1',
      revisionId: 'r1',
      status: 'promoted',
      promotedAt: later,
    });
    expect(classifyHistoricalProfile(e, cutoff)).toMatchObject({
      action: 'CLASSIFY_EVIDENCE_ENRICHED',
      completedAt: later,
      timestampBasis: 'CANDIDATE_PROMOTION',
    });
    e.promotions = [];
    e.observations.push({
      id: 'p1',
      profileId: e.profile.id,
      revisionId: 'r1',
      hash: HASH,
      status: 'active',
      observedAt: date,
    });
    expect(classifyHistoricalProfile(e, cutoff)).toMatchObject({
      action: 'CLASSIFY_EVIDENCE_ENRICHED',
      completedAt: date,
      timestampBasis: 'PROMPT_PACKAGE_ACTIVE',
    });
    e.observations[0]!.hash = 'wrong';
    expect(classifyHistoricalProfile(e, cutoff).reason).toBe('EVIDENCE_CONFLICT');
    e.observations[0]!.hash = HASH;
    e.observations[0]!.profileId = 'other.md';
    expect(classifyHistoricalProfile(e, cutoff).reason).toBe('EVIDENCE_CONFLICT');
  });

  it('retains evidence-bearing links copied onto a manually edited draft', () => {
    const e = fixture();
    e.revisions.push(revision('manual', { source: 'update' }));
    e.links.push({ candidateId: 'c1', revisionId: 'manual', evidenceCount: 1 });
    expect(action(e)).toBe('KEEP_UNKNOWN');
    e.revisions[0]!.status = 'active';
    e.revisions[0]!.activatedAt = later;
    e.profile.activeRevisionId = 'manual';
    expect(classifyHistoricalProfile(e, cutoff)).toMatchObject({
      action: 'CLASSIFY_EVIDENCE_ENRICHED',
      evidenceCandidateIds: ['c1'],
    });
    e.links[0]!.evidenceCount = 0;
    expect(action(e)).toBe('KEEP_UNKNOWN');
  });

  it('follows hash-consistent restore ancestry through draft ancestors', () => {
    const e = fixture();
    e.revisions.push(
      revision('source'),
      revision('draft', { source: 'restore', restoredFromRevisionId: 'source' }),
      revision('active', {
        source: 'restore',
        status: 'active',
        activatedAt: later,
        restoredFromRevisionId: 'draft',
      }),
    );
    e.profile.activeRevisionId = 'active';
    expect(classifyHistoricalProfile(e, cutoff)).toMatchObject({
      action: 'CLASSIFY_EVIDENCE_ENRICHED',
      evidenceRevisionIds: ['active', 'draft', 'source'],
    });
    e.revisions[1]!.hash = 'b'.repeat(64);
    expect(classifyHistoricalProfile(e, cutoff).reason).toBe('EVIDENCE_CONFLICT');
    e.revisions[1]!.hash = HASH;
    e.revisions[1]!.restoredFromRevisionId = 'missing';
    expect(classifyHistoricalProfile(e, cutoff).reason).toBe('EVIDENCE_CONFLICT');
    e.revisions[1]!.restoredFromRevisionId = 'active';
    expect(classifyHistoricalProfile(e, cutoff).reason).toBe('EVIDENCE_CONFLICT');
    e.revisions[1]!.restoredFromRevisionId = 'source';
    e.revisions[0]!.profileId = 'other.md';
    expect(classifyHistoricalProfile(e, cutoff).reason).toBe('EVIDENCE_CONFLICT');
  });

  it.each(['create', 'update', 'starter_profile_form', 'legacy_normalization'])(
    'keeps %s-only histories unknown',
    (source) => {
      const e = fixture();
      e.revisions.push(revision('r1', { source, status: 'active', activatedAt: date }));
      e.profile.activeRevisionId = 'r1';
      expect(action(e)).toBe('KEEP_UNKNOWN');
    },
  );
  it('keeps empty histories unknown', () =>
    expect(classifyHistoricalProfile(fixture(), cutoff)).toMatchObject({
      action: 'KEEP_UNKNOWN',
      reason: 'NO_REVISIONS',
    }));

  it('chooses the earliest durable completion proof', () => {
    const e = fixture();
    e.revisions.push(revision('r1', { status: 'active', activatedAt: later }));
    e.profile.activeRevisionId = 'r1';
    e.promotions.push({
      candidateId: 'c1',
      revisionId: 'r1',
      status: 'promoted',
      promotedAt: date,
    });
    expect(classifyHistoricalProfile(e, cutoff)).toMatchObject({
      completedAt: date,
      timestampBasis: 'CANDIDATE_PROMOTION',
    });
  });

  it('defers contradictory state, invalid timestamps, and unexpected operations', () => {
    const e = fixture();
    e.revisions.push(revision('r1', { status: 'active', activatedAt: date }));
    expect(classifyHistoricalProfile(e, cutoff).reason).toBe('EVIDENCE_CONFLICT');
    e.profile.activeRevisionId = 'r1';
    e.revisions[0]!.activatedAt = 'invalid';
    expect(classifyHistoricalProfile(e, cutoff).reason).toBe('EVIDENCE_CONFLICT');
    e.revisions[0]!.activatedAt = date;
    e.operations.push({ id: 'op1', state: 'uncertain' });
    expect(classifyHistoricalProfile(e, cutoff).reason).toBe('UNEXPECTED_INITIAL_OPERATION');
    e.operations = [];
    e.promotions.push({
      candidateId: 'c1',
      revisionId: 'r1',
      status: 'promoted',
      promotedAt: null,
    });
    expect(classifyHistoricalProfile(e, cutoff).reason).toBe('EVIDENCE_CONFLICT');
    e.promotions = [];
    e.profile.provenance = 'evidence_enriched';
    e.profile.completion = date;
    expect(classifyHistoricalProfile(e, cutoff)).toMatchObject({
      action: 'NO_OP',
      reason: 'ALREADY_CLASSIFIED',
    });
  });
});

function fakePool(e: ProfileEvidence) {
  const commands: Array<{ sql: string; params?: unknown[] }> = [];
  let migrationCutoff = cutoff;
  let preservesProfileUpdatedAt = true;
  const client = {
    async query(sql: string, params?: unknown[]) {
      commands.push({ sql, params });
      if (sql.includes('current_database()'))
        return {
          rows: [
            {
              database: 'test',
              schema: '0056_first_profile_onboarding',
              cohort_cutoff: migrationCutoff,
              preserves_profile_updated_at: preservesProfileUpdatedAt,
            },
          ],
        };
      if (sql.includes('FROM profiles ORDER BY id'))
        return {
          rows: [
            {
              id: e.profile.id,
              provenance: e.profile.provenance,
              initial_enrichment_completed_at: e.profile.completion,
              active_revision_id: e.profile.activeRevisionId,
              created_at: e.profile.createdAt,
            },
          ],
        };
      if (sql.includes('FROM profile_revisions WHERE profile_id'))
        return {
          rows: e.revisions
            .filter((r) => ((params?.[0] as string[] | undefined) ?? []).includes(r.profileId))
            .map((r) => ({
              id: r.id,
              profile_id: r.profileId,
              content_hash: r.hash,
              source: r.source,
              status: r.status,
              created_at: r.createdAt,
              activated_at: r.activatedAt,
              deprecated_at: r.deprecatedAt,
              restored_from_revision_id: r.restoredFromRevisionId,
            })),
        };
      if (sql.includes('FROM student_profile_candidate_draft_revisions')) return { rows: [] };
      if (sql.includes('FROM student_profile_candidates c JOIN')) return { rows: [] };
      if (sql.includes('FROM prompt_packages')) return { rows: [] };
      if (sql.includes('FROM profile_initial_enrichment_operations')) return { rows: [] };
      if (sql.startsWith('UPDATE profiles')) return { rowCount: 1, rows: [] };
      return { rows: [] };
    },
    release() {},
  };
  return {
    commands,
    setMigrationCutoff(value: string) {
      migrationCutoff = value;
    },
    setTimestampMigrationApplied(value: boolean) {
      preservesProfileUpdatedAt = value;
    },
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

describe('dry-run and apply boundary', () => {
  it('reports post-migration unknown separately and never loads or updates its qualifying revision', async () => {
    const e = fixture();
    e.profile.createdAt = cutoff;
    e.profile.activeRevisionId = 'r1';
    e.revisions.push(revision('r1', { status: 'active', activatedAt: later }));
    const db = fakePool(e);
    const dry = await runHistoricalProvenanceBackfill({}, db.pool as never);
    expect(dry.counts).toMatchObject({ classify: 0, keepUnknown: 0, outsideHistoricalCohort: 1 });
    expect(dry.databaseContext.cohortCutoff).toBe(cutoff);
    expect(dry.decisions[0]).toMatchObject({ action: 'OUT_OF_SCOPE', reason: 'POST_0056_PROFILE' });
    expect(db.commands.some((c) => c.sql.includes('FROM profile_revisions'))).toBe(false);
    const applied = await runHistoricalProvenanceBackfill(
      { apply: true, fingerprint: dry.fingerprint },
      db.pool as never,
    );
    expect(applied.updated).toBe(0);
    expect(db.commands.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
    expect(db.commands.some((c) => c.sql.includes('LOCK TABLE'))).toBe(false);
  });

  it('refuses apply without a reviewed fingerprint before connecting', async () => {
    const db = fakePool(fixture());
    await expect(
      runHistoricalProvenanceBackfill({ apply: true }, db.pool as never),
    ).rejects.toThrow('--fingerprint');
    expect(db.commands).toHaveLength(0);
  });

  it('dry-runs without writes and applies only two provenance columns with a reviewed fingerprint', async () => {
    const e = fixture();
    e.revisions.push(revision('r1', { status: 'active', activatedAt: date }));
    e.profile.activeRevisionId = 'r1';
    const db = fakePool(e);
    const dry = await runHistoricalProvenanceBackfill({}, db.pool as never);
    expect(dry.counts.classify).toBe(1);
    expect(db.commands.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
    const applied = await runHistoricalProvenanceBackfill(
      { apply: true, fingerprint: dry.fingerprint },
      db.pool as never,
    );
    expect(applied.updated).toBe(1);
    const updates = db.commands.filter((c) => c.sql.startsWith('UPDATE'));
    expect(updates).toHaveLength(1);
    expect(updates[0]!.sql).toContain(
      "SET provenance = 'evidence_enriched', initial_enrichment_completed_at = $2",
    );
    expect(updates[0]!.sql).not.toContain('updated_at');
    expect(db.commands.some((c) => c.sql.includes('FOR UPDATE'))).toBe(true);
    e.profile.provenance = 'evidence_enriched';
    e.profile.completion = date;
    const repeat = await runHistoricalProvenanceBackfill({}, db.pool as never);
    const again = await runHistoricalProvenanceBackfill(
      { apply: true, fingerprint: repeat.fingerprint },
      db.pool as never,
    );
    expect(again.updated).toBe(0);
    expect(db.commands.filter((c) => c.sql.startsWith('UPDATE'))).toHaveLength(1);
  });

  it('rejects material drift before any update', async () => {
    const e = fixture();
    e.revisions.push(revision('r1', { status: 'active', activatedAt: date }));
    e.profile.activeRevisionId = 'r1';
    const db = fakePool(e);
    const dry = await runHistoricalProvenanceBackfill({}, db.pool as never);
    e.revisions[0]!.hash = 'c'.repeat(64);
    await expect(
      runHistoricalProvenanceBackfill(
        { apply: true, fingerprint: dry.fingerprint },
        db.pool as never,
      ),
    ).rejects.toThrow('Evidence drift');
    expect(db.commands.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
    expect(db.commands.some((c) => c.sql === 'ROLLBACK')).toBe(true);
  });

  it('binds the reviewed fingerprint to migration application time', async () => {
    const e = fixture();
    const db = fakePool(e);
    const dry = await runHistoricalProvenanceBackfill({}, db.pool as never);
    db.setMigrationCutoff('2026-09-27T13:00:00.000Z');
    await expect(
      runHistoricalProvenanceBackfill(
        { apply: true, fingerprint: dry.fingerprint },
        db.pool as never,
      ),
    ).rejects.toThrow('Evidence drift');
    expect(db.commands.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });

  it('allows dry-run on migration 0056 but refuses apply until timestamp migration 0057', async () => {
    const db = fakePool(fixture());
    db.setTimestampMigrationApplied(false);
    const dry = await runHistoricalProvenanceBackfill({}, db.pool as never);
    expect(dry.databaseContext.preservesProfileUpdatedAt).toBe(false);
    await expect(
      runHistoricalProvenanceBackfill(
        { apply: true, fingerprint: dry.fingerprint },
        db.pool as never,
      ),
    ).rejects.toThrow('requires migration 0057');
    expect(db.commands.some((command) => command.sql.startsWith('UPDATE'))).toBe(false);
  });
});
