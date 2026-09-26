import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { BatchBackendConfig } from '../config/env.js';
import { buildCanonicalLessonMemoryAuthoritySqlPredicate } from '../domain/lesson-memory-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import {
  deriveFoundationalProfileFromMarkdown,
  type FoundationalProfile,
  normalizeFoundationalProfile,
  renderFoundationalProfileContent,
} from './foundational-profile.js';
import {
  generateProfileRevisionDraft,
  ProfileRevisionDraftingError,
} from './profile-revision-drafting.js';

type OperationState =
  | 'waiting_evidence'
  | 'queued'
  | 'submitting'
  | 'result_ready'
  | 'succeeded'
  | 'failed'
  | 'uncertain'
  | 'superseded';
interface OperationRow {
  id: string;
  profile_id: string;
  student_id: string;
  assignment_session_id: string;
  recording_id: string;
  transcript_id: string;
  transcript_storage_uri: string;
  transcript_hash: string;
  source_identity_kind: string;
  source_fingerprint_scheme: string;
  source_fingerprint: string;
  lesson_memory_entry_id: string | null;
  seed_revision_id: string | null;
  seed_revision_hash: string | null;
  generation_input: GenerationInput | null;
  generation_provider: string | null;
  generation_model: string | null;
  state: OperationState;
  submission_id: string | null;
  submission_reserved_at: Date | null;
  validated_result: FoundationalProfile | null;
  result_hash: string | null;
}
interface GenerationInput {
  studentName: string;
  seed: FoundationalProfile | null;
  lessonEvidence: unknown;
  prompt: string;
  maxOutputTokens: number;
}

const SUBMISSION_UNCERTAIN_AFTER_MINUTES = 15;

async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function lockOperation(client: PoolClient, id: string): Promise<OperationRow | null> {
  // Lock order is assignment -> profile -> operation, matching Source confirmation.
  const identity = await client.query<OperationRow>(
    'SELECT assignment_session_id, profile_id FROM profile_initial_enrichment_operations WHERE id = $1',
    [id],
  );
  if (!identity.rows[0]) return null;
  await client.query('SELECT id FROM assignment_sessions WHERE id = $1 FOR UPDATE', [
    identity.rows[0].assignment_session_id,
  ]);
  await client.query('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [
    identity.rows[0].profile_id,
  ]);
  const locked = await client.query<OperationRow>(
    'SELECT * FROM profile_initial_enrichment_operations WHERE id = $1 FOR UPDATE',
    [id],
  );
  return locked.rows[0] ?? null;
}

async function authority(
  client: PoolClient,
  op: OperationRow,
): Promise<{
  valid: boolean;
  activeRevisionId: string | null;
  activeHash: string | null;
  provenance: string | null;
}> {
  const result = await client.query<{
    provenance: string;
    active_revision_id: string | null;
    content_hash: string | null;
    source_valid: boolean;
    binding_valid: boolean;
    evidence_valid: boolean;
  }>(
    `SELECT p.provenance, p.active_revision_id, pr.content_hash,
      EXISTS (
        SELECT 1 FROM assignment_sessions a
        JOIN assignment_source_bindings b ON b.assignment_session_id = a.id
        JOIN recordings r ON r.id = $4
        JOIN transcripts t ON t.id = $5
        WHERE a.id = $3 AND a.student_id = $2
          AND a.confirmed_step <> 'share'
          AND b.binding_role = 'confirmed'
          AND b.recording_id = $4 AND b.transcript_id = $5
          AND b.source_identity_kind = $8
          AND b.source_fingerprint_scheme = $9
          AND b.source_fingerprint = $10
          AND r.source_identity_kind = $8
          AND r.source_fingerprint_scheme = $9
          AND r.source_fingerprint = $10
          AND t.recording_id = $4 AND t.storage_uri = $6
          AND t.content_hash = $7
          AND t.working_version =
            (a.confirmed_snapshot->'source'->>'transcriptWorkingVersion')::integer
          AND a.confirmed_snapshot->'source'->>'recordingId' = $4::text
          AND a.confirmed_snapshot->'source'->>'transcriptId' = $5::text
          AND a.confirmed_snapshot->'source'->>'transcriptHash' = $7
      ) AS source_valid,
      EXISTS (SELECT 1 FROM student_profile_bindings b
        WHERE b.student_id = $2 AND b.profile_id = $1 AND b.effective_to IS NULL) AS binding_valid,
      ($11::uuid IS NULL OR EXISTS (
        SELECT 1 FROM lesson_memory_entries
        WHERE lesson_memory_entries.id = $11 AND student_id = $2
          AND assignment_session_id = $3 AND recording_id = $4 AND transcript_id = $5
          AND source_storage_uri = $6 AND source_content_hash = $7
          AND status = 'ready'
          AND ${buildCanonicalLessonMemoryAuthoritySqlPredicate('lesson_memory_entries')}
      )) AS evidence_valid
     FROM profiles p LEFT JOIN profile_revisions pr ON pr.id = p.active_revision_id
     WHERE p.id = $1`,
    [
      op.profile_id,
      op.student_id,
      op.assignment_session_id,
      op.recording_id,
      op.transcript_id,
      op.transcript_storage_uri,
      op.transcript_hash,
      op.source_identity_kind,
      op.source_fingerprint_scheme,
      op.source_fingerprint,
      op.lesson_memory_entry_id,
    ],
  );
  const row = result.rows[0];
  return {
    valid: Boolean(
      row?.source_valid &&
        row.binding_valid &&
        row.evidence_valid &&
        row.provenance === 'tutor_only' &&
        row.active_revision_id === op.seed_revision_id &&
        row.content_hash === op.seed_revision_hash,
    ),
    activeRevisionId: row?.active_revision_id ?? null,
    activeHash: row?.content_hash ?? null,
    provenance: row?.provenance ?? null,
  };
}

