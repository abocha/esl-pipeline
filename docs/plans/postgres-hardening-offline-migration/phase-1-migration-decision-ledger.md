# Phase 1 Migration Decision Ledger

## Summary

This ledger converts drift findings into migration-ready, decision-complete actions.
Each item has a fixed migration step id for Phase 2 implementation.

## Step Ledger

## MIG-001 - Create Migration Control Plane

- Action: add `schema_migrations` table and migration metadata contract.
- Reason: remove implicit schema state and drift recurrence.
- Safety: safe_offline.
- Prerequisites: none.

## MIG-002 - Normalize Core Table Superset (`jobs`)

- Action:
  1. Ensure `jobs` includes both `auto_publish` and `source_job_id`.
  2. Ensure legacy columns used by existing data remain present.
- Reason: code paths use both semantics; current sources disagree.
- Safety: requires_offline (due to additive + constraint alignment).
- Prerequisites: MIG-001.

## MIG-003 - Add Missing Runtime Tables Absent in `schema.sql`

- Action: create/align `templates`, `job_action_history`, `generation_budget_counters`.
- Reason: active repositories and application flows depend on these tables.
- Safety: safe_offline.
- Prerequisites: MIG-001.

## MIG-004 - Add Missing Feature Tables Absent in `db.ts` Bootstrap Canon

- Action: add/align `user_settings` and `uploaded_files` in canonical migration baseline.
- Reason: `user_settings` is actively queried; `uploaded_files` is retained feature table.
- Safety: safe_offline.
- Prerequisites: MIG-001.

## MIG-005 - Normalize Revision Lifecycle Model

- Action:
  1. Add lifecycle columns to revision tables where missing.
  2. Preserve data with deterministic backfill.
  3. Add unique/partial indexes for active/version invariants.
- Reason: `db.ts` runtime model is more complete and already operational.
- Safety: requires_precheck.
- Prerequisites: MIG-001, precheck duplicates/active collisions.

## MIG-006 - Normalize Prompt/Draft Student Link Columns

- Action:
  1. Ensure `drafts.student_id` exists.
  2. Ensure prompt package resolved version/status fields exist.
- Reason: repository queries and timeline paths rely on these columns.
- Safety: safe_offline.
- Prerequisites: MIG-001.

## MIG-007 - Constraint Unification Pass

- Action:
  1. add missing user/job checks from `schema.sql`,
  2. add missing lifecycle/action FKs/checks from `db.ts`,
  3. reconcile naming to one canonical set.
- Reason: current split leaves inconsistent enforcement by deployment path.
- Safety: requires_precheck.
- Prerequisites: MIG-002, MIG-003, MIG-004, MIG-005.

## MIG-008 - Index Unification Pass

- Action:
  1. merge required indexes from both sources,
  2. preserve query-critical and invariant-critical indexes,
  3. defer removals of potentially redundant indexes until plan validation in Phase 3.
- Reason: both sources contain non-overlapping essential indexes.
- Safety: safe_offline.
- Prerequisites: MIG-002..MIG-007.

## MIG-009 - Trigger and Function Unification

- Action: ensure `updated_at` functions/triggers exist for canonical tables (including users/jobs and retained feature tables).
- Reason: trigger definitions are currently split.
- Safety: safe_offline.
- Prerequisites: MIG-002..MIG-004.

## MIG-010 - Extension Policy Normalization

- Action:
  1. keep `uuid-ossp` compatibility,
  2. keep conditional `pg_trgm` provisioning and guarded trigram index creation.
- Reason: extension handling is currently asymmetric across sources.
- Safety: requires_precheck (permissions).
- Prerequisites: MIG-001.

## MIG-011 - Runtime Schema Mutator Decommission (Phase 2 handoff marker)

- Action: remove request-path schema patching and replace with migration-runner gate.
- Reason: eliminate startup/race drift and enforce explicit migration flow.
- Safety: requires_offline rollout.
- Prerequisites: MIG-001..MIG-010 complete.

## Precheck Gates (Must Pass Before MIG-005 and MIG-007)

1. No duplicate `(profile_id, version_number)` and `(template_id, version_number)` keys.
2. At most one active revision per profile/template.
3. No invalid `jobs.mode` / `jobs.state` values for target checks.
4. No FK orphans across drafts/prompt/transcript/recording chains.

## Validation Gates (After MIG-011)

1. `db:status` reports all migrations applied.
2. `db:verify` confirms expected object presence.
3. smoke queries for:
   - jobs list/summary/status
   - student timeline
   - settings read/update
   - generation budget counter read/write

## Deferred Decisions (Explicitly Locked to Later Phases)

1. `jobs.student_id` denormalization and query rewrite: Phase 3.
2. pool/runtime env hardening: Phase 4.
3. RLS enforcement switch: Phase 5.
4. CI mandatory PG enforcement: Phase 6.

