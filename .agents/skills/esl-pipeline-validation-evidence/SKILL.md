---
name: esl-pipeline-validation-evidence
description: Use when work in esl-pipeline involves affected validation, check:fast:agent, check:pre-pr, backend test routing, service-owned CI lanes, validation artifacts, or PASS_WITH_CI_REQUIREMENTS.
---

# ESL Pipeline validation evidence

Use the smallest reliable validation path. Focused local evidence is the default; hosted PR CI owns
comprehensive regression on the resource-constrained developer laptop. Preserve the repository's
explicit division between local, CI-owned, and manual/environment-owned evidence.

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
- The primary owns choosing, inspecting, and reporting evidence, not physically running every broad
  suite locally. A focused-evidence branch may be ready for hosted CI without a local aggregate gate.

## Diagnose efficiently

- Run the narrowest focused test first.
- Do not require a local aggregate completion gate. Choose broad local execution only when there is a
  concrete plausible wider failure to catch before CI, local environment behavior under test,
  unavailable equivalent hosted evidence, or a specific CI failure to reproduce/diagnose. Diff
  breadth, package metadata, or a pre-PR command name alone is not enough.
- `check:fast:agent` can run selected affected local evidence. Its conservative broad fallback
  persists the broad plan and reports hosted comprehensive regression outstanding without executing
  broad local lanes. `check:pre-pr` / `check:pre-pr:agent` deliberately execute the broad plan when
  the reason is stated. A successful full `pnpm check` is local evidence only and never replaces
  required hosted CI.
- Allow at most one isolated diagnostic rerun for an unchanged failure.
- Treat a timeout, missing output, or detached caller as inconclusive until the artifact and any
  surviving process are inspected.
- If an aggregate validation process is still alive, continue observing or reconnect to that run.
  Do not start a second copy of the same aggregate gate against the same repository state.
- Do not add lane parallelism without explicit resource accounting across pnpm, Turbo, and Vitest.
- Stop with findings when the request is review or redesign only.

## Optional aggregate validation

Do not create a terminal aggregate-validation phase for focused work. When a concrete reason does
justify local aggregate execution, finish planned edits and focused checks first, state the expected
failure class and why hosted CI alone is insufficient for that decision, then inspect the resulting
artifact before changing the tree again. Do not run aggregates as an editing loop or repeat them to
manufacture a green summary; one isolated rerun is only for a diagnosed unchanged failure.

After sufficient focused local evidence, hand off the branch as ready for hosted CI and retain the
required hosted jobs, `CI gate`, and any manual/environment-owned checks as outstanding. Optional
improvements found after evidence is sufficient are follow-up findings unless separately authorized.

## Evidence freshness and completion handoff

Evidence must cover the final relevant code, configuration, and environment. The completion handoff
is the reuse boundary for a fresh receiving agent. When a command or validation lane produces
structured or persisted evidence, report:

- the exact command or validation lane and outcome;
- the exact local summary file or run-directory reference when one exists;
- for hosted evidence, the run URL or run identity plus the job and artifact identification when
  applicable;
- outstanding CI, manual, or environment-owned requirements; and
- enough execution-state and relevant-delta context to judge freshness, such as the comparison
  base and whether relevant files changed after the run.

Preserve the concrete evidence reference and the scope/state it covered. Preserve subsequent
relevant changes while ownership and context continue. Reuse completed evidence when relevant inputs
have not changed; a new message alone does not invalidate it. If continuity cannot be established
cheaply, treat freshness as unknown and rerun the affected scope. A `HEAD` value plus a dirty flag
does not prove that dirty content is unchanged. Do not add hashes, registries, generalized
fingerprints, or new artifact infrastructure for this handoff contract.

Read the recorded result and scope before relying on it. Rerun affected checks after relevant changes
or when concrete uncertainty remains, not merely to restate a passing result. Focused checks support
focused claims and do not replace a required repository or hosted gate.

A relevant change invalidates only evidence whose claimed scope it can affect. Do not mechanically
rerun unrelated focused lanes or aggregate gates when existing evidence still covers their inputs.

Agent-output commands are available when the receiving handoff needs persisted local evidence:
`pnpm check:fast:agent` for affected validation, `pnpm check:pre-pr:agent` for deliberately
justified broad local validation, and `pnpm check:agent` for full local CI reproduction or DB /
migration / worker / integration behavior. `check:fast:agent` preserves conservative classification
and artifacts but delegates its broad fallback to hosted CI; the explicit broad and full agent commands
preserve their local execution scope and exit semantics. The corresponding non-agent commands remain
the canonical human-readable equivalents.

Always report focused commands actually run, the canonical gate result, cited artifact paths for
failures, named CI-owned requirements, and whether the result is `PASS`,
`PASS_WITH_CI_REQUIREMENTS`, or a failure. Never describe `PASS_WITH_CI_REQUIREMENTS` as merge-ready.
