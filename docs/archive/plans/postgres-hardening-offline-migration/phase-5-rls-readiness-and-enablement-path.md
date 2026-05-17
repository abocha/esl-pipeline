# Phase 5 - RLS Readiness and Enablement Path

## Summary

Prepare the system for future Row Level Security enforcement with minimal future migration risk, while keeping immediate rollout stable.

## Goals

1. Define full RLS policy model for user-scoped data.
2. Prepare application DB session context needed by policies.
3. Ensure policy predicates are indexed and testable before enforcement.

## Work Plan

1. Define table classification:
   - user-scoped tables
   - system/shared tables
   - service-only tables
2. Add policy SQL artifacts for user-scoped tables using session context patterns (for example `current_setting('app.user_id', true)`).
3. Add helper/session conventions in DB access layer so request identity can be propagated once auth context is available end-to-end.
4. Add policy-supporting indexes where missing.
5. Add RLS readiness audit command and SQL checks:
   - missing policies
   - missing indexes
   - missing grants
6. Document staged enablement playbook:
   - dry run in staging
   - table-by-table enablement
   - rollback steps if policy mismatch appears

## Deliverables

1. Policy definitions committed and reviewed.
2. Session-context plumbing hooks in DB access layer.
3. RLS readiness audit report capability.
4. Enablement runbook with gate checks.

## Exit Criteria

1. Enabling RLS later requires no destructive schema migration.
2. Policy/index prerequisites are verified automatically.
3. Current behavior remains unchanged with RLS disabled.

## Risks and Mitigations

1. Risk: enabling RLS too early blocks production paths.  
   Mitigation: deferred enforcement plus audit-first rollout.
2. Risk: missing session context causes false denials.  
   Mitigation: explicit context contract and pre-enable checks.

## Dependencies

1. Stable migration framework from Phase 2.
2. Auth context propagation strategy in transport/application layers.

# Phase 5 Detailed Plan: RLS Readiness and Enablement Path

(Readiness-First)

## Summary

Implement Phase 5 as RLS-readiness without behavior change for
currently user-owned tables, with auditable policy/index/grant
prerequisites and a staged enablement playbook.
Scope is locked to readiness-first: no broad ownership-model
migration for student-scoped tables in this phase.

## Scope Decision (Locked)

1. Implement full RLS artifacts for tables that already have
   clear user ownership.
2. Add DB session-context plumbing hooks so request identity
   can be propagated safely.
3. Add an explicit RLS audit command.
4. Do not enable RLS yet (ALTER TABLE ... ENABLE ROW LEVEL
   SECURITY deferred to controlled rollout).
5. Document follow-up ownership migration needed for student-
   scoped tables.

## Current-State Grounding (Repo-Based)

1. Migration framework exists and is authoritative (0001-0006
   in packages/batch-backend/migrations).
2. DB tooling exists: db:migrate, db:status, db:verify via
   packages/batch-backend/src/tools/migrate-db.ts.
3. Auth identity exists at transport layer
   (AuthenticatedRequest.user.id), but DB session context
   propagation does not yet exist.
4. User-owned tables now:

- users (self identity)
- jobs (user_id)
- uploaded_files (user_id)
- user_settings (user_id)

5. Student-scoped tables lack direct user ownership columns
   (deferred for follow-up phase).

## Table Classification (Phase 5 Artifact)

Create and document a classification map in docs + audit code:

1. user_scoped_now:

- users
- jobs
- uploaded_files
- user_settings

2. service_or_shared:

- schema_migrations
- generation_budget_counters

3. user_scoped_later_requires_ownership_binding:

- recordings
- transcripts
- prompt_packages
- drafts
- students
- profiles
- templates
- profile_revisions
- template_revisions
- student_profile_bindings
- job_action_history

## Implementation Plan

### 1) SQL Artifacts (new migration

0007_rls_readiness_artifacts.sql)

Add a new migration in packages/batch-backend/migrations:

1. Create helper functions (stable, safe wrappers around
   session settings):

- app_current_user_id() -> uuid|null from
  current_setting('app.user_id', true)
- app_current_user_role() -> text|null from
  current_setting('app.user_role', true)
- app_rls_bypass() -> boolean from
  current_setting('app.rls_bypass', true) = 'on'

2. Create policies for user_scoped_now tables (policies exist
   but RLS not enabled yet):

