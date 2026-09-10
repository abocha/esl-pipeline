import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import type { AudioInputTopology } from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import {
  AudioInputTopologySchema,
  type AudioLifecycle,
  AudioLifecycleSchema,
  type RecordingRecord,
  type RecordingSource,
  RecordingSourceSchema,
  type RecordingStatus,
  RecordingStatusSchema,
} from './recording-model.js';
import { completeRecordingUploadOperation } from './recording-upload-operation-repository.js';
import type { TranscriptRecord } from './transcript-model.js';
import { type InsertTranscriptParams, insertTranscript } from './transcript-repository.js';
import {
  createQueuedTranscriptionRun,
  type TranscriptionRun,
} from './transcription-run-repository.js';

interface RecordingRow {
  id: string;
  workspace_id: string;
  source: string;
  student_id: string | null;
  source_path: string | null;
  storage_uri: string | null;
  sha256: string | null;
  bytes: string | number;
  duration_sec: number | null;
  channels: number | null;
  audio_topology: string | null;
  media_preparation_version: string | null;
  audio_lifecycle: string;
  audio_deletion_requested_at: Date | null;
  audio_deleted_at: Date | null;
  audio_deletion_attempt_count: number;
  audio_deletion_error_code: string | null;
  audio_deletion_next_attempt_at: Date | null;
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
  workspaceId: string;
  source: RecordingSource;
  studentId?: string | null;
  sourcePath?: string | null;
  storageUri: string | null;
  sha256?: string | null;
  bytes: number;
  durationSec?: number | null;
  channels?: number | null;
  audioTopology?: AudioInputTopology | null;
  mediaPreparationVersion?: string | null;
  audioLifecycle?: AudioLifecycle;
  status: RecordingStatus;
  error?: string | null;
}

/** Explicitly unscoped for queue/service execution only. */
export async function getRecordingBySha256ForWorker(
  sha256: string,
): Promise<RecordingRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, workspace_id, source, student_id, source_path, storage_uri, sha256, bytes,
             duration_sec, channels, audio_topology, media_preparation_version, audio_lifecycle,
             audio_deletion_requested_at, audio_deleted_at, audio_deletion_attempt_count,
             audio_deletion_error_code, audio_deletion_next_attempt_at,
             status, error, created_at, updated_at
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

/** Explicitly unscoped for queue/service execution only. */
export async function listRecordingsBySha256ForWorker(sha256: string): Promise<RecordingRecord[]> {
  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, workspace_id, source, student_id, source_path, storage_uri, sha256, bytes,
             duration_sec, channels, audio_topology, media_preparation_version, audio_lifecycle,
             audio_deletion_requested_at, audio_deleted_at, audio_deletion_attempt_count,
             audio_deletion_error_code, audio_deletion_next_attempt_at,
             status, error, created_at, updated_at
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

export async function listRecordingsBySha256ForWorkspace(
  sha256: string,
  workspaceId: string,
): Promise<RecordingRecord[]> {
  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `SELECT * FROM recordings WHERE sha256 = $1 AND workspace_id = $2
       ORDER BY created_at DESC, id DESC`,
      [sha256, workspaceId],
    );
    return result.rows;
  });
  return rows.map((row) => mapRowToRecording(row));
}

/** Explicitly unscoped for queue/service execution only. */
export async function getRecordingByIdForWorker(id: string): Promise<RecordingRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, workspace_id, source, student_id, source_path, storage_uri, sha256, bytes,
             duration_sec, channels, audio_topology, media_preparation_version, audio_lifecycle,
             audio_deletion_requested_at, audio_deleted_at, audio_deletion_attempt_count,
             audio_deletion_error_code, audio_deletion_next_attempt_at,
             status, error, created_at, updated_at
      FROM recordings
      WHERE id = $1
      `,
      [id],
    );
    return result.rows[0];
  });

  return row ? mapRowToRecording(row) : null;
}

export async function getRecordingByIdForWorkspace(
  id: string,
  workspaceId: string,
): Promise<RecordingRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `SELECT * FROM recordings WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
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
      SELECT id, workspace_id, source, student_id, source_path, storage_uri, sha256, bytes,
             duration_sec, channels, audio_topology, audio_lifecycle,
             audio_deletion_requested_at, audio_deleted_at, audio_deletion_attempt_count,
             audio_deletion_error_code, audio_deletion_next_attempt_at,
             status, error, created_at, updated_at
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

