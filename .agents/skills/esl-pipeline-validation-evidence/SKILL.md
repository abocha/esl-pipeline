---
name: esl-pipeline-validation-evidence
description: Use when work in esl-pipeline involves affected validation, check:fast:agent, check:pre-pr, backend test routing, service-owned CI lanes, validation artifacts, or PASS_WITH_CI_REQUIREMENTS.
---

# ESL Pipeline validation evidence

Use the smallest reliable validation path while preserving the repository's explicit division
between local evidence and CI-owned PostgreSQL/Redis evidence.

## Establish the contract

1. Read `AGENTS.md` and `docs/reference/TESTING_GUIDELINES.md`.
2. Read `docs/reference/agents-ssot.md` when the task changes validation policy, CI ownership,
   contracts, or repository administration.
3. When changing or diagnosing routing behavior, inspect the relevant subset of:
   - `scripts/check/run-affected-check.mjs`
   - `scripts/check/affected-check-lib.mjs`
   - `scripts/check/execution-lane-lib.mjs`
   - `scripts/check/agent-check-lib.mjs`
   - `packages/batch-backend/tests/test-routing.json`
   - `.github/workflows/ci.yml`
4. For a failure, open the cited artifact under `tmp/check-logs` or `tmp/test-logs` before rerunning.

## Route and validate

- Preserve affected planning across committed, staged, unstaged, and untracked paths, workspace
  dependents, global guards, and path-risk rules.
- Classify backend tests by imports, bootstrap, and operational prerequisites: pure, deterministic
  in-process, PostgreSQL, or PostgreSQL plus Redis worker integration. Do not route by filename alone.
- Keep pure lanes hermetic by scrubbing ambient database, Redis, Docker, provider, and repository
  `.env` inputs.
- Keep selected local lanes serial. Continue independent lanes after failure, block only dependent
  lanes, and report the aggregate result.
- Keep selected PostgreSQL/Redis application evidence in PR CI. `PASS_WITH_CI_REQUIREMENTS` permits
  PR creation but is not merge evidence.
- Require every selected hosted job and the fail-closed `CI gate` before merge.

## Diagnose efficiently

- Run the narrowest focused test first, then one normal pre-push gate selected by `AGENTS.md`.
- Allow at most one isolated diagnostic rerun for an unchanged failure.
- Treat a timeout as inconclusive until the artifact and any orphaned process are inspected.
- Do not add lane parallelism without explicit resource accounting across pnpm, Turbo, and Vitest.
- Stop with findings when the request is review or redesign only.

## Evidence freshness

Evidence must cover the final relevant code, configuration, and environment. Reuse a completed
check from this task when those inputs have not changed; a new message alone does not invalidate it.
Read the recorded result and scope before relying on it. Rerun affected checks after relevant changes
or when concrete uncertainty remains, not merely to restate a passing result. Focused checks support
focused claims and do not replace a required repository or hosted gate.

## Completion evidence

Report:

- focused commands actually run;
- the canonical gate result;
- cited artifact paths for failures;
- named CI-owned requirements;
- whether the result is `PASS`, `PASS_WITH_CI_REQUIREMENTS`, or a failure.

Never describe `PASS_WITH_CI_REQUIREMENTS` as merge-ready.
