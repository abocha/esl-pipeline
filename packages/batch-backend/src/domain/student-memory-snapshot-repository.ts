import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { StudentMemoryAvailability } from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import { buildVerifiedHomeworkMemoryEvidenceSqlPredicate } from './homework-memory-repository.js';
import type { StudentFact } from './lesson-memory-model.js';
import { buildVerifiedLessonMemoryEvidenceSqlPredicate } from './lesson-memory-repository.js';
import {
  readStudentMemoryCurrentness,
  type StudentMemoryCurrentness,
} from './student-memory-currentness.js';
import {
  StudentMemoryConfidenceSchema,
  StudentMemoryIssueTypeSchema,
  type StudentMemoryLabeledNote,
  StudentMemoryPrioritySchema,
  type StudentMemoryRecommendedAssignmentDirection,
  type StudentMemoryRecurringIssue,
  type StudentMemorySnapshotGenerationNotes,
  type StudentMemorySnapshotRecord,
  StudentMemorySnapshotSourceKindSchema,
  type StudentMemorySnapshotStatus,
  StudentMemorySnapshotStatusSchema,
  type StudentMemoryUnresolvedIssue,
} from './student-memory-snapshot-model.js';

interface StudentMemorySnapshotRow {
  id: string;
  student_id: string;
  schema_version: string;
  generated_at: Date;
  provider: string;
  model: string;
  status: string;
  source_kind: string;
  lesson_memory_entry_ids: string[] | null;
  homework_memory_entry_ids: string[] | null;
  content_hash: string | null;
  generation_notes: StudentMemorySnapshotGenerationNotes | null;
  stable_strengths: StudentMemoryLabeledNote[] | null;
  recurring_issues: StudentMemoryRecurringIssue[] | null;
  active_review_backlog: StudentMemoryLabeledNote[] | null;
  recent_progress: StudentMemoryLabeledNote[] | null;
  personal_facts: StudentFact[] | null;
  recommended_assignment_directions: StudentMemoryRecommendedAssignmentDirection[] | null;
  unresolved_issues: StudentMemoryUnresolvedIssue[] | null;
  snapshot_summary: string | null;
  superseded_by_id: string | null;
  superseded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertStudentMemorySnapshotParams {
  id?: string;
  studentId: string;
  schemaVersion: string;
  generatedAt?: Date;
  provider: string;
  model: string;
  status: StudentMemorySnapshotStatus;
  lessonMemoryEntryIds?: string[];
  homeworkMemoryEntryIds?: string[];
  contentHash?: string | null;
  generationNotes?: StudentMemorySnapshotGenerationNotes | null;
  stableStrengths?: StudentMemoryLabeledNote[];
  recurringIssues?: StudentMemoryRecurringIssue[];
  activeReviewBacklog?: StudentMemoryLabeledNote[];
  recentProgress?: StudentMemoryLabeledNote[];
  personalFacts?: StudentFact[];
  recommendedAssignmentDirections?: StudentMemoryRecommendedAssignmentDirection[];
  unresolvedIssues?: StudentMemoryUnresolvedIssue[];
  snapshotSummary?: string | null;
}

export type InsertCanonicalReadyStudentMemorySnapshotParams = Omit<
  InsertStudentMemorySnapshotParams,
  'status'
> & {
  expectedLatestReadySnapshotId?: string | null;
  pendingEntryId?: string | null;
  expectedCurrentness?: StudentMemoryCurrentness;
};

export class StudentMemorySnapshotIntentObsoleteError extends Error {
  constructor() {
    super('Snapshot intent is cancelled, superseded, or its source/current snapshot state changed');
    this.name = 'StudentMemorySnapshotIntentObsoleteError';
  }
}

export class StudentMemorySnapshotRepairRequiredError extends Error {
  constructor() {
    super('Established student-memory history requires an explicitly authorized full rebuild.');
    this.name = 'StudentMemorySnapshotRepairRequiredError';
  }
}

export interface StudentMemorySnapshotSelection {
  snapshot: StudentMemorySnapshotRecord | null;
  availability: StudentMemoryAvailability;
}

// Successful result rows survive supersession. Pending/failed/cancelled first intents
// alone do not establish an aggregate. Older rows without notes are classified from
// retained successful output/history, without guessing or backfilling provenance.
function buildEstablishedSnapshotSqlPredicate(alias: string): string {
  return `(${alias}.status = 'ready' OR (${alias}.status = 'superseded' AND (
    ${alias}.content_hash IS NOT NULL OR ${alias}.snapshot_summary IS NOT NULL
    OR ${alias}.generation_notes ->> 'pendingEntryId' IS NOT NULL
    OR jsonb_array_length(COALESCE(${alias}.stable_strengths, '[]'::jsonb)) > 0
    OR jsonb_array_length(COALESCE(${alias}.recurring_issues, '[]'::jsonb)) > 0
    OR jsonb_array_length(COALESCE(${alias}.personal_facts, '[]'::jsonb)) > 0
    OR ${alias}.generation_notes ->> 'continuityReason' = 'source_invalidated'
  )))`;
}

/** One statement gives consumers a coherent read-only selection and explanation. */
export async function readStudentMemorySnapshotSelection(
  client: PoolClient,
  studentId: string,
): Promise<StudentMemorySnapshotSelection> {
  const lineage = buildEligibleStudentMemorySnapshotLineageSqlPredicate('snapshot');
  const result = await client.query<StudentMemorySnapshotRow & { eligible: boolean }>(
    `SELECT snapshot.*, (snapshot.status = 'ready' AND ${lineage}) AS eligible
     FROM student_memory_snapshots snapshot
     WHERE snapshot.student_id = $1 AND ${buildEstablishedSnapshotSqlPredicate('snapshot')}
     ORDER BY (snapshot.status = 'ready' AND ${lineage}) DESC,
       snapshot.generated_at DESC, snapshot.created_at DESC, snapshot.id DESC LIMIT 1`,
    [studentId],
  );
  const row = result.rows[0];
  return {
    snapshot: row?.eligible ? mapRowToStudentMemorySnapshot(row) : null,
    availability: {
      state: row ? (row.eligible ? 'available' : 'repair_required') : 'absent',
      reason: row
        ? row.eligible
          ? 'verified_lineage'
          : 'established_history_ineligible'
        : 'no_established_snapshot',
      lessonReferenceCount: row?.lesson_memory_entry_ids?.length ?? 0,
      homeworkReferenceCount: row?.homework_memory_entry_ids?.length ?? 0,
    },
  };
}

export async function getStudentMemorySnapshotSelection(
  studentId: string,
): Promise<StudentMemorySnapshotSelection> {
  return withPgClient((client) => readStudentMemorySnapshotSelection(client, studentId));
}

/** Persist blocked refreshes under the same lock as source invalidation/publication. */
export async function markStudentMemorySnapshotRepairRequired(
  studentId: string,
  intentId: string,
): Promise<void> {
  await withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [studentId]);
      if (
        (await readStudentMemorySnapshotSelection(client, studentId)).availability.state !==
        'repair_required'
      ) {
        await client.query('COMMIT');
        return;
      }
      await client.query(
        `UPDATE student_memory_snapshots SET status = 'failed',
         generation_notes = COALESCE(generation_notes, '{}'::jsonb) ||
           jsonb_build_object('continuityReason', 'repair_required', 'errorMessage', 'Established memory history requires explicit full rebuild'),
         updated_at = NOW() WHERE id = $1 AND student_id = $2 AND status = 'pending'`,
        [intentId, studentId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export class StudentMemorySnapshotParentChangedError extends Error {
  readonly studentId: string;
  readonly expectedLatestReadySnapshotId: string | null;
  readonly actualLatestReadySnapshotId: string | null;

  constructor(args: {
    studentId: string;
    expectedLatestReadySnapshotId: string | null;
    actualLatestReadySnapshotId: string | null;
  }) {
    super(
      `Latest ready student-memory snapshot changed before finalize for student ${args.studentId}: expected ${args.expectedLatestReadySnapshotId ?? 'none'}, actual ${args.actualLatestReadySnapshotId ?? 'none'}`,
    );
    this.name = 'StudentMemorySnapshotParentChangedError';
    this.studentId = args.studentId;
    this.expectedLatestReadySnapshotId = args.expectedLatestReadySnapshotId;
    this.actualLatestReadySnapshotId = args.actualLatestReadySnapshotId;
  }
}

export class StudentMemorySnapshotSourcesChangedError extends Error {
  constructor(
    readonly unavailableLessonMemoryEntryIds: string[],
    readonly unavailableHomeworkMemoryEntryIds: string[] = [],
  ) {
    super(
      `Memory sources changed before student-memory snapshot finalize: lessons ${unavailableLessonMemoryEntryIds.join(', ')}; homework ${unavailableHomeworkMemoryEntryIds.join(', ')}`,
    );
    this.name = 'StudentMemorySnapshotSourcesChangedError';
  }
}

export interface EnsurePendingStudentMemorySnapshotParams {
  id?: string;
  studentId: string;
  schemaVersion: string;
  generatedAt?: Date;
  provider: string;
  model: string;
  generationNotes?: StudentMemorySnapshotGenerationNotes | null;
  sourceEntryId?: string | null;
  reuseReadyHomeworkSource?: boolean;
  reuseReadyLessonSource?: boolean;
  replayKey?: string;
}

export interface EnsurePendingStudentMemorySnapshotResult {
  outcome: 'created' | 'pending_exists' | 'already_reconciled';
  entry: StudentMemorySnapshotRecord;
}

export interface ListStudentMemorySnapshotsOptions {
  studentId?: string | null;
  statuses?: StudentMemorySnapshotStatus[];
  limit: number;
  offset: number;
  order?: 'asc' | 'desc';
}

export function buildEligibleStudentMemorySnapshotLineageSqlPredicate(
  snapshotAlias: string,
): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(snapshotAlias)) {
    throw new Error('Invalid student-memory snapshot SQL alias');
  }

  const canonicalLesson = buildVerifiedLessonMemoryEvidenceSqlPredicate('eligible_lesson');
  return `NOT EXISTS (
    SELECT 1
    FROM unnest(${snapshotAlias}.lesson_memory_entry_ids) AS source(lesson_memory_entry_id)
    LEFT JOIN lesson_memory_entries AS eligible_lesson
      ON eligible_lesson.id = source.lesson_memory_entry_id
     AND eligible_lesson.student_id = ${snapshotAlias}.student_id
     AND eligible_lesson.status = 'ready'
     AND eligible_lesson.source_content_hash IS NOT NULL
     AND ${canonicalLesson}
    WHERE eligible_lesson.id IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM unnest(${snapshotAlias}.homework_memory_entry_ids) AS source(homework_memory_entry_id)
    LEFT JOIN homework_memory_entries AS eligible_homework
      ON eligible_homework.id = source.homework_memory_entry_id
     AND eligible_homework.student_id = ${snapshotAlias}.student_id
     AND eligible_homework.status = 'ready'
     AND ${buildVerifiedHomeworkMemoryEvidenceSqlPredicate('eligible_homework')}
    WHERE eligible_homework.id IS NULL
  )`;
}

/** Candidate opportunities survive aggregate supersession, but never source invalidation. */
export function buildProfileCandidateSourceSnapshotSqlPredicate(snapshotAlias: string): string {
  const lineage = buildEligibleStudentMemorySnapshotLineageSqlPredicate(snapshotAlias);
  return `(
    ${snapshotAlias}.status = 'ready' OR (
      ${snapshotAlias}.status = 'superseded'
      AND ${buildEstablishedSnapshotSqlPredicate(snapshotAlias)}
      AND ${snapshotAlias}.generation_notes ->> 'continuityReason' IS NULL
      AND EXISTS (
        SELECT 1 FROM student_memory_snapshots AS candidate_successor
        WHERE candidate_successor.id = ${snapshotAlias}.superseded_by_id
          AND candidate_successor.id <> ${snapshotAlias}.id
          AND candidate_successor.student_id = ${snapshotAlias}.student_id
          AND ${buildEstablishedSnapshotSqlPredicate('candidate_successor')}
      )
    )
  ) AND ${snapshotAlias}.generation_notes ->> 'obsoleteReason' IS NULL
    AND COALESCE(${snapshotAlias}.generation_notes ->> 'continuityReason', '') <> 'source_invalidated'
    AND ${lineage}`;
}

export async function ensurePendingStudentMemorySnapshot(
  params: EnsurePendingStudentMemorySnapshotParams,
): Promise<EnsurePendingStudentMemorySnapshotResult> {
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  return withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [params.studentId]);

