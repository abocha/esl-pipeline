// packages/batch-backend/src/domain/job-repository.ts

// PostgreSQL-backed repository for JobRecord.
// - Uses withPgClient() from infrastructure/db.
// - All queries parameterized.
// - State transitions guarded by expectedState to avoid races.

import { randomUUID } from 'crypto';
import { withPgClient } from '../infrastructure/db';
import { JobRecord, JobState, assertTransition } from './job-model';
import { logger } from '../infrastructure/logger';

// insertJob.declaration()
export async function insertJob(params: {
  md: string;
  preset?: string;
  withTts?: boolean;
  upload?: string;
}): Promise<JobRecord> {
  const id = randomUUID();
  const now = new Date();

  const row = await withPgClient(async client => {
    const result = await client.query(
      `
      INSERT INTO jobs (id, state, md, preset, with_tts, upload, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
      RETURNING id, state, md, preset, with_tts, upload,
                created_at, updated_at, started_at, finished_at, error, manifest_path
      `,
      [
        id,
        'queued',
        params.md,
        params.preset ?? null,
        params.withTts ?? false,
        params.upload ?? null,
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
        started_at = COALESCE($4, started_at),
        finished_at = COALESCE($5, finished_at),
        updated_at = now()
      WHERE id = $6
        AND state = $7
      RETURNING id, state, md, preset, with_tts, upload,
                created_at, updated_at, started_at, finished_at, error, manifest_path
      `,
      [nextState, error, manifestPath, startedAt, finishedAt, id, expectedState]
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    manifestPath: row.manifest_path,
  };
}
