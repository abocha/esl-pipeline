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
  auto_publish: boolean | null;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
  manifest_path: string | null;
}

// insertJob.declaration()
export interface InsertJobParams {
  md?: string | null;
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
  autoPublish?: boolean;
}

export interface JobListOptions {
  states?: JobState[];
  studentId?: string | null;
  from?: Date | null;
  to?: Date | null;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
  userId?: string | null;
}

export interface JobListFilters {
  states?: JobState[];
  studentId?: string | null;
  from?: Date | null;
  to?: Date | null;
  userId?: string | null;
}

export interface JobSummaryCounts {
  total: number;
  queued: number;
  running: number;
  awaitingApproval: number;
  succeeded: number;
  failed: number;
  ttsEnabled: number;
  ttsSucceeded: number;
}

export interface StudentJobSummaryRow {
  studentId: string;
  lastLessonAt: Date | null;
  pendingDrafts: number;
}

export interface UpdateJobMetadataParams {
  id: string;
  expectedState?: JobState;
  preset?: string;
  notionDatabase?: string;
  withTts?: boolean;
  forceTts?: boolean;
  ttsStrategy?: TtsStrategy;
  upload?: JobUploadOption | null;
  voiceId?: string;
  voiceAccent?: string;
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
        auto_publish,
        created_at,
        updated_at,
        user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING
        id,
        state,
        md,
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
        auto_publish,
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
        params.autoPublish ?? false,
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
             recording_id, transcript_id, prompt_package_id, draft_id,
             preset, with_tts, upload,
             voice_id, voice_accent, force_tts, notion_database, mode, notion_url, auto_publish,
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

export async function listJobs(options: JobListOptions): Promise<JobRecord[]> {
  const values: (string | string[] | number | Date)[] = [];
  const clauses = buildJobFilterClauses(options, values);
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const orderDirection = options.order === 'asc' ? 'ASC' : 'DESC';

  values.push(options.limit);
  const limitParam = values.length;
  values.push(options.offset);
  const offsetParam = values.length;

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        j.id,
        j.state,
        j.md,
        j.recording_id,
        j.transcript_id,
        j.prompt_package_id,
        j.draft_id,
        j.preset,
        j.with_tts,
        j.upload,
        j.voice_id,
        j.voice_accent,
        j.force_tts,
        j.notion_database,
        j.mode,
        j.notion_url,
        j.auto_publish,
        j.created_at,
        j.updated_at,
        j.started_at,
        j.finished_at,
        j.error,
        j.manifest_path,
        j.user_id
      FROM jobs j
      LEFT JOIN recordings r ON r.id = j.recording_id
      LEFT JOIN prompt_packages p ON p.id = j.prompt_package_id
      LEFT JOIN recordings rp ON rp.id = p.recording_id
      LEFT JOIN drafts d ON d.id = j.draft_id
      LEFT JOIN prompt_packages pd ON pd.id = d.prompt_package_id
      LEFT JOIN recordings rd ON rd.id = pd.recording_id
      ${whereClause}
      ORDER BY j.created_at ${orderDirection}, j.id ${orderDirection}
      LIMIT $${limitParam} OFFSET $${offsetParam}
      `,
      values,
    );
    return result.rows;
  });

  return rows.map((row) => mapRowToJob(row));
}

export async function countJobs(filters: JobListFilters = {}): Promise<number> {
  const values: (string | string[] | Date)[] = [];
  const clauses = buildJobFilterClauses(filters, values);
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const result = await withPgClient(async (client: PoolClient) => {
    const queryResult = await client.query(
      `
      SELECT COUNT(*) as count
      FROM jobs j
      LEFT JOIN recordings r ON r.id = j.recording_id
      LEFT JOIN prompt_packages p ON p.id = j.prompt_package_id
      LEFT JOIN recordings rp ON rp.id = p.recording_id
      LEFT JOIN drafts d ON d.id = j.draft_id
      LEFT JOIN prompt_packages pd ON pd.id = d.prompt_package_id
      LEFT JOIN recordings rd ON rd.id = pd.recording_id
      ${whereClause}
      `,
      values,
    );
    return queryResult;
  });

  return Number.parseInt(result.rows[0]?.count ?? '0', 10);
}

export async function getJobSummary(filters: JobListFilters = {}): Promise<JobSummaryCounts> {
  const values: (string | string[] | Date)[] = [];
  const clauses = buildJobFilterClauses(filters, values);
  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE j.state = 'queued')::int as queued,
        COUNT(*) FILTER (WHERE j.state = 'running')::int as running,
        COUNT(*) FILTER (WHERE j.state = 'awaiting_approval')::int as awaiting_approval,
        COUNT(*) FILTER (WHERE j.state = 'succeeded')::int as succeeded,
        COUNT(*) FILTER (WHERE j.state = 'failed')::int as failed,
        COUNT(*) FILTER (WHERE j.with_tts IS TRUE)::int as tts_enabled,
        COUNT(*) FILTER (WHERE j.with_tts IS TRUE AND j.state = 'succeeded')::int as tts_succeeded
      FROM jobs j
      LEFT JOIN recordings r ON r.id = j.recording_id
      LEFT JOIN prompt_packages p ON p.id = j.prompt_package_id
      LEFT JOIN recordings rp ON rp.id = p.recording_id
      LEFT JOIN drafts d ON d.id = j.draft_id
      LEFT JOIN prompt_packages pd ON pd.id = d.prompt_package_id
      LEFT JOIN recordings rd ON rd.id = pd.recording_id
      ${whereClause}
      `,
      values,
    );
    return result.rows[0];
  });

  return {
    total: row?.total ?? 0,
    queued: row?.queued ?? 0,
    running: row?.running ?? 0,
    awaitingApproval: row?.awaiting_approval ?? 0,
    succeeded: row?.succeeded ?? 0,
    failed: row?.failed ?? 0,
    ttsEnabled: row?.tts_enabled ?? 0,
    ttsSucceeded: row?.tts_succeeded ?? 0,
  };
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
        auto_publish,
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
        auto_publish,
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

