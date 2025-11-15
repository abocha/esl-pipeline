// packages/batch-backend/src/domain/job-repository.ts

// PostgreSQL-backed repository for JobRecord.
// - Uses withPgClient() from infrastructure/db.
// - All queries parameterized.
// - State transitions guarded by expectedState to avoid races.

import { randomUUID } from 'crypto';
import { withPgClient } from '../infrastructure/db';
import { JobRecord, JobState, JobMode, assertTransition } from './job-model';
import { logger } from '../infrastructure/logger';

// insertJob.declaration()
export async function insertJob(params: {
  md: string;
  preset?: string;
  withTts?: boolean;
  upload?: string;
  voiceId?: string;
  voiceAccent?: string;
  forceTts?: boolean;
  notionDatabase?: string;
  mode?: JobMode;
}): Promise<JobRecord> {
  const id = randomUUID();
  const now = new Date();

  const row = await withPgClient(async client => {
    const result = await client.query(
      `
      INSERT INTO jobs (
        id,
        state,
        md,
        preset,
        with_tts,
        upload,
        voice_id,
        voice_accent,
        force_tts,
        notion_database,
        mode,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING
        id,
        state,
        md,
        preset,
        with_tts,
        upload,
        voice_id,
        voice_accent,
        force_tts,
        notion_database,
        mode,
        notion_url,
        created_at,
        updated_at,
        started_at,
        finished_at,
        error,
        manifest_path
      `,
      [
        id,
        'queued',
        params.md,
        params.preset ?? null,
        params.withTts ?? false,
        params.upload ?? null,
        params.voiceId ?? null,
        params.voiceAccent ?? null,
        params.forceTts ?? null,
        params.notionDatabase ?? null,
        params.mode ?? null,
        now,
        now,
      ]
    );
    return result.rows[0];
  });

  logger.info('Job inserted', { jobId: id });

  return mapRowToJob(row);
}

// getJobById.declaration()
export async function getJobById(id: string): Promise<JobRecord | null> {
  const row = await withPgClient(async client => {
    const result = await client.query(
      `
      SELECT id, state, md, preset, with_tts, upload,
             voice_id, voice_accent, force_tts, notion_database, mode, notion_url,
             created_at, updated_at, started_at, finished_at, error, manifest_path
      FROM jobs
      WHERE id = $1
      `,
      [id]
    );
    return result.rows[0];
  });

  return row ? mapRowToJob(row) : null;
}

// updateJobStateAndResult.declaration()
export async function updateJobStateAndResult(args: {
  id: string;
  expectedState: JobState;
  nextState: JobState;
  error?: string | null;
  manifestPath?: string | null;
  notionUrl?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}): Promise<JobRecord | null> {
  const {
    id,
    expectedState,
    nextState,
    error = null,
    manifestPath = null,
    startedAt = null,
    finishedAt = null,
    notionUrl = null,
  } = args;

  assertTransition(expectedState, nextState);

  const row = await withPgClient(async client => {
    const result = await client.query(
      `
      UPDATE jobs
      SET
        state = $1,
        error = COALESCE($2, error),
        manifest_path = COALESCE($3, manifest_path),
        notion_url = COALESCE($4, notion_url),
        started_at = COALESCE($5, started_at),
        finished_at = COALESCE($6, finished_at),
        updated_at = now()
      WHERE id = $7
        AND state = $8
      RETURNING
        id,
        state,
        md,
        preset,
        with_tts,
        upload,
        voice_id,
        voice_accent,
        force_tts,
        notion_database,
        mode,
        notion_url,
        created_at,
        updated_at,
        started_at,
        finished_at,
        error,
        manifest_path
      `,
      [nextState, error, manifestPath, notionUrl, startedAt, finishedAt, id, expectedState]
    );
    return result.rows[0];
  });

  if (!row) {
    logger.warn('No job row updated (state race or missing)', { jobId: id });
    return null;
  }

  logger.info('Job state updated', { jobId: id, state: row.state });
  return mapRowToJob(row);
}

function mapRowToJob(row: any): JobRecord {
  return {
    id: row.id,
    state: row.state,
    md: row.md,
    preset: row.preset ?? null,
    withTts: row.with_tts ?? null,
    upload: row.upload ?? null,
    voiceId: row.voice_id ?? null,
    voiceAccent: row.voice_accent ?? null,
    forceTts: row.force_tts ?? null,
    notionDatabase: row.notion_database ?? null,
    mode: normalizeJobMode(row.mode),
    notionUrl: row.notion_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    manifestPath: row.manifest_path,
  };
}

function normalizeJobMode(value: unknown): JobMode | null {
  if (value === 'auto' || value === 'dialogue' || value === 'monologue') {
    return value;
  }
  return null;
}