      if (params.replayKey) {
        const existing = await client.query<StudentMemorySnapshotRow>(
          `SELECT * FROM student_memory_snapshots WHERE student_id = $1
           AND generation_notes ->> 'replayKey' = $2
           AND generation_notes ->> 'pendingEntryId' IS NULL`,
          [params.studentId, params.replayKey],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].status === 'failed') {
            await client.query(
              `UPDATE student_memory_snapshots SET status = 'pending', updated_at = NOW() WHERE id = $1`,
              [existing.rows[0].id],
            );
            existing.rows[0].status = 'pending';
          }
          await client.query('COMMIT');
          return {
            outcome:
              existing.rows[0].status === 'pending' ? 'pending_exists' : 'already_reconciled',
            entry: mapRowToStudentMemorySnapshot(existing.rows[0]),
          };
        }
        // A new explicit manual replay replaces older manual intent, never online intent.
        await client.query(
          `UPDATE student_memory_snapshots SET status = 'superseded',
          generation_notes = COALESCE(generation_notes, '{}'::jsonb) || jsonb_build_object('obsoleteReason', 'new_manual_replay'),
          updated_at = NOW() WHERE student_id = $1 AND status IN ('pending', 'failed')
          AND generation_notes ->> 'trigger' = 'manual-replay'`,
          [params.studentId],
        );
        params = {
          ...params,
          generationNotes: {
            ...params.generationNotes,
            replayKey: params.replayKey,
            currentness: await readStudentMemoryCurrentness(client, params.studentId),
          },
        };
      }

      if (params.reuseReadyLessonSource && params.sourceEntryId) {
        const source = await client.query(
          `SELECT id FROM lesson_memory_entries AS lesson
           WHERE lesson.id = $1 AND lesson.student_id = $2 AND lesson.status = 'ready'
             AND ${buildVerifiedLessonMemoryEvidenceSqlPredicate('lesson')}`,
          [params.sourceEntryId, params.studentId],
        );
        if (!source.rows[0]) throw new StudentMemorySnapshotIntentObsoleteError();
      }
      if (params.reuseReadyHomeworkSource && params.sourceEntryId) {
        const source = await client.query(
          `SELECT id FROM homework_memory_entries AS homework
           WHERE homework.id = $1 AND homework.student_id = $2 AND homework.status = 'ready'
             AND ${buildVerifiedHomeworkMemoryEvidenceSqlPredicate('homework')}`,
          [params.sourceEntryId, params.studentId],
        );
        if (!source.rows[0]) throw new StudentMemorySnapshotIntentObsoleteError();
      }

      if (
        (params.reuseReadyHomeworkSource || params.reuseReadyLessonSource) &&
        params.sourceEntryId
      ) {
        const eligibleLineage = buildEligibleStudentMemorySnapshotLineageSqlPredicate('snapshot');
        const readyResult = await client.query<StudentMemorySnapshotRow>(
          `
          SELECT
            id,
            student_id,
            schema_version,
            generated_at,
            provider,
            model,
            status,
            source_kind,
            lesson_memory_entry_ids,
            homework_memory_entry_ids,
            content_hash,
            generation_notes,
            stable_strengths,
            recurring_issues,
            active_review_backlog,
            recent_progress,
            personal_facts,
            recommended_assignment_directions,
            unresolved_issues,
            snapshot_summary,
            superseded_by_id,
            superseded_at,
            created_at,
            updated_at
          FROM student_memory_snapshots AS snapshot
          WHERE snapshot.student_id = $1
            AND snapshot.status = 'ready'
            AND ($2::uuid = ANY(snapshot.${params.reuseReadyLessonSource ? 'lesson' : 'homework'}_memory_entry_ids)
              OR snapshot.generation_notes ->> 'sourceEntryId' = $2::text)
            AND ${eligibleLineage}
          ORDER BY snapshot.generated_at DESC, snapshot.created_at DESC, snapshot.id DESC
          LIMIT 1
          `,
          [params.studentId, params.sourceEntryId],
        );
        const ready = readyResult.rows[0];
        if (ready) {
          await client.query(
            `
            UPDATE student_memory_snapshots
            SET
              status = 'superseded',
              superseded_by_id = $1,
              superseded_at = $2,
              updated_at = NOW()
            WHERE student_id = $3
              AND status = 'pending'
              AND generation_notes ->> 'sourceEntryId' = $4
            `,
            [ready.id, generatedAt, params.studentId, params.sourceEntryId],
          );
          await client.query('COMMIT');
          return {
            outcome: 'already_reconciled',
            entry: mapRowToStudentMemorySnapshot(ready),
          };
        }
      }

      if (params.sourceEntryId) {
        const terminal = await client.query<StudentMemorySnapshotRow>(
          `SELECT * FROM student_memory_snapshots WHERE student_id = $1
           AND generation_notes ->> 'sourceEntryId' = $2
           AND (status = 'superseded' OR ($3 AND status IN ('failed', 'ready')))
           AND generation_notes ->> 'pendingEntryId' IS NULL
           ORDER BY created_at DESC, id DESC LIMIT 1`,
          [
            params.studentId,
            params.sourceEntryId,
            params.reuseReadyLessonSource === true || params.reuseReadyHomeworkSource === true,
          ],
        );
        if (terminal.rows[0]) {
          await client.query('COMMIT');
          return {
            outcome: 'already_reconciled',
            entry: mapRowToStudentMemorySnapshot(terminal.rows[0]),
          };
        }
        const pendingResult = await client.query<StudentMemorySnapshotRow>(
          `
          SELECT
            id,
            student_id,
            schema_version,
            generated_at,
            provider,
            model,
            status,
            source_kind,
            lesson_memory_entry_ids,
            homework_memory_entry_ids,
            content_hash,
            generation_notes,
            stable_strengths,
            recurring_issues,
            active_review_backlog,
            recent_progress,
            personal_facts,
            recommended_assignment_directions,
            unresolved_issues,
            snapshot_summary,
            superseded_by_id,
            superseded_at,
            created_at,
            updated_at
          FROM student_memory_snapshots
          WHERE student_id = $1
            AND status = 'pending'
            AND generation_notes ->> 'sourceEntryId' = $2
          ORDER BY generated_at DESC, created_at DESC, id DESC
          LIMIT 1
          `,
          [params.studentId, params.sourceEntryId],
        );

        const latestPending = pendingResult.rows[0];
        if (latestPending) {
          await client.query('COMMIT');
          return {
            outcome: 'pending_exists',
            entry: mapRowToStudentMemorySnapshot(latestPending),
          };
        }
      }

      const insertResult = await client.query<StudentMemorySnapshotRow>(
        `
        INSERT INTO student_memory_snapshots (
          id,
          student_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          lesson_memory_entry_ids,
          homework_memory_entry_ids,
          content_hash,
          generation_notes,
          stable_strengths,
          recurring_issues,
          active_review_backlog,
          recent_progress,
          personal_facts,
          recommended_assignment_directions,
          unresolved_issues,
          snapshot_summary
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, 'pending', 'student_memory_rollup', $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18
        )
        RETURNING
          id,
          student_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          lesson_memory_entry_ids,
          homework_memory_entry_ids,
          content_hash,
          generation_notes,
          stable_strengths,
          recurring_issues,
          active_review_backlog,
          recent_progress,
          personal_facts,
          recommended_assignment_directions,
          unresolved_issues,
          snapshot_summary,
          superseded_by_id,
          superseded_at,
          created_at,
          updated_at
        `,
        [
          id,
          params.studentId,
          params.schemaVersion,
          generatedAt,
          params.provider,
          params.model,
          [],
          [],
          null,
          params.generationNotes ?? null,
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          null,
        ],
      );

      const insertedRow = insertResult.rows[0];
      if (!insertedRow) {
        throw new Error('Failed to insert pending student-memory snapshot');
      }

      await client.query('COMMIT');
      const inserted = mapRowToStudentMemorySnapshot(insertedRow);
      logger.info('Pending student memory snapshot inserted', {
        studentMemorySnapshotId: inserted.id,
        studentId: params.studentId,
      });
      return {
        outcome: 'created',
        entry: inserted,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function insertStudentMemorySnapshot(
  params: InsertStudentMemorySnapshotParams,
): Promise<StudentMemorySnapshotRecord> {
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO student_memory_snapshots (
        id,
        student_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        lesson_memory_entry_ids,
        homework_memory_entry_ids,
        content_hash,
        generation_notes,
        stable_strengths,
        recurring_issues,
        active_review_backlog,
        recent_progress,
        personal_facts,
        recommended_assignment_directions,
        unresolved_issues,
        snapshot_summary
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, 'student_memory_rollup', $8, $9, $10, $11,
        $12, $13, $14, $15, $16, $17, $18, $19
      )
      RETURNING
        id,
        student_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        lesson_memory_entry_ids,
        homework_memory_entry_ids,
        content_hash,
        generation_notes,
        stable_strengths,
        recurring_issues,
        active_review_backlog,
        recent_progress,
        personal_facts,
        recommended_assignment_directions,
        unresolved_issues,
        snapshot_summary,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      `,
      [
        id,
        params.studentId,
        params.schemaVersion,
        generatedAt,
        params.provider,
        params.model,
        params.status,
        params.lessonMemoryEntryIds ?? [],
        params.homeworkMemoryEntryIds ?? [],
        params.contentHash ?? null,
        params.generationNotes ?? null,
        JSON.stringify(params.stableStrengths ?? []),
        JSON.stringify(params.recurringIssues ?? []),
        JSON.stringify(params.activeReviewBacklog ?? []),
        JSON.stringify(params.recentProgress ?? []),
        JSON.stringify(params.personalFacts ?? []),
        JSON.stringify(params.recommendedAssignmentDirections ?? []),
        JSON.stringify(params.unresolvedIssues ?? []),
        params.snapshotSummary ?? null,
      ],
    );
    return result.rows[0];
  });

  logger.info('Student memory snapshot inserted', {
    studentMemorySnapshotId: id,
    studentId: params.studentId,
    status: params.status,
  });

  return mapRowToStudentMemorySnapshot(row);
}

export async function insertCanonicalReadyStudentMemorySnapshot(
  params: InsertCanonicalReadyStudentMemorySnapshotParams,
  options?: { client?: PoolClient },
): Promise<StudentMemorySnapshotRecord> {
  if (params.pendingEntryId) {
    if (options?.client) throw new Error('Ordinary snapshot finalization owns its transaction');
    return finalizePendingStudentMemorySnapshot(params);
  }
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  const write = async (client: PoolClient) => {
    if (!options?.client) await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [params.studentId]);

      const requestedLessonIds = [...new Set(params.lessonMemoryEntryIds ?? [])];
      const selection = await readStudentMemorySnapshotSelection(client, params.studentId);
      if (
        selection.availability.state === 'repair_required' &&
        !(
          params.generationNotes?.trigger === 'manual-replay' &&
          ['full_rebuild_v1', 'manual_rebuild_v1_1'].includes(
            String(params.generationNotes?.strategy),
          ) &&
          params.generationNotes?.replayKey &&
          params.generationNotes?.operatorReason
        )
      )
        throw new StudentMemorySnapshotRepairRequiredError();
      if (requestedLessonIds.length > 0) {
        const readyLessonResult = await client.query<{ id: string }>(
          `SELECT lesson_memory_entries.id FROM lesson_memory_entries
           WHERE lesson_memory_entries.student_id = $1
             AND lesson_memory_entries.id = ANY($2::uuid[])
             AND lesson_memory_entries.status = 'ready'
             AND lesson_memory_entries.source_content_hash IS NOT NULL
             AND ${buildVerifiedLessonMemoryEvidenceSqlPredicate('lesson_memory_entries')}
           `,
          [params.studentId, requestedLessonIds],
        );
        const readyLessonIds = new Set(readyLessonResult.rows.map((row) => row.id));
        const unavailableLessonIds = requestedLessonIds.filter((id) => !readyLessonIds.has(id));
        if (unavailableLessonIds.length > 0) {
          throw new StudentMemorySnapshotSourcesChangedError(unavailableLessonIds);
        }
      }

      const requestedHomeworkIds = [...new Set(params.homeworkMemoryEntryIds ?? [])];
      if (requestedHomeworkIds.length > 0) {
        const readyHomeworkResult = await client.query<{ id: string }>(
          `SELECT homework.id FROM homework_memory_entries homework
           WHERE homework.student_id = $1 AND homework.id = ANY($2::uuid[])
             AND homework.status = 'ready'
             AND ${buildVerifiedHomeworkMemoryEvidenceSqlPredicate('homework')}`,
          [params.studentId, requestedHomeworkIds],
        );
        const readyHomeworkIds = new Set(readyHomeworkResult.rows.map((row) => row.id));
        const unavailableHomeworkIds = requestedHomeworkIds.filter(
          (id) => !readyHomeworkIds.has(id),
        );
        if (unavailableHomeworkIds.length > 0)
          throw new StudentMemorySnapshotSourcesChangedError([], unavailableHomeworkIds);
      }

      if (params.expectedLatestReadySnapshotId !== undefined) {
        const eligibleLineage = buildEligibleStudentMemorySnapshotLineageSqlPredicate('snapshot');
        const latestResult = await client.query<{ id: string }>(
          `
          SELECT snapshot.id
          FROM student_memory_snapshots AS snapshot
          WHERE snapshot.student_id = $1
            AND snapshot.status = 'ready'
            AND ${eligibleLineage}
          ORDER BY snapshot.generated_at DESC, snapshot.created_at DESC, snapshot.id DESC
          LIMIT 1
          `,
          [params.studentId],
        );
        const actualLatestReadySnapshotId = latestResult.rows[0]?.id ?? null;
        if (actualLatestReadySnapshotId !== params.expectedLatestReadySnapshotId) {
          throw new StudentMemorySnapshotParentChangedError({
            studentId: params.studentId,
            expectedLatestReadySnapshotId: params.expectedLatestReadySnapshotId,
            actualLatestReadySnapshotId,
          });
        }
      }

      const insertResult = await client.query(
        `
        INSERT INTO student_memory_snapshots (
          id,
          student_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          lesson_memory_entry_ids,
          homework_memory_entry_ids,
          content_hash,
          generation_notes,
          stable_strengths,
          recurring_issues,
          active_review_backlog,
          recent_progress,
          personal_facts,
          recommended_assignment_directions,
          unresolved_issues,
          snapshot_summary
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, 'ready', 'student_memory_rollup', $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18
        )
        RETURNING
          id,
          student_id,
          schema_version,
          generated_at,
          provider,
          model,
          status,
          source_kind,
          lesson_memory_entry_ids,
          homework_memory_entry_ids,
          content_hash,
          generation_notes,
          stable_strengths,
          recurring_issues,
          active_review_backlog,
          recent_progress,
          personal_facts,
          recommended_assignment_directions,
          unresolved_issues,
          snapshot_summary,
          superseded_by_id,
          superseded_at,
          created_at,
          updated_at
        `,
        [
          id,
          params.studentId,
          params.schemaVersion,
          generatedAt,
          params.provider,
          params.model,
          params.lessonMemoryEntryIds ?? [],
          params.homeworkMemoryEntryIds ?? [],
          params.contentHash ?? null,
          params.generationNotes ?? null,
          JSON.stringify(params.stableStrengths ?? []),
          JSON.stringify(params.recurringIssues ?? []),
          JSON.stringify(params.activeReviewBacklog ?? []),
          JSON.stringify(params.recentProgress ?? []),
          JSON.stringify(params.personalFacts ?? []),
          JSON.stringify(params.recommendedAssignmentDirections ?? []),
          JSON.stringify(params.unresolvedIssues ?? []),
          params.snapshotSummary ?? null,
        ],
      );

      await client.query(
        `
        UPDATE student_memory_snapshots
        SET
          status = 'superseded',
          superseded_by_id = $1,
          superseded_at = $2,
          updated_at = NOW()
        WHERE student_id = $3
          AND status = 'ready'
          AND id <> $1
        `,
        [id, generatedAt, params.studentId],
      );

      if (!options?.client) await client.query('COMMIT');
      return insertResult.rows[0];
    } catch (error) {
      if (!options?.client) await client.query('ROLLBACK');
      throw error;
    }
  };
  const row = options?.client ? await write(options.client) : await withPgClient(write);

  logger.info('Canonical ready student memory snapshot inserted', {
    studentMemorySnapshotId: id,
    studentId: params.studentId,
  });

  return mapRowToStudentMemorySnapshot(row);
}

export async function insertCanonicalReadyStudentMemorySnapshotWithinTransaction(
  client: PoolClient,
  params: InsertCanonicalReadyStudentMemorySnapshotParams,
): Promise<StudentMemorySnapshotRecord> {
  return insertCanonicalReadyStudentMemorySnapshot(params, { client });
}

export async function admitStudentMemorySnapshotIntent(params: {
  studentId: string;
  pendingEntryId: string;
  expectedCurrentness: StudentMemoryCurrentness;
}): Promise<boolean> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [params.studentId]);
      const intent = (
        await client.query<StudentMemorySnapshotRow>(
          'SELECT * FROM student_memory_snapshots WHERE id = $1 AND student_id = $2 FOR UPDATE',
          [params.pendingEntryId, params.studentId],
        )
      ).rows[0];
      if (intent?.status !== 'pending') {
        await client.query('COMMIT');
        return false;
      }
      const current = await readStudentMemoryCurrentness(client, params.studentId);
      const admitted =
        current.sourceState === params.expectedCurrentness.sourceState &&
        current.latestReadySnapshotId === params.expectedCurrentness.latestReadySnapshotId;
      if (!admitted)
        await client.query(
          `UPDATE student_memory_snapshots SET status = 'superseded',
        generation_notes = COALESCE(generation_notes, '{}'::jsonb) || jsonb_build_object('obsoleteReason', 'memory_state_changed'),
        updated_at = NOW() WHERE id = $1`,
          [intent.id],
        );
      await client.query('COMMIT');
      return admitted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function finalizePendingStudentMemorySnapshot(
  params: InsertCanonicalReadyStudentMemorySnapshotParams,
): Promise<StudentMemorySnapshotRecord> {
  const result = await withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [params.studentId]);
      const intent = (
        await client.query<StudentMemorySnapshotRow>(
          'SELECT * FROM student_memory_snapshots WHERE id = $1 FOR UPDATE',
          [params.pendingEntryId],
        )
      ).rows[0];
      if (intent?.student_id === params.studentId && intent.superseded_by_id) {
        const completed = (
          await client.query<StudentMemorySnapshotRow>(
            `SELECT * FROM student_memory_snapshots WHERE id = $1 AND student_id = $2
           AND generation_notes ->> 'pendingEntryId' = $3`,
            [intent.superseded_by_id, params.studentId, intent.id],
          )
        ).rows[0];
        if (completed) {
          await client.query('COMMIT');
          return mapRowToStudentMemorySnapshot(completed);
        }
      }
      if (!intent || intent.student_id !== params.studentId || intent.status !== 'pending') {
        await client.query('COMMIT');
        return null;
      }
      if (
        intent.provider !== params.provider ||
        intent.model !== params.model ||
        !params.expectedCurrentness
      ) {
        throw new Error('Snapshot finalization requires the frozen target and currentness');
      }
      const current = await readStudentMemoryCurrentness(client, params.studentId);
      if (
        current.sourceState !== params.expectedCurrentness.sourceState ||
        current.latestReadySnapshotId !== params.expectedCurrentness.latestReadySnapshotId
      ) {
        await client.query(
          `UPDATE student_memory_snapshots SET status = 'superseded',
          generation_notes = COALESCE(generation_notes, '{}'::jsonb) || jsonb_build_object('obsoleteReason', 'memory_state_changed'),
          updated_at = NOW() WHERE id = $1`,
          [intent.id],
        );
        await client.query('COMMIT');
        return null;
      }
      const snapshot = await insertCanonicalReadyStudentMemorySnapshot(
        {
          ...params,
          pendingEntryId: null,
          generationNotes: {
            ...intent.generation_notes,
            ...params.generationNotes,
            pendingEntryId: intent.id,
          },
        },
        { client },
      );
      await client.query(
        `UPDATE student_memory_snapshots SET status = 'superseded',
        superseded_by_id = $2, superseded_at = $3, updated_at = NOW() WHERE id = $1`,
        [intent.id, snapshot.id, snapshot.generatedAt],
      );
      await client.query('COMMIT');
      return snapshot;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
  if (!result) throw new StudentMemorySnapshotIntentObsoleteError();
  return result;
}

export async function getStudentMemorySnapshotById(
  id: string,
): Promise<StudentMemorySnapshotRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        id,
        student_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        lesson_memory_entry_ids,
        homework_memory_entry_ids,
        content_hash,
        generation_notes,
        stable_strengths,
        recurring_issues,
        active_review_backlog,
        recent_progress,
        personal_facts,
        recommended_assignment_directions,
        unresolved_issues,
        snapshot_summary,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      FROM student_memory_snapshots
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0];
  });

  return row ? mapRowToStudentMemorySnapshot(row) : null;
}

export async function getLatestReadyStudentMemorySnapshotByStudentId(
  studentId: string,
): Promise<StudentMemorySnapshotRecord | null> {
  return (await getStudentMemorySnapshotSelection(studentId)).snapshot;
}

export async function getEligibleReadyStudentMemorySnapshotById(
  id: string,
): Promise<StudentMemorySnapshotRecord | null> {
  const eligibleLineage = buildEligibleStudentMemorySnapshotLineageSqlPredicate('snapshot');
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<StudentMemorySnapshotRow>(
      `
      SELECT
        id,
        student_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        lesson_memory_entry_ids,
        homework_memory_entry_ids,
        content_hash,
        generation_notes,
        stable_strengths,
        recurring_issues,
        active_review_backlog,
        recent_progress,
        personal_facts,
        recommended_assignment_directions,
        unresolved_issues,
        snapshot_summary,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      FROM student_memory_snapshots AS snapshot
      WHERE snapshot.id = $1
        AND snapshot.status = 'ready'
        AND ${eligibleLineage}
      `,
      [id],
    );
    return result.rows[0];
  });

  return row ? mapRowToStudentMemorySnapshot(row) : null;
}

export async function getProfileCandidateSourceStudentMemorySnapshotById(
  id: string,
): Promise<StudentMemorySnapshotRecord | null> {
  const predicate = buildProfileCandidateSourceSnapshotSqlPredicate('snapshot');
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<StudentMemorySnapshotRow>(
      `SELECT snapshot.* FROM student_memory_snapshots AS snapshot
       WHERE snapshot.id = $1 AND ${predicate}`,
      [id],
    );
    return result.rows[0];
  });
  return row ? mapRowToStudentMemorySnapshot(row) : null;
}

export async function supersedePendingStudentMemorySnapshotsForStudent(params: {
  studentId: string;
  supersededById: string;
  supersededAt?: Date;
  maxGeneratedAt?: Date;
}): Promise<StudentMemorySnapshotRecord[]> {
  const supersededAt = params.supersededAt ?? new Date();
  const maxGeneratedAt = params.maxGeneratedAt ?? supersededAt;

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE student_memory_snapshots
      SET
        status = 'superseded',
        superseded_by_id = $1,
        superseded_at = $2,
        updated_at = NOW()
      WHERE student_id = $3
        AND status = 'pending'
        AND generated_at <= $4
      RETURNING
        id,
        student_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        lesson_memory_entry_ids,
        homework_memory_entry_ids,
        content_hash,
        generation_notes,
        stable_strengths,
        recurring_issues,
        active_review_backlog,
        recent_progress,
        personal_facts,
        recommended_assignment_directions,
        unresolved_issues,
        snapshot_summary,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      `,
      [params.supersededById, supersededAt, params.studentId, maxGeneratedAt],
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToStudentMemorySnapshot(row));
}

