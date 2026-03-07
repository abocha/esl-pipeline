# Agent Handbook (v3)

## Meta

- Audience: AI agents and maintainers.
- Authority Level: router + operating contract.
- Last Verified Against: 2026-03-05 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after major workflow/tooling changes.
- Status: `router`.

This file is the primary entrypoint for AI agents and maintainers working in this repo.
It is both:

- A fast router into the right docs.
- A compact operating contract for safe, consistent changes.

If anything here conflicts with [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md), the SSOT wins.

Everything below assumes **Node.js 24.11.1+**, pnpm, and system ffmpeg.

## Agent Fast Path (Read In Order)

1. [`docs/README.md`](docs/README.md) - docs router.
2. [`docs/reference/DOCS_IA_MAP.md`](docs/reference/DOCS_IA_MAP.md) - task-to-doc map.
3. [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md) - live capability status.
4. [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md) - contracts/invariants.

If you are resuming after context loss: start at [`START_HERE.md`](START_HERE.md).

## Plan Continuity Rule (Mandatory)

When implementing from a plan file, re-read that exact plan file after every context compaction before making further edits.

## How To Use Docs (Progressive Disclosure)

- Read only what your task needs.
- Prefer active docs over archive docs.
- Use archive docs only for historical rationale.
- Keep changes in sync across router docs and SSOT when behavior changes.

## Task Router (Common Paths)

- Repo orientation:
  - [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md)
- Setup/run commands:
  - [`docs/QUICK_START.md`](docs/QUICK_START.md)
  - [`docs/reference/env.md`](docs/reference/env.md)
- Test writing + lane methodology:
  - [`docs/reference/TESTING_GUIDELINES.md`](docs/reference/TESTING_GUIDELINES.md)
- Backend/frontend integration work:
  - [`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md)
  - [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md)
- Prompt gallery (DB-canonical runtime):
  - [`docs/operations/prompt-gallery-bootstrap.md`](docs/operations/prompt-gallery-bootstrap.md)
- Docker dev stack troubleshooting:
  - [`docs/operations/docker-host-paths.md`](docs/operations/docker-host-paths.md)
- Postgres backup + restore + S3 archival:
  - [`docs/operations/postgres-backup-restore.md`](docs/operations/postgres-backup-restore.md)
  - [`docs/operations/postgres-backup-s3.md`](docs/operations/postgres-backup-s3.md)
  - [`docs/operations/postgres-ops-health.md`](docs/operations/postgres-ops-health.md)
- Release notes from direct commits:
  - [`docs/operations/pr-style-release-notes.md`](docs/operations/pr-style-release-notes.md)
- Release/versioning model and automation:
  - [`docs/reference/VERSIONING_MODEL.md`](docs/reference/VERSIONING_MODEL.md)
- Historical pre-v1 tag reset record:
  - [`docs/archive/release/versioning-tag-reset-runbook.md`](docs/archive/release/versioning-tag-reset-runbook.md)

## Architecture Snapshot (High-Level)

- `@esl-pipeline/orchestrator` is the canonical pipeline engine and CLI/API surface.
- `@esl-pipeline/batch-backend` and `@esl-pipeline/batch-frontend` are the operational batch system.
- Supporting core packages:
  - `@esl-pipeline/md-validator`
  - `@esl-pipeline/pmd`
  - `@esl-pipeline/notion-adapter`
  - `@esl-pipeline/tts-elevenlabs`
  - `@esl-pipeline/storage-uploader`
  - `@esl-pipeline/html-publisher`
  - `@esl-pipeline/provider-runtime`
  - `@esl-pipeline/contracts`
  - `@esl-pipeline/shared-infrastructure`

## Non-Negotiable Invariants

- Do not bypass orchestrator contracts for pipeline behavior changes.
- Do not hardcode secrets.
- Do not silently change manifest/config contracts.
- Do not treat historical docs as current truth.
- Keep docs and code aligned when behavior changes.

For exact invariants and forbidden changes: [`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md).

## Runtime and Command Baseline

- Install: `pnpm install`
- Fast checks: `pnpm check:fast`
- Full checks: `pnpm check`
- Build: `pnpm build`
- Lint: `pnpm lint`
- Test (unit lane): `pnpm test`
- Test (integration lane): `pnpm test:integration`
- Smoke: `pnpm smoke`
- Batch local dev: `pnpm dev:batch`

For lane semantics and test-authoring methodology, see
[`docs/reference/TESTING_GUIDELINES.md`](docs/reference/TESTING_GUIDELINES.md).

Dependency hygiene when touching deps:

1. `pnpm install`
2. `pnpm deps:pin`
3. `pnpm deps:audit:strict`
4. `pnpm check:fast`

## Docs Change Rules

When editing docs:

- Update the smallest authoritative doc set.
- Keep router docs concise; avoid duplicating long specs.
- Archive stale long-form docs rather than patching forever.
- Keep metadata and links current.

Before merge for docs-heavy work:

- Run `pnpm docs:check`.

Docs governance and IA:

- [`docs/reference/DOCS_GOVERNANCE.md`](docs/reference/DOCS_GOVERNANCE.md)
- [`docs/reference/DOCS_IA_MAP.md`](docs/reference/DOCS_IA_MAP.md)
- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/reference/DOCS_QUALITY_SCORE.md`](docs/reference/DOCS_QUALITY_SCORE.md)

## Repo Admin Workflow (GitHub)

- Use short-lived feature branches; avoid direct pushes to `main`.
- Standard PR flow:
  1. `git fetch origin`
  2. `git switch main`
  3. `git pull --ff-only`
  4. `git switch -c <branch>`
  5. `git push -u origin <branch>`
  6. `gh pr create --base main --head <branch> --title "<title>" --body-file .github/pull_request_template.md`
- Monitor checks and comments:
  - `gh pr checks <pr-number>`
  - `gh pr view <pr-number> --comments`
- Merge:
  - `gh pr merge <pr-number> --merge --delete-branch`

If you accidentally push to `main`:

1. Create a backup branch at current tip.
2. Revert accidental commits on `main` (no force-push).
3. Cherry-pick intended commits onto a feature branch and open a normal PR.

## Final Reminder

Start here for orientation, then rely on the SSOT for decision-making:
[`docs/reference/agents-ssot.md`](docs/reference/agents-ssot.md).
