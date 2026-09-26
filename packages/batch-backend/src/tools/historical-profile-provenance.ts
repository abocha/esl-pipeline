import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';

import { loadBatchBackendEnv } from '../bootstrap/env.js';
import { configureHostRunPgRuntimeEnv } from '../bootstrap/pg-host-run-env.js';
import { closePgPool, createPgPool } from '../infrastructure/db.js';

export const CLASSIFIER_VERSION = 'historical-profile-provenance-v2';
const CODE_CONTEXT = createHash('sha256')
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest('hex');

type DateValue = Date | string | null;
export interface ProfileEvidence {
  profile: {
    id: string;
    provenance: string;
    completion: DateValue;
    activeRevisionId: string | null;
    createdAt: DateValue;
  };
  revisions: Array<{
    id: string;
    profileId: string;
    hash: string;
    source: string;
    status: string;
    createdAt: DateValue;
    activatedAt: DateValue;
    deprecatedAt: DateValue;
    restoredFromRevisionId: string | null;
  }>;
  links: Array<{
    candidateId: string;
    revisionId: string;
    evidenceCount: number;
    evidenceHash?: string;
  }>;
  promotions: Array<{
    candidateId: string;
    revisionId: string;
    promotedAt: DateValue;
    status: string;
  }>;
  observations: Array<{
    id: string;
    revisionId: string;
    profileId: string;
    hash: string;
    status: string;
    observedAt: DateValue;
  }>;
  operations: Array<{ id: string; state: string }>;
}

type Reason =
  | 'ACTIVATED_EVIDENCE'
  | 'NO_REVISIONS'
  | 'NO_POSITIVE_ORIGIN'
  | 'NO_ACTIVATION_PROOF'
  | 'EVIDENCE_CONFLICT'
  | 'UNEXPECTED_INITIAL_OPERATION'
  | 'ALREADY_CLASSIFIED'
  | 'INCONSISTENT_PROFILE_STATE';
export interface Decision {
  profileId: string;
  action: 'CLASSIFY_EVIDENCE_ENRICHED' | 'KEEP_UNKNOWN' | 'NO_OP' | 'OUT_OF_SCOPE';
  reason: Reason | 'POST_0056_PROFILE' | 'UNVERIFIABLE_PROFILE_CREATED_AT';
  evidenceRevisionIds: string[];
  evidenceCandidateIds: string[];
  evidencePromptPackageIds: string[];
  completedAt: string | null;
  timestampBasis: 'ACTIVATION' | 'CANDIDATE_PROMOTION' | 'PROMPT_PACKAGE_ACTIVE' | null;
  evidenceFingerprint: string;
}

export interface ReportContext {
  database: string;
  schema: string;
  cohortCutoff: string;
  preservesProfileUpdatedAt: boolean;
}

function timestamp(value: DateValue): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sorted<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

function fingerprintEvidence(e: ProfileEvidence): string {
  return hash({
    classifier: CLASSIFIER_VERSION,
    profile: e.profile,
    revisions: sorted(e.revisions, (r) => r.id),
    links: sorted(e.links, (l) => `${l.revisionId}:${l.candidateId}`),
    promotions: sorted(e.promotions, (p) => `${p.revisionId}:${p.candidateId}`),
    observations: sorted(e.observations, (o) => o.id),
    operations: sorted(e.operations, (o) => o.id),
  });
}