export async function markStudentMemorySnapshotFailed(params: {
  id: string;
  errorMessage: string;
  generationNotes?: StudentMemorySnapshotGenerationNotes | null;
  providerRequestId?: string | null;
  usage?: unknown;
}): Promise<StudentMemorySnapshotRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE student_memory_snapshots
      SET
        status = 'failed',
        generation_notes = COALESCE(generation_notes, '{}'::jsonb)
          || ($2::jsonb - ARRAY['replayKey', 'currentness', 'deliveryCheckedAt'])
          || jsonb_build_object('error', $3::text, 'failedAt', $6::text,
            'providerRequestId', COALESCE($4::text, generation_notes ->> 'providerRequestId'),
            'usage', COALESCE($5::jsonb, generation_notes -> 'usage')),
        updated_at = NOW()
      WHERE id = $1
        AND status = 'pending'
      RETURNING
        id,
        student_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        lesson_memory_entry_ids,
        homework_memory_entry_ids,
        content_hash,
        generation_notes,
        stable_strengths,
        recurring_issues,
        active_review_backlog,
        recent_progress,
        personal_facts,
        recommended_assignment_directions,
        unresolved_issues,
        snapshot_summary,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      `,
      [
        params.id,
        JSON.stringify(params.generationNotes ?? {}),
        params.errorMessage,
        params.providerRequestId ?? params.generationNotes?.providerRequestId ?? null,
        (params.usage ?? params.generationNotes?.usage) == null
          ? null
          : JSON.stringify(params.usage ?? params.generationNotes?.usage),
        new Date().toISOString(),
      ],
    );
    return result.rows[0];
  });

  return row ? mapRowToStudentMemorySnapshot(row) : null;
}

export async function updateStudentMemorySnapshotGenerationNotes(params: {
  id: string;
  generationNotes: StudentMemorySnapshotGenerationNotes;
}): Promise<StudentMemorySnapshotRecord | null> {
  const existing = await getStudentMemorySnapshotById(params.id);
  if (!existing) {
    return null;
  }

  const generationNotes: StudentMemorySnapshotGenerationNotes = {
    ...(existing.generationNotes ?? {}),
    ...params.generationNotes,
  };

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE student_memory_snapshots
      SET
        generation_notes = $2::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        student_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        lesson_memory_entry_ids,
        homework_memory_entry_ids,
        content_hash,
        generation_notes,
        stable_strengths,
        recurring_issues,
        active_review_backlog,
        recent_progress,
        personal_facts,
        recommended_assignment_directions,
        unresolved_issues,
        snapshot_summary,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      `,
      [params.id, JSON.stringify(generationNotes)],
    );
    return result.rows[0];
  });

  return row ? mapRowToStudentMemorySnapshot(row) : null;
}

