import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import type { StudentProfileBindingRecord } from './student-profile-binding-model.js';

interface StudentProfileBindingRow {
  id: string;
  student_id: string;
  profile_id: string;
  effective_from: Date;
  effective_to: Date | null;
  reason: string | null;
  changed_by: string | null;
  created_at: Date;
}

export interface SetActiveStudentProfileBindingParams {
  studentId: string;
  profileId: string;
  reason?: string | null;
  changedBy?: string | null;
  effectiveFrom?: Date;
}

export async function getActiveStudentProfileBinding(
  studentId: string,
): Promise<StudentProfileBindingRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        id,
        student_id,
        profile_id,
        effective_from,
        effective_to,
        reason,
        changed_by,
        created_at
      FROM student_profile_bindings
      WHERE student_id = $1
        AND effective_to IS NULL
      ORDER BY effective_from DESC, created_at DESC
      LIMIT 1
      `,
      [studentId],
    );
    return result.rows[0] as StudentProfileBindingRow | undefined;
  });

  return row ? mapRow(row) : null;
}

export async function clearActiveStudentProfileBinding(
  studentId: string,
  effectiveTo: Date = new Date(),
): Promise<void> {
  await withPgClient(async (client: PoolClient) => {
    await client.query(
      `
      UPDATE student_profile_bindings
      SET effective_to = $2
      WHERE student_id = $1
        AND effective_to IS NULL
      `,
      [studentId, effectiveTo],
    );
  });
}

export async function setActiveStudentProfileBinding(
  params: SetActiveStudentProfileBindingParams,
): Promise<StudentProfileBindingRecord> {
  return withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const currentResult = await client.query(
        `
        SELECT
          id,
          student_id,
          profile_id,
          effective_from,
          effective_to,
          reason,
          changed_by,
          created_at
        FROM student_profile_bindings
        WHERE student_id = $1
          AND effective_to IS NULL
        ORDER BY effective_from DESC, created_at DESC
        LIMIT 1
        `,
        [params.studentId],
      );
      const current = currentResult.rows[0] as StudentProfileBindingRow | undefined;
      if (current && current.profile_id === params.profileId) {
        await client.query('COMMIT');
        return mapRow(current);
      }

      const effectiveFrom = params.effectiveFrom ?? new Date();
      await client.query(
        `
        UPDATE student_profile_bindings
        SET effective_to = $2
        WHERE student_id = $1
          AND effective_to IS NULL
        `,
        [params.studentId, effectiveFrom],
      );

      const id = randomUUID();
      const insertResult = await client.query(
        `
        INSERT INTO student_profile_bindings (
          id,
          student_id,
          profile_id,
          effective_from,
          effective_to,
          reason,
          changed_by,
          created_at
        )
        VALUES ($1, $2, $3, $4, NULL, $5, $6, NOW())
        RETURNING
          id,
          student_id,
          profile_id,
          effective_from,
          effective_to,
          reason,
          changed_by,
          created_at
        `,
        [
          id,
          params.studentId,
          params.profileId,
          effectiveFrom,
          params.reason ?? null,
          params.changedBy ?? null,
        ],
      );

      await client.query('COMMIT');
      return mapRow(insertResult.rows[0] as StudentProfileBindingRow);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

function mapRow(row: StudentProfileBindingRow): StudentProfileBindingRecord {
  return {
    id: row.id,
    studentId: row.student_id,
    profileId: row.profile_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to ?? null,
    reason: row.reason ?? null,
    changedBy: row.changed_by ?? null,
    createdAt: row.created_at,
  };
}
