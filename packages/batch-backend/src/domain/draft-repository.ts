import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import type { DraftRecord } from './draft-model.js';

interface DraftRow {
  id: string;
  prompt_package_id: string;
  storage_uri: string;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertDraftParams {
  id?: string;
  promptPackageId: string;
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
        storage_uri,
        created_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING
        id,
        prompt_package_id,
        storage_uri,
        created_by,
        created_at,
        updated_at
      `,
      [
        id,
        params.promptPackageId,
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
      SELECT id, prompt_package_id, storage_uri, created_by, created_at, updated_at
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
    storageUri: row.storage_uri,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
