// packages/batch-backend/src/domain/job-repository.ts
// PostgreSQL-backed repository for JobRecord.
// - Uses withPgClient() from infrastructure/db.
// - All queries parameterized.
// - State transitions guarded by expectedState to avoid races.
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import {
  JobRecord,
  JobState,
  JobUploadOption,
  TtsStrategy,
  assertTransition,
} from './job-model.js';

/**
 * PostgreSQL row structure for jobs table
 */
interface JobRow {
  id: string;
  state: string;
  md: string | null;
  transcribe_workdir: string | null;
  transcript_path: string | null;
  prompt_payload: string | null;
  prompt_notes: string | null;
  profile_path: string | null;
  recording_id: string | null;
  transcript_id: string | null;
  prompt_package_id: string | null;
  draft_id: string | null;
  preset: string | null;
  with_tts: boolean | null;
  upload: string | null;
  voice_id: string | null;
  voice_accent: string | null;
  force_tts: boolean | null;
  compress_image: boolean | null;
  user_id: string | null;
  created_at: Date;
  updated_at: Date;
  error_message: string | null;
  result_path: string | null;
  voice_accents: string | null;
  voice_persona: string | null;
  notion_database: string | null;
  mode: string | null;
  notion_url: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
  manifest_path: string | null;
}

// insertJob.declaration()
export interface InsertJobParams {
  md?: string | null;
  transcribeWorkdir?: string | null;
  transcriptPath?: string | null;
  promptPayload?: string | null;
  promptNotes?: string | null;
  profilePath?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  promptPackageId?: string | null;
  draftId?: string | null;
  preset?: string;
  withTts?: boolean;
  upload?: JobUploadOption | null;
  voiceId?: string;
  voiceAccent?: string;
  forceTts?: boolean;
  notionDatabase?: string;
  ttsStrategy?: TtsStrategy;
  userId?: string;
}

export async function insertJob(params: InsertJobParams): Promise<JobRecord> {
  return insertJobWithState(params, 'queued');
}

export async function insertApprovalJob(params: InsertJobParams): Promise<JobRecord> {
  return insertJobWithState(params, 'awaiting_approval');
}

async function insertJobWithState(
  params: InsertJobParams,
  state: JobState,
): Promise<JobRecord> {
  const id = randomUUID();
  const now = new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO jobs (
        id,
        state,
        md,
        transcribe_workdir,
        transcript_path,
        prompt_payload,
        prompt_notes,
        profile_path,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
        preset,
        with_tts,
        upload,
        voice_id,
        voice_accent,
        force_tts,
        notion_database,
        mode,
        created_at,
        updated_at,
        user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      RETURNING
        id,
        state,
        md,
        transcribe_workdir,
        transcript_path,
        prompt_payload,
        prompt_notes,
        profile_path,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
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
        manifest_path,
        user_id
      `,
      [
        id,
        state,
        params.md ?? null,
        params.transcribeWorkdir ?? null,
        params.transcriptPath ?? null,
        params.promptPayload ?? null,
        params.promptNotes ?? null,
        params.profilePath ?? null,
        params.recordingId ?? null,
        params.transcriptId ?? null,
        params.promptPackageId ?? null,
        params.draftId ?? null,
        params.preset ?? null,
        params.withTts ?? false,
        params.upload ?? null,
        params.voiceId ?? null,
        params.voiceAccent ?? null,
        params.forceTts ?? null,
        params.notionDatabase ?? null,
        params.ttsStrategy ?? null,
        now,
        now,
        params.userId ?? null,
      ],
    );
    return result.rows[0];
  });

  logger.info('Job inserted', { jobId: id, state });

  return mapRowToJob(row);
}

// getJobById.declaration()
export async function getJobById(id: string): Promise<JobRecord | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT id, state, md,
             transcribe_workdir, transcript_path, prompt_payload, prompt_notes, profile_path,
             recording_id, transcript_id, prompt_package_id, draft_id,
             preset, with_tts, upload,
             voice_id, voice_accent, force_tts, notion_database, mode, notion_url,
             created_at, updated_at, started_at, finished_at, error, manifest_path, user_id
      FROM jobs
      WHERE id = $1
      `,
      [id],
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

  const row = await withPgClient(async (client: PoolClient) => {
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
        transcribe_workdir,
        transcript_path,
        prompt_payload,
        prompt_notes,
        profile_path,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
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
        manifest_path,
        user_id
      `,
      [nextState, error, manifestPath, notionUrl, startedAt, finishedAt, id, expectedState],
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

export async function updateJobPromptData(args: {
  id: string;
  expectedState: JobState;
  nextState: JobState;
  transcriptPath?: string | null;
  promptPayload?: string | null;
  promptNotes?: string | null;
  profilePath?: string | null;
}): Promise<JobRecord | null> {
  const {
    id,
    expectedState,
    nextState,
    transcriptPath = null,
    promptPayload = null,
    promptNotes = null,
    profilePath = null,
  } = args;

  assertTransition(expectedState, nextState);

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE jobs
      SET
        state = $1,
        transcript_path = COALESCE($2, transcript_path),
        prompt_payload = COALESCE($3, prompt_payload),
        prompt_notes = COALESCE($4, prompt_notes),
        profile_path = COALESCE($5, profile_path),
        updated_at = now()
      WHERE id = $6
        AND state = $7
      RETURNING
        id,
        state,
        md,
        transcribe_workdir,
        transcript_path,
        prompt_payload,
        prompt_notes,
        profile_path,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
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
        manifest_path,
        user_id
      `,
      [nextState, transcriptPath, promptPayload, promptNotes, profilePath, id, expectedState],
    );
    return result.rows[0];
  });

  if (!row) {
    logger.warn('No job row updated (state race or missing)', { jobId: id });
    return null;
  }

  logger.info('Job prompt data updated', { jobId: id, state: row.state });
  return mapRowToJob(row);
}

