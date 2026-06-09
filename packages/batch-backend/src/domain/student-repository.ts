import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import type { StudentListResult, StudentRecord } from './student-model.js';

interface StudentRow {
  id: string;
  student: string;
  workspace_id: string | null;
  db_id: string | null;
  page_parent_id: string | null;
  color_preset: string | null;
  voices: Record<string, string> | null;
  manifest_preset: string | null;
  accent_preference: string | null;
  profile_id: string | null;
  archived_at: Date | null;
  archived_by: string | null;
  archive_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertStudentParams {
  id?: string;
  student: string;
  workspaceId?: string | null;
  dbId?: string | null;
  pageParentId?: string | null;
  colorPreset?: string | null;
  voices?: Record<string, string>;
  manifestPreset?: string | null;
  accentPreference?: string | null;
  profileId?: string | null;
}

export interface UpdateStudentParams {
  id: string;
  workspaceId?: string | null;
  student?: string;
  dbId?: string | null;
  pageParentId?: string | null;
  colorPreset?: string | null;
  voices?: Record<string, string>;
  manifestPreset?: string | null;
  accentPreference?: string | null;
  profileId?: string | null;
}

export interface ListStudentsParams {
  search?: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  status?: 'active' | 'archived' | 'all';
  workspaceId?: string | null;
}

export interface ArchiveStudentParams {
  id: string;
  workspaceId?: string | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
}

export interface GetStudentParams {
  includeArchived?: boolean;
  workspaceId?: string | null;
}

const MAX_PAGE_LIMIT = 500;
const STUDENT_COLUMNS = `
  id,
  student,
  workspace_id,
  db_id,
  page_parent_id,
  color_preset,
  voices,
  manifest_preset,
  accent_preference,
  profile_id,
  archived_at,
  archived_by,
  archive_reason,
  created_at,
  updated_at
`;

export async function insertStudent(params: InsertStudentParams): Promise<StudentRecord> {
  const id = params.id ?? randomUUID();
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO students (
        id,
        student,
        workspace_id,
        db_id,
        page_parent_id,
        color_preset,
        voices,
        manifest_preset,
        accent_preference,
        profile_id
      )
      VALUES ($1, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8, $9, $10)
      RETURNING ${STUDENT_COLUMNS}
      `,
      [
        id,
        params.student,
        params.workspaceId ?? null,
        params.dbId ?? null,
        params.pageParentId ?? null,
        params.colorPreset ?? null,
        JSON.stringify(params.voices ?? {}),
        params.manifestPreset ?? null,
        params.accentPreference ?? null,
        params.profileId ?? null,
      ],
    );
    return result.rows[0] as StudentRow;
  });

  return mapRow(row);
}

export async function upsertStudent(params: InsertStudentParams): Promise<StudentRecord> {
  const id = params.id ?? randomUUID();
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO students (
        id,
        student,
        workspace_id,
        db_id,
        page_parent_id,
        color_preset,
        voices,
        manifest_preset,
        accent_preference,
        profile_id
      )
      VALUES ($1, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE
      SET
        student = EXCLUDED.student,
        workspace_id = EXCLUDED.workspace_id,
        db_id = EXCLUDED.db_id,
        page_parent_id = EXCLUDED.page_parent_id,
        color_preset = EXCLUDED.color_preset,
        voices = EXCLUDED.voices,
        manifest_preset = EXCLUDED.manifest_preset,
        accent_preference = EXCLUDED.accent_preference,
        profile_id = EXCLUDED.profile_id
      RETURNING ${STUDENT_COLUMNS}
      `,
      [
        id,
        params.student,
        params.workspaceId ?? null,
        params.dbId ?? null,
        params.pageParentId ?? null,
        params.colorPreset ?? null,
        JSON.stringify(params.voices ?? {}),
        params.manifestPreset ?? null,
        params.accentPreference ?? null,
        params.profileId ?? null,
      ],
    );
    return result.rows[0] as StudentRow;
  });

  return mapRow(row);
}

