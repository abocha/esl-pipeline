import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { GenerationProvider } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { buildLessonMemoryExecutionSqlPredicate } from '../domain/lesson-memory-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import { createStudentMemoryQueue } from '../infrastructure/student-memory-queue.js';
import {
  deriveFoundationalProfileFromMarkdown,
  type FoundationalProfile,
  normalizeFoundationalProfile,
  renderFoundationalProfileContent,
} from './foundational-profile.js';
import { GenerationBudgetExceededError } from './generation-budget-guard.js';
import { ProviderExecutionError } from './generation-providers.js';
import {
  generateProfileRevisionDraft,
  ProfileRevisionDraftingError,
} from './profile-revision-drafting.js';
import {
  createStudentMemoryGenerationPacer,
  isStudentMemoryPacingDeferredError,
  type StudentMemoryGenerationPacer,
  StudentMemoryPacingDeferredError,
} from './student-memory-generation-pacing.js';

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
  generation_provider: GenerationProvider | null;
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
  seedContent: string | null;
  seedIsStructured: boolean;
  lessonEvidence: unknown;
  prompt: string;
  maxOutputTokens: number;
}

const SUBMISSION_UNCERTAIN_AFTER_MINUTES = 15;
const EVIDENCE_EXHAUSTED_AFTER_HOURS = 24;

export interface ProcessProfileInitialEnrichmentJobPayload {
  kind: 'profile-initial-enrichment';
  operationId: string;
}

