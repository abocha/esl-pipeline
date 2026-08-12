# Optimization Backlog

## Meta

- Audience: maintainers and implementation agents.
- Authority Level: historical archive.
- Last Verified Against: 2026-08-12 repo and GitHub state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: after backlog item implementation PRs.
- Status: `archived`.
- Exit Trigger: archived on 2026-08-12 after unfinished items were split into GitHub Issues.
- Current Focus: use the linked GitHub Issues as the canonical backlog; this document is historical trace only.

## Summary

Prioritized backlog of high-impact technical debt and optimization work discovered during repository chores.
This backlog is intended to be executed incrementally with safe, test-backed patches.

## Archive disposition

This backlog was revalidated against the repository and live GitHub state on 2026-08-12. GitHub
Issues is now the canonical backlog; the links below are the durable handoff for work that remains.

| ID  | Disposition                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Already implemented: `extended-routes.ts` is a 35-line composition layer over route modules.                                                                                                                                                        |
| B2  | Already completed by Wave 3: migration parity is inventoried and the legacy runtime patch path is explicitly quarantined and CI-frozen. The duplicate [Issue #174](https://github.com/abocha/esl-pipeline/issues/174) was closed during this audit. |
| B3  | Already implemented: the metadata side-effect contract is documented in code and covered by `application.edit-metadata.test.ts`.                                                                                                                    |
| B4  | Wave 1 completed the explicit fallback gate; deferred removal remains [Issue #175](https://github.com/abocha/esl-pipeline/issues/175), blocked on the orchestrator metadata-reliability SLO/decision.                                               |
| B5  | Already implemented: `UploadRateLimiter`, `RedisRateLimiter`, and `NoOpRateLimiter` are separate current implementations.                                                                                                                           |
| B6  | Already completed by Wave 2 in the scoped high-traffic tests. The duplicate [Issue #176](https://github.com/abocha/esl-pipeline/issues/176) was closed during this audit; residual casts have no newly validated acceptance scope.                  |
| B7  | [Issue #177](https://github.com/abocha/esl-pipeline/issues/177)                                                                                                                                                                                     |
| B8  | [Issue #178](https://github.com/abocha/esl-pipeline/issues/178), ready investigation to map repository/domain coverage to current test lanes and distinguish real gaps from visibility gaps.                                                        |
| B9  | [Issue #179](https://github.com/abocha/esl-pipeline/issues/179), ready investigation to produce a current timing artifact and evaluate worthwhile frontend test optimization.                                                                       |
| B10 | Remaining debt: [Issue #184](https://github.com/abocha/esl-pipeline/issues/184) tracks historical lineage artifact reads before hash comparison.                                                                                                    |
| B11 | [Issue #180](https://github.com/abocha/esl-pipeline/issues/180)                                                                                                                                                                                     |
| B12 | Already verified: `BusinessSchedulePage.test.tsx` passes 7/7 with the repository's `jsdom` test environment.                                                                                                                                        |
| B13 | [Issue #181](https://github.com/abocha/esl-pipeline/issues/181), ready investigation to reproduce current Windows/service-lane target handling.                                                                                                     |
| B14 | [Issue #182](https://github.com/abocha/esl-pipeline/issues/182)                                                                                                                                                                                     |

## Prioritized Items

| ID  | Item                                                 | Why It Matters                                                                                                                                    | Effort | Risk | Proposed First Step                                                                                                                                                                          |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Split `extended-routes.ts` into route modules        | Reduces hot-path maintenance cost in transport layer and lowers regression risk in large edits.                                                   | M      | M    | Extract the extended API into capability modules (`config`, `students`, `profiles/templates`, `recordings`, `auth/user`, `ops`) behind a stable router registration API.                     |
| B2  | Unify DB schema evolution path                       | Legacy runtime schema patch arrays still overlap the migration-first path; this keeps drift risk alive.                                           | M      | H    | Audit remaining runtime patch arrays against the existing migration chain, then retire or quarantine the fallback path so migrations remain the single schema authority.                     |
| B3  | Complete metadata edit side-effect contract          | Current TODO leaves behavior partially implicit around manifest/events updates.                                                                   | S      | M    | Formalize expected side effects, then add integration tests for edit + downstream visibility.                                                                                                |
| B4  | Remove static job-options fallback debt              | Static fallback can hide source-of-truth issues and complicates diagnostics.                                                                      | S      | M    | Gate fallback behind an explicit env flag, then migrate callers to DB/config-driven options only.                                                                                            |
| B5  | Decouple NoOp and Redis rate limiter implementations | Current inheritance requires dummy Redis wiring and weakens type clarity.                                                                         | S      | L    | Introduce a small rate-limiter interface with independent `RedisRateLimiter` and `NoOpRateLimiter`.                                                                                          |
| B6  | Reduce `as any` test typing debt in batch-backend    | Type casts in tests can hide real contract drift and reduce refactor confidence.                                                                  | M      | L    | Replace cast-heavy mocks with typed helpers for Redis, DB, and transport dependencies.                                                                                                       |
| B7  | Expand `batch-backend` extended-route coverage       | Coverage gaps are concentrated in `recordings`, `students`, `auth/user`, `profiles/templates`, and `config` routes.                               | M      | M    | Add focused transport/integration coverage for the extended route families that currently dominate uncovered large-file counts.                                                              |
| B8  | Sanity-check repository/domain coverage visibility   | Near-zero coverage in some repository files may be true gaps or coverage-lane blind spots.                                                        | S      | L    | Map existing tests to `job-repository` and memory repositories, then decide whether to add tests or widen the coverage lane inputs.                                                          |
| B9  | Do one last targeted UI timing polish pass           | `batch-frontend` still dominates unit timings, led by `MinimalAssignment` flows.                                                                  | S      | L    | Prefer narrower harness or logic-level tests for `MinimalAssignment.job-actions`, `generation-throttle`, and only then optional follow-up on orchestrator smoke or TTS retry classification. |
| B10 | Move homework memory lineage comparison to hashes    | Homework memory source resolution still serially reads historical lineage markdown before deciding whether content changed.                       | M      | M    | Persist or backfill published markdown hashes for lineage jobs, then filter same-content lineage rows by hash before reading markdown from storage.                                          |
| B11 | Batch recurrence materialization writes              | Student lesson recurrence saves can issue one database write per slot and generated occurrence, which grows with horizon size.                    | M      | M-H  | Replace per-row slot and lesson writes with bulk SQL while preserving recurrence ID stability, generated occurrence keys, and manual override behavior.                                      |
| B12 | Fix `BusinessSchedulePage` range-race test failure   | `test:unit:prebuilt:fast:agent` surfaced a reproducible frontend test failure around stale versus newer schedule range loads.                     | S      | M    | Reproduce `BusinessSchedulePage.test.tsx` in isolation, then fix the race expectation or implementation without broad UI changes.                                                            |
| B13 | Fix Windows batch-backend integration glob handling  | `test:integration:prebuilt:agent` surfaced that the batch-backend integration script reports 0 tests on the Windows checkout.                     | S      | L-M  | Normalize the package integration test target so `pnpm --filter @esl-pipeline/batch-backend run test:integration` resolves test files cross-platform.                                        |
| B14 | Retire legacy student advanced profile fields        | `colorPreset`, `accentPreference`, and `manifestPreset` are no longer part of the public create/update UX but still exist in storage/read models. | M      | M    | Audit remaining storage/read/model/tooling usage, then remove or migrate the legacy columns and DTO fields in a dedicated schema-backed cleanup PR.                                          |

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