export async function getStudentById(
  id: string,
  params: GetStudentParams = {},
): Promise<StudentRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT ${STUDENT_COLUMNS}
      FROM students
      WHERE id = $1
        AND ($2::boolean OR archived_at IS NULL)
        AND ($3::uuid IS NULL OR workspace_id = $3::uuid)
      `,
      [id, params.includeArchived ?? false, params.workspaceId ?? null],
    );
    return result.rows[0] as StudentRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function listStudents(params: ListStudentsParams = {}): Promise<StudentListResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const order = params.order === 'desc' ? 'desc' : 'asc';
  const status = params.status ?? 'active';
  const values: (string | number)[] = [];
  const filters: string[] = [];
  let index = 1;

  if (status === 'active') {
    filters.push('archived_at IS NULL');
  } else if (status === 'archived') {
    filters.push('archived_at IS NOT NULL');
  }

  if (params.workspaceId) {
    values.push(params.workspaceId);
    filters.push(`workspace_id = $${index}::uuid`);
    index += 1;
  }

  if (params.search?.trim()) {
    const search = `%${params.search.trim()}%`;
    values.push(search);
    filters.push(`(student ILIKE $${index} OR id::text ILIKE $${index})`);
    index += 1;
  }

  const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
  const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

  const { rows, total } = await withPgClient(async (client: PoolClient) => {
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS total FROM students ${whereClause}`,
      values,
    );
    const dataResult = await client.query(
      `
      SELECT ${STUDENT_COLUMNS}
      FROM students
      ${whereClause}
      ORDER BY student ${orderDirection}, id ${orderDirection}
      LIMIT $${index} OFFSET $${index + 1}
      `,
      [...values, limit, offset],
    );
    return {
      rows: dataResult.rows as StudentRow[],
      total: countResult.rows[0]?.total ?? 0,
    };
  });

  return {
    items: rows.map((row) => mapRow(row)),
    total,
    limit,
    offset,
    order,
  };
}

export async function updateStudent(params: UpdateStudentParams): Promise<StudentRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE students
      SET
        student = COALESCE($2, student),
        db_id = COALESCE($3, db_id),
        page_parent_id = COALESCE($4, page_parent_id),
        color_preset = COALESCE($5, color_preset),
        voices = COALESCE($6::jsonb, voices),
        manifest_preset = COALESCE($7, manifest_preset),
        accent_preference = COALESCE($8, accent_preference),
        profile_id = $9
      WHERE id = $1
        AND ($10::uuid IS NULL OR workspace_id = $10::uuid)
      RETURNING ${STUDENT_COLUMNS}
      `,
      [
        params.id,
        params.student ?? null,
        params.dbId ?? null,
        params.pageParentId ?? null,
        params.colorPreset ?? null,
        params.voices ? JSON.stringify(params.voices) : null,
        params.manifestPreset ?? null,
        params.accentPreference ?? null,
        params.profileId ?? null,
        params.workspaceId ?? null,
      ],
    );
    return result.rows[0] as StudentRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function deleteStudent(id: string): Promise<boolean> {
  const deleted = await withPgClient(async (client: PoolClient) => {
    const result = await client.query('DELETE FROM students WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  });

  return deleted;
}

export async function archiveStudent(params: ArchiveStudentParams): Promise<StudentRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE students
      SET
        archived_at = COALESCE(archived_at, NOW()),
        archived_by = $2,
        archive_reason = $3
      WHERE id = $1
        AND ($4::uuid IS NULL OR workspace_id = $4::uuid)
      RETURNING ${STUDENT_COLUMNS}
      `,
      [
        params.id,
        params.archivedBy ?? null,
        params.archiveReason ?? null,
        params.workspaceId ?? null,
      ],
    );
    return result.rows[0] as StudentRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function restoreStudent(
  id: string,
  params: { workspaceId?: string | null } = {},
): Promise<StudentRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE students
      SET
        archived_at = NULL,
        archived_by = NULL,
        archive_reason = NULL
      WHERE id = $1
        AND ($2::uuid IS NULL OR workspace_id = $2::uuid)
      RETURNING ${STUDENT_COLUMNS}
      `,
      [id, params.workspaceId ?? null],
    );
    return result.rows[0] as StudentRow | undefined;
  });

  return row ? mapRow(row) : null;
}

function mapRow(row: StudentRow): StudentRecord {
  return {
    id: row.id,
    student: row.student,
    workspaceId: row.workspace_id ?? null,
    dbId: row.db_id ?? null,
    pageParentId: row.page_parent_id ?? null,
    colorPreset: row.color_preset ?? null,
    voices: row.voices ?? {},
    manifestPreset: row.manifest_preset ?? null,
    accentPreference: row.accent_preference ?? null,
    profileId: row.profile_id ?? null,
    archivedAt: row.archived_at ?? null,
    archivedBy: row.archived_by ?? null,
    archiveReason: row.archive_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
