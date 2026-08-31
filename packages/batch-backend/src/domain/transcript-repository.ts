import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import type { TranscriptProviderId } from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import { ArtifactWorkingConflictError } from './artifact-working-conflict.js';
import {
  type TranscriptMode,
  TranscriptModeSchema,
  type TranscriptRecord,
} from './transcript-model.js';

interface TranscriptRow {
  id: string;
  recording_id: string;
  storage_uri: string;
  working_version: number | null;
  content_hash: string | null;
  raw_response_uri: string | null;
  mode: string;
  model: string;
  language: string;
  stt_provider: TranscriptProviderId;
  fallback_used: boolean;
  summary_json: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export interface InsertTranscriptParams {
  id?: string;
  recordingId: string;
  storageUri: string;
  workingVersion: number;
  contentHash: string;
  rawResponseUri?: string | null;
  mode: TranscriptMode;
  model: string;
  language: string;
  sttProvider: TranscriptProviderId;
  fallbackUsed: boolean;
  summaryJson?: Record<string, unknown> | null;
}

export async function getTranscriptByRecordingId(
  recordingId: string,
): Promise<TranscriptRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, recording_id, storage_uri, working_version, content_hash,
             raw_response_uri, mode, model, language,
             stt_provider, fallback_used, summary_json, created_at, updated_at
      FROM transcripts
      WHERE recording_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [recordingId],
    );
    return result.rows[0];
  });

  return row ? mapRowToTranscript(row) : null;
}

export async function listLatestTranscriptsByRecordingIds(
  recordingIds: string[],
): Promise<TranscriptRecord[]> {
  if (recordingIds.length === 0) {
    return [];
  }

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT DISTINCT ON (recording_id)
             id, recording_id, storage_uri, working_version, content_hash,
             raw_response_uri, mode, model, language,
             stt_provider, fallback_used, summary_json, created_at, updated_at
      FROM transcripts
      WHERE recording_id = ANY($1::uuid[])
        AND working_version IS NOT NULL
        AND content_hash IS NOT NULL
      ORDER BY recording_id, created_at DESC, id DESC
      `,
      [recordingIds],
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToTranscript(row));
}

export async function insertTranscript(
  params: InsertTranscriptParams,
  options?: { client?: PoolClient },
): Promise<TranscriptRecord> {
  const id = params.id ?? randomUUID();
  const now = new Date();

  const write = async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO transcripts (
        id,
        recording_id,
        storage_uri,
        working_version,
        content_hash,
        raw_response_uri,
        mode,
        model,
        language,
        stt_provider,
        fallback_used,
        summary_json,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING
        id,
        recording_id,
        storage_uri,
        working_version,
        content_hash,
        raw_response_uri,
        mode,
        model,
        language,
        stt_provider,
        fallback_used,
        summary_json,
        created_at,
        updated_at
      `,
      [
        id,
        params.recordingId,
        params.storageUri,
        params.workingVersion,
        params.contentHash,
        params.rawResponseUri ?? null,
        params.mode,
        params.model,
        params.language,
        params.sttProvider,
        params.fallbackUsed,
        params.summaryJson ?? null,
        now,
        now,
      ],
    );
    return result.rows[0];
  };
  const row = options?.client ? await write(options.client) : await withPgClient(write);

  logger.info('Transcript inserted', { transcriptId: id, recordingId: params.recordingId });

  return mapRowToTranscript(row);
}

export async function updateTranscriptWorkingContent(params: {
  id: string;
  expectedWorkingVersion: number;
  storageUri: string;
  contentHash: string;
  summaryJson?: Record<string, unknown> | null;
}): Promise<TranscriptRecord> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE transcripts
      SET
        storage_uri = $3,
        content_hash = $4,
        summary_json = COALESCE($5, summary_json),
        working_version = working_version + 1,
        updated_at = now()
      WHERE id = $1 AND working_version = $2
      RETURNING
        id,
        recording_id,
        storage_uri,
        working_version,
        content_hash,
        raw_response_uri,
        mode,
        model,
        language,
        stt_provider,
        fallback_used,
        summary_json,
        created_at,
        updated_at
      `,
      [
        params.id,
        params.expectedWorkingVersion,
        params.storageUri,
        params.contentHash,
        params.summaryJson ?? null,
      ],
    );
    return result.rows[0];
  });

  if (!row) {
    const latest = await getTranscriptById(params.id);
    if (!latest) {
      throw new Error(`Transcript not found: ${params.id}`);
    }
    throw new ArtifactWorkingConflictError(latest);
  }

  logger.info('Transcript updated', { transcriptId: params.id });
  return mapRowToTranscript(row);
}

export async function getTranscriptById(id: string): Promise<TranscriptRecord | null> {
  return withPgClient((client) => getTranscriptByIdWithClient(client, id, false));
}

export async function getTranscriptByIdForUpdate(
  client: PoolClient,
  id: string,
): Promise<TranscriptRecord | null> {
  return getTranscriptByIdWithClient(client, id, true);
}

async function getTranscriptByIdWithClient(
  client: PoolClient,
  id: string,
  forUpdate: boolean,
): Promise<TranscriptRecord | null> {
  const result = await client.query(
    `
    SELECT id, recording_id, storage_uri, working_version, content_hash,
           raw_response_uri, mode, model, language, stt_provider, fallback_used,
           summary_json, created_at, updated_at
    FROM transcripts
    WHERE id = $1
    ${forUpdate ? 'FOR UPDATE' : ''}
    `,
    [id],
  );
  return result.rows[0] ? mapRowToTranscript(result.rows[0]) : null;
}

function mapRowToTranscript(row: TranscriptRow): TranscriptRecord {
  const mode = TranscriptModeSchema.parse(row.mode);
  return {
    id: row.id,
    recordingId: row.recording_id,
    storageUri: row.storage_uri,
    workingVersion: row.working_version,
    contentHash: row.content_hash,
    rawResponseUri: row.raw_response_uri ?? null,
    mode,
    model: row.model,
    language: row.language,
    sttProvider: row.stt_provider,
    fallbackUsed: row.fallback_used,
    summaryJson: row.summary_json ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
