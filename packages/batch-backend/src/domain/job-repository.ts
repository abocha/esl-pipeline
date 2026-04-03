// packages/batch-backend/src/domain/job-repository.ts
// PostgreSQL-backed repository for JobRecord.
// - Uses withPgClient() from infrastructure/db.
// - All queries parameterized.
// - State transitions guarded by expectedState to avoid races.
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';

import type { VoiceProviderErrorCategory } from '@esl-pipeline/contracts';

import { buildLearningPresetProvenance } from '../application/learning-preset.js';
import { withPgClient } from '../infrastructure/db.js';
import { logger } from '../infrastructure/logger.js';
import {
  assertTransition,
  GoogleTtsModel,
  JobRecord,
  JobState,
  JobUploadOption,
  PublishTarget,
  TtsProviderId,
  TtsStrategy,
} from './job-model.js';

/**
 * PostgreSQL row structure for jobs table
 */
interface JobRow {
  id: string;
  student_id?: string | null;
  student_name?: string | null;
  state: string;
  md: string | null;
  md_storage_uri: string | null;
  recording_id: string | null;
  transcript_id: string | null;
  prompt_package_id: string | null;
  draft_id: string | null;
  preset: string | null;
  learning_preset_id: string | null;
  learning_preset_version: string | null;
  prompt_snapshot_version: string | null;
  prompt_alias: string | null;
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
  publish_target: string | null;
  mode: string | null;
  tts_provider: string | null;
  google_tts_model: string | null;
  notion_url: string | null;
  anytype_url: string | null;
  html_url: string | null;
  auto_publish: boolean | null;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
  manifest_path: string | null;
  source_job_id?: string | null;
}

