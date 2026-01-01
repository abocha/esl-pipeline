import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import type { PromptPackageRecord } from './prompt-package-model.js';

interface PromptPackageRow {
  id: string;
  recording_id: string;
  transcript_id: string;
  student_id: string | null;
  profile_path: string | null;
  template_version: string;
  notes: string | null;
  storage_uri: string;
  created_at: Date;
  updated_at: Date;
}

export interface InsertPromptPackageParams {
  id?: string;
  recordingId: string;
  transcriptId: string;
  studentId?: string | null;
  profilePath?: string | null;
  templateVersion: string;
  notes?: string | null;
  storageUri: string;
}

export async function insertPromptPackage(
  params: InsertPromptPackageParams,
): Promise<PromptPackageRecord> {
  const id = params.id ?? randomUUID();
  const now = new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO prompt_packages (
        id,
        recording_id,
        transcript_id,
        student_id,
        profile_path,
        template_version,
        notes,
        storage_uri,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING
        id,
        recording_id,
        transcript_id,
        student_id,
        profile_path,
        template_version,
        notes,
        storage_uri,
        created_at,
        updated_at
      `,
      [
        id,
        params.recordingId,
        params.transcriptId,
        params.studentId ?? null,
        params.profilePath ?? null,
        params.templateVersion,
        params.notes ?? null,
        params.storageUri,
        now,
        now,
      ],
    );
    return result.rows[0];
  });

  logger.info('Prompt package inserted', { promptPackageId: id });
  return mapRowToPromptPackage(row);
}

export async function getPromptPackageById(
  id: string,
): Promise<PromptPackageRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, recording_id, transcript_id, profile_path, template_version,
             student_id, notes, storage_uri, created_at, updated_at
      FROM prompt_packages
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0];
  });

  return row ? mapRowToPromptPackage(row) : null;
}

function mapRowToPromptPackage(row: PromptPackageRow): PromptPackageRecord {
  return {
    id: row.id,
    recordingId: row.recording_id,
    transcriptId: row.transcript_id,
    studentId: row.student_id ?? null,
    profilePath: row.profile_path ?? null,
    templateVersion: row.template_version,
    notes: row.notes ?? null,
    storageUri: row.storage_uri,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
