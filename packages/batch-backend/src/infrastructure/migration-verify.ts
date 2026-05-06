import { PoolClient } from 'pg';

import { createPgPool } from './db.js';

export interface VerificationResult {
  ok: boolean;
  errors: string[];
}

const REQUIRED_TABLES = [
  'schema_migrations',
  'users',
  'jobs',
  'recordings',
  'transcripts',
  'prompt_packages',
  'drafts',
  'profile_revisions',
  'template_revisions',
  'students',
  'profiles',
  'templates',
  'student_profile_bindings',
  'job_action_history',
  'generation_budget_counters',
  'user_settings',
  'uploaded_files',
  'workspaces',
  'workspace_memberships',
  'student_lesson_plans',
  'student_lessons',
  'student_credit_events',
  'student_payment_records',
  'student_reminder_preferences',
];

const REQUIRED_CONSTRAINTS = [
  'users_role_check',
  'users_email_check',
  'jobs_state_check',
  'jobs_mode_check',
  'jobs_user_id_fkey',
  'jobs_source_job_id_fkey',
  'recordings_source_check',
  'recordings_status_check',
  'transcripts_mode_check',
  'transcripts_recording_id_fkey',
  'prompt_packages_recording_id_fkey',
  'prompt_packages_transcript_id_fkey',
  'drafts_prompt_package_id_fkey',
  'drafts_created_by_fkey',
  'profile_revisions_source_check',
  'profile_revisions_status_check',
  'profile_revisions_version_number_check',
  'template_revisions_source_check',
  'template_revisions_status_check',
  'template_revisions_version_number_check',
  'students_profile_id_fkey',
  'student_profile_bindings_student_id_fkey',
  'student_profile_bindings_profile_id_fkey',
  'student_profile_bindings_changed_by_fkey',
  'student_profile_bindings_effective_window_check',
  'job_action_history_job_id_fkey',
  'job_action_history_created_job_id_fkey',
  'job_action_history_requested_by_fkey',
  'job_action_history_action_type_check',
  'job_action_history_outcome_check',
  'uploaded_files_storage_provider_check',
  'uploaded_files_file_size_check',
  'user_settings_tts_strategy_check',
  'user_settings_tts_provider_check',
  'workspace_memberships_role_check',
  'students_workspace_id_fkey',
  'student_lesson_plans_student_id_fkey',
  'student_lesson_plans_workspace_id_fkey',
  'student_lessons_student_id_fkey',
  'student_lessons_status_check',
  'student_credit_events_type_check',
  'student_credit_events_nonzero_check',
  'student_payment_records_currency_check',
  'student_reminder_preferences_channel_check',
];

const REQUIRED_INDEXES = [
  'idx_jobs_state_created_at',
  'idx_jobs_source_job_id',
  'idx_jobs_user_id',
  'idx_jobs_student_created_at_id',
  'idx_jobs_created_at_id',
  'idx_jobs_user_created_at_id',
  'idx_jobs_publish_target_state_created_at',
  'idx_recordings_student_id',
  'idx_prompt_packages_student_id',
  'idx_drafts_student_id',
  'idx_profile_revisions_profile_version',
  'idx_profile_revisions_single_active',
  'idx_template_revisions_template_version',
  'idx_template_revisions_single_active',
  'idx_job_action_history_job_id_requested_at',
  'idx_generation_budget_counters_provider_model',
  'idx_user_settings_user_id',
  'idx_uploaded_files_user_id',
  'idx_students_workspace_id',
  'idx_workspace_memberships_user_id',
  'idx_student_lessons_student_starts_at',
  'idx_student_credit_events_student_active',
  'idx_student_payment_records_student_received_at',
];

const REQUIRED_EXTENSIONS = ['uuid-ossp'];
const OPTIONAL_PG_TRGM_INDEXES = [
  'idx_recordings_source_path_trgm',
  'idx_recordings_storage_uri_trgm',
  'idx_recordings_id_trgm',
];
const REQUIRED_COLUMNS: { table: string; column: string }[] = [
  { table: 'jobs', column: 'student_id' },
  { table: 'profile_revisions', column: 'structured_content' },
  { table: 'students', column: 'workspace_id' },
];

async function verifyTables(client: PoolClient, errors: string[]): Promise<void> {
  for (const table of REQUIRED_TABLES) {
    const result = await client.query<{ present: string | null }>(
      'SELECT to_regclass($1) AS present',
      [`public.${table}`],
    );
    if (!result.rows[0]?.present) {
      errors.push(`Missing table: ${table}`);
    }
  }
}

async function verifyConstraints(client: PoolClient, errors: string[]): Promise<void> {
  const result = await client.query<{ conname: string }>(
    `
    SELECT conname
    FROM pg_constraint
    WHERE conname = ANY($1::text[])
    `,
    [REQUIRED_CONSTRAINTS],
  );
  const existing = new Set(result.rows.map((row) => row.conname));
  for (const constraint of REQUIRED_CONSTRAINTS) {
    if (!existing.has(constraint)) {
      errors.push(`Missing constraint: ${constraint}`);
    }
  }
}

async function verifyIndexes(client: PoolClient, errors: string[]): Promise<void> {
  const indexesToLookup = [...REQUIRED_INDEXES, ...OPTIONAL_PG_TRGM_INDEXES];
  const result = await client.query<{ indexname: string }>(
    `
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY($1::text[])
    `,
    [indexesToLookup],
  );
  const existing = new Set(result.rows.map((row) => row.indexname));
  for (const indexName of REQUIRED_INDEXES) {
    if (!existing.has(indexName)) {
      errors.push(`Missing index: ${indexName}`);
    }
  }

  const pgTrgmExistsResult = await client.query<{ present: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
    ) AS present
    `,
  );
  if (pgTrgmExistsResult.rows[0]?.present) {
    for (const indexName of OPTIONAL_PG_TRGM_INDEXES) {
      if (!existing.has(indexName)) {
        errors.push(`Missing pg_trgm index: ${indexName}`);
      }
    }
  }
}

async function verifyExtensions(client: PoolClient, errors: string[]): Promise<void> {
  const result = await client.query<{ extname: string }>(
    `
    SELECT extname
    FROM pg_extension
    WHERE extname = ANY($1::text[])
    `,
    [REQUIRED_EXTENSIONS],
  );
  const existing = new Set(result.rows.map((row) => row.extname));
  for (const extension of REQUIRED_EXTENSIONS) {
    if (!existing.has(extension)) {
      errors.push(`Missing extension: ${extension}`);
    }
  }
}

async function verifyColumns(client: PoolClient, errors: string[]): Promise<void> {
  for (const requirement of REQUIRED_COLUMNS) {
    const result = await client.query<{ present: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
      ) AS present
      `,
      [requirement.table, requirement.column],
    );
    if (!result.rows[0]?.present) {
      errors.push(`Missing column: ${requirement.table}.${requirement.column}`);
    }
  }
}

export async function verifyMigrations(): Promise<VerificationResult> {
  const pool = createPgPool();
  const client = await pool.connect();
  const errors: string[] = [];
  try {
    await verifyTables(client, errors);
    await verifyConstraints(client, errors);
    await verifyIndexes(client, errors);
    await verifyColumns(client, errors);
    await verifyExtensions(client, errors);
  } finally {
    client.release();
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