// insertJob.declaration()
export interface InsertJobParams {
  md?: string | null;
  mdStorageUri?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  promptPackageId?: string | null;
  draftId?: string | null;
  preset?: string;
  learningPresetId?: string | null;
  learningPresetVersion?: string | null;
  promptSnapshotVersion?: string | null;
  promptAlias?: string | null;
  withTts?: boolean;
  upload?: JobUploadOption | null;
  voiceId?: string;
  voiceAccent?: string;
  forceTts?: boolean;
  notionDatabase?: string;
  publishTarget?: PublishTarget;
  ttsStrategy?: TtsStrategy;
  ttsProvider?: TtsProviderId;
  googleTtsModel?: GoogleTtsModel;
  userId?: string;
  autoPublish?: boolean;
  sourceJobId?: string | null;
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

export interface ReadinessMetricsFilters {
  from: Date;
  to: Date;
  userId?: string | null;
}

export interface ReadinessMetricsSnapshot {
  publishSucceeded: number;
  publishFailed: number;
  publishTotal: number;
  latencySampleSize: number;
  medianPublishLatencyMs: number | null;
  firstSessionTotalUsers: number;
  firstSessionSucceededUsers: number;
  voiceValidationFailures: number;
  voiceStrictMismatches: number;
  voiceProviderErrors: number;
  voiceProviderErrorBreakdown: Partial<Record<VoiceProviderErrorCategory, number>>;
  voiceFallbackSelections: number | null;
  voiceReuseSelections: number | null;
}

interface FailedJobErrorRow {
  error: string | null;
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
  learningPresetId?: string;
  notionDatabase?: string;
  publishTarget?: PublishTarget;
  withTts?: boolean;
  forceTts?: boolean;
  ttsStrategy?: TtsStrategy;
  ttsProvider?: TtsProviderId;
  googleTtsModel?: GoogleTtsModel;
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

async function insertJobWithState(params: InsertJobParams, state: JobState): Promise<JobRecord> {
  const id = randomUUID();
  const now = new Date();

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      String.raw`
      INSERT INTO jobs (
        id,
        state,
        md,
        md_storage_uri,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
        preset,
        learning_preset_id,
        learning_preset_version,
        prompt_snapshot_version,
        prompt_alias,
        with_tts,
        upload,
        voice_id,
        voice_accent,
        force_tts,
        notion_database,
        publish_target,
        mode,
        tts_provider,
        google_tts_model,
        auto_publish,
        source_job_id,
        created_at,
        updated_at,
        user_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28
      )
      RETURNING
        id,
        student_id,
        (SELECT s.student FROM students s WHERE s.id = jobs.student_id) AS student_name,
        state,
        md,
        md_storage_uri,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
        preset,
        learning_preset_id,
        learning_preset_version,
        prompt_snapshot_version,
        prompt_alias,
        with_tts,
        upload,
        voice_id,
        voice_accent,
        force_tts,
        notion_database,
        publish_target,
        mode,
        tts_provider,
        google_tts_model,
        notion_url,
        anytype_url,
        html_url,
        auto_publish,
        created_at,
        updated_at,
        started_at,
        finished_at,
        error,
        manifest_path,
        source_job_id,
        user_id
      `,
      [
        id,
        state,
        params.md ?? null,
        params.mdStorageUri ?? null,
        params.recordingId ?? null,
        params.transcriptId ?? null,
        params.promptPackageId ?? null,
        params.draftId ?? null,
        params.preset ?? null,
        params.learningPresetId ?? null,
        params.learningPresetVersion ?? null,
        params.promptSnapshotVersion ?? null,
        params.promptAlias ?? null,
        params.withTts ?? false,
        params.upload ?? null,
        params.voiceId ?? null,
        params.voiceAccent ?? null,
        params.forceTts ?? null,
        params.notionDatabase ?? null,
        params.publishTarget ?? null,
        params.ttsStrategy ?? null,
        params.ttsProvider ?? null,
        params.googleTtsModel ?? null,
        params.autoPublish ?? false,
        params.sourceJobId ?? null,
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
      String.raw`
      SELECT
        j.id,
        j.student_id,
        (SELECT s.student FROM students s WHERE s.id = j.student_id) AS student_name,
        j.state,
        j.md,
        j.md_storage_uri,
        j.recording_id,
        j.transcript_id,
        j.prompt_package_id,
        j.draft_id,
        j.preset,
        j.learning_preset_id,
        j.learning_preset_version,
        j.prompt_snapshot_version,
        j.prompt_alias,
        j.with_tts,
        j.upload,
        j.voice_id,
        j.voice_accent,
        j.force_tts,
        j.notion_database,
        j.publish_target,
        j.mode,
        j.tts_provider,
        j.google_tts_model,
        j.notion_url,
        j.anytype_url,
        j.html_url,
        j.auto_publish,
        j.created_at,
        j.updated_at,
        j.started_at,
        j.finished_at,
        j.error,
        j.manifest_path,
        j.source_job_id,
        j.user_id
      FROM jobs j
      WHERE j.id = $1
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
        j.student_id,
        (SELECT s.student FROM students s WHERE s.id = j.student_id) AS student_name,
        j.state,
        j.md,
        j.md_storage_uri,
        j.recording_id,
        j.transcript_id,
        j.prompt_package_id,
        j.draft_id,
        j.preset,
        j.learning_preset_id,
        j.learning_preset_version,
        j.prompt_snapshot_version,
        j.prompt_alias,
        j.with_tts,
        j.upload,
        j.voice_id,
        j.voice_accent,
        j.force_tts,
        j.notion_database,
        j.publish_target,
        j.mode,
        j.tts_provider,
        j.google_tts_model,
        j.notion_url,
        j.anytype_url,
        j.html_url,
        j.auto_publish,
        j.created_at,
        j.updated_at,
        j.started_at,
        j.finished_at,
        j.error,
        j.manifest_path,
        j.source_job_id,
        j.user_id
      FROM jobs j
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

export async function getReadinessMetrics(
  filters: ReadinessMetricsFilters,
): Promise<ReadinessMetricsSnapshot> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      String.raw`
      WITH window_jobs AS (
        SELECT
          j.id,
          j.user_id,
          j.state,
          j.publish_target,
          j.created_at,
          j.finished_at,
          j.error
        FROM jobs j
        WHERE j.created_at >= $1
          AND j.created_at <= $2
          AND ($3::uuid IS NULL OR j.user_id = $3::uuid)
      ),
      publish_jobs AS (
        SELECT *
        FROM window_jobs
        WHERE publish_target IN ('notion', 'anytype', 'html')
      ),
      terminal_publish_jobs AS (
        SELECT *
        FROM publish_jobs
        WHERE state IN ('succeeded', 'failed')
      ),
      first_session_candidates AS (
        SELECT
          user_id,
          state,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC, id ASC) AS rank_in_window
        FROM publish_jobs
        WHERE user_id IS NOT NULL
      ),
      first_session AS (
        SELECT
          COUNT(*)::int AS total_users,
          COUNT(*) FILTER (WHERE state = 'succeeded')::int AS succeeded_users
        FROM first_session_candidates
        WHERE rank_in_window = 1
      ),
      terminal_aggregates AS (
        SELECT
          COUNT(*) FILTER (WHERE state = 'succeeded')::int AS publish_succeeded,
          COUNT(*) FILTER (WHERE state = 'failed')::int AS publish_failed,
          COUNT(*)::int AS publish_total,
          COUNT(*) FILTER (WHERE state = 'succeeded' AND finished_at IS NOT NULL)::int AS latency_sample_size,
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (finished_at - created_at)) * 1000
          ) FILTER (WHERE state = 'succeeded' AND finished_at IS NOT NULL)
            AS median_publish_latency_ms
        FROM terminal_publish_jobs
      ),
      voice_alignment_aggregates AS (
        SELECT
          COUNT(*) FILTER (
            WHERE state = 'failed'
              AND error IS NOT NULL
              AND (
                error ILIKE '%Front matter:%'
                OR error ILIKE '%study_text_type%'
                OR error ILIKE '%speaker_profiles%'
                OR error ILIKE '%speaker_labels%'
              )
          )::int AS voice_validation_failures,
          COUNT(*) FILTER (
            WHERE state = 'failed'
              AND error IS NOT NULL
              AND (
                error ILIKE '%does not match study-text content%'
                OR error ILIKE '%unsupported accent%'
                OR error ILIKE '%unsupported style%'
                OR error ILIKE '%does not exist in the current voice catalog%'
                OR error ILIKE '%has no matching speaker_profile%'
              )
          )::int AS voice_strict_mismatches,
          COUNT(*) FILTER (
            WHERE state = 'failed'
              AND error IS NOT NULL
              AND error ~* '\\[(invalid_voice_id|unsupported_voice_capability|provider_rate_limit|provider_timeout|provider_contract_error)\\]'
          )::int AS voice_provider_errors,
          COUNT(*) FILTER (
            WHERE state = 'failed' AND error IS NOT NULL AND error ~* '\\[invalid_voice_id\\]'
          )::int AS provider_invalid_voice_id,
          COUNT(*) FILTER (
            WHERE state = 'failed' AND error IS NOT NULL AND error ~* '\\[unsupported_voice_capability\\]'
          )::int AS provider_unsupported_voice_capability,
          COUNT(*) FILTER (
            WHERE state = 'failed' AND error IS NOT NULL AND error ~* '\\[provider_rate_limit\\]'
          )::int AS provider_rate_limit,
          COUNT(*) FILTER (
            WHERE state = 'failed' AND error IS NOT NULL AND error ~* '\\[provider_timeout\\]'
          )::int AS provider_timeout,
          COUNT(*) FILTER (
            WHERE state = 'failed' AND error IS NOT NULL AND error ~* '\\[provider_contract_error\\]'
          )::int AS provider_contract_error,
          NULL::int AS voice_fallback_selections,
          NULL::int AS voice_reuse_selections
        FROM window_jobs
      )
      SELECT
        ta.publish_succeeded,
        ta.publish_failed,
        ta.publish_total,
        ta.latency_sample_size,
        ta.median_publish_latency_ms,
        fs.total_users::int AS first_session_total_users,
        fs.succeeded_users::int AS first_session_succeeded_users,
        va.voice_validation_failures,
        va.voice_strict_mismatches,
        va.voice_provider_errors,
        va.provider_invalid_voice_id,
        va.provider_unsupported_voice_capability,
        va.provider_rate_limit,
        va.provider_timeout,
        va.provider_contract_error,
        va.voice_fallback_selections,
        va.voice_reuse_selections
      FROM terminal_aggregates ta
      CROSS JOIN first_session fs
      CROSS JOIN voice_alignment_aggregates va
      `,
      [filters.from, filters.to, filters.userId ?? null],
    );
    return result.rows[0];
  });

  return {
    publishSucceeded: Number(row?.publish_succeeded ?? 0),
    publishFailed: Number(row?.publish_failed ?? 0),
    publishTotal: Number(row?.publish_total ?? 0),
    latencySampleSize: Number(row?.latency_sample_size ?? 0),
    medianPublishLatencyMs:
      row?.median_publish_latency_ms == null ? null : Number(row.median_publish_latency_ms),
    firstSessionTotalUsers: Number(row?.first_session_total_users ?? 0),
    firstSessionSucceededUsers: Number(row?.first_session_succeeded_users ?? 0),
    voiceValidationFailures: Number(row?.voice_validation_failures ?? 0),
    voiceStrictMismatches: Number(row?.voice_strict_mismatches ?? 0),
    voiceProviderErrors: Number(row?.voice_provider_errors ?? 0),
    voiceProviderErrorBreakdown: {
      invalid_voice_id: Number(row?.provider_invalid_voice_id ?? 0),
      unsupported_voice_capability: Number(row?.provider_unsupported_voice_capability ?? 0),
      provider_rate_limit: Number(row?.provider_rate_limit ?? 0),
      provider_timeout: Number(row?.provider_timeout ?? 0),
      provider_contract_error: Number(row?.provider_contract_error ?? 0),
    },
    voiceFallbackSelections:
      row?.voice_fallback_selections == null ? null : Number(row.voice_fallback_selections),
    voiceReuseSelections:
      row?.voice_reuse_selections == null ? null : Number(row.voice_reuse_selections),
  };
}

export async function listFailedJobErrorsForReadiness(
  filters: ReadinessMetricsFilters,
): Promise<string[]> {
  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT error
      FROM jobs
      WHERE created_at >= $1
        AND created_at <= $2
        AND ($3::uuid IS NULL OR user_id = $3::uuid)
        AND publish_target IS NOT NULL
        AND state = 'failed'
        AND error IS NOT NULL
      `,
      [filters.from, filters.to, filters.userId ?? null],
    );
    return result.rows as FailedJobErrorRow[];
  });

  return rows
    .map((row) => row.error)
    .filter((error): error is string => typeof error === 'string' && error.length > 0);
}