export function initialEnrichmentJobId(operationId: string): string {
  return `profile-initial-enrichment-${operationId}`;
}

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
  // Lock order is assignment -> student -> operation, matching Source confirmation.
  const identity = await client.query<OperationRow>(
    'SELECT assignment_session_id, student_id FROM profile_initial_enrichment_operations WHERE id = $1',
    [id],
  );
  if (!identity.rows[0]) return null;
  await client.query('SELECT id FROM assignment_sessions WHERE id = $1 FOR UPDATE', [
    identity.rows[0].assignment_session_id,
  ]);
  await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [
    identity.rows[0].student_id,
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
    student_valid: boolean;
    evidence_valid: boolean;
  }>(
    `SELECT p.profile_provenance AS provenance, pr.id AS active_revision_id, pr.content_hash,
      EXISTS (
        SELECT 1 FROM assignment_sessions a
        JOIN assignment_source_bindings b ON b.assignment_session_id = a.id
        JOIN recordings r ON r.id = $4
        JOIN transcripts t ON t.id = $5
        WHERE a.id = $3 AND a.student_id = $2
          AND NOT historical_assignment_session(a)
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
      (p.archived_at IS NULL) AS student_valid,
      ($11::uuid IS NULL OR EXISTS (
        SELECT 1 FROM lesson_memory_entries
        WHERE lesson_memory_entries.id = $11 AND student_id = $2
          AND assignment_session_id = $3 AND recording_id = $4 AND transcript_id = $5
          AND source_storage_uri = $6 AND source_content_hash = $7
          AND status = 'ready'
          AND ${buildLessonMemoryExecutionSqlPredicate('lesson_memory_entries')}
      )) AS evidence_valid
     FROM students p LEFT JOIN student_profile_revisions pr ON pr.student_id = p.id AND pr.status = 'active'
     WHERE p.id = $1`,
    [
      op.student_id,
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
        row.student_valid &&
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
  seedContent: string | null,
  seedIsStructured: boolean,
  generated: FoundationalProfile,
): FoundationalProfile {
  const merged = { ...generated, overallLevel: seed?.overallLevel ?? generated.overallLevel };
  for (const key of [
    'primaryGoals',
    'communicationContexts',
    'interestsAndUsefulThemes',
    'stableStrengths',
    'persistentChallenges',
    'studyPreferences',
    'durableConstraints',
  ] as const) {
    merged[key] = [...new Set([...(seed?.[key] ?? []), ...generated[key]])];
  }
  merged.teacherNotes =
    [
      seed?.teacherNotes,
      generated.teacherNotes,
      !seedIsStructured && seedContent?.trim()
        ? `Original tutor-authored profile (verbatim):\n${seedContent}`
        : null,
    ]
      .filter(Boolean)
      .join('\n\n') || null;
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
    `UPDATE student_profile_revisions SET status = 'deprecated',
       deprecated_at = COALESCE(deprecated_at, NOW())
     WHERE student_id = $1 AND status = 'active'`,
    [op.student_id],
  );
  await client.query(
    `INSERT INTO student_profile_revisions
      (id, student_id, content, structured_content, content_hash, source, status,
       version_number, version_label, activated_at)
     SELECT $1, $2, $3, $4::jsonb, $5, 'lesson_population', 'active',
       COALESCE(MAX(version_number), 0) + 1,
       'v' || (COALESCE(MAX(version_number), 0) + 1)::text, NOW()
     FROM student_profile_revisions WHERE student_id = $2`,
    [revisionId, op.student_id, content, JSON.stringify(op.validated_result), hash],
  );
  await client.query(
    `UPDATE students SET profile_provenance = 'evidence_enriched',
       profile_initial_enrichment_completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [op.student_id],
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
  reserveSubmission = true,
): Promise<{
  submissionId: string | null;
  input: GenerationInput;
  provider: GenerationProvider;
  model: string;
} | null> {
  return withTransaction(async (client) => {
    const op = await lockOperation(client, id);
    if (!op) return null;
    const historical = await client.query<{ historical: boolean }>(
      'SELECT historical_assignment_session(s) AS historical FROM assignment_sessions s WHERE id = $1',
      [op.assignment_session_id],
    );
    if (historical.rows[0]?.historical) {
      if (
        ['waiting_evidence', 'queued', 'submitting', 'result_ready', 'uncertain'].includes(op.state)
      )
        await supersede(client, op, 'legacy_assignment_read_only');
      return null;
    }
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
           AND ${buildLessonMemoryExecutionSqlPredicate('lesson_memory_entries')}
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
      if (!evidence.rows[0]) {
        const evidenceState = await client.query<{ status: string }>(
          `SELECT status FROM lesson_memory_entries
           WHERE assignment_session_id = $1 AND student_id = $2
             AND recording_id = $3 AND transcript_id = $4
             AND source_storage_uri = $5 AND source_content_hash = $6
           ORDER BY created_at DESC, id DESC LIMIT 1`,
          [
            op.assignment_session_id,
            op.student_id,
            op.recording_id,
            op.transcript_id,
            op.transcript_storage_uri,
            op.transcript_hash,
          ],
        );
        const expired = await client.query<{ expired: boolean }>(
          `SELECT created_at < NOW() - INTERVAL '${EVIDENCE_EXHAUSTED_AFTER_HOURS} hours' AS expired
           FROM profile_initial_enrichment_operations WHERE id = $1`,
          [op.id],
        );
        if (evidenceState.rows[0]?.status === 'failed' || expired.rows[0]?.expired) {
          await client.query(
            `UPDATE profile_initial_enrichment_operations
             SET state = 'failed', failure_code = $2, updated_at = NOW() WHERE id = $1`,
            [
              op.id,
              evidenceState.rows[0]?.status === 'failed'
                ? 'lesson_evidence_failed'
                : 'lesson_evidence_timeout',
            ],
          );
        }
        return null;
      }
      const seed = op.seed_revision_id
        ? await client.query<{ content: string; structured_content: FoundationalProfile | null }>(
            'SELECT content, structured_content FROM student_profile_revisions WHERE id = $1 AND student_id = $2',
            [op.seed_revision_id, op.student_id],
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
        seedContent: seed?.rows[0]?.content ?? null,
        seedIsStructured: seed?.rows[0]?.structured_content != null,
        lessonEvidence: evidence.rows[0].evidence,
        prompt: [
          'Create a foundational ESL learner profile from only this canonical lesson evidence.',
          'Preserve every tutor-authored seed fact. Omit unsupported claims. Return schema JSON.',
          `Student: ${student.rows[0]?.student ?? ''}`,
          `Tutor seed: ${JSON.stringify(seedProfile)}`,
          `Original tutor-authored profile: ${seed?.rows[0]?.content ?? ''}`,
          `Confirmed lesson evidence: ${JSON.stringify(evidence.rows[0].evidence)}`,
        ].join('\n'),
        maxOutputTokens: 2800,
      };
      const { provider, model } = config.generation.targets.profile_revision_drafting;
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
    if (!reserveSubmission) {
      return {
        submissionId: null,
        input: op.generation_input,
        provider: op.generation_provider,
        model: op.generation_model,
      };
    }
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
  pacingOverride?: StudentMemoryGenerationPacer,
): Promise<void> {
  const pacer =
    pacingOverride ??
    (generator === generateProfileRevisionDraft
      ? createStudentMemoryGenerationPacer(config)
      : null);
  const initial = await prepareOrCommit(id, config, !pacer);
  if (!initial) return;
  let reserved = initial;
  let persisted = false;
  const persistResult = async (generatedProfile: FoundationalProfile): Promise<void> => {
    const result = preserveSeed(
      reserved.input.seed,
      reserved.input.seedContent,
      reserved.input.seedIsStructured,
      generatedProfile,
    );
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
    const generate = () =>
      generator({
        request: {
          prompt: reserved.input.prompt,
          operation: 'lesson_population',
          providerOverride: reserved.provider,
          modelOverride: reserved.model,
          budgetReservationAlreadyMade: Boolean(pacer),
          maxOutputTokens: reserved.input.maxOutputTokens,
          onValidatedResponse: async (profile) => {
            if (!('schemaVersion' in profile)) throw new Error('Invalid profile result');
            await persistResult(profile);
          },
        },
        overrides: { config },
      });
    const dispatch = async () => {
      if (!reserved.submissionId) {
        const claimed = await prepareOrCommit(id, config);
        if (!claimed) return { skipped: true as const, usage: undefined };
        reserved = claimed;
      }
      const valid = await withTransaction(async (client) => {
        const op = await lockOperation(client, id);
        if (!op || op.state !== 'submitting' || op.submission_id !== reserved.submissionId)
          return false;
        if (!(await authority(client, op)).valid) {
          await supersede(client, op, 'authority_changed');
          return false;
        }
        return true;
      });
      return valid ? generate() : { skipped: true as const, usage: undefined };
    };
    const generated = pacer
      ? await pacer.run({
          workload: 'profile_initial_enrichment',
          provider: reserved.provider,
          model: reserved.model,
          prompt: reserved.input.prompt,
          maxOutputTokens: reserved.input.maxOutputTokens,
          recordUsage: false,
          execute: dispatch,
        })
      : await dispatch();
    if ('skipped' in generated) return;
    if (!('schemaVersion' in generated.structuredProfile))
      throw new Error('Invalid profile result');
    if (!persisted) await persistResult(generated.structuredProfile);
  } catch (error) {
    if (!reserved.submissionId) {
      // A permanent preflight rejection has not reached the provider. Resolve it
      // durably so the queue does not retry an impossible request forever.
      const retiredTarget =
        error instanceof ProviderExecutionError &&
        (error.code === 'unsupported_provider' || error.code === 'unsupported_model');
      if (error instanceof GenerationBudgetExceededError || retiredTarget) {
        await withTransaction(async (client) => {
          const op = await lockOperation(client, id);
          if (op?.state !== 'queued') return;
          await client.query(
            `UPDATE profile_initial_enrichment_operations
             SET state = 'failed', failure_code = $2, updated_at = NOW()
             WHERE id = $1`,
            [id, retiredTarget ? 'provider_rejected' : 'budget_unavailable'],
          );
        });
        return;
      }
      // Transient pacing and database preflight failures remain retryable.
      throw error;
    }
    if (persisted) {
      await prepareOrCommit(id, config);
      return;
    }
    const rateLimitRejection =
      error instanceof ProfileRevisionDraftingError &&
      error.rejectedBeforeExecution &&
      error.providerStatus === 429;
    const deferred = isStudentMemoryPacingDeferredError(error)
      ? error
      : rateLimitRejection
        ? new StudentMemoryPacingDeferredError({
            reason: 'provider_rate_limit',
            provider: reserved.provider,
            model: reserved.model,
            notBefore: new Date(
              Math.max(
                (Math.floor(Date.now() / 60_000) + 1) * 60_000,
                Date.now() + (error.retryAfterMs ?? 0),
              ),
            ),
            estimatedTokens: 0,
            ...(typeof error.retryAfterMs === 'number' ? { retryAfterMs: error.retryAfterMs } : {}),
          })
        : null;
    const safelyBeforeExecution =
      deferred !== null ||
      error instanceof GenerationBudgetExceededError ||
      (error instanceof ProfileRevisionDraftingError &&
        (error.category === 'budget_exceeded' || error.rejectedBeforeExecution));
    const terminalRejection =
      error instanceof ProfileRevisionDraftingError &&
      error.rejectedBeforeExecution &&
      error.category !== 'provider_rate_limit' &&
      error.category !== 'budget_exceeded';
    // Only outcomes that may have executed without a recoverable result are uncertain.
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
          terminalRejection ? 'failed' : safelyBeforeExecution ? 'queued' : 'uncertain',
          safelyBeforeExecution,
          terminalRejection
            ? 'provider_rejected'
            : deferred
              ? 'generation_deferred'
              : safelyBeforeExecution
                ? 'budget_unavailable'
                : 'provider_outcome_ambiguous',
        ],
      );
    });
    logger.warn('Initial profile enrichment attempt did not complete', {
      event: terminalRejection
        ? 'profile_initial_enrichment_failed'
        : safelyBeforeExecution
          ? 'profile_initial_enrichment_deferred'
          : 'profile_initial_enrichment_uncertain',
      operationId: id,
      category: error instanceof Error ? error.name : 'unknown',
    });
    if (deferred) throw deferred;
    return;
  }
  await prepareOrCommit(id, config);
}

export async function enqueuePendingProfileInitialEnrichments(
  queue: Pick<
    ReturnType<typeof createStudentMemoryQueue>,
    'reconcile'
  > = createStudentMemoryQueue(),
): Promise<void> {
  const ids = await withPgClient(async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT op.id FROM profile_initial_enrichment_operations op
       JOIN assignment_sessions a ON a.id = op.assignment_session_id
       WHERE NOT historical_assignment_session(a) AND (op.state = 'result_ready'
          OR (op.state = 'queued' AND op.updated_at < NOW() - INTERVAL '1 minute')
          OR (op.state = 'submitting' AND op.submission_reserved_at < NOW() - INTERVAL '15 minutes')
          OR (op.state = 'waiting_evidence' AND (
            op.created_at < NOW() - INTERVAL '24 hours'
            OR NOT EXISTS (
              SELECT 1 FROM students p LEFT JOIN student_profile_revisions pr ON pr.student_id = p.id AND pr.status = 'active'
              WHERE p.id = op.student_id AND p.archived_at IS NULL AND p.profile_provenance = 'tutor_only'
                AND pr.id IS NOT DISTINCT FROM op.seed_revision_id
            )
            OR EXISTS (
              SELECT 1 FROM lesson_memory_entries e
              WHERE e.assignment_session_id = op.assignment_session_id
                AND e.student_id = op.student_id AND e.recording_id = op.recording_id
                AND e.transcript_id = op.transcript_id
                AND e.source_storage_uri = op.transcript_storage_uri
                AND e.source_content_hash = op.transcript_hash AND e.status = 'ready'
            )
            OR (
              SELECT e.status FROM lesson_memory_entries e
              WHERE e.assignment_session_id = op.assignment_session_id
                AND e.student_id = op.student_id AND e.recording_id = op.recording_id
                AND e.transcript_id = op.transcript_id
                AND e.source_storage_uri = op.transcript_storage_uri
                AND e.source_content_hash = op.transcript_hash
              ORDER BY e.created_at DESC, e.id DESC LIMIT 1
            ) = 'failed'
          ))
       ) ORDER BY op.created_at DESC LIMIT 50`,
    );
    return result.rows.map((row) => row.id);
  });
  for (const id of ids) {
    try {
      await queue.reconcile(
        { kind: 'profile-initial-enrichment', operationId: id },
        { jobId: initialEnrichmentJobId(id), requeueCompleted: true },
      );
    } catch (error) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'profile_initial_enrichment_enqueue_failed',
        operationId: id,
      });
    }
  }
}
