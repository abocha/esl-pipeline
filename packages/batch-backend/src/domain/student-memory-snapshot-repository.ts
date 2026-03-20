import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { StudentFact } from './lesson-memory-model.js';
import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import {
  StudentMemoryConfidenceSchema,
  StudentMemoryIssueTypeSchema,
  StudentMemoryPrioritySchema,
  StudentMemorySnapshotSourceKindSchema,
  StudentMemorySnapshotStatusSchema,
  type StudentMemoryLabeledNote,
  type StudentMemoryRecommendedAssignmentDirection,
  type StudentMemoryRecurringIssue,
  type StudentMemorySnapshotGenerationNotes,
  type StudentMemorySnapshotRecord,
  type StudentMemorySnapshotStatus,
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
>;

export interface ListStudentMemorySnapshotsOptions {
  studentId?: string | null;
  statuses?: StudentMemorySnapshotStatus[];
  limit: number;
  offset: number;
  order?: 'asc' | 'desc';
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
): Promise<StudentMemorySnapshotRecord> {
  const id = params.id ?? randomUUID();
  const generatedAt = params.generatedAt ?? new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [params.studentId]);

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

      await client.query('COMMIT');
      return insertResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  logger.info('Canonical ready student memory snapshot inserted', {
    studentMemorySnapshotId: id,
    studentId: params.studentId,
  });

  return mapRowToStudentMemorySnapshot(row);
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
      WHERE student_id = $1
        AND status = 'ready'
      ORDER BY generated_at DESC, created_at DESC, id DESC
      LIMIT 1
      `,
      [studentId],
    );
    return result.rows[0];
  });

  return row ? mapRowToStudentMemorySnapshot(row) : null;
}

export async function listStudentMemorySnapshots(
  options: ListStudentMemorySnapshotsOptions,
): Promise<StudentMemorySnapshotRecord[]> {
  const { studentId, statuses, limit, offset, order = 'desc' } = options;
  const values: Array<string | string[] | number> = [];
  const clauses: string[] = [];

  if (studentId) {
    values.push(studentId);
    clauses.push(`student_id = $${values.length}`);
  }

  if (statuses && statuses.length > 0) {
    values.push(statuses);
    clauses.push(`status = ANY($${values.length}::text[])`);
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
      FROM student_memory_snapshots
      ${whereClause}
      ORDER BY generated_at ${orderDirection}, created_at ${orderDirection}, id ${orderDirection}
      LIMIT $${limitParam}
      OFFSET $${offsetParam}
      `,
      values,
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToStudentMemorySnapshot(row));
}

function mapRowToStudentMemorySnapshot(
  row: StudentMemorySnapshotRow,
): StudentMemorySnapshotRecord {
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