// updateJobStateAndResult.declaration()
export async function updateJobStateAndResult(args: {
  id: string;
  expectedState: JobState;
  nextState: JobState;
  error?: string | null;
  manifestPath?: string | null;
  notionUrl?: string | null;
  anytypeUrl?: string | null;
  htmlUrl?: string | null;
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
    anytypeUrl = null,
    htmlUrl = null,
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
        anytype_url = COALESCE($5, anytype_url),
        html_url = COALESCE($6, html_url),
        started_at = COALESCE($7, started_at),
        finished_at = COALESCE($8, finished_at),
        updated_at = now()
      WHERE id = $9
        AND state = $10
      RETURNING
        id,
        student_id,
        (SELECT s.student FROM students s WHERE s.id = jobs.student_id) AS student_name,
        state,
        md,
        md_storage_uri,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
        preset,
        learning_preset_id,
        learning_preset_version,
        prompt_snapshot_version,
        prompt_alias,
        with_tts,
        upload,
        voice_id,
        voice_accent,
        force_tts,
        notion_database,
        publish_target,
        mode,
        tts_provider,
        google_tts_model,
        notion_url,
        anytype_url,
        html_url,
        auto_publish,
        created_at,
        updated_at,
        started_at,
        finished_at,
        error,
        manifest_path,
        source_job_id,
        user_id
      `,
      [
        nextState,
        error,
        manifestPath,
        notionUrl,
        anytypeUrl,
        htmlUrl,
        startedAt,
        finishedAt,
        id,
        expectedState,
      ],
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
  md?: string | null;
  mdStorageUri?: string | null;
  draftId: string;
}): Promise<JobRecord | null> {
  const { id, expectedState, md = null, mdStorageUri = null, draftId } = args;

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE jobs
      SET
        md = COALESCE($1, md),
        md_storage_uri = COALESCE($2, md_storage_uri),
        draft_id = $3,
        updated_at = now()
      WHERE id = $4
        AND state = $5
      RETURNING
        id,
        student_id,
        (SELECT s.student FROM students s WHERE s.id = jobs.student_id) AS student_name,
        state,
        md,
        md_storage_uri,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
        preset,
        learning_preset_id,
        learning_preset_version,
        prompt_snapshot_version,
        prompt_alias,
        with_tts,
        upload,
        voice_id,
        voice_accent,
        force_tts,
        notion_database,
        publish_target,
        mode,
        tts_provider,
        google_tts_model,
        notion_url,
        anytype_url,
        html_url,
        auto_publish,
        created_at,
        updated_at,
        started_at,
        finished_at,
        error,
        manifest_path,
        source_job_id,
        user_id
      `,
      [md, mdStorageUri, draftId, id, expectedState],
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

  if (params.learningPresetId !== undefined) {
    const provenance = buildLearningPresetProvenance(params.learningPresetId);

    values.push(provenance.learningPresetId);
    updates.push(`learning_preset_id = $${values.length}`, 'preset = NULL');

    values.push(provenance.learningPresetVersion);
    updates.push(`learning_preset_version = $${values.length}`);

    values.push(provenance.promptSnapshotVersion);
    updates.push(`prompt_snapshot_version = $${values.length}`);

    values.push(provenance.promptAlias);
    updates.push(`prompt_alias = $${values.length}`);
  }

  if (params.notionDatabase !== undefined) {
    values.push(params.notionDatabase);
    updates.push(`notion_database = $${values.length}`);
  }

  if (params.publishTarget !== undefined) {
    values.push(params.publishTarget);
    updates.push(`publish_target = $${values.length}`);
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

  if (params.ttsProvider !== undefined) {
    values.push(params.ttsProvider);
    updates.push(`tts_provider = $${values.length}`);
  }

  if (params.googleTtsModel !== undefined) {
    values.push(params.googleTtsModel);
    updates.push(`google_tts_model = $${values.length}`);
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
        student_id,
        (SELECT s.student FROM students s WHERE s.id = jobs.student_id) AS student_name,
        state,
        md,
        md_storage_uri,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
        preset,
        learning_preset_id,
        learning_preset_version,
        prompt_snapshot_version,
        prompt_alias,
        with_tts,
        upload,
        voice_id,
        voice_accent,
        force_tts,
        notion_database,
        publish_target,
        mode,
        tts_provider,
        google_tts_model,
        notion_url,
        anytype_url,
        html_url,
        auto_publish,
        created_at,
        updated_at,
        started_at,
        finished_at,
        error,
        manifest_path,
        source_job_id,
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
  md?: string | null;
  mdStorageUri?: string | null;
}): Promise<JobRecord | null> {
  const { id, expectedState, md = null, mdStorageUri = null } = args;

  assertTransition(expectedState, 'queued');

  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE jobs
      SET
        state = 'queued',
        md = COALESCE($1, md),
        md_storage_uri = COALESCE($2, md_storage_uri),
        error = NULL,
        started_at = NULL,
        finished_at = NULL,
        manifest_path = NULL,
        notion_url = NULL,
        anytype_url = NULL,
        html_url = NULL,
        updated_at = now()
      WHERE id = $3
        AND state = $4
        AND (COALESCE($1, md) IS NOT NULL OR COALESCE($2, md_storage_uri) IS NOT NULL)
      RETURNING
        id,
        student_id,
        (SELECT s.student FROM students s WHERE s.id = jobs.student_id) AS student_name,
        state,
        md,
        md_storage_uri,
        recording_id,
        transcript_id,
        prompt_package_id,
        draft_id,
        preset,
        learning_preset_id,
        learning_preset_version,
        prompt_snapshot_version,
        prompt_alias,
        with_tts,
        upload,
        voice_id,
        voice_accent,
        force_tts,
        notion_database,
        publish_target,
        mode,
        tts_provider,
        google_tts_model,
        notion_url,
        anytype_url,
        html_url,
        auto_publish,
        created_at,
        updated_at,
        started_at,
        finished_at,
        error,
        manifest_path,
        source_job_id,
        user_id
      `,
      [md, mdStorageUri, id, expectedState],
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
        j.student_id,
        MAX(COALESCE(j.finished_at, j.updated_at, j.created_at)) AS last_lesson_at,
        COUNT(*) FILTER (WHERE j.state = 'awaiting_approval')::int AS pending_drafts
      FROM jobs j
      WHERE j.student_id = ANY($1::uuid[])
      GROUP BY j.student_id
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
    studentId: row.student_id ?? null,
    studentName: row.student_name ?? null,
    state: row.state as JobState,
    md: row.md,
    mdStorageUri: row.md_storage_uri ?? null,
    recordingId: row.recording_id ?? null,
    transcriptId: row.transcript_id ?? null,
    promptPackageId: row.prompt_package_id ?? null,
    draftId: row.draft_id ?? null,
    preset: row.preset ?? null,
    learningPresetId: row.learning_preset_id ?? null,
    learningPresetVersion: row.learning_preset_version ?? null,
    promptSnapshotVersion: row.prompt_snapshot_version ?? null,
    promptAlias: row.prompt_alias ?? null,
    withTts: row.with_tts ?? null,
    upload: normalizeUploadOption(row.upload),
    voiceId: row.voice_id ?? null,
    voiceAccent: row.voice_accent ?? null,
    forceTts: row.force_tts ?? null,
    notionDatabase: row.notion_database ?? null,
    publishTarget: normalizePublishTarget(row.publish_target),
    ttsStrategy: normalizeTtsStrategy(row.mode, { jobId: row.id }),
    ttsProvider: normalizeTtsProvider(row.tts_provider, { jobId: row.id }),
    googleTtsModel: normalizeGoogleTtsModel(row.google_tts_model, { jobId: row.id }),
    notionUrl: row.notion_url ?? null,
    anytypeUrl: row.anytype_url ?? null,
    htmlUrl: row.html_url ?? null,
    autoPublish: row.auto_publish ?? false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    manifestPath: row.manifest_path,
    userId: row.user_id,
    sourceJobId: row.source_job_id ?? null,
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
    clauses.push(`j.student_id = $${values.length}`);
  }

  return clauses;
}

function normalizePublishTarget(value: string | null | undefined): PublishTarget | null {
  if (value === 'notion' || value === 'anytype' || value === 'html') {
    return value;
  }
  return null;
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

function normalizeTtsProvider(value: unknown, ctx: { jobId: string }): TtsProviderId | null {
  if (value == null) return null;
  if (value === 'elevenlabs' || value === 'google') return value;
  if (typeof value === 'string') {
    throw new TypeError(
      `Unsupported jobs.tts_provider value "${value}" for job ${ctx.jobId}; migrate legacy rows before running this version`,
    );
  }
  throw new Error(
    `Unsupported jobs.tts_provider value type "${typeof value}" for job ${ctx.jobId}; expected null or a TtsProviderId string`,
  );
}

function normalizeGoogleTtsModel(value: unknown, ctx: { jobId: string }): GoogleTtsModel | null {
  if (value == null) return null;
  if (value === 'chirp3_hd' || value === 'studio' || value === 'neural2' || value === 'wavenet') {
    return value;
  }
  if (typeof value === 'string') {
    throw new TypeError(
      `Unsupported jobs.google_tts_model value "${value}" for job ${ctx.jobId}; migrate legacy rows before running this version`,
    );
  }
  throw new Error(
    `Unsupported jobs.google_tts_model value type "${typeof value}" for job ${ctx.jobId}; expected null or a GoogleTtsModel string`,
  );
}

const JOB_UPLOAD_OPTIONS: ReadonlySet<JobUploadOption> = new Set(['auto', 's3', 'none']);

function normalizeUploadOption(value: unknown): JobUploadOption | null {
  if (typeof value !== 'string') return null;
  return JOB_UPLOAD_OPTIONS.has(value as JobUploadOption) ? (value as JobUploadOption) : null;
}
