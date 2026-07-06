import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import type {
  FactEvidence,
  MemoryConfidence,
  StudentFactAuthority,
} from './lesson-memory-model.js';
import {
  type StudentProfileCandidateRecord,
  type StudentProfileCandidateReviewState,
  StudentProfileCandidateReviewStateSchema,
  type StudentProfileCandidateStatus,
  StudentProfileCandidateStatusSchema,
  type StudentProfileCandidateTargetSection,
  StudentProfileCandidateTargetSectionSchema,
} from './student-profile-candidate-model.js';

interface StudentProfileCandidateRow {
  id: string;
  student_id: string;
  target_section: string;
  candidate_key: string;
  fact: string;
  approved_fact: string | null;
  category: string;
  authority: StudentFactAuthority;
  confidence: MemoryConfidence;
  review_needed: boolean;
  source_snapshot_id: string | null;
  source_lesson_memory_ids: string[] | null;
  source_lesson_id: string | null;
  source_lesson_started_at: Date | null;
  source_lesson_title: string | null;
  source_memory_ids: string[] | null;
  provenance: Record<string, unknown> | null;
  dedup_decision: Record<string, unknown> | null;
  evidence: FactEvidence[] | null;
  status: string;
  review_state: string;
  reviewer_id: string | null;
  reviewer_note: string | null;
  reviewed_at: Date | null;
  promoted_revision_id: string | null;
  promoted_at: Date | null;
  superseded_by_id: string | null;
  superseded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertStudentProfileCandidateParams {
  id?: string;
  studentId: string;
  targetSection: StudentProfileCandidateTargetSection;
  candidateKey: string;
  fact: string;
  category: string;
  authority: StudentFactAuthority;
  confidence: MemoryConfidence;
  reviewNeeded: boolean;
  sourceSnapshotId?: string | null;
  sourceLessonMemoryIds?: string[];
  sourceLessonId?: string | null;
  sourceLessonStartedAt?: Date | null;
  sourceLessonTitle?: string | null;
  sourceMemoryIds?: string[];
  provenance?: Record<string, unknown>;
  dedupDecision?: Record<string, unknown>;
  evidence?: FactEvidence[];
  status?: StudentProfileCandidateStatus;
  reviewState?: StudentProfileCandidateReviewState;
}

export interface ListStudentProfileCandidatesOptions {
  studentId: string;
  statuses?: StudentProfileCandidateStatus[];
  reviewStates?: StudentProfileCandidateReviewState[];
  limit: number;
  offset: number;
  order?: 'asc' | 'desc';
}

export interface ListStudentProfileCandidatesResult {
  items: StudentProfileCandidateRecord[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export interface UpdateStudentProfileCandidateReviewParams {
  studentId: string;
  candidateId: string;
  status: StudentProfileCandidateStatus;
  reviewState: StudentProfileCandidateReviewState;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  approvedFact?: string | null;
  reviewedAt?: Date;
}

export interface MarkStudentProfileCandidatesPromotedParams {
  studentId: string;
  candidateIds: string[];
  promotedRevisionId: string;
  promotedAt?: Date;
}

export interface LinkStudentProfileCandidatesToDraftRevisionParams {
  studentId: string;
  candidateIds: string[];
  draftRevisionId: string;
}

export interface CopyStudentProfileCandidateDraftRevisionLinksParams {
  sourceRevisionId: string;
  targetRevisionId: string;
}

const SELECT_COLUMNS = `
  id,
  student_id,
  target_section,
  candidate_key,
  fact,
  approved_fact,
  category,
  authority,
  confidence,
  review_needed,
  source_snapshot_id,
  source_lesson_memory_ids,
  source_lesson_id,
  source_lesson_started_at,
  source_lesson_title,
  source_memory_ids,
  provenance,
  dedup_decision,
  evidence,
  status,
  review_state,
  reviewer_id,
  reviewer_note,
  reviewed_at,
  promoted_revision_id,
  promoted_at,
  superseded_by_id,
  superseded_at,
  created_at,
  updated_at
`;

export async function insertStudentProfileCandidate(
  params: InsertStudentProfileCandidateParams,
): Promise<StudentProfileCandidateRecord> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<StudentProfileCandidateRow>(
      `
      INSERT INTO student_profile_candidates (
        id,
        student_id,
        target_section,
        candidate_key,
        fact,
        approved_fact,
        category,
        authority,
        confidence,
        review_needed,
        source_snapshot_id,
        source_lesson_memory_ids,
        source_lesson_id,
        source_lesson_started_at,
        source_lesson_title,
        source_memory_ids,
        provenance,
        dedup_decision,
        evidence,
        status,
        review_state
      )
      VALUES (
        $1, $2, $3, $4, $5, NULL, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
      )
      RETURNING ${SELECT_COLUMNS}
      `,
      [
        params.id ?? randomUUID(),
        params.studentId,
        params.targetSection,
        params.candidateKey,
        params.fact,
        params.category,
        params.authority,
        params.confidence,
        params.reviewNeeded,
        params.sourceSnapshotId ?? null,
        params.sourceLessonMemoryIds ?? [],
        params.sourceLessonId ?? null,
        params.sourceLessonStartedAt ?? null,
        params.sourceLessonTitle ?? null,
        params.sourceMemoryIds ?? params.sourceLessonMemoryIds ?? [],
        JSON.stringify(params.provenance ?? {}),
        JSON.stringify(params.dedupDecision ?? {}),
        JSON.stringify(params.evidence ?? []),
        params.status ?? 'pending_review',
        params.reviewState ?? 'unreviewed',
      ],
    );
    return result.rows[0];
  });

