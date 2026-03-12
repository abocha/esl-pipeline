import { describe, expect, it, vi } from 'vitest';

import { runRlsReadinessAuditWithClient } from '../src/infrastructure/rls-readiness-audit.js';

interface AuditFixture {
  existingTables?: string[];
  policies?: { tablename: string; policyname: string }[];
  indexes?: { indexname: string }[];
  publicGrants?: { table_name: string; privilege_type: string }[];
  enabledRlsTables?: { relname: string }[];
}

function createAuditClient(fixture: AuditFixture) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM pg_class c') && sql.includes('c.relrowsecurity = TRUE')) {
      return { rows: fixture.enabledRlsTables ?? [] };
    }

    if (sql.includes('FROM pg_class c')) {
      const existingTables = (fixture.existingTables ?? []).map((table) => ({ relname: table }));
      return { rows: existingTables };
    }

    if (sql.includes('FROM pg_policies')) {
      return { rows: fixture.policies ?? [] };
    }

    if (sql.includes('FROM pg_indexes')) {
      return { rows: fixture.indexes ?? [] };
    }

    if (sql.includes('FROM information_schema.role_table_grants')) {
      return { rows: fixture.publicGrants ?? [] };
    }

    throw new Error(`Unexpected SQL in audit test: ${sql}`);
  });

  return {
    query,
    release: vi.fn(),
  };
}

describe('infrastructure/rls-readiness-audit', () => {
  it('passes when required readiness artifacts are present', async () => {
    const client = createAuditClient({
      existingTables: ['users', 'jobs', 'uploaded_files', 'user_settings'],
      policies: [
        { tablename: 'users', policyname: 'users_self_access_policy' },
        { tablename: 'jobs', policyname: 'jobs_user_scope_policy' },
        { tablename: 'uploaded_files', policyname: 'uploaded_files_user_scope_policy' },
        { tablename: 'user_settings', policyname: 'user_settings_user_scope_policy' },
      ],
      indexes: [
        { indexname: 'users_pkey' },
        { indexname: 'idx_jobs_user_id' },
        { indexname: 'idx_uploaded_files_user_id' },
        { indexname: 'idx_user_settings_user_id' },
      ],
      publicGrants: [],
      enabledRlsTables: [],
    });

    const result = await runRlsReadinessAuditWithClient(
      client as unknown as import('pg').PoolClient,
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('fails when policies/indexes are missing or public grants exist', async () => {
    const client = createAuditClient({
      existingTables: ['users', 'jobs', 'uploaded_files', 'user_settings'],
      policies: [
        { tablename: 'users', policyname: 'users_self_access_policy' },
        { tablename: 'jobs', policyname: 'jobs_user_scope_policy' },
      ],
      indexes: [{ indexname: 'users_pkey' }],
      publicGrants: [{ table_name: 'jobs', privilege_type: 'SELECT' }],
      enabledRlsTables: [],
    });

    const result = await runRlsReadinessAuditWithClient(
      client as unknown as import('pg').PoolClient,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'Missing RLS policy: uploaded_files.uploaded_files_user_scope_policy',
    );
    expect(result.errors).toContain('Missing RLS policy-supporting index: jobs.idx_jobs_user_id');
    expect(result.errors).toContain('Unsafe PUBLIC grant on user-scoped table: jobs.SELECT');
  });

  it('reports warnings when RLS is already enabled on scoped tables', async () => {
    const client = createAuditClient({
      existingTables: ['users', 'jobs', 'uploaded_files', 'user_settings'],
      policies: [
        { tablename: 'users', policyname: 'users_self_access_policy' },
        { tablename: 'jobs', policyname: 'jobs_user_scope_policy' },
        { tablename: 'uploaded_files', policyname: 'uploaded_files_user_scope_policy' },
        { tablename: 'user_settings', policyname: 'user_settings_user_scope_policy' },
      ],
      indexes: [
        { indexname: 'users_pkey' },
        { indexname: 'idx_jobs_user_id' },
        { indexname: 'idx_uploaded_files_user_id' },
        { indexname: 'idx_user_settings_user_id' },
      ],
      publicGrants: [],
      enabledRlsTables: [{ relname: 'jobs' }],
    });

    const result = await runRlsReadinessAuditWithClient(
      client as unknown as import('pg').PoolClient,
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual(['RLS already enabled on user-scoped table(s): jobs']);
  });
});
