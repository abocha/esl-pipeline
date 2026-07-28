# PR Validation Simplification

## Meta

- Status: `active`.
- Last Verified Against: 2026-07-29 repo state (`65584896`).
- Exit Trigger: archive this topic after all three implementation PRs merge and the resulting
  contracts are authoritative in `AGENTS.md`, `docs/reference/agents-ssot.md`, and
  `docs/reference/TESTING_GUIDELINES.md`.
- Current Focus: PR 3, CI service evidence handoff.
- Owner: founder-maintainer + primary implementation agent.

## Goal

Replace repeated fail-fast local validation with a small, explicit system that preserves the current
affected-package planner, classifies backend tests by real prerequisites, delegates authoritative
service evidence to PR CI, and keeps automatic release-on-merge unchanged.

## Agreed Architecture

1. Local validation retains the current committed, staged, unstaged, untracked, dependent-package,
   and path-risk selection logic.
2. Local lanes execute serially with bounded resource use. Independent failures are aggregated in one
   report; a failed build blocks only prebuilt dependents.
3. Backend tests use four operational routes:
   - pure unit;
   - deterministic in-process integration;
   - PostgreSQL;
   - PostgreSQL + Redis worker integration.
4. Service-backed tests are positively listed. The unit route is the guarded remainder: any test that
   imports a known PostgreSQL or Redis bootstrap outside a service route fails the routing guard.
5. Local validation reports selected PostgreSQL/Redis evidence as CI-required instead of silently
   requiring local services. Local service commands remain available for focused diagnosis.
6. PR CI is the authoritative merge gate for PostgreSQL and Redis. Merge to `main` automatically
   produces the release; no nightly validation or nightly release tier is introduced.

## Phase Plans

1. [PR 1 - Aggregate Local Validation](./pr-1-aggregate-local-validation.md)
2. [PR 2 - Explicit Backend Test Routing](./pr-2-explicit-backend-test-routing.md)
3. [PR 3 - CI Service Evidence Handoff](./pr-3-ci-service-evidence-handoff.md)

## Cross-PR Invariants

- Do not weaken or remove meaningful tests.
- Do not globally increase timeouts or add automatic test retries.
- Do not require PostgreSQL, Redis, Docker, or provider credentials for ordinary local changes.
- Do not use cache warming as correctness evidence.
- Keep independent work serial until measurements justify bounded parallelism.
- A focused diagnostic rerun never replaces the canonical aggregate result.
- All release-blocking application evidence runs before merge in PR CI.
- The release-on-merge workflow remains packaging/publication authority and does not become a second
  general regression suite.
- Implementation is owned inline by the primary agent; project subagents remain read-only specialists.

## Review Boundaries

- Review PR 1 as runner correctness and artifact-contract work.
- Review PR 2 as test-classification and environment-isolation work.
- Review PR 3 as CI selection, merge-gate, documentation, and release-boundary work.
- Do not combine the three phases into one PR.
