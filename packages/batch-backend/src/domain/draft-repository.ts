import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import type { DraftRecord } from './draft-model.js';

interface DraftRow {
  id: string;
  prompt_package_id: string;
  student_id: string | null;
  storage_uri: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertDraftParams {
  id?: string;
  promptPackageId: string;
  studentId?: string | null;
  storageUri: string;
  createdBy?: string | null;
}

export async function insertDraft(params: InsertDraftParams): Promise<DraftRecord> {
  const id = params.id ?? randomUUID();
  const now = new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO drafts (
        id,
        prompt_package_id,
        student_id,
        storage_uri,
        created_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING
        id,
        prompt_package_id,
        student_id,
        storage_uri,
        created_by,
        created_at,
        updated_at
      `,
      [
        id,
        params.promptPackageId,
        params.studentId ?? null,
        params.storageUri,
        params.createdBy ?? null,
        now,
        now,
      ],
    );
    return result.rows[0];
  });

  logger.info('Draft inserted', { draftId: id });
  return mapRowToDraft(row);
}

export async function getDraftById(id: string): Promise<DraftRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, prompt_package_id, student_id, storage_uri, created_by, created_at, updated_at
      FROM drafts
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0];
  });

  return row ? mapRowToDraft(row) : null;
}

function mapRowToDraft(row: DraftRow): DraftRecord {
  return {
    id: row.id,
    promptPackageId: row.prompt_package_id,
    studentId: row.student_id ?? null,
    storageUri: row.storage_uri,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpdateDraftParams {
  id: string;
  storageUri?: string;
}

export async function updateDraft(params: UpdateDraftParams): Promise<DraftRecord | null> {
  const now = new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE drafts
      SET
        storage_uri = COALESCE($2, storage_uri),
        updated_at = $3
      WHERE id = $1
      RETURNING
        id,
        prompt_package_id,
        student_id,
        storage_uri,
        created_by,
        created_at,
        updated_at
      `,
      [params.id, params.storageUri, now],
    );
    return result.rows[0];
  });

  if (!row) return null;
  logger.info('Draft updated', { draftId: params.id });
  return mapRowToDraft(row);
}
