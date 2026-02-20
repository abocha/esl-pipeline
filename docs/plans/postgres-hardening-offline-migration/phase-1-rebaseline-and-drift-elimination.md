# Phase 1 Implementation Plan - Re-baseline and Drift Elimination

## Summary

This phase will produce a decision-complete schema baseline for batch-backend Postgres by reconciling drift between packages/batch-backend/schema.sql and packages/batch-backend/src/infrastructure/db.ts,
without changing runtime behavior yet.
Output is a canonical object map plus a migration-ready decision ledger that Phase 2 can execute directly.

## Goal

Lock every schema object into one of four statuses so there are zero open schema-governance decisions before migration work starts:

1. Keep as canonical (definition accepted).
2. Normalize (same object, different definitions).
3. Add missing object.
4. Deprecate/remove legacy object (with migration path).

## In Scope

1. Tables, columns, defaults, nullability.
2. PK/FK/check constraints.
3. Indexes (including uniqueness/partial indexes).
4. Trigger functions + triggers.
5. Extension dependencies (uuid-ossp, pg_trgm behavior).
6. Drift affecting production safety and migration ordering.

## Out of Scope

1. Implementing migration runner/tooling (Phase 2).
2. Query refactors and denormalization (jobs.student_id) (Phase 3).
3. Pool/env/runtime hardening (Phase 4).
4. RLS enforcement (Phase 5).
5. CI pipeline changes (Phase 6).

## Current-State Facts (Grounded)

1. Repo is dirty with expected local docs edits; we are explicitly ignoring unrelated docs/templates/NEW PROFILE.txt.
2. schema.sql contains objects not represented in db.ts bootstrap flow (notably uploaded_files, user_settings stack).
3. db.ts contains richer revision/versioning patch logic not fully mirrored in schema.sql.
4. There is no schema_migrations system yet.
5. Core backend uses withPgClient path that currently couples schema ensure + runtime query path.

## Deliverables (Phase 1)

1. docs/plans/postgres-hardening-offline-migration/phase-1-drift-report.md
2. docs/plans/postgres-hardening-offline-migration/phase-1-canonical-object-map.md
3. docs/plans/postgres-hardening-offline-migration/phase-1-migration-decision-ledger.md

## Detailed Implementation Steps

1. Build object inventory from both sources.

- Parse schema.sql and db.ts into comparable object records:
  - object_type (table, column, constraint, index, trigger_fn, trigger, extension)
  - object_name
  - normalized definition hash/signature
  - source (schema.sql | db.ts)
- Produce a merged matrix with presence and definition parity.

2. Classify drift automatically first, then review manually.

- Categories:
  - exact_match
  - same_name_diff_definition
  - only_in_schema_sql
  - only_in_db_ts
  - implicit_in_code (used by repositories/tests but absent in one source)
- Flag high-risk drift:
  - FK/check differences
  - unique/partial index mismatches
  - trigger/function name collision with differing body

3. Define canonical ownership rules (locked for subsequent phases).

- Source of truth policy for this repo:
  - Future truth: versioned migrations.
  - Interim for Phase 1 decisions:
	  - Semantic behavior in runtime (db.ts) wins when protecting existing data invariants.
	  - SQL file object coverage wins when objects are actively referenced by domain code (settings-repository, extended routes, etc.).
- Rule must be documented in decision ledger with rationale.

4. Produce per-object decisions.

- For each non-exact_match row, assign:
  - action: keep | normalize_to_sql | normalize_to_runtime | add | deprecate
  - reason
  - phase2_migration_step_id placeholder (MIG-001 etc.)
  - safety_level: safe_online | requires_offline | requires_precheck

5. Generate migration dependency order graph (no SQL yet).

- Establish ordering constraints:
  - extensions -> tables -> columns -> data backfills -> constraints -> indexes -> triggers
- Explicitly mark objects requiring data cleanup before constraints/indexes.

6. Define legacy-compat prechecks for offline migration.

- SQL checks to run before Phase 2:
  - duplicate-key risk for future unique constraints
  - invalid enum/check values
  - orphaned FK references
  - nullability violations
- Store in drift report as runnable checklist.

7. Sign-off checklist for Phase 1 completion.

- All drift rows resolved with action.
- No “TBD” objects in decision ledger.
- Each decision linked to a concrete Phase 2 migration step ID.

## Important API / Interface / Type Impact in Phase 1

The following future interfaces are pre-declared (for Phase 2 implementation consistency):
1. Migration step IDs (MIG-###) in ledger.
2. Canonical object naming conventions for constraints/indexes/triggers.

## Test Cases and Scenarios (Phase 1 Validation)

1. Inventory completeness test:

- Every table touched by repositories appears in merged matrix.

2. Drift determinism test:

- Re-running inventory generation yields identical classification.

3. Referential coverage test:

- Objects referenced in domain/settings/auth paths are not left unclassified.

4. Decision completeness test:

- No unresolved drift row without action and Phase 2 step mapping.

## Risks and Mitigations

1. Risk: missing hidden dependency from runtime SQL strings.

- Mitigation: grep-based cross-reference from repositories/tests for table/column names.

2. Risk: accidentally deprecating objects used only by extended API.

- Mitigation: treat domain + transport references as authoritative usage signals.

3. Risk: Phase 2 blocked by ambiguous precedence decisions.

- Mitigation: enforce “no unresolved rows” exit criterion.

## Acceptance Criteria

1. Three Phase 1 documents exist and are internally consistent.
2. 100% of schema drift entries are classified and mapped to a migration step ID.
3. Canonical ownership policy is explicit and unambiguous.
4. Phase 2 can be executed without additional design decisions.

## Assumptions and Defaults

1. Offline migration window is available (confirmed).
2. Existing production data must be preserved (confirmed).
3. We are not enabling RLS in Phase 1.
4. Unrelated local file edits remain untouched and ignored during this phase.