import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import {
  type RecordingRecord,
  type RecordingSource,
  type RecordingStatus,
  RecordingSourceSchema,
  RecordingStatusSchema,
} from './recording-model.js';

interface RecordingRow {
  id: string;
  source: string;
  student_id: string | null;
  source_path: string | null;
  storage_uri: string;
  sha256: string | null;
  bytes: string | number;
  duration_sec: number | null;
  channels: number | null;
  status: string;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertRecordingParams {
  id?: string;
  source: RecordingSource;
  studentId?: string | null;
  sourcePath?: string | null;
  storageUri: string;
  sha256?: string | null;
  bytes: number;
  durationSec?: number | null;
  channels?: number | null;
  status: RecordingStatus;
  error?: string | null;
}

export async function getRecordingBySha256(sha256: string): Promise<RecordingRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, source, student_id, source_path, storage_uri, sha256, bytes,
             duration_sec, channels, status, error, created_at, updated_at
      FROM recordings
      WHERE sha256 = $1
      LIMIT 1
      `,
      [sha256],
    );
    return result.rows[0];
  });

  return row ? mapRowToRecording(row) : null;
}

export async function getRecordingById(id: string): Promise<RecordingRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, source, student_id, source_path, storage_uri, sha256, bytes,
             duration_sec, channels, status, error, created_at, updated_at
      FROM recordings
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0];
  });

  return row ? mapRowToRecording(row) : null;
}

export async function getRecordingBySourcePath(
  sourcePath: string,
  bytes: number,
): Promise<RecordingRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, source, student_id, source_path, storage_uri, sha256, bytes,
             duration_sec, channels, status, error, created_at, updated_at
      FROM recordings
      WHERE source_path = $1
        AND bytes = $2
      LIMIT 1
      `,
      [sourcePath, bytes],
    );
    return result.rows[0];
  });

  return row ? mapRowToRecording(row) : null;
}

export async function insertRecording(params: InsertRecordingParams): Promise<RecordingRecord> {
  const id = params.id ?? randomUUID();
  const now = new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO recordings (
        id,
        source,
        student_id,
        source_path,
        storage_uri,
        sha256,
        bytes,
        duration_sec,
        channels,
        status,
        error,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING
        id,
        source,
        student_id,
        source_path,
        storage_uri,
        sha256,
        bytes,
        duration_sec,
        channels,
        status,
        error,
        created_at,
        updated_at
      `,
      [
        id,
        params.source,
        params.studentId ?? null,
        params.sourcePath ?? null,
        params.storageUri,
        params.sha256 ?? null,
        params.bytes,
        params.durationSec ?? null,
        params.channels ?? null,
        params.status,
        params.error ?? null,
        now,
        now,
      ],
    );
    return result.rows[0];
  });

  logger.info('Recording inserted', { recordingId: id });

  return mapRowToRecording(row);
}

export async function updateRecordingStatus(params: {
  id: string;
  status: RecordingStatus;
  error?: string | null;
}): Promise<RecordingRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE recordings
      SET
        status = $1,
        error = COALESCE($2, error),
        updated_at = now()
      WHERE id = $3
      RETURNING
        id,
        source,
        student_id,
        source_path,
        storage_uri,
        sha256,
        bytes,
        duration_sec,
        channels,
        status,
        error,
        created_at,
        updated_at
      `,
      [params.status, params.error ?? null, params.id],
    );
    return result.rows[0];
  });

  if (!row) {
    logger.warn('Recording status update skipped; record missing', { recordingId: params.id });
    return null;
  }

  logger.info('Recording status updated', { recordingId: params.id, status: row.status });
  return mapRowToRecording(row);
}

function mapRowToRecording(row: RecordingRow): RecordingRecord {
  const source = RecordingSourceSchema.parse(row.source);
  const status = RecordingStatusSchema.parse(row.status);
  const bytes = typeof row.bytes === 'string' ? Number(row.bytes) : row.bytes;

  return {
    id: row.id,
    source,
    studentId: row.student_id ?? null,
    sourcePath: row.source_path ?? null,
    storageUri: row.storage_uri,
    sha256: row.sha256 ?? null,
    bytes: Number.isNaN(bytes) ? 0 : bytes,
    durationSec: row.duration_sec ?? null,
    channels: row.channels ?? null,
    status,
    error: row.error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