async function supersede(client: PoolClient, op: OperationRow, code: string): Promise<void> {
  await client.query(
    `UPDATE profile_initial_enrichment_operations
     SET state = 'superseded', failure_code = $2, updated_at = NOW() WHERE id = $1`,
    [op.id, code],
  );
}

function preserveSeed(
  seed: FoundationalProfile | null,
  generated: FoundationalProfile,
): FoundationalProfile {
  if (!seed) return normalizeFoundationalProfile(generated);
  const merged = { ...generated, overallLevel: seed.overallLevel ?? generated.overallLevel };
  for (const key of [
    'primaryGoals',
    'communicationContexts',
    'interestsAndUsefulThemes',
    'stableStrengths',
    'persistentChallenges',
    'studyPreferences',
    'durableConstraints',
  ] as const) {
    merged[key] = [...new Set([...seed[key], ...generated[key]])];
  }
  merged.teacherNotes =
    [seed.teacherNotes, generated.teacherNotes].filter(Boolean).join('\n\n') || null;
  return normalizeFoundationalProfile(merged);
}

async function publishReadyResult(client: PoolClient, op: OperationRow): Promise<void> {
  if (op.state !== 'result_ready' || !op.validated_result) return;
  if (!(await authority(client, op)).valid) {
    await supersede(client, op, 'authority_changed');
    return;
  }
  const content = renderFoundationalProfileContent(op.validated_result);
  const hash = createHash('sha256').update(content, 'utf8').digest('hex');
  if (hash !== op.result_hash) {
    await client.query(
      `UPDATE profile_initial_enrichment_operations
       SET state = 'failed', failure_code = 'result_integrity_invalid', updated_at = NOW() WHERE id = $1`,
      [op.id],
    );
    return;
  }
  const revisionId = randomUUID();
  await client.query(
    `UPDATE profile_revisions SET status = 'deprecated',
       deprecated_at = COALESCE(deprecated_at, NOW()), activated_at = NULL
     WHERE profile_id = $1 AND status = 'active'`,
    [op.profile_id],
  );
  await client.query(
    `INSERT INTO profile_revisions
      (id, profile_id, content, structured_content, content_hash, source, status,
       version_number, version_label, activated_at)
     SELECT $1, $2, $3, $4::jsonb, $5, 'lesson_population', 'active',
       COALESCE(MAX(version_number), 0) + 1,
       'v' || (COALESCE(MAX(version_number), 0) + 1)::text, NOW()
     FROM profile_revisions WHERE profile_id = $2`,
    [revisionId, op.profile_id, content, JSON.stringify(op.validated_result), hash],
  );
  await client.query(
    `UPDATE profiles SET active_revision_id = $2, provenance = 'evidence_enriched',
       initial_enrichment_completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [op.profile_id, revisionId],
  );
  await client.query(
    `UPDATE profile_initial_enrichment_operations
     SET state = 'succeeded', result_revision_id = $2, updated_at = NOW() WHERE id = $1`,
    [op.id, revisionId],
  );
}

async function prepareOrCommit(
  id: string,
  config: BatchBackendConfig,
): Promise<{
  submissionId: string;
  input: GenerationInput;
  provider: string;
  model: string;
} | null> {
  return withTransaction(async (client) => {
    const op = await lockOperation(client, id);
    if (!op) return null;
    if (op.state === 'result_ready') {
      await publishReadyResult(client, op);
      return null;
    }
    if (!['waiting_evidence', 'queued', 'submitting'].includes(op.state)) return null;
    if (op.state === 'submitting') {
      // A replaced source cannot release an unresolved provider reservation.
      // Its late response will validate authority before any publication.
      await client.query(
        `UPDATE profile_initial_enrichment_operations
         SET state = 'uncertain', failure_code = 'submission_unresolved', updated_at = NOW()
         WHERE id = $1 AND submission_reserved_at < NOW() - INTERVAL '${SUBMISSION_UNCERTAIN_AFTER_MINUTES} minutes'`,
        [op.id],
      );
      return null;
    }
    if (!(await authority(client, op)).valid) {
      await supersede(client, op, 'authority_changed');
      return null;
    }
    if (op.state === 'waiting_evidence') {
      const evidence = await client.query<{ id: string; evidence: unknown }>(
        `SELECT lesson_memory_entries.id, to_jsonb(lesson_memory_entries) AS evidence
         FROM lesson_memory_entries WHERE assignment_session_id = $1
           AND student_id = $2 AND recording_id = $3 AND transcript_id = $4
           AND source_storage_uri = $5 AND source_content_hash = $6
           AND status = 'ready'
           AND ${buildCanonicalLessonMemoryAuthoritySqlPredicate('lesson_memory_entries')}
         ORDER BY generated_at DESC LIMIT 1`,
        [
          op.assignment_session_id,
          op.student_id,
          op.recording_id,
          op.transcript_id,
          op.transcript_storage_uri,
          op.transcript_hash,
        ],
      );
      if (!evidence.rows[0]) return null;
      const seed = op.seed_revision_id
        ? await client.query<{ content: string; structured_content: FoundationalProfile | null }>(
            'SELECT content, structured_content FROM profile_revisions WHERE id = $1 AND profile_id = $2',
            [op.seed_revision_id, op.profile_id],
          )
        : null;
      const student = await client.query<{ student: string }>(
        'SELECT student FROM students WHERE id = $1',
        [op.student_id],
      );
      const seedProfile =
        seed?.rows[0]?.structured_content ??
        deriveFoundationalProfileFromMarkdown(seed?.rows[0]?.content ?? '');
      const input: GenerationInput = {
        studentName: student.rows[0]?.student ?? '',
        seed: seedProfile,
        lessonEvidence: evidence.rows[0].evidence,
        prompt: [
          'Create a foundational ESL learner profile from only this canonical lesson evidence.',
          'Preserve every tutor-authored seed fact. Omit unsupported claims. Return schema JSON.',
          `Student: ${student.rows[0]?.student ?? ''}`,
          `Tutor seed: ${JSON.stringify(seedProfile)}`,
          `Confirmed lesson evidence: ${JSON.stringify(evidence.rows[0].evidence)}`,
        ].join('\n'),
        maxOutputTokens: 2800,
      };
      const provider = 'openai';
      const model = config.generation.models.openai.profileDraftPrimary;
      if (!model) {
        await client.query(
          `UPDATE profile_initial_enrichment_operations
           SET state = 'failed', failure_code = 'model_unavailable', updated_at = NOW()
           WHERE id = $1`,
          [op.id],
        );
        return null;
      }
      await client.query(
        `UPDATE profile_initial_enrichment_operations
         SET state = 'queued', lesson_memory_entry_id = $2,
           generation_input = $3::jsonb, generation_provider = $4, generation_model = $5,
           updated_at = NOW() WHERE id = $1`,
        [op.id, evidence.rows[0].id, JSON.stringify(input), provider, model],
      );
      op.generation_input = input;
      op.generation_provider = provider;
      op.generation_model = model;
    }
    if (!op.generation_input || !op.generation_provider || !op.generation_model) return null;
    const submissionId = randomUUID();
    await client.query(
      `UPDATE profile_initial_enrichment_operations SET state = 'submitting',
       submission_id = $2, submission_reserved_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [op.id, submissionId],
    );
    return {
      submissionId,
      input: op.generation_input,
      provider: op.generation_provider,
      model: op.generation_model,
    };
  });
}

