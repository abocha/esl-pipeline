---
name: esl-pipeline-validation-evidence
description: Use when work in esl-pipeline changes validation policy, hosted CI scope, backend test projects, service-test helpers, or evidence handoff.
---

# ESL Pipeline validation evidence

Use the smallest reliable validation path. Focused local evidence is the default; hosted PR CI is
the comprehensive merge gate on the resource-constrained developer laptop.

## Establish the contract

1. Read `AGENTS.md` and `docs/reference/TESTING_GUIDELINES.md`.
2. Read `docs/reference/agents-ssot.md` when the task changes validation policy, CI ownership,
   contracts, or repository administration.
3. When changing hosted scope or backend test routing, inspect the relevant subset of:
   - `scripts/check/run-ci-scope.mjs`
   - `scripts/check/workspace-change-scope.mjs`
   - `packages/batch-backend/vitest.projects.mjs`
   - `.github/workflows/ci.yml`
4. For a hosted failure, open its retained log manifest/artifact before rerunning anything.

## Local validation

- Run the narrowest relevant test, package command, typecheck, lint, or build while editing.
- Before pushing, rerun focused evidence appropriate to the final diff.
- Docs-only changes use `pnpm docs:generate:indexes`, `pnpm format`, and `pnpm docs:check`.
- Do not automatically run a repository-wide local gate. Broader local or service-backed
  diagnostics require a concrete suspected cross-package/environment failure, an unavailable
  hosted equivalent, or a specific hosted-CI failure to reproduce.
- Keep direct package scripts and the narrow `pnpm test:backend:db:worker` helper available where
  they have concrete callers. Do not add a generalized local orchestration wrapper.

## Hosted CI and reproduction

Hosted PR CI owns comprehensive regression and the fail-closed `CI gate`. Every selected hosted job
must succeed before merge. When a job fails, reproduce that job's actual command, configuration,
resource settings, and prerequisites. Do not substitute an approximate repository-wide local run.

The retained committed-diff scope helper must preserve name-status parsing, workspace discovery,
transitive dependent selection, fail-closed path classification, and hosted summary/output
formatting. The production-image selector shares workspace/dependency impact logic and must retain
transitive dependent coverage.

The backend Vitest project configuration is the prerequisite-membership source of truth. Classify
tests by imports/bootstrap and operational prerequisites, not filename alone. Pure setup must scrub
ambient PostgreSQL, Redis, Docker, provider, and repository `.env` inputs before test modules load
and set `VALIDATION_TEST_CLASS=pure`; service projects keep their explicit environment.

The retained DB/worker helper provides reachability checks, safe `_test` PostgreSQL handling,
explicit service-test environment construction, and Windows-compatible invocation. Its local Redis
fallback is `redis://127.0.0.1:6380`; explicit service-test URLs remain authoritative. It is not a
full CI reproduction command and must not be described as migration preflight unless its commands
actually provide that behavior.

## Completion handoff

Report exact focused commands and outcomes, with artifact paths when a command produces them.
Distinguish focused local evidence from hosted, manual, and environment-owned requirements. A local
focused pass is not merge evidence; selected hosted jobs and `CI gate` remain required.

Historical acceptance records and archived documents may retain old command names as evidence of
what ran. They are not current instructions and do not justify compatibility aliases.
