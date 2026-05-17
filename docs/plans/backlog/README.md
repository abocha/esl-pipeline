# Optimization Backlog

## Meta

- Audience: maintainers and implementation agents.
- Authority Level: active optimization backlog.
- Last Verified Against: 2026-05-17 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after backlog item implementation PRs.
- Status: `backlog`.
- Exit Trigger: archive individual wave plans after their implementation PR merges; keep this backlog routed while it contains active or deferred optimization candidates.

## Summary

Prioritized backlog of high-impact technical debt and optimization work discovered during repository chores.
This backlog is intended to be executed incrementally with safe, test-backed patches.

## Prioritized Items

| ID  | Item                                                 | Why It Matters                                                                                                      | Effort | Risk | Proposed First Step                                                                                                                                                                          |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Split `extended-routes.ts` into route modules        | Reduces hot-path maintenance cost in transport layer and lowers regression risk in large edits.                     | M      | M    | Extract the extended API into capability modules (`config`, `students`, `profiles/templates`, `recordings`, `auth/user`, `ops`) behind a stable router registration API.                     |
| B2  | Unify DB schema evolution path                       | Legacy runtime schema patch arrays still overlap the migration-first path; this keeps drift risk alive.             | M      | H    | Audit remaining runtime patch arrays against the existing migration chain, then retire or quarantine the fallback path so migrations remain the single schema authority.                     |
| B3  | Complete metadata edit side-effect contract          | Current TODO leaves behavior partially implicit around manifest/events updates.                                     | S      | M    | Formalize expected side effects, then add integration tests for edit + downstream visibility.                                                                                                |
| B4  | Remove static job-options fallback debt              | Static fallback can hide source-of-truth issues and complicates diagnostics.                                        | S      | M    | Gate fallback behind an explicit env flag, then migrate callers to DB/config-driven options only.                                                                                            |
| B5  | Decouple NoOp and Redis rate limiter implementations | Current inheritance requires dummy Redis wiring and weakens type clarity.                                           | S      | L    | Introduce a small rate-limiter interface with independent `RedisRateLimiter` and `NoOpRateLimiter`.                                                                                          |
| B6  | Reduce `as any` test typing debt in batch-backend    | Type casts in tests can hide real contract drift and reduce refactor confidence.                                    | M      | L    | Replace cast-heavy mocks with typed helpers for Redis, DB, and transport dependencies.                                                                                                       |
| B7  | Expand `batch-backend` extended-route coverage       | Coverage gaps are concentrated in `recordings`, `students`, `auth/user`, `profiles/templates`, and `config` routes. | M      | M    | Add focused transport/integration coverage for the extended route families that currently dominate uncovered large-file counts.                                                              |
| B8  | Sanity-check repository/domain coverage visibility   | Near-zero coverage in some repository files may be true gaps or coverage-lane blind spots.                          | S      | L    | Map existing tests to `job-repository` and memory repositories, then decide whether to add tests or widen the coverage lane inputs.                                                          |
| B9  | Do one last targeted UI timing polish pass           | `batch-frontend` still dominates unit timings, led by `MinimalAssignment` flows.                                    | S      | L    | Prefer narrower harness or logic-level tests for `MinimalAssignment.job-actions`, `generation-throttle`, and only then optional follow-up on orchestrator smoke or TTS retry classification. |

## Wave Plans (Completed)

1. [Wave 1 - Quick ROI](../../archive/plans/completed/wave-1-quick-roi.md): `B5`, `B3`, `B4`
2. [Wave 2 - Maintainability](../../archive/plans/completed/wave-2-maintainability.md): `B6`, `B1`
3. [Wave 3 - Schema Unification](../../archive/plans/completed/wave-3-schema-unification.md): `B2`

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