export async function reconcileProfileInitialEnrichmentOperation(
  id: string,
  config: BatchBackendConfig,
  generator: typeof generateProfileRevisionDraft = generateProfileRevisionDraft,
): Promise<void> {
  const reserved = await prepareOrCommit(id, config);
  if (!reserved) return;
  let persisted = false;
  const persistResult = async (generatedProfile: FoundationalProfile): Promise<void> => {
    const result = preserveSeed(reserved.input.seed, generatedProfile);
    const content = renderFoundationalProfileContent(result);
    const hash = createHash('sha256').update(content, 'utf8').digest('hex');
    // Keep the validated response in this process through transient database failures.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await withTransaction(async (client) => {
          const op = await lockOperation(client, id);
          if (
            !op ||
            op.submission_id !== reserved.submissionId ||
            (op.state !== 'submitting' && op.state !== 'uncertain')
          )
            return;
          if (!(await authority(client, op)).valid) {
            await supersede(client, op, 'authority_changed');
            return;
          }
          await client.query(
            `UPDATE profile_initial_enrichment_operations
             SET state = 'result_ready', validated_result = $2::jsonb,
               result_hash = $3, failure_code = NULL, updated_at = NOW()
             WHERE id = $1`,
            [id, JSON.stringify(result), hash],
          );
        });
        persisted = true;
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  };
  try {
    const generated = await generator({
      request: {
        prompt: reserved.input.prompt,
        operation: 'lesson_population',
        providerOverride: 'openai',
        modelOverride: reserved.model,
        includeProviderFallbacks: false,
        retryMaxOverride: 0,
        maxOutputTokens: reserved.input.maxOutputTokens,
        onValidatedResponse: async (profile) => {
          if (!('schemaVersion' in profile)) throw new Error('Invalid profile result');
          await persistResult(profile);
        },
      },
      overrides: { config },
    });
    if (!('schemaVersion' in generated.structuredProfile))
      throw new Error('Invalid profile result');
    if (!persisted) await persistResult(generated.structuredProfile);
  } catch (error) {
    if (persisted) {
      await prepareOrCommit(id, config);
      return;
    }
    const safelyBeforeExecution =
      error instanceof ProfileRevisionDraftingError && error.category === 'budget_exceeded';
    // Once reserved, any other provider exception may mean the model executed.
    await withTransaction(async (client) => {
      const op = await lockOperation(client, id);
      if (!op || op.submission_id !== reserved.submissionId || op.state !== 'submitting') return;
      await client.query(
        `UPDATE profile_initial_enrichment_operations
         SET state = $2, submission_id = CASE WHEN $3 THEN NULL ELSE submission_id END,
           submission_reserved_at = CASE WHEN $3 THEN NULL ELSE submission_reserved_at END,
           failure_code = $4, updated_at = NOW() WHERE id = $1`,
        [
          id,
          safelyBeforeExecution ? 'queued' : 'uncertain',
          safelyBeforeExecution,
          safelyBeforeExecution ? 'budget_unavailable' : 'provider_outcome_ambiguous',
        ],
      );
    });
    logger.warn('Initial profile enrichment attempt did not complete', {
      event: safelyBeforeExecution
        ? 'profile_initial_enrichment_deferred'
        : 'profile_initial_enrichment_uncertain',
      operationId: id,
      category: error instanceof Error ? error.name : 'unknown',
    });
    return;
  }
  await prepareOrCommit(id, config);
}

export async function reconcilePendingProfileInitialEnrichments(
  config: BatchBackendConfig,
): Promise<void> {
  const ids = await withPgClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT id FROM profile_initial_enrichment_operations
       WHERE state IN ('waiting_evidence', 'result_ready')
          OR (state = 'queued' AND updated_at < NOW() - INTERVAL '1 minute')
          OR (state = 'submitting' AND submission_reserved_at < NOW() - INTERVAL '15 minutes')
       ORDER BY updated_at ASC LIMIT 50`,
    );
    return result.rows.map((row) => row.id);
  });
  for (const id of ids) {
    try {
      await reconcileProfileInitialEnrichmentOperation(id, config);
    } catch (error) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'profile_initial_enrichment_reconcile_failed',
        operationId: id,
      });
    }
  }
}