  if (!row) {
    throw new Error('Failed to insert student profile candidate');
  }

  return mapRow(row);
}

export async function listStudentProfileCandidates(
  options: ListStudentProfileCandidatesOptions,
): Promise<ListStudentProfileCandidatesResult> {
  const order = options.order === 'asc' ? 'ASC' : 'DESC';
  const clauses = ['student_id = $1'];
  const values: unknown[] = [options.studentId];

  if (options.statuses?.length) {
    values.push(options.statuses);
    clauses.push(`status = ANY($${values.length}::text[])`);
  }

  if (options.reviewStates?.length) {
    values.push(options.reviewStates);
    clauses.push(`review_state = ANY($${values.length}::text[])`);
  }

  values.push(options.limit, options.offset);

  const { rows, total } = await withPgClient(async (client: PoolClient) => {
    const countResult = await client.query<{ total: number }>(
      `
      SELECT COUNT(*)::int AS total
      FROM student_profile_candidates
      WHERE ${clauses.join(' AND ')}
      `,
      values.slice(0, -2),
    );
    const result = await client.query<StudentProfileCandidateRow>(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM student_profile_candidates
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at ${order}, id ${order}
      LIMIT $${values.length - 1} OFFSET $${values.length}
      `,
      values,
    );
    return {
      rows: result.rows,
      total: countResult.rows[0]?.total ?? 0,
    };
  });

  return {
    items: rows.map((row) => mapRow(row)),
    total,
    limit: options.limit,
    offset: options.offset,
    order: options.order === 'asc' ? 'asc' : 'desc',
  };
}

export async function getStudentProfileCandidateById(
  studentId: string,
  candidateId: string,
): Promise<StudentProfileCandidateRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<StudentProfileCandidateRow>(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM student_profile_candidates
      WHERE student_id = $1 AND id = $2
      `,
      [studentId, candidateId],
    );
    return result.rows[0];
  });

  return row ? mapRow(row) : null;
}

export async function listStudentProfileCandidatesByIds(
  studentId: string,
  candidateIds: readonly string[],
): Promise<StudentProfileCandidateRecord[]> {
  if (candidateIds.length === 0) {
    return [];
  }

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<StudentProfileCandidateRow>(
      `
      SELECT
        ${SELECT_COLUMNS}
      FROM student_profile_candidates
      WHERE student_id = $1
        AND id = ANY($2::uuid[])
      `,
      [studentId, candidateIds],
    );
    return result.rows;
  });

  return rows.map((row) => mapRow(row));
}

export async function listLatestStudentProfileCandidatesByKeys(
  studentId: string,
  candidateKeys: readonly string[],
): Promise<Map<string, StudentProfileCandidateRecord>> {
  if (candidateKeys.length === 0) {
    return new Map();
  }

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<StudentProfileCandidateRow>(
      `
      SELECT DISTINCT ON (candidate_key)
        ${SELECT_COLUMNS}
      FROM student_profile_candidates
      WHERE student_id = $1
        AND candidate_key = ANY($2::text[])
      ORDER BY
        candidate_key,
        CASE
          WHEN status IN ('pending_review', 'approved', 'promoted') THEN 0
          ELSE 1
        END,
        created_at DESC,
        id DESC
      `,
      [studentId, candidateKeys],
    );
    return result.rows;
  });

  return new Map(rows.map((row) => [row.candidate_key, mapRow(row)]));
}

export async function supersedePendingStudentProfileCandidates(args: {
  studentId: string;
  candidateKey: string;
  supersededById: string;
  supersededAt?: Date;
}): Promise<void> {
  await withPgClient(async (client: PoolClient) => {
    await client.query(
      `
      UPDATE student_profile_candidates
      SET
        status = 'superseded',
        superseded_by_id = $3,
        superseded_at = COALESCE($4, NOW()),
        review_state = CASE
          WHEN review_state = 'deferred' THEN 'deferred'
          ELSE review_state
        END
      WHERE student_id = $1
        AND candidate_key = $2
        AND status = 'pending_review'
        AND id <> $3
      `,
      [args.studentId, args.candidateKey, args.supersededById, args.supersededAt ?? null],
    );
  });
}

