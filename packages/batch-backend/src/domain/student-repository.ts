import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import type { StudentListResult, StudentRecord } from './student-model.js';

interface StudentRow {
  id: string;
  student: string;
  db_id: string | null;
  page_parent_id: string | null;
  color_preset: string | null;
  voices: Record<string, string> | null;
  manifest_preset: string | null;
  accent_preference: string | null;
  profile_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertStudentParams {
  id?: string;
  student: string;
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
}

const MAX_PAGE_LIMIT = 500;

export async function insertStudent(params: InsertStudentParams): Promise<StudentRecord> {
  const id = params.id ?? randomUUID();
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO students (
        id,
        student,
        db_id,
        page_parent_id,
        color_preset,
        voices,
        manifest_preset,
        accent_preference,
        profile_id
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
      RETURNING
        id,
        student,
        db_id,
        page_parent_id,
        color_preset,
        voices,
        manifest_preset,
        accent_preference,
        profile_id,
        created_at,
        updated_at
      `,
      [
        id,
        params.student,
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
        db_id,
        page_parent_id,
        color_preset,
        voices,
        manifest_preset,
        accent_preference,
        profile_id
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE
      SET
        student = EXCLUDED.student,
        db_id = EXCLUDED.db_id,
        page_parent_id = EXCLUDED.page_parent_id,
        color_preset = EXCLUDED.color_preset,
        voices = EXCLUDED.voices,
        manifest_preset = EXCLUDED.manifest_preset,
        accent_preference = EXCLUDED.accent_preference,
        profile_id = EXCLUDED.profile_id
      RETURNING
        id,
        student,
        db_id,
        page_parent_id,
        color_preset,
        voices,
        manifest_preset,
        accent_preference,
        profile_id,
        created_at,
        updated_at
      `,
      [
        id,
        params.student,
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

export async function getStudentById(id: string): Promise<StudentRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        id,
        student,
        db_id,
        page_parent_id,
        color_preset,
        voices,
        manifest_preset,
        accent_preference,
        profile_id,
        created_at,
        updated_at
      FROM students
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0] as StudentRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function listStudents(params: ListStudentsParams = {}): Promise<StudentListResult> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), MAX_PAGE_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const order = params.order === 'desc' ? 'desc' : 'asc';
  const values: (string | number)[] = [];
  const filters: string[] = [];
  let index = 1;

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
      SELECT
        id,
        student,
        db_id,
        page_parent_id,
        color_preset,
        voices,
        manifest_preset,
        accent_preference,
        profile_id,
        created_at,
        updated_at
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
      RETURNING
        id,
        student,
        db_id,
        page_parent_id,
        color_preset,
        voices,
        manifest_preset,
        accent_preference,
        profile_id,
        created_at,
        updated_at
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

function mapRow(row: StudentRow): StudentRecord {
  return {
    id: row.id,
    student: row.student,
    dbId: row.db_id ?? null,
    pageParentId: row.page_parent_id ?? null,
    colorPreset: row.color_preset ?? null,
    voices: row.voices ?? {},
    manifestPreset: row.manifest_preset ?? null,
    accentPreference: row.accent_preference ?? null,
    profileId: row.profile_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
