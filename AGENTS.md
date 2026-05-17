# Agent Handbook (v4)

## Meta

- Audience: AI agents and maintainers.
- Authority Level: router + compact operating contract.
- Last Verified Against: 2026-05-17 repo state.
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
- Fast check: `pnpm check:fast`
- Full check: `pnpm check`
- Docs check: `pnpm docs:check`
- Docs indexes: `pnpm docs:generate:indexes`
- Docs gardening: `pnpm docs:garden`
- Batch dev stack: `pnpm dev:batch`

When touching migrations, schema baselines, or contract-version files, also run the contract and DB
baseline verification commands listed in [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md)
and the repo admin workflow.

## Repo Admin

- Use short-lived feature branches; avoid direct pushes to `main`.
- Use Conventional Commit style: `<type>(<scope>): <short imperative summary>`.
- Every PR to `main` needs exactly one release label from
  [`docs/reference/VERSIONING_MODEL.md`](docs/reference/VERSIONING_MODEL.md).
- PR validation text must list commands actually run.
- Full PR workflow lives in [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md) and
  [`docs/operations/pr-style-release-notes.md`](docs/operations/pr-style-release-notes.md).