export async function updateJobDraftLink(args: {
  id: string;
  expectedState: JobState;
  md: string;
  draftId: string;
}): Promise<JobRecord | null> {
  const { id, expectedState, md, draftId } = args;

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE jobs
      SET
        md = $1,
        draft_id = $2,
        updated_at = now()
      WHERE id = $3
        AND state = $4
      RETURNING
        id,
        state,
        md,
        transcribe_workdir,
        transcript_path,
        prompt_payload,
        prompt_notes,
        profile_path,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
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
        manifest_path,
        user_id
      `,
      [md, draftId, id, expectedState],
    );
    return result.rows[0];
  });

  if (!row) {
    logger.warn('No job row updated (state race or missing)', { jobId: id });
    return null;
  }

  logger.info('Job draft link updated', { jobId: id, draftId });
  return mapRowToJob(row);
}

export async function approveJob(args: {
  id: string;
  expectedState: JobState;
  md: string;
}): Promise<JobRecord | null> {
  const { id, expectedState, md } = args;

  assertTransition(expectedState, 'queued');

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE jobs
      SET
        state = 'queued',
        md = $1,
        error = NULL,
        started_at = NULL,
        finished_at = NULL,
        manifest_path = NULL,
        notion_url = NULL,
        updated_at = now()
      WHERE id = $2
        AND state = $3
      RETURNING
        id,
        state,
        md,
        transcribe_workdir,
        transcript_path,
        prompt_payload,
        prompt_notes,
        profile_path,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
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
        manifest_path,
        user_id
      `,
      [md, id, expectedState],
    );
    return result.rows[0];
  });

  if (!row) {
    logger.warn('No job row updated (state race or missing)', { jobId: id });
    return null;
  }

  logger.info('Job approved and re-queued', { jobId: id, state: row.state });
  return mapRowToJob(row);
}

function mapRowToJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    state: row.state as JobState,
    md: row.md,
    transcribeWorkdir: row.transcribe_workdir ?? null,
    transcriptPath: row.transcript_path ?? null,
    promptPayload: row.prompt_payload ?? null,
    promptNotes: row.prompt_notes ?? null,
    profilePath: row.profile_path ?? null,
    recordingId: row.recording_id ?? null,
    transcriptId: row.transcript_id ?? null,
    promptPackageId: row.prompt_package_id ?? null,
    draftId: row.draft_id ?? null,
    preset: row.preset ?? null,
    withTts: row.with_tts ?? null,
    upload: normalizeUploadOption(row.upload),
    voiceId: row.voice_id ?? null,
    voiceAccent: row.voice_accent ?? null,
    forceTts: row.force_tts ?? null,
    notionDatabase: row.notion_database ?? null,
    ttsStrategy: normalizeTtsStrategy(row.mode, { jobId: row.id }),
    notionUrl: row.notion_url ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    manifestPath: row.manifest_path,
    userId: row.user_id,
  };
}

function normalizeTtsStrategy(value: unknown, ctx: { jobId: string }): TtsStrategy | null {
  if (value == null) return null;
  if (value === 'auto' || value === 'dialogue' || value === 'tts') return value;
  if (typeof value === 'string') {
    throw new TypeError(
      `Unsupported jobs.mode value "${value}" for job ${ctx.jobId}; migrate legacy rows before running this version`,
    );
  }
  throw new Error(
    `Unsupported jobs.mode value type "${typeof value}" for job ${ctx.jobId}; expected null or a TtsStrategy string`,
  );
}

const JOB_UPLOAD_OPTIONS: ReadonlySet<JobUploadOption> = new Set(['auto', 's3', 'none']);

function normalizeUploadOption(value: unknown): JobUploadOption | null {
  if (typeof value !== 'string') return null;
  return JOB_UPLOAD_OPTIONS.has(value as JobUploadOption) ? (value as JobUploadOption) : null;
}