export async function updateJobMetadata(
  params: UpdateJobMetadataParams,
): Promise<JobRecord | null> {
  const values: (string | boolean | null)[] = [];
  const updates: string[] = [];

  if (params.preset !== undefined) {
    values.push(params.preset);
    updates.push(`preset = $${values.length}`);
  }

  if (params.notionDatabase !== undefined) {
    values.push(params.notionDatabase);
    updates.push(`notion_database = $${values.length}`);
  }

  if (params.withTts !== undefined) {
    values.push(params.withTts);
    updates.push(`with_tts = $${values.length}`);
  }

  if (params.forceTts !== undefined) {
    values.push(params.forceTts);
    updates.push(`force_tts = $${values.length}`);
  }

  if (params.ttsStrategy !== undefined) {
    values.push(params.ttsStrategy);
    updates.push(`mode = $${values.length}`);
  }

  if (params.upload !== undefined) {
    values.push(params.upload);
    updates.push(`upload = $${values.length}`);
  }

  if (params.voiceId !== undefined) {
    values.push(params.voiceId);
    updates.push(`voice_id = $${values.length}`);
  }

  if (params.voiceAccent !== undefined) {
    values.push(params.voiceAccent);
    updates.push(`voice_accent = $${values.length}`);
  }

  values.push(params.id);
  const idParam = values.length;
  let stateParam: number | null = null;
  if (params.expectedState) {
    values.push(params.expectedState);
    stateParam = values.length;
  }

  const setClause = updates.length > 0 ? `${updates.join(', ')}, ` : '';
  const whereClause = stateParam
    ? `WHERE id = $${idParam} AND state = $${stateParam}`
    : `WHERE id = $${idParam}`;

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE jobs
      SET
        ${setClause}
        updated_at = now()
      ${whereClause}
      RETURNING
        id,
        state,
        md,
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
        auto_publish,
        created_at,
        updated_at,
        started_at,
        finished_at,
        error,
        manifest_path,
        user_id
      `,
      values,
    );
    return result.rows[0];
  });

  if (!row) {
    logger.warn('No job row updated (state race or missing)', { jobId: params.id });
    return null;
  }

  logger.info('Job metadata updated', {
    jobId: params.id,
    updatedFields: updates.map((field) => field.split('=')[0]?.trim()),
  });

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
        auto_publish,
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

export async function getStudentJobSummaries(
  studentIds: string[],
): Promise<StudentJobSummaryRow[]> {
  if (!studentIds || studentIds.length === 0) return [];

  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT
        COALESCE(r.student_id, p.student_id, rp.student_id, d.student_id, pd.student_id, rd.student_id) AS student_id,
        MAX(COALESCE(j.finished_at, j.updated_at, j.created_at)) AS last_lesson_at,
        COUNT(*) FILTER (WHERE j.state = 'awaiting_approval')::int AS pending_drafts
      FROM jobs j
      LEFT JOIN recordings r ON r.id = j.recording_id
      LEFT JOIN prompt_packages p ON p.id = j.prompt_package_id
      LEFT JOIN recordings rp ON rp.id = p.recording_id
      LEFT JOIN drafts d ON d.id = j.draft_id
      LEFT JOIN prompt_packages pd ON pd.id = d.prompt_package_id
      LEFT JOIN recordings rd ON rd.id = pd.recording_id
      WHERE COALESCE(r.student_id, p.student_id, rp.student_id, d.student_id, pd.student_id, rd.student_id)
        = ANY($1::uuid[])
      GROUP BY COALESCE(r.student_id, p.student_id, rp.student_id, d.student_id, pd.student_id, rd.student_id)
      `,
      [studentIds],
    );
    return result.rows;
  });

  return rows.map((row) => ({
    studentId: row.student_id,
    lastLessonAt: row.last_lesson_at ?? null,
    pendingDrafts: row.pending_drafts ?? 0,
  }));
}

function mapRowToJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    state: row.state as JobState,
    md: row.md,
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
    autoPublish: row.auto_publish ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    manifestPath: row.manifest_path,
    userId: row.user_id,
  };
}

function buildJobFilterClauses(
  filters: JobListFilters,
  values: (string | string[] | number | Date)[],
): string[] {
  const clauses: string[] = [];

  if (filters.userId) {
    values.push(filters.userId);
    clauses.push(`j.user_id = $${values.length}`);
  }

  if (filters.states && filters.states.length > 0) {
    values.push(filters.states);
    clauses.push(`j.state = ANY($${values.length}::text[])`);
  }

  if (filters.from) {
    values.push(filters.from);
    clauses.push(`j.created_at >= $${values.length}`);
  }

  if (filters.to) {
    values.push(filters.to);
    clauses.push(`j.created_at <= $${values.length}`);
  }

  if (filters.studentId) {
    values.push(filters.studentId);
    clauses.push(
      `COALESCE(r.student_id, p.student_id, rp.student_id, d.student_id, pd.student_id, rd.student_id) = $${values.length}`,
    );
  }

  return clauses;
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
