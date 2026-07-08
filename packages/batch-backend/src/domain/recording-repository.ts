import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import {
  type RecordingRecord,
  type RecordingSource,
  RecordingSourceSchema,
  type RecordingStatus,
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

interface RecordingListRow extends RecordingRow {
  transcript_id: string | null;
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

export async function listRecordingsBySha256(sha256: string): Promise<RecordingRecord[]> {
  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, source, student_id, source_path, storage_uri, sha256, bytes,
             duration_sec, channels, status, error, created_at, updated_at
      FROM recordings
      WHERE sha256 = $1
      ORDER BY created_at DESC, id DESC
      `,
      [sha256],
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToRecording(row));
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

export async function updateRecordingStudentId(params: {
  id: string;
  studentId: string | null;
}): Promise<RecordingRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE recordings
      SET
        student_id = $2,
        updated_at = now()
      WHERE id = $1
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
      [params.id, params.studentId],
    );
    return result.rows[0];
  });

  if (!row) {
    logger.warn('Recording student binding update skipped; record missing', {
      recordingId: params.id,
    });
    return null;
  }

  logger.info('Recording student binding updated', {
    recordingId: params.id,
    studentId: row.student_id ?? null,
  });
  return mapRowToRecording(row);
}

export interface RecordingListOptions {
  statuses?: RecordingStatus[];
  sources?: RecordingSource[];
  search?: string | null;
  studentId?: string | null;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export interface RecordingWithTranscript extends RecordingRecord {
  transcriptId: string | null;
}

export async function listRecordings(
  options: RecordingListOptions,
): Promise<RecordingWithTranscript[]> {
  const { statuses, sources, search, studentId, limit, offset, order } = options;
  const values: (string | string[] | number)[] = [];
  const clauses: string[] = [];

  if (statuses && statuses.length > 0) {
    values.push(statuses);
    clauses.push(`r.status = ANY($${values.length}::text[])`);
  }

  if (studentId) {
    values.push(studentId);
    clauses.push(`r.student_id = $${values.length}`);
  }

  if (sources && sources.length > 0) {
    values.push(sources);
    clauses.push(`r.source = ANY($${values.length}::text[])`);
  }

  if (search && search.length > 0) {
    values.push(`%${escapeLike(search)}%`);
    clauses.push(
      String.raw`(r.id::text ILIKE $${values.length} ESCAPE '\\' OR r.source_path ILIKE $${values.length} ESCAPE '\\' OR r.storage_uri ILIKE $${values.length} ESCAPE '\\')`,
    );
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderDirection = order === 'asc' ? 'ASC' : 'DESC';

  values.push(limit);
  const limitParam = values.length;
  values.push(offset);
  const offsetParam = values.length;

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        r.id,
        r.source,
        r.student_id,
        r.source_path,
        r.storage_uri,
        r.sha256,
        r.bytes,
        r.duration_sec,
        r.channels,
        r.status,
        r.error,
        r.created_at,
        r.updated_at,
        t.id AS transcript_id
      FROM recordings r
      LEFT JOIN LATERAL (
        SELECT id
        FROM transcripts
        WHERE recording_id = r.id
        ORDER BY created_at DESC
        LIMIT 1
      ) t ON true
      ${whereClause}
      ORDER BY r.created_at ${orderDirection}, r.id ${orderDirection}
      LIMIT $${limitParam} OFFSET $${offsetParam}
      `,
      values,
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToRecordingWithTranscript(row));
}

export async function countRecordings(
  statuses?: RecordingStatus[],
  studentId?: string | null,
  sources?: RecordingSource[],
  search?: string | null,
): Promise<number> {
  const values: (string | string[])[] = [];
  const clauses: string[] = [];

  if (statuses && statuses.length > 0) {
    values.push(statuses);
    clauses.push(`status = ANY($${values.length}::text[])`);
  }

  if (studentId) {
    values.push(studentId);
    clauses.push(`student_id = $${values.length}`);
  }

  if (sources && sources.length > 0) {
    values.push(sources);
    clauses.push(`source = ANY($${values.length}::text[])`);
  }

  if (search && search.length > 0) {
    values.push(`%${escapeLike(search)}%`);
    clauses.push(
      String.raw`(id::text ILIKE $${values.length} ESCAPE '\\' OR source_path ILIKE $${values.length} ESCAPE '\\' OR storage_uri ILIKE $${values.length} ESCAPE '\\')`,
    );
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const result = await withPgClient(async (client: PoolClient) => {
    const queryResult = await client.query(
      `
      SELECT COUNT(*) as count
      FROM recordings
      ${whereClause}
      `,
      values,
    );
    return queryResult;
  });

  return Number.parseInt(result.rows[0]?.count ?? '0', 10);
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

function mapRowToRecordingWithTranscript(row: RecordingListRow): RecordingWithTranscript {
  return {
    ...mapRowToRecording(row),
    transcriptId: row.transcript_id ?? null,
  };
}

function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, String.raw`\\$&`);
}
