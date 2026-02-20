import { PoolClient } from 'pg';

import { createPgPool } from './db.js';

export interface RlsReadinessAuditResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  details: {
    checkedTables: string[];
    checkedPolicies: string[];
    checkedIndexes: string[];
    enabledRlsTables: string[];
    publicGrantViolations: string[];
  };
}

interface PolicyRequirement {
  table: string;
  policy: string;
}

interface IndexRequirement {
  table: string;
  index: string;
}

const USER_SCOPED_TABLES = ['users', 'jobs', 'uploaded_files', 'user_settings'];

const REQUIRED_POLICIES: PolicyRequirement[] = [
  { table: 'users', policy: 'users_self_access_policy' },
  { table: 'jobs', policy: 'jobs_user_scope_policy' },
  { table: 'uploaded_files', policy: 'uploaded_files_user_scope_policy' },
  { table: 'user_settings', policy: 'user_settings_user_scope_policy' },
];

const REQUIRED_POLICY_INDEXES: IndexRequirement[] = [
  { table: 'users', index: 'users_pkey' },
  { table: 'jobs', index: 'idx_jobs_user_id' },
  { table: 'uploaded_files', index: 'idx_uploaded_files_user_id' },
  { table: 'user_settings', index: 'idx_user_settings_user_id' },
];

async function loadExistingTables(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ relname: string }>(
    `
    SELECT c.relname
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = ANY($1::text[])
    `,
    [USER_SCOPED_TABLES],
  );
  return new Set(result.rows.map((row) => row.relname));
}

async function verifyPolicies(client: PoolClient, errors: string[]): Promise<void> {
  const result = await client.query<{ tablename: string; policyname: string }>(
    `
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY($1::text[])
    `,
    [USER_SCOPED_TABLES],
  );
  const discovered = new Set(result.rows.map((row) => `${row.tablename}:${row.policyname}`));
  for (const requirement of REQUIRED_POLICIES) {
    const key = `${requirement.table}:${requirement.policy}`;
    if (!discovered.has(key)) {
      errors.push(`Missing RLS policy: ${requirement.table}.${requirement.policy}`);
    }
  }
}

async function verifyIndexes(client: PoolClient, errors: string[]): Promise<void> {
  const requiredIndexNames = REQUIRED_POLICY_INDEXES.map((entry) => entry.index);
  const result = await client.query<{ indexname: string }>(
    `
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY($1::text[])
    `,
    [requiredIndexNames],
  );
  const discovered = new Set(result.rows.map((row) => row.indexname));
  for (const requirement of REQUIRED_POLICY_INDEXES) {
    if (!discovered.has(requirement.index)) {
      errors.push(
        `Missing RLS policy-supporting index: ${requirement.table}.${requirement.index}`,
      );
    }
  }
}

async function verifyPublicGrants(client: PoolClient, errors: string[]): Promise<string[]> {
  const result = await client.query<{ table_name: string; privilege_type: string }>(
    `
    SELECT table_name, privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'PUBLIC'
      AND table_name = ANY($1::text[])
    ORDER BY table_name, privilege_type
    `,
    [USER_SCOPED_TABLES],
  );
  const violations = result.rows.map((row) => `${row.table_name}.${row.privilege_type}`);
  for (const violation of violations) {
    errors.push(`Unsafe PUBLIC grant on user-scoped table: ${violation}`);
  }
  return violations;
}

async function loadRlsEnabledTables(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ relname: string }>(
    `
    SELECT c.relname
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = TRUE
      AND c.relname = ANY($1::text[])
    ORDER BY c.relname
    `,
    [USER_SCOPED_TABLES],
  );
  return result.rows.map((row) => row.relname);
}

export async function runRlsReadinessAuditWithClient(
  client: PoolClient,
): Promise<RlsReadinessAuditResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const existingTables = await loadExistingTables(client);
  for (const table of USER_SCOPED_TABLES) {
    if (!existingTables.has(table)) {
      errors.push(`Missing user-scoped table for RLS readiness: ${table}`);
    }
  }

  await verifyPolicies(client, errors);
  await verifyIndexes(client, errors);
  const publicGrantViolations = await verifyPublicGrants(client, errors);
  const enabledRlsTables = await loadRlsEnabledTables(client);

  if (enabledRlsTables.length > 0) {
    warnings.push(
      `RLS already enabled on user-scoped table(s): ${enabledRlsTables.join(', ')}`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    details: {
      checkedTables: [...USER_SCOPED_TABLES],
      checkedPolicies: REQUIRED_POLICIES.map((entry) => `${entry.table}.${entry.policy}`),
      checkedIndexes: REQUIRED_POLICY_INDEXES.map((entry) => `${entry.table}.${entry.index}`),
      enabledRlsTables,
      publicGrantViolations,
    },
  };
}

export async function runRlsReadinessAudit(): Promise<RlsReadinessAuditResult> {
  const pool = createPgPool();
  const client = await pool.connect();
  try {
    return await runRlsReadinessAuditWithClient(client);
  } finally {
    client.release();
  }
}