export async function updateStudentProfileCandidateReview(
  params: UpdateStudentProfileCandidateReviewParams,
): Promise<StudentProfileCandidateRecord | null> {
  const reviewedAt = params.reviewedAt ?? new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<StudentProfileCandidateRow>(
      `
      UPDATE student_profile_candidates
      SET
        status = $3,
        review_state = $4,
        reviewer_id = $5,
        reviewer_note = $6,
        approved_fact = $7,
        reviewed_at = $8
      WHERE student_id = $1
        AND id = $2
      RETURNING ${SELECT_COLUMNS}
      `,
      [
        params.studentId,
        params.candidateId,
        params.status,
        params.reviewState,
        params.reviewerId ?? null,
        params.reviewerNote ?? null,
        params.approvedFact ?? null,
        reviewedAt,
      ],
    );
    return result.rows[0];
  });

  return row ? mapRow(row) : null;
}

export async function markStudentProfileCandidatesPromoted(
  params: MarkStudentProfileCandidatesPromotedParams,
): Promise<void> {
  if (params.candidateIds.length === 0) {
    return;
  }

  await withPgClient(async (client: PoolClient) => {
    await client.query(
      `
      UPDATE student_profile_candidates
      SET
        status = 'promoted',
        promoted_revision_id = $3,
        promoted_at = COALESCE($4, NOW()),
        review_state = 'approved'
      WHERE student_id = $1
        AND id = ANY($2::uuid[])
      `,
      [params.studentId, params.candidateIds, params.promotedRevisionId, params.promotedAt ?? null],
    );
  });
}

export async function linkStudentProfileCandidatesToDraftRevision(
  params: LinkStudentProfileCandidatesToDraftRevisionParams,
): Promise<void> {
  if (params.candidateIds.length === 0) {
    return;
  }

  await withPgClient(async (client: PoolClient) => {
    await client.query(
      `
      INSERT INTO student_profile_candidate_draft_revisions (
        candidate_id,
        revision_id
      )
      SELECT
        id,
        $3
      FROM student_profile_candidates
      WHERE student_id = $1
        AND id = ANY($2::uuid[])
      ON CONFLICT (candidate_id, revision_id) DO NOTHING
      `,
      [params.studentId, params.candidateIds, params.draftRevisionId],
    );
  });
}

export async function copyStudentProfileCandidateDraftRevisionLinks(
  params: CopyStudentProfileCandidateDraftRevisionLinksParams,
): Promise<void> {
  if (params.sourceRevisionId === params.targetRevisionId) {
    return;
  }

  await withPgClient(async (client: PoolClient) => {
    await client.query(
      `
      INSERT INTO student_profile_candidate_draft_revisions (
        candidate_id,
        revision_id
      )
      SELECT
        candidate_id,
        $2
      FROM student_profile_candidate_draft_revisions
      WHERE revision_id = $1
      ON CONFLICT (candidate_id, revision_id) DO NOTHING
      `,
      [params.sourceRevisionId, params.targetRevisionId],
    );
  });
}

export async function markStudentProfileCandidatesPromotedByRevision(
  revisionId: string,
  promotedAt?: Date,
): Promise<void> {
  await withPgClient(async (client: PoolClient) => {
    await client.query(
      `
      UPDATE student_profile_candidates
      SET
        status = 'promoted',
        promoted_revision_id = $1,
        promoted_at = COALESCE($2, NOW()),
        review_state = 'approved'
      WHERE status = 'approved'
        AND (
          promoted_revision_id = $1
          OR id IN (
            SELECT candidate_id
            FROM student_profile_candidate_draft_revisions
            WHERE revision_id = $1
          )
        )
      `,
      [revisionId, promotedAt ?? null],
    );
  });
}

function mapRow(row: StudentProfileCandidateRow): StudentProfileCandidateRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    targetSection: StudentProfileCandidateTargetSectionSchema.parse(row.target_section),
    candidateKey: row.candidate_key,
    fact: row.fact,
    approvedFact: row.approved_fact,
    category: row.category,
    authority: row.authority,
    confidence: row.confidence,
    reviewNeeded: row.review_needed,
    sourceSnapshotId: row.source_snapshot_id,
    sourceLessonMemoryIds: row.source_lesson_memory_ids ?? [],
    sourceLessonId: row.source_lesson_id,
    sourceLessonStartedAt: row.source_lesson_started_at,
    sourceLessonTitle: row.source_lesson_title,
    sourceMemoryIds: row.source_memory_ids ?? [],
    provenance: row.provenance ?? {},
    dedupDecision: row.dedup_decision ?? {},
    evidence: row.evidence ?? [],
    status: StudentProfileCandidateStatusSchema.parse(row.status),
    reviewState: StudentProfileCandidateReviewStateSchema.parse(row.review_state),
    reviewerId: row.reviewer_id,
    reviewerNote: row.reviewer_note,
    reviewedAt: row.reviewed_at,
    promotedRevisionId: row.promoted_revision_id,
    promotedAt: row.promoted_at,
    supersededById: row.superseded_by_id,
    supersededAt: row.superseded_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
