import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import { ArtifactWorkingConflictError } from './artifact-working-conflict.js';
import type { DraftRecord } from './draft-model.js';

interface DraftRow {
  id: string;
  prompt_package_id: string;
  student_id: string | null;
  lesson_id: string | null;
  format?: 'markdown' | 'assignment_v1';
  storage_uri: string;
  working_version: number | null;
  content_hash: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertDraftParams {
  id?: string;
  promptPackageId: string;
  studentId?: string | null;
  lessonId?: string | null;
  format?: 'markdown' | 'assignment_v1';
  storageUri: string;
  workingVersion: number;
  contentHash: string;
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
        lesson_id,
        format,
        storage_uri,
        working_version,
        content_hash,
        created_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING
        id,
        prompt_package_id,
        student_id,
        lesson_id,
        format,
        storage_uri,
        working_version,
        content_hash,
        created_by,
        created_at,
        updated_at
      `,
      [
        id,
        params.promptPackageId,
        params.studentId ?? null,
        params.lessonId ?? null,
        params.format ?? 'markdown',
        params.storageUri,
        params.workingVersion,
        params.contentHash,
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
      SELECT id, prompt_package_id, student_id, lesson_id, format, storage_uri,
             working_version, content_hash, created_by, created_at, updated_at
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
    lessonId: row.lesson_id ?? null,
    format: row.format ?? 'markdown',
    storageUri: row.storage_uri,
    workingVersion: row.working_version,
    contentHash: row.content_hash,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UpdateDraftParams {
  id: string;
  expectedWorkingVersion: number;
  storageUri: string;
  contentHash: string;
}

export async function updateDraftWorkingContent(params: UpdateDraftParams): Promise<DraftRecord> {
  const now = new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE drafts
      SET
        storage_uri = $3,
        content_hash = $4,
        working_version = working_version + 1,
        updated_at = $5
      WHERE id = $1 AND working_version = $2
      RETURNING
        id,
        prompt_package_id,
        student_id,
        lesson_id,
        format,
        storage_uri,
        working_version,
        content_hash,
        created_by,
        created_at,
        updated_at
      `,
      [params.id, params.expectedWorkingVersion, params.storageUri, params.contentHash, now],
    );
    return result.rows[0];
  });

  if (!row) {
    const latest = await getDraftById(params.id);
    if (!latest) throw new Error(`Draft not found: ${params.id}`);
    throw new ArtifactWorkingConflictError(latest);
  }
  logger.info('Draft updated', { draftId: params.id });
  return mapRowToDraft(row);
}

export async function getDraftByIdForUpdate(
  client: PoolClient,
  id: string,
): Promise<DraftRecord | null> {
  const result = await client.query(
    `
    SELECT id, prompt_package_id, student_id, lesson_id, format, storage_uri,
           working_version, content_hash, created_by, created_at, updated_at
    FROM drafts
    WHERE id = $1
    FOR UPDATE
    `,
    [id],
  );
  return result.rows[0] ? mapRowToDraft(result.rows[0]) : null;
}
