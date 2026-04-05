# Agent Handbook (v3)

## Meta

- Audience: AI agents and maintainers.
- Authority Level: router + operating contract.
- Last Verified Against: 2026-04-05 repo state.
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
- Repo hygiene lint/tooling:
  - [`docs/reference/REPO_HYGIENE_LINTING.md`](docs/reference/REPO_HYGIENE_LINTING.md)
- Backend/frontend integration work:
  - [`docs/backend-frontend/BATCH_SYSTEM.md`](docs/backend-frontend/BATCH_SYSTEM.md)
  - [`docs/backend-frontend/backend-frontend-alignment.md`](docs/backend-frontend/backend-frontend-alignment.md)
- Orchestrator architecture review + ownership decisions:
  - [`docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`](docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md)
  - [`docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`](docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md)
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
- Docs gardening, archive policy, and generated references:
  - [`docs/reference/DOCS_GOVERNANCE.md`](docs/reference/DOCS_GOVERNANCE.md)
  - [`docs/reference/AGENT_LEGIBILITY_MODEL.md`](docs/reference/AGENT_LEGIBILITY_MODEL.md)
  - [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](docs/reference/DOCS_GARDENING_PLAYBOOK.md)
  - [`docs/generated/README.md`](docs/generated/README.md)
- Plan routing and lifecycle:
  - [`docs/plans/README.md`](docs/plans/README.md)
- Historical pre-v1 tag reset record:
  - [`docs/archive/release/versioning-tag-reset-runbook.md`](docs/archive/release/versioning-tag-reset-runbook.md)

## Architecture Snapshot (High-Level)

- `@esl-pipeline/orchestrator` is the canonical pipeline engine and library-only programmatic API surface (CLI/wizard/path-picker retired).
- `@esl-pipeline/batch-backend` and `@esl-pipeline/batch-frontend` are the operational batch system.
- Supporting core packages:
  - `@esl-pipeline/md-validator`
  - `@esl-pipeline/pmd`
  - `@esl-pipeline/notion-adapter`
  - `@esl-pipeline/tts-core`
  - `@esl-pipeline/tts-provider-elevenlabs`
  - `@esl-pipeline/tts-provider-google`
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

Lint/format ownership baseline:

- `pnpm lint` is a hybrid lane:
  - Biome is the default JS/TS/TSX/JSON linter.
  - ESLint remains for specialized React and Vitest checks.
- Repo hygiene:
  - `pnpm run lint:repo-hygiene` runs workflow and shell linting (`actionlint` + `ShellCheck`).
  - These checks are enforced in GitHub Actions and kept separate from the default local `pnpm lint` lane because they rely on extra non-Node tooling.
- `pnpm format` is a hybrid lane:
  - Biome formats JS/TS/TSX/JSON and organizes imports.
  - Prettier remains for Markdown, YAML, and `package.json`.
- Advisory lint:
  - `pnpm lint:sqlfluff` is available for SQL debt review, but is not part of the default blocking lane until the existing SQL style is calibrated.

Dependency hygiene when touching deps:

1. `pnpm install`
2. `pnpm deps:pin`
3. `pnpm deps:audit:strict`
4. `pnpm check:fast`

## Host vs Container Env Context (Mandatory)

When working with scripts/commands that read environment:

- Treat `host-invoked CLI` and `container runtime` as distinct execution contexts.
  - Host CLI runs from local shell/network context.
  - Services in Compose use Docker DNS/service networking.
- Do not require changing container-safe defaults just to make host checks pass.
  - In this repo, `PG_HOST=postgres` is canonical for Compose services.
  - Host checks should adapt internally when they need `127.0.0.1`.
- Prefer script-level adaptation over operator shell gymnastics.
  - If a release/readiness script runs from host, it should normalize host-specific env needs itself.
- On WSL/Linux host-run tooling, proactively set safe temp envs (`TMPDIR`, `TMP`, `TEMP`) inside scripts when Node/tsx IPC sockets may fail on mounted Windows temp paths.

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
- [`docs/reference/AGENT_LEGIBILITY_MODEL.md`](docs/reference/AGENT_LEGIBILITY_MODEL.md)
- [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](docs/reference/DOCS_GARDENING_PLAYBOOK.md)
- [`docs/reference/DOCS_GARDENING_SCORECARD.md`](docs/reference/DOCS_GARDENING_SCORECARD.md)
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
  5. `pnpm format:write`
  6. `pnpm format`
  7. `pnpm run lint:repo-hygiene`
  8. `pnpm check:fast`
  9. `git push -u origin <branch>`
  10. `gh pr create --base main --head <branch> --title "<title>" --body-file .github/pull_request_template.md --label <release:major|release:minor|release:patch>`
- Pull request body protocol:
  - Use `.github/pull_request_template.md` sections exactly:
    - `Summary`
    - `Validation`
    - `Risk Notes`
    - `Checklist`
  - In `Validation`, include commands actually run, including `pnpm format`, `pnpm run lint:repo-hygiene`, `pnpm check:fast`, targeted tests, and manual smoke if applicable.
- Mandatory release label protocol:
  - Every PR targeting `main` must have exactly one release label:
    - `release:major`
    - `release:minor`
    - `release:patch`
  - Determine the label using [`docs/reference/VERSIONING_MODEL.md`](docs/reference/VERSIONING_MODEL.md):
    - `release:major`: breaking contract compatibility
    - `release:minor`: backward-compatible feature or surface expansion
    - `release:patch`: bugfix, docs, ops, refactor, or internal hardening
  - If label choice is ambiguous, stop and ask before creating the PR.
  - After PR creation, verify labels with `gh pr view <pr-number> --json labels` and fix immediately if missing or multiple.
- Commit protocol:
  - Use Conventional Commit style: `<type>(<scope>): <short imperative summary>`.
  - Prefer: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `build`, `ci`.
  - Use a meaningful scope for the package or subsystem touched.
  - Keep commits focused and avoid generated local artifacts.
  - When behavior changes, include related docs updates in the same branch.
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