export async function insertRecording(
  params: InsertRecordingParams,
  options?: { client?: PoolClient },
): Promise<RecordingRecord> {
  const id = params.id ?? randomUUID();
  const now = new Date();

  const write = async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO recordings (
        id,
        workspace_id,
        source,
        student_id,
        source_path,
        storage_uri,
        sha256,
        bytes,
        duration_sec,
        channels,
        audio_topology,
        media_preparation_version,
        audio_lifecycle,
        status,
        error,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING
        id,
        workspace_id,
        source,
        student_id,
        source_path,
        storage_uri,
        sha256,
        bytes,
        duration_sec,
        channels,
        audio_topology,
        media_preparation_version,
        audio_lifecycle,
        audio_deletion_requested_at, audio_deleted_at, audio_deletion_attempt_count,
        audio_deletion_error_code, audio_deletion_next_attempt_at,
        status,
        error,
        created_at,
        updated_at
      `,
      [
        id,
        params.workspaceId,
        params.source,
        params.studentId ?? null,
        params.sourcePath ?? null,
        params.storageUri,
        params.sha256 ?? null,
        params.bytes,
        params.durationSec ?? null,
        params.channels ?? null,
        params.audioTopology ?? null,
        params.mediaPreparationVersion ?? null,
        params.audioLifecycle ?? (params.storageUri ? 'retained' : 'not_retained'),
        params.status,
        params.error ?? null,
        now,
        now,
      ],
    );
    return result.rows[0];
  };
  const row = options?.client ? await write(options.client) : await withPgClient(write);

  logger.info('Recording inserted', { recordingId: id });

  return mapRowToRecording(row);
}

export async function insertCachedRecordingLineage(params: {
  recording: InsertRecordingParams;
  transcript: InsertTranscriptParams;
  uploadOperation?: { id: string; attemptToken: string };
}): Promise<{ recording: RecordingRecord; transcript: TranscriptRecord }> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const recording = await insertRecording(params.recording, { client });
      const transcript = await insertTranscript(params.transcript, { client });
      if (
        params.uploadOperation &&
        !(await completeRecordingUploadOperation({
          client,
          operationId: params.uploadOperation.id,
          attemptToken: params.uploadOperation.attemptToken,
          recordingId: recording.id,
          candidateUri: null,
        }))
      ) {
        throw new Error('Recording upload operation lost ownership before cache adoption.');
      }
      await client.query('COMMIT');
      return { recording, transcript };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

/** The recording and its execution authority are one durable transaction. */
export async function insertRecordingWithQueuedTranscriptionRun(params: {
  recording: InsertRecordingParams;
  provider: import('@esl-pipeline/contracts').SttProviderId;
  requestProfile: string;
  uploadOperation?: { id: string; attemptToken: string; candidateUri: string };
}): Promise<{ recording: RecordingRecord; run: TranscriptionRun }> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const recording = await insertRecording(params.recording, { client });
      const run = await createQueuedTranscriptionRun({
        recordingId: recording.id,
        workspaceId: recording.workspaceId,
        provider: params.provider,
        requestProfile: params.requestProfile,
        client,
      });
      if (
        params.uploadOperation &&
        !(await completeRecordingUploadOperation({
          client,
          operationId: params.uploadOperation.id,
          attemptToken: params.uploadOperation.attemptToken,
          recordingId: recording.id,
          candidateUri: params.uploadOperation.candidateUri,
        }))
      ) {
        throw new Error('Recording upload operation lost ownership before storage adoption.');
      }
      await client.query('COMMIT');
      return { recording, run };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
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
      RETURNING *
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

export async function updateRecordingAudioTopology(params: {
  id: string;
  audioTopology: AudioInputTopology;
}): Promise<RecordingRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `UPDATE recordings SET audio_topology = $2, updated_at = now() WHERE id = $1
       RETURNING *`,
      [params.id, params.audioTopology],
    );
    return result.rows[0];
  });
  return row ? mapRowToRecording(row) : null;
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
      RETURNING *
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
  workspaceId: string;
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
  const { workspaceId, statuses, sources, search, studentId, limit, offset, order } = options;
  const values: (string | string[] | number)[] = [];
  const clauses: string[] = [];
  values.push(workspaceId);
  clauses.push(`r.workspace_id = $${values.length}`);

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
        r.workspace_id,
        r.source,
        r.student_id,
        r.source_path,
        r.storage_uri,
        r.sha256,
        r.bytes,
        r.duration_sec,
        r.channels,
        r.audio_topology,
        r.media_preparation_version,
        r.audio_lifecycle,
        r.audio_deletion_requested_at,
        r.audio_deleted_at,
        r.audio_deletion_attempt_count,
        r.audio_deletion_error_code,
        r.audio_deletion_next_attempt_at,
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
  workspaceId: string,
  statuses?: RecordingStatus[],
  studentId?: string | null,
  sources?: RecordingSource[],
  search?: string | null,
): Promise<number> {
  const values: (string | string[])[] = [];
  const clauses: string[] = [];
  values.push(workspaceId);
  clauses.push(`workspace_id = $${values.length}`);

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
    workspaceId: row.workspace_id,
    source,
    studentId: row.student_id ?? null,
    sourcePath: row.source_path ?? null,
    storageUri: row.storage_uri,
    sha256: row.sha256 ?? null,
    bytes: Number.isNaN(bytes) ? 0 : bytes,
    durationSec: row.duration_sec ?? null,
    channels: row.channels ?? null,
    audioTopology: row.audio_topology ? AudioInputTopologySchema.parse(row.audio_topology) : null,
    mediaPreparationVersion: row.media_preparation_version ?? null,
    audioLifecycle: AudioLifecycleSchema.parse(row.audio_lifecycle),
    audioDeletionRequestedAt: row.audio_deletion_requested_at ?? null,
    audioDeletedAt: row.audio_deleted_at ?? null,
    audioDeletionAttemptCount: row.audio_deletion_attempt_count ?? 0,
    audioDeletionErrorCode: row.audio_deletion_error_code ?? null,
    audioDeletionNextAttemptAt: row.audio_deletion_next_attempt_at ?? null,
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