export async function listStudentMemorySnapshots(
  options: ListStudentMemorySnapshotsOptions,
): Promise<StudentMemorySnapshotRecord[]> {
  const { studentId, statuses, limit, offset, order = 'desc' } = options;
  const values: (string | string[] | number)[] = [];
  const clauses: string[] = [];

  if (studentId) {
    values.push(studentId);
    clauses.push(`snapshot.student_id = $${values.length}`);
  }

  if (statuses && statuses.length > 0) {
    values.push(statuses);
    clauses.push(`snapshot.status = ANY($${values.length}::text[])`);
    if (statuses.includes('ready')) {
      const eligibleLineage = buildEligibleStudentMemorySnapshotLineageSqlPredicate('snapshot');
      clauses.push(`(snapshot.status <> 'ready' OR ${eligibleLineage})`);
    }
  }

  values.push(limit);
  const limitParam = values.length;
  values.push(offset);
  const offsetParam = values.length;

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        id,
        student_id,
        schema_version,
        generated_at,
        provider,
        model,
        status,
        source_kind,
        lesson_memory_entry_ids,
        homework_memory_entry_ids,
        content_hash,
        generation_notes,
        stable_strengths,
        recurring_issues,
        active_review_backlog,
        recent_progress,
        personal_facts,
        recommended_assignment_directions,
        unresolved_issues,
        snapshot_summary,
        superseded_by_id,
        superseded_at,
        created_at,
        updated_at
      FROM student_memory_snapshots AS snapshot
      ${whereClause}
      ORDER BY snapshot.generated_at ${orderDirection}, snapshot.created_at ${orderDirection}, snapshot.id ${orderDirection}
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
      `,
      values,
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToStudentMemorySnapshot(row));
}

function mapRowToStudentMemorySnapshot(row: StudentMemorySnapshotRow): StudentMemorySnapshotRecord {
  const recurringIssues = (row.recurring_issues ?? []).map((issue) => ({
    ...issue,
    issueType: StudentMemoryIssueTypeSchema.parse(issue.issueType),
    confidence: StudentMemoryConfidenceSchema.parse(issue.confidence),
  }));

  const unresolvedIssues = (row.unresolved_issues ?? []).map((issue) => ({
    ...issue,
    issueType: StudentMemoryIssueTypeSchema.parse(issue.issueType),
    priority: StudentMemoryPrioritySchema.parse(issue.priority),
  }));

  return {
    id: row.id,
    studentId: row.student_id,
    schemaVersion: row.schema_version,
    generatedAt: row.generated_at,
    provider: row.provider,
    model: row.model,
    status: StudentMemorySnapshotStatusSchema.parse(row.status),
    sourceKind: StudentMemorySnapshotSourceKindSchema.parse(row.source_kind),
    lessonMemoryEntryIds: row.lesson_memory_entry_ids ?? [],
    homeworkMemoryEntryIds: row.homework_memory_entry_ids ?? [],
    contentHash: row.content_hash ?? null,
    generationNotes: row.generation_notes ?? null,
    stableStrengths: row.stable_strengths ?? [],
    recurringIssues,
    activeReviewBacklog: row.active_review_backlog ?? [],
    recentProgress: row.recent_progress ?? [],
    personalFacts: row.personal_facts ?? [],
    recommendedAssignmentDirections: row.recommended_assignment_directions ?? [],
    unresolvedIssues,
    snapshotSummary: row.snapshot_summary ?? null,
    supersededById: row.superseded_by_id ?? null,
    supersededAt: row.superseded_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