export function classifyHistoricalProfile(e: ProfileEvidence, cohortCutoff: string): Decision {
  const base: Decision = {
    profileId: e.profile.id,
    action: 'KEEP_UNKNOWN',
    reason: 'NO_POSITIVE_ORIGIN',
    evidenceRevisionIds: [],
    evidenceCandidateIds: [],
    evidencePromptPackageIds: [],
    completedAt: null,
    timestampBasis: null,
    evidenceFingerprint: fingerprintEvidence(e),
  };
  if (e.profile.provenance !== 'unknown')
    return { ...base, action: 'NO_OP', reason: 'ALREADY_CLASSIFIED' };
  const createdAt = timestamp(e.profile.createdAt);
  if (!createdAt)
    return { ...base, action: 'OUT_OF_SCOPE', reason: 'UNVERIFIABLE_PROFILE_CREATED_AT' };
  if (createdAt >= cohortCutoff)
    return { ...base, action: 'OUT_OF_SCOPE', reason: 'POST_0056_PROFILE' };
  if (e.profile.completion !== null) return { ...base, reason: 'INCONSISTENT_PROFILE_STATE' };
  if (e.operations.length > 0) return { ...base, reason: 'UNEXPECTED_INITIAL_OPERATION' };

  const revisions = new Map(e.revisions.map((r) => [r.id, r]));
  const active = e.revisions.filter((r) => r.status === 'active');
  if (
    active.length > 1 ||
    (e.profile.activeRevisionId !== null &&
      (active.length !== 1 || active[0]?.id !== e.profile.activeRevisionId)) ||
    (e.profile.activeRevisionId === null && active.length !== 0)
  ) {
    return { ...base, reason: 'EVIDENCE_CONFLICT' };
  }
  if (e.revisions.length === 0) return { ...base, reason: 'NO_REVISIONS' };
  const validDate = (value: DateValue) => value === null || timestamp(value) !== null;
  if (
    e.revisions.some(
      (r) =>
        r.createdAt === null ||
        !/^[0-9a-f]{64}$/.test(r.hash) ||
        !validDate(r.createdAt) ||
        !['draft', 'active', 'deprecated'].includes(r.status) ||
        !validDate(r.activatedAt) ||
        !validDate(r.deprecatedAt) ||
        (r.status === 'draft' && (r.activatedAt !== null || r.deprecatedAt !== null)) ||
        (r.status === 'deprecated' && r.activatedAt !== null) ||
        (r.status === 'active' && (r.activatedAt === null || r.deprecatedAt !== null)) ||
        (r.activatedAt !== null && timestamp(r.activatedAt)! < timestamp(r.createdAt)!) ||
        (r.deprecatedAt !== null && timestamp(r.deprecatedAt)! < timestamp(r.createdAt)!),
    ) ||
    e.promotions.some(
      (p) =>
        !validDate(p.promotedAt) ||
        (['promoted', 'superseded'].includes(p.status) && p.promotedAt === null) ||
        (p.promotedAt !== null && !['promoted', 'superseded'].includes(p.status)) ||
        (p.promotedAt !== null &&
          revisions.get(p.revisionId) &&
          timestamp(p.promotedAt)! < timestamp(revisions.get(p.revisionId)!.createdAt)!),
    ) ||
    e.observations.some(
      (o) =>
        !validDate(o.observedAt) ||
        (o.status === 'active' && o.observedAt === null) ||
        (o.observedAt !== null &&
          revisions.get(o.revisionId) &&
          timestamp(o.observedAt)! < timestamp(revisions.get(o.revisionId)!.createdAt)!),
    )
  ) {
    return { ...base, reason: 'EVIDENCE_CONFLICT' };
  }

  const evidenceLinks = new Map<string, string[]>();
  for (const link of e.links) {
    if (!revisions.has(link.revisionId) || link.evidenceCount < 0)
      return { ...base, reason: 'EVIDENCE_CONFLICT' };
    if (link.evidenceCount > 0)
      evidenceLinks.set(link.revisionId, [
        ...(evidenceLinks.get(link.revisionId) ?? []),
        link.candidateId,
      ]);
  }
  const origins = new Map<string, { revisionIds: string[]; candidateIds: string[] }>();
  const visiting = new Set<string>();
  let conflict = false;
  function origin(id: string): { revisionIds: string[]; candidateIds: string[] } | null {
    if (origins.has(id)) return origins.get(id)!;
    const revision = revisions.get(id);
    if (!revision || revision.profileId !== e.profile.id || visiting.has(id)) {
      conflict = true;
      return null;
    }
    visiting.add(id);
    let result = { revisionIds: [] as string[], candidateIds: [] as string[] };
    if (revision.source === 'lesson_population' || evidenceLinks.has(id)) {
      result = { revisionIds: [id], candidateIds: evidenceLinks.get(id) ?? [] };
    }
    if (revision.restoredFromRevisionId) {
      if (revision.source !== 'restore') conflict = true;
      const parent = origin(revision.restoredFromRevisionId);
      if (
        !parent ||
        !revisions.get(revision.restoredFromRevisionId) ||
        revisions.get(revision.restoredFromRevisionId)!.hash !== revision.hash
      )
        conflict = true;
      else
        result = {
          revisionIds: parent.revisionIds.length
            ? [id, ...result.revisionIds, ...parent.revisionIds]
            : result.revisionIds,
          candidateIds: [...result.candidateIds, ...parent.candidateIds],
        };
    } else if (revision.source === 'restore') conflict = true;
    visiting.delete(id);
    origins.set(id, result);
    return result;
  }
  for (const revision of e.revisions) origin(revision.id);
  if (conflict) return { ...base, reason: 'EVIDENCE_CONFLICT' };

  const proofs: Array<{
    revisionId: string;
    at: string;
    basis: NonNullable<Decision['timestampBasis']>;
    id: string;
  }> = [];
  for (const revision of e.revisions) {
    const source = origins.get(revision.id)!;
    if (source.revisionIds.length === 0) continue;
    if (
      revision.status === 'active' &&
      revision.id === e.profile.activeRevisionId &&
      revision.activatedAt
    ) {
      proofs.push({
        revisionId: revision.id,
        at: timestamp(revision.activatedAt)!,
        basis: 'ACTIVATION',
        id: revision.id,
      });
    }
  }
  for (const promotion of e.promotions) {
    if (
      !revisions.has(promotion.revisionId) ||
      !promotion.promotedAt ||
      !['promoted', 'superseded'].includes(promotion.status) ||
      !origins.get(promotion.revisionId)?.revisionIds.length
    )
      continue;
    proofs.push({
      revisionId: promotion.revisionId,
      at: timestamp(promotion.promotedAt)!,
      basis: 'CANDIDATE_PROMOTION',
      id: promotion.candidateId,
    });
  }
  for (const observation of e.observations) {
    const revision = revisions.get(observation.revisionId);
    if (observation.profileId !== e.profile.id || !revision || observation.hash !== revision.hash)
      return { ...base, reason: 'EVIDENCE_CONFLICT' };
    if (
      observation.status !== 'active' ||
      !observation.observedAt ||
      !origins.get(observation.revisionId)?.revisionIds.length
    )
      continue;
    proofs.push({
      revisionId: observation.revisionId,
      at: timestamp(observation.observedAt)!,
      basis: 'PROMPT_PACKAGE_ACTIVE',
      id: observation.id,
    });
  }
  if (proofs.length === 0) {
    const sources = [...origins.values()].filter((value) => value.revisionIds.length > 0);
    return {
      ...base,
      reason: sources.length > 0 ? 'NO_ACTIVATION_PROOF' : 'NO_POSITIVE_ORIGIN',
      evidenceRevisionIds: [...new Set(sources.flatMap((value) => value.revisionIds))].sort(),
      evidenceCandidateIds: [...new Set(sources.flatMap((value) => value.candidateIds))].sort(),
    };
  }
  proofs.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const winning = proofs[0]!;
  const source = origins.get(winning.revisionId)!;
  return {
    ...base,
    action: 'CLASSIFY_EVIDENCE_ENRICHED',
    reason: 'ACTIVATED_EVIDENCE',
    evidenceRevisionIds: [...new Set([winning.revisionId, ...source.revisionIds])].sort(),
    evidenceCandidateIds: [
      ...new Set([
        ...source.candidateIds,
        ...proofs
          .filter((p) => p.basis === 'CANDIDATE_PROMOTION' && p.revisionId === winning.revisionId)
          .map((p) => p.id),
      ]),
    ].sort(),
    evidencePromptPackageIds: proofs
      .filter((p) => p.basis === 'PROMPT_PACKAGE_ACTIVE' && p.revisionId === winning.revisionId)
      .map((p) => p.id)
      .sort(),
    completedAt: winning.at,
    timestampBasis: winning.basis,
  };
}

