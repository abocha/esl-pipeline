# Agent Handbook (v5)

## Meta

- Audience: AI agents and maintainers.
- Authority Level: router + compact operating contract.
- Last Verified Against: 2026-07-29 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after major workflow/tooling changes.
- Status: `router`.

This file is the agent entrypoint. Keep it short: route to the smallest authoritative doc set, then
let task docs and SSOT carry the details.

If this file conflicts with [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md), the
SSOT wins.

## Fast Path

1. [`docs/README.md`](docs/README.md) - section router.
2. [`docs/reference/DOCS_IA_MAP.md`](docs/reference/DOCS_IA_MAP.md) - task router.
3. Task-specific doc or package README.
4. [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md) - hard contracts.

If resuming after context loss, start with
[`docs/playbooks/RESTART_TOMORROW.md`](docs/playbooks/RESTART_TOMORROW.md), then check
[`docs/reference/V1_IMPLEMENTATION_TRACKER.md`](docs/reference/V1_IMPLEMENTATION_TRACKER.md).

## Non-Negotiables

- Do not bypass orchestrator contracts for pipeline behavior changes.
- Do not hardcode secrets.
- Do not silently change manifest, DTO, environment, or database contracts.
- Do not treat archive docs as current truth.
- Keep code, docs, and package READMEs aligned when behavior changes.
- When implementing from a plan file, re-read that exact plan after context compaction.
- Treat the developer laptop as the primary development environment, Git/CI as the source of truth,
  and the Lightsail VPS as production runtime only.

## Instruction Scope

- Keep durable repo-wide conventions, commands, constraints, and completion criteria in this file.
- Put subsystem detail in the nearest package README or task-specific doc; add a nested `AGENTS.md`
  only when repeated local rules cannot be expressed clearly through those docs.
- Put one-off goals and acceptance criteria in the task prompt or active plan, not in this router.
- Put reusable procedures in skills and deterministic enforcement in scripts, hooks, or CI.

## Execution Discipline

### Primary-agent ownership

- The primary agent owns all repository modifications. Perform code, test, documentation, config,
  and workflow edits inline; do not delegate implementation to subagents.
- Project subagents are read-only specialists and are not a default step:
  - `terra_explorer` is for bounded large-context tracing across code paths, contracts, tests, and
    active documentation.
  - `sol_reviewer` is for finding-first review where correctness, security, contracts, concurrency,
    or regression risk justifies high-reasoning review.
- Use the smallest set of agents that materially improves the result. Do not invoke subagents merely
  for parallelism, ceremony, or confirmation of work the primary agent can establish cheaply.
- Give each subagent a concrete, non-overlapping question. When an explorer owns a repository trace,
  the primary agent synthesizes its evidence instead of repeating the same exploration; perform only
  the targeted verification needed to make or validate the resulting change.

### Review gates

- Review cadence follows shared implementation context and risk boundaries, not the number of tasks
  or checkboxes in a plan.
- Batch related plan steps into one review gate when they operate on the same code surface and form
  one evidence chain. For example, exploration, a failing regression test, and the minimal green
  implementation for one subsystem should normally be reviewed together after that batch, not by
  calling a reviewer once per step.
- Start a new review batch when the work moves to a materially different subsystem, contract surface,
  or risk class, or when earlier findings require a redesigned approach. Give the reviewer the full
  relevant diff, plan context, and validation evidence for that batch.
- Send follow-up review of the same context to the reviewer that handled the original batch so its
  findings, assumptions, and residual questions carry forward. Use a fresh reviewer only when the
  original reviewer is unavailable or an intentionally independent second opinion is required.
- Avoid both fragmented micro-reviews and one oversized end-only review that mixes unrelated
  contexts. Reviewer calls must have a specific decision or risk question to answer.

### Tool-call batching

- Within each bounded Code Mode stage, run independent `functions.exec`-available tool calls
  concurrently in one `functions.exec` call.
- Use `Promise.allSettled(...)` when partial results are useful and inspect every result. Use
  `Promise.all(...)` only when any failure should abort the batch.