- users: self-access policy (id = app_current_user_id())
  plus bypass path.
- jobs: user-owned rows (user_id = app_current_user_id())
  plus bypass path.
- uploaded_files: same user-id predicate plus bypass path.
- user_settings: same user-id predicate plus bypass path.

3. Use explicit USING + WITH CHECK for write safety.
4. Ensure policy predicates use index-friendly columns already
   present.
5. Keep RLS disabled in this migration (readiness only).

### 2) DB Session Context Hooks (infrastructure)

Update packages/batch-backend/src/infrastructure/db.ts:

1. Add types:

- PgSessionContext with userId, userRole, rlsBypass.

2. Add helpers:

- setPgSessionContext(client, context) using
  set_config(..., true).
- withPgClientSessionContext(context, fn):
  - acquires client
  - BEGIN
  - SET LOCAL context via set_config
  - executes callback
  - COMMIT/ROLLBACK

3. Keep existing withPgClient unchanged for backward
   compatibility in Phase 5.
4. Add clear usage contract in comments/docs: session context
   helper is required for future RLS enablement paths.

### 3) RLS Readiness Audit Command

Extend tooling:

1. New module: packages/batch-backend/src/infrastructure/rls-
   readiness-audit.ts
2. Add command in packages/batch-backend/src/tools/migrate-
   db.ts:

- db:rls-audit subcommand

3. Add script in packages/batch-backend/package.json:

- "db:rls-audit": "tsx src/tools/migrate-db.ts rls-audit"

Audit checks:

1. Missing policies for user_scoped_now.
2. Missing policy-supporting indexes (predicate columns).
3. Grant posture checks:

- flag unsafe PUBLIC grants on user-scoped tables.

4. Report-only check that RLS is still disabled (expected in
   Phase 5).
5. Emit machine-readable pass/fail summary and detailed list of
   failures.

### 4) Verification Integration

Keep db:verify focused on schema invariants, and keep RLS
checks in dedicated db:rls-audit command (clear operational
separation).

### 5) Documentation Deliverables

Update/create docs under docs/plans/postgres-hardening-offline-
migration:

1. Expand phase-5-rls-readiness-and-enablement-path.md with:

- classification matrix
- policy matrix
- audit contract

2. Add staged enablement playbook:

- staging dry run
- canary table enablement order
- rollback steps

3. Add explicit deferred follow-up:

- ownership-binding migration for student-scoped tables.

## Public APIs / Interfaces / Types Changes

1. migrate-db.ts CLI usage:

- from <migrate|status|verify> to <migrate|status|verify|
  rls-audit>

2. New npm script:

- db:rls-audit

3. New infrastructure type:

- PgSessionContext in db.ts

4. New infrastructure helpers:

- setPgSessionContext
- withPgClientSessionContext

## Test Plan

### Unit Tests

- passes when all policies/indexes/grants expectations are
- fails with specific missing-index messages
- fails on unsafe PUBLIC grants

2. migrate-db command parser:

- recognizes rls-audit
- returns non-zero on failed audit

3. db.ts session context helper:

- sets expected session config keys
- rolls back on callback failure

### Integration/Verification Scenarios

1. Fresh DB:

- db:migrate applies 0007
- db:rls-audit passes

2. Existing migrated DB:

- db:migrate no-op re-run
- db:rls-audit stable pass

3. Negative simulation:

- drop one policy manually -> audit fails with exact policy
  name.

## Rollout / Enablement Path (Post-Phase-5)

1. Keep RLS disabled in production after Phase 5 merge.
2. In staging:

- wire selected request paths to withPgClientSessionContext
- run full test and smoke suite
- run db:rls-audit in CI and pre-deploy checks

3. Later enforcement phase:

- enable RLS table-by-table (starting with user_settings,
  uploaded_files, then jobs, then users)
- monitor denied queries/errors
- rollback by ALTER TABLE ... DISABLE ROW LEVEL SECURITY if
  needed.

## Assumptions and Defaults (Explicit)

1. Scope is readiness-first (selected): no ownership backfill
   for student-scoped tables in this phase.
2. Existing runtime behavior must remain unchanged after Phase
   5 merge.
3. Policy model is user-centric via app.user_id session
   context.
4. Admin/service paths will use rls_bypass context in future
   enforcement phase.
5. Live DB migration for this phase is in-place via normal
   migration tooling; no clean-slate reset required.