export function buildReport(evidence: ProfileEvidence[], context: ReportContext) {
  const decisions = evidence
    .map((item) => classifyHistoricalProfile(item, context.cohortCutoff))
    .sort((a, b) => a.profileId.localeCompare(b.profileId));
  const counts = {
    classify: decisions.filter((d) => d.action === 'CLASSIFY_EVIDENCE_ENRICHED').length,
    keepUnknown: decisions.filter((d) => d.action === 'KEEP_UNKNOWN').length,
    alreadyClassified: decisions.filter((d) => d.action === 'NO_OP').length,
    outsideHistoricalCohort: decisions.filter((d) => d.action === 'OUT_OF_SCOPE').length,
  };
  const fingerprint = hash({
    classifier: CLASSIFIER_VERSION,
    code: CODE_CONTEXT,
    context,
    decisions,
  });
  return {
    classifierVersion: CLASSIFIER_VERSION,
    codeContext: CODE_CONTEXT,
    databaseContext: context,
    fingerprint,
    counts,
    decisions,
  };
}

async function loadContext(client: PoolClient): Promise<ReportContext> {
  const contextRow = await client.query<{
    database: string;
    schema: string;
    cohort_cutoff: Date | null;
    preserves_profile_updated_at: boolean;
  }>(
    `SELECT current_database() AS database,
      (SELECT max(id) FROM schema_migrations) AS schema,
      (SELECT applied_at FROM schema_migrations WHERE id = '0056_first_profile_onboarding') AS cohort_cutoff,
      EXISTS (SELECT 1 FROM schema_migrations
              WHERE id = '0057_historical_profile_provenance_timestamp') AS preserves_profile_updated_at`,
  );
  const cohortCutoff = timestamp(contextRow.rows[0]?.cohort_cutoff ?? null);
  if (!cohortCutoff) {
    throw new Error('Required schema migration 0056 is not applied.');
  }
  return {
    database: contextRow.rows[0]!.database,
    schema: contextRow.rows[0]!.schema,
    cohortCutoff,
    preservesProfileUpdatedAt: contextRow.rows[0]!.preserves_profile_updated_at,
  };
}