- Keep dependencies, waits or resumes, approvals, conflicting or interdependent mutations, and
  adaptive investigations whose next step depends on the prior result sequential.
- Do not split otherwise batchable inspections across outer tool calls.

### Quota economy

- Prefer the lowest-cost evidence path that can answer the question reliably: the smallest relevant
  doc set, targeted search, focused test, or bounded specialist review.
- Stop exploring once evidence is sufficient for the current decision. Avoid repeated repository
  scans, duplicate agent work, speculative branches of investigation, and rerunning checks without
  new evidence.
- Match validation to the changed risk surface. Do not expand a focused change into broad checks,
  CI monitoring, or unrelated cleanup unless repo routing, fresh failure evidence, or the user
  requires it.
- Preserve quality over token savings when security, data integrity, contracts, production safety,
  or a genuinely ambiguous implementation decision needs deeper evidence.

## Common Routes

- Orientation: [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md)
- Setup/env: [`docs/QUICK_START.md`](docs/QUICK_START.md),
  [`docs/reference/env.md`](docs/reference/env.md)
- Tests: [`docs/reference/TESTING_GUIDELINES.md`](docs/reference/TESTING_GUIDELINES.md)
- Backend/frontend integration:
  [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md),
  [`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md)
- Orchestrator ownership:
  [`docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`](docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md),
  [`docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`](docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md)
- Prompt gallery runtime:
  [`docs/operations/prompt-gallery-bootstrap.md`](docs/operations/prompt-gallery-bootstrap.md)
- Docker/dev stack: [`docs/operations/docker-host-paths.md`](docs/operations/docker-host-paths.md)
- Deployment/runtime workflow: [`docs/backend-frontend/DEPLOYMENT.md`](docs/backend-frontend/DEPLOYMENT.md),
  [`docs/operations/production-env-checklist.md`](docs/operations/production-env-checklist.md),
  [`docs/alpha-deployment-decisions.md`](docs/alpha-deployment-decisions.md)
- Postgres ops:
  [`docs/operations/postgres-backup-restore.md`](docs/operations/postgres-backup-restore.md),
  [`docs/operations/postgres-backup-s3.md`](docs/operations/postgres-backup-s3.md),
  [`docs/operations/postgres-ops-health.md`](docs/operations/postgres-ops-health.md)
- Release/versioning:
  [`docs/reference/VERSIONING_MODEL.md`](docs/reference/VERSIONING_MODEL.md),
  [`docs/operations/pr-style-release-notes.md`](docs/operations/pr-style-release-notes.md)
- Docs gardening and plan lifecycle:
  [`docs/reference/DOCS_GOVERNANCE.md`](docs/reference/DOCS_GOVERNANCE.md),
  [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](docs/reference/DOCS_GARDENING_PLAYBOOK.md),
  [`docs/plans/README.md`](docs/plans/README.md),
  [`docs/generated/README.md`](docs/generated/README.md)

## Command Baseline

- Install: `pnpm install`
- Format write/check: `pnpm format:write`, then `pnpm format`
- Repo hygiene: `pnpm run lint:repo-hygiene`
- Root tooling tests: `pnpm test:tooling`
- Docker configuration lint: `pnpm docker:lint`
- Affected check (agent default): `pnpm --silent run check:fast:agent`
- Affected check (raw human output): `pnpm check:fast`
- Broad pre-PR check: `pnpm check:pre-pr`
- Full check: `pnpm check`
- Docs check: `pnpm docs:check`
- Core docs check only: `pnpm docs:check:core`
- Docs indexes: `pnpm docs:generate:indexes`
- Docs gardening: `pnpm docs:garden`
- Batch dev stack: `pnpm dev:batch`
- Production deploy (VPS, after CI publishes images):
  `bash scripts/deploy/deploy-prod-images.sh <40-char-git-sha>`

Agents should prefer `:agent` validation commands when they exist. These commands are intentionally
terse on success and write detailed artifacts under `tmp/check-logs/...` or `tmp/test-logs/...`; do
not treat quiet output as a hang. `check:fast` is an affected-package lane: it compares against
`origin/main`, includes committed/staged/unstaged/untracked files, runs cheap global guards, expands
workspace dependents, applies path-risk rules, and prints why packages or lanes were selected. On
failure, read the reported artifact before rerunning raw commands. Use raw lanes only when the agent
lane is missing or when the artifact shows that full stream output is needed for diagnosis.
`check:fast:dry-run` prints the local working-tree scope and committed hosted CI preview separately.
Affected and broad pre-PR validation execute selected lanes serially. Independent lanes continue
after a failure so one run reports every available problem; prebuilt test lanes are marked blocked
when their build prerequisite fails. Read the aggregate summary and cited lane artifacts before any
rerun. Use an isolated rerun only to diagnose a specific failure; it does not replace canonical gate
evidence. Allow at most one isolated diagnostic rerun per unchanged failure. Repeat the complete gate
only after relevant source, configuration, toolchain, or diagnosed prerequisite state changed.

Backend tests are routed by operational prerequisite, not filename alone. The positive service
inventory in `packages/batch-backend/tests/test-routing.json` owns deterministic HTTP, PostgreSQL
migration, PostgreSQL query, and PostgreSQL + Redis worker suites; unit is the guarded remainder.
`test:check-routing` must pass before unit execution. Canonical local and agent unit lanes remove
ambient service/provider credentials and set `VALIDATION_TEST_CLASS=pure`; focused DB/worker lanes
retain only their explicitly constructed service environment.

Selected PostgreSQL and Redis lanes are visible in the local plan but owned by PR CI; ordinary local
validation does not start those services. `PASS_WITH_CI_REQUIREMENTS` permits opening or updating a
PR, but it is not merge evidence. Before merge, every selected CI job and the aggregate `CI gate`
must pass. Static and deterministic integration CI logs are retained as artifacts for failure
classification. Merge to `main` automatically starts the release workflow, so required application
evidence must not be deferred to a nightly or post-merge regression run.

After focused tests, choose one normal pre-push gate: use `check:fast:agent` by default; use
`check:pre-pr` directly when the branch is already broad, cross-cutting, shared-contract, or
toolchain-level. A `check:fast:agent` fallback to `check:pre-pr` satisfies the broad gate, and a
successful `pnpm check` subsumes both narrower gates. Clearly docs-only work may use the documented
docs-specific lanes. Run `pnpm check` directly when reproducing CI or when DB, migration, worker,
integration, or similarly broad behavior changed. For Vitest-heavy work, prefer the matching agent lane first:
`pnpm --silent run test:unit:prebuilt:fast:agent`, `pnpm --silent run test:agent:html-publisher`,
or another existing `:agent` test script.

When touching migrations, schema baselines, or contract-version files, also run the contract and DB
baseline verification commands listed in [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md)
and the repo admin workflow.

Production Compose must stay pull-based: app services use SHA-tagged GHCR image refs supplied through
environment/state files, while the VPS stores deployment state outside the checkout under
`/var/lib/esl-pipeline/deploy`. Do not reintroduce production `build:`, `:local`, `pull_policy:
never`, `up --build`, backend Docker socket mounts, or long-running backend Docker/AWS CLIs.

## Definition of Done

- The requested outcome is implemented without widening scope or silently changing contracts.
- Relevant tests and validation have fresh evidence, and the final handoff lists commands actually run.
- Behavior docs, package READMEs, plans, and generated indexes are synchronized where the change
  affects them; deployment or other external mutations occur only when explicitly requested.

## Repo Admin

- Use short-lived feature branches; avoid direct pushes to `main`.
- Use Conventional Commit style: `<type>(<scope>): <short imperative summary>`.
- Every PR to `main` needs exactly one release label from
  [`docs/reference/VERSIONING_MODEL.md`](docs/reference/VERSIONING_MODEL.md). Use `release:none`
  only when the release guard confirms the complete change is maintenance-only.
- PR validation text must list commands actually run.
- Full PR workflow lives in [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md) and
  [`docs/operations/pr-style-release-notes.md`](docs/operations/pr-style-release-notes.md).
