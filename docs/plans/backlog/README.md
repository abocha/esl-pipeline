# Optimization Backlog

## Summary

Prioritized backlog of high-impact technical debt and optimization work discovered during repository chores.
This backlog is intended to be executed incrementally with safe, test-backed patches.

## Prioritized Items

| ID  | Item                                                 | Why It Matters                                                                                          | Effort | Risk | Proposed First Step                                                                                                                                                      |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Split `extended-routes.ts` into route modules        | Reduces hot-path maintenance cost in transport layer and lowers regression risk in large edits.         | M      | M    | Extract the extended API into capability modules (`config`, `students`, `profiles/templates`, `recordings`, `auth/user`, `ops`) behind a stable router registration API. |
| B2  | Unify DB schema evolution path                       | Legacy runtime schema patch arrays still overlap the migration-first path; this keeps drift risk alive. | M      | H    | Audit remaining runtime patch arrays against the existing migration chain, then retire or quarantine the fallback path so migrations remain the single schema authority. |
| B3  | Complete metadata edit side-effect contract          | Current TODO leaves behavior partially implicit around manifest/events updates.                         | S      | M    | Formalize expected side effects, then add integration tests for edit + downstream visibility.                                                                            |
| B4  | Remove static job-options fallback debt              | Static fallback can hide source-of-truth issues and complicates diagnostics.                            | S      | M    | Gate fallback behind an explicit env flag, then migrate callers to DB/config-driven options only.                                                                        |
| B5  | Decouple NoOp and Redis rate limiter implementations | Current inheritance requires dummy Redis wiring and weakens type clarity.                               | S      | L    | Introduce a small rate-limiter interface with independent `RedisRateLimiter` and `NoOpRateLimiter`.                                                                      |
| B6  | Reduce `as any` test typing debt in batch-backend    | Type casts in tests can hide real contract drift and reduce refactor confidence.                        | M      | L    | Replace cast-heavy mocks with typed helpers for Redis, DB, and transport dependencies.                                                                                   |

## Wave Plans (Completed)

1. [Wave 1 - Quick ROI](../completed/wave-1-quick-roi.md): `B5`, `B3`, `B4`
2. [Wave 2 - Maintainability](../completed/wave-2-maintainability.md): `B6`, `B1`
3. [Wave 3 - Schema Unification](../completed/wave-3-schema-unification.md): `B2`

## Wave Status

| Wave   | Scope            | Status    |
| ------ | ---------------- | --------- |
| Wave 1 | `B5`, `B3`, `B4` | Completed |
| Wave 2 | `B6`, `B1`       | Completed |
| Wave 3 | `B2`             | Completed |

## Acceptance Pattern (Per Item)

1. Add or update targeted tests first (or in same patch).
2. Run package-level checks for touched areas.
3. Run `pnpm check:fast` before merge.
4. Update docs/contracts when behavior changes.