async function loadEvidence(
  client: PoolClient,
  context: ReportContext,
): Promise<ProfileEvidence[]> {
  const profileRows = await client.query<{
    id: string;
    provenance: string;
    initial_enrichment_completed_at: Date | null;
    active_revision_id: string | null;
    created_at: Date | null;
  }>(
    'SELECT id, provenance, initial_enrichment_completed_at, active_revision_id, created_at FROM profiles ORDER BY id',
  );
  const unknownIds = profileRows.rows
    .filter((p) => {
      const createdAt = timestamp(p.created_at);
      return p.provenance === 'unknown' && createdAt !== null && createdAt < context.cohortCutoff;
    })
    .map((p) => p.id);
  const evidence = profileRows.rows.map(
    (p): ProfileEvidence => ({
      profile: {
        id: p.id,
        provenance: p.provenance,
        completion: p.initial_enrichment_completed_at,
        activeRevisionId: p.active_revision_id,
        createdAt: p.created_at,
      },
      revisions: [],
      links: [],
      promotions: [],
      observations: [],
      operations: [],
    }),
  );
  const byId = new Map(evidence.map((e) => [e.profile.id, e]));
  if (unknownIds.length === 0) return evidence;
  const revisions = await client.query<{
    id: string;
    profile_id: string;
    content_hash: string;
    source: string;
    status: string;
    created_at: Date;
    activated_at: Date | null;
    deprecated_at: Date | null;
    restored_from_revision_id: string | null;
  }>(
    `SELECT id, profile_id, content_hash, source, status, created_at, activated_at,
    deprecated_at, restored_from_revision_id FROM profile_revisions WHERE profile_id = ANY($1::text[])`,
    [unknownIds],
  );
  const revisionIds = revisions.rows.map((r) => r.id);
  for (const r of revisions.rows)
    byId.get(r.profile_id)!.revisions.push({
      id: r.id,
      profileId: r.profile_id,
      hash: r.content_hash,
      source: r.source,
      status: r.status,
      createdAt: r.created_at,
      activatedAt: r.activated_at,
      deprecatedAt: r.deprecated_at,
      restoredFromRevisionId: r.restored_from_revision_id,
    });
  if (revisionIds.length > 0) {
    const links = await client.query<{
      profile_id: string;
      candidate_id: string;
      revision_id: string;
      evidence_count: number;
      evidence_hash: string;
    }>(
      `SELECT r.profile_id, l.candidate_id, l.revision_id,
        CASE WHEN jsonb_typeof(c.evidence) = 'array' THEN
          (SELECT count(*)::int FROM jsonb_array_elements(c.evidence) AS element(value)
           WHERE jsonb_typeof(element.value) = 'object'
             AND length(trim(element.value->>'quote')) > 0)
        ELSE -1 END AS evidence_count,
        md5(c.evidence::text) AS evidence_hash
       FROM student_profile_candidate_draft_revisions l
       JOIN profile_revisions r ON r.id = l.revision_id
       JOIN student_profile_candidates c ON c.id = l.candidate_id
       WHERE l.revision_id = ANY($1::uuid[])`,
      [revisionIds],
    );
    for (const l of links.rows)
      byId.get(l.profile_id)!.links.push({
        candidateId: l.candidate_id,
        revisionId: l.revision_id,
        evidenceCount: l.evidence_count,
        evidenceHash: l.evidence_hash,
      });
    const promotions = await client.query<{
      profile_id: string;
      id: string;
      promoted_revision_id: string;
      promoted_at: Date | null;
      status: string;
    }>(
      `SELECT r.profile_id, c.id, c.promoted_revision_id, c.promoted_at, c.status
       FROM student_profile_candidates c JOIN profile_revisions r ON r.id = c.promoted_revision_id
       WHERE c.promoted_revision_id = ANY($1::uuid[])`,
      [revisionIds],
    );
    for (const p of promotions.rows)
      byId.get(p.profile_id)!.promotions.push({
        candidateId: p.id,
        revisionId: p.promoted_revision_id,
        promotedAt: p.promoted_at,
        status: p.status,
      });
    const observations = await client.query<{
      id: string;
      resolved_profile_id: string;
      resolved_profile_revision_id: string;
      resolved_profile_hash: string;
      resolved_profile_status: string;
      created_at: Date;
    }>(
      `SELECT id, resolved_profile_id, resolved_profile_revision_id, resolved_profile_hash,
        resolved_profile_status, created_at FROM prompt_packages
       WHERE resolved_profile_revision_id IS NOT NULL
         AND (resolved_profile_id = ANY($1::text[])
           OR resolved_profile_revision_id = ANY($2::uuid[]))`,
      [unknownIds, revisionIds],
    );
    const ownerByRevision = new Map(revisions.rows.map((r) => [r.id, r.profile_id]));
    for (const o of observations.rows) {
      const owners = new Set([
        o.resolved_profile_id,
        ownerByRevision.get(o.resolved_profile_revision_id),
      ]);
      for (const owner of owners) {
        const target = owner ? byId.get(owner) : undefined;
        if (!target) continue;
        target.observations.push({
          id: o.id,
          profileId: o.resolved_profile_id,
          revisionId: o.resolved_profile_revision_id,
          hash: o.resolved_profile_hash,
          status: o.resolved_profile_status,
          observedAt: o.created_at,
        });
      }
    }
  }
  const operations = await client.query<{ profile_id: string; id: string; state: string }>(
    'SELECT profile_id, id, state FROM profile_initial_enrichment_operations WHERE profile_id = ANY($1::text[])',
    [unknownIds],
  );
  for (const o of operations.rows)
    byId.get(o.profile_id)!.operations.push({ id: o.id, state: o.state });
  return evidence;
}

export async function runHistoricalProvenanceBackfill(
  options: { apply?: boolean; fingerprint?: string },
  pool = createPgPool(),
) {
  if (options.apply && !/^[0-9a-f]{64}$/.test(options.fingerprint ?? '')) {
    throw new Error('--apply requires --fingerprint from a reviewed dry-run report.');
  }
  const client = await pool.connect();
  try {
    await client.query(
      options.apply
        ? 'BEGIN ISOLATION LEVEL SERIALIZABLE'
        : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    await client.query("SET LOCAL statement_timeout = '30s'");
    const context = await loadContext(client);
    if (options.apply) {
      if (!context.preservesProfileUpdatedAt) {
        throw new Error('Apply requires migration 0057 to preserve profiles.updated_at.');
      }
      await client.query(
        `SELECT id FROM profiles
         WHERE provenance = 'unknown' AND initial_enrichment_completed_at IS NULL
           AND created_at < $1::timestamptz
         ORDER BY id FOR UPDATE`,
        [context.cohortCutoff],
      );
    }
    const evidence = await loadEvidence(client, context);
    const report = buildReport(evidence, context);
    if (options.apply && report.fingerprint !== options.fingerprint) {
      throw new Error(
        'Evidence drift: reviewed fingerprint does not match current classifier/database state.',
      );
    }
    if (options.apply) {
      for (const decision of report.decisions) {
        if (decision.action !== 'CLASSIFY_EVIDENCE_ENRICHED') continue;
        const result = await client.query(
          `UPDATE profiles SET provenance = 'evidence_enriched', initial_enrichment_completed_at = $2
           WHERE id = $1 AND provenance = 'unknown' AND initial_enrichment_completed_at IS NULL
             AND created_at < $3::timestamptz`,
          [decision.profileId, decision.completedAt, context.cohortCutoff],
        );
        if (result.rowCount !== 1) throw new Error(`Profile state drift: ${decision.profileId}`);
      }
    }
    await client.query('COMMIT');
    return {
      ...report,
      mode: options.apply ? 'apply' : 'dry-run',
      updated: options.apply ? report.counts.classify : 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--help')) {
    console.log(
      'Usage: pnpm --filter @esl-pipeline/batch-backend profile:provenance-backfill [--apply --fingerprint <dry-run fingerprint>]',
    );
    return;
  }
  const apply = argv.includes('--apply');
  const index = argv.indexOf('--fingerprint');
  const fingerprint = index >= 0 ? argv[index + 1] : undefined;
  const expected = apply ? ['--apply', '--fingerprint', fingerprint] : [];
  if (argv.length !== expected.length || argv.some((arg, i) => arg !== expected[i])) {
    throw new Error(
      'Default is read-only dry-run; apply requires --apply --fingerprint <reviewed report fingerprint>.',
    );
  }
  loadBatchBackendEnv(import.meta.url, 'batch-backend-tool-historical-profile-provenance');
  configureHostRunPgRuntimeEnv();
  console.log(
    JSON.stringify(await runHistoricalProvenanceBackfill({ apply, fingerprint }), null, 2),
  );
}

if (
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => closePgPool());
}
