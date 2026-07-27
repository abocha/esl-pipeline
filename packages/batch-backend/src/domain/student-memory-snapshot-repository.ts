import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import type { StudentFact } from './lesson-memory-model.js';
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
};

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
  constructor(readonly unavailableLessonMemoryEntryIds: string[]) {
    super(
      `Lesson-memory sources changed before student-memory snapshot finalize: ${unavailableLessonMemoryEntryIds.join(', ')}`,
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
}

export interface EnsurePendingStudentMemorySnapshotResult {
  outcome: 'created' | 'pending_exists';
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

  return `NOT EXISTS (
    SELECT 1
    FROM unnest(${snapshotAlias}.lesson_memory_entry_ids) AS source(lesson_memory_entry_id)
    LEFT JOIN lesson_memory_entries AS eligible_lesson
      ON eligible_lesson.id = source.lesson_memory_entry_id
     AND eligible_lesson.student_id = ${snapshotAlias}.student_id
     AND eligible_lesson.status = 'ready'
     AND eligible_lesson.source_content_hash IS NOT NULL
    WHERE eligible_lesson.id IS NULL
  )`;
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

      if (params.sourceEntryId) {
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
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  const write = async (client: PoolClient) => {
    if (!options?.client) await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [params.studentId]);

      const requestedLessonIds = [...new Set(params.lessonMemoryEntryIds ?? [])];
      if (requestedLessonIds.length > 0) {
        const readyLessonResult = await client.query<{ id: string }>(
          `SELECT id FROM lesson_memory_entries
           WHERE student_id = $1 AND id = ANY($2::uuid[])
             AND status = 'ready' AND source_content_hash IS NOT NULL
           FOR SHARE`,
          [params.studentId, requestedLessonIds],
        );
        const readyLessonIds = new Set(readyLessonResult.rows.map((row) => row.id));
        const unavailableLessonIds = requestedLessonIds.filter((id) => !readyLessonIds.has(id));
        if (unavailableLessonIds.length > 0) {
          throw new StudentMemorySnapshotSourcesChangedError(unavailableLessonIds);
        }
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
  const eligibleLineage = buildEligibleStudentMemorySnapshotLineageSqlPredicate('snapshot');
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
      FROM student_memory_snapshots AS snapshot
      WHERE snapshot.student_id = $1
        AND snapshot.status = 'ready'
        AND ${eligibleLineage}
      ORDER BY snapshot.generated_at DESC, snapshot.created_at DESC, snapshot.id DESC
      LIMIT 1
      `,
      [studentId],
    );
    return result.rows[0];
  });

  return row ? mapRowToStudentMemorySnapshot(row) : null;
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
  const existing = await getStudentMemorySnapshotById(params.id);
  if (!existing) {
    return null;
  }

  const generationNotes: StudentMemorySnapshotGenerationNotes = {
    ...existing.generationNotes,
    ...(params.generationNotes ?? {}),
    error: params.errorMessage,
    providerRequestId:
      params.providerRequestId ??
      params.generationNotes?.providerRequestId ??
      existing.generationNotes?.providerRequestId ??
      null,
    usage: params.usage ?? params.generationNotes?.usage ?? existing.generationNotes?.usage ?? null,
    failedAt: new Date().toISOString(),
  };

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE student_memory_snapshots
      SET
        status = 'failed',
        generation_notes = $2::jsonb,
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
      [params.id, JSON.stringify(generationNotes)],
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
