# Documentation Router (Agent-First)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 2 minutes.
- Authority Level: Router.
- Last Verified Against: 2026-03-05 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly.
- Status: `router`.

## Purpose

- Route tasks to the minimum authoritative doc set.
- Keep active guidance concise and discoverable.
- Keep historical rationale in archive docs.

## Canonical Read Order

1. [`AGENTS.md`](../AGENTS.md)
2. [`docs/README.md`](README.md)
3. [`docs/reference/DOCS_IA_MAP.md`](reference/DOCS_IA_MAP.md)
4. Task-specific docs
5. [`docs/reference/agents-ssot.md`](reference/agents-ssot.md) for contracts/invariants

## Agent Start Paths

- Repo orientation: [`docs/PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md)
- Setup/run commands: [`docs/QUICK_START.md`](QUICK_START.md)
- Backend/frontend status: [`docs/backend-frontend/backend-frontend-alignment.md`](backend-frontend/backend-frontend-alignment.md)
- Batch system map: [`docs/backend-frontend/BATCH_SYSTEM.md`](backend-frontend/BATCH_SYSTEM.md)
- Orchestrator architecture and ownership:
  - [`docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`](reference/ORCHESTRATOR_SYSTEM_REVIEW.md)
  - [`docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`](reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md)
- Env contracts: [`docs/reference/env.md`](reference/env.md)
- Test methodology + lane model: [`docs/reference/TESTING_GUIDELINES.md`](reference/TESTING_GUIDELINES.md)
- Validator ruleset conventions: [`docs/reference/MD_VALIDATOR_RULESET_CONVENTIONS.md`](reference/MD_VALIDATOR_RULESET_CONVENTIONS.md)

## Operations Paths

- Docker host paths and port collisions:
  - [`docs/operations/docker-host-paths.md`](operations/docker-host-paths.md)
- Postgres backup/restore:
  - [`docs/operations/postgres-backup-restore.md`](operations/postgres-backup-restore.md)
- S3 archival + scheduling:
  - [`docs/operations/postgres-backup-s3.md`](operations/postgres-backup-s3.md)
- Ops health alerts/status/key rotation:
  - [`docs/operations/postgres-ops-health.md`](operations/postgres-ops-health.md)
- Prompt gallery DB bootstrap:
  - [`docs/operations/prompt-gallery-bootstrap.md`](operations/prompt-gallery-bootstrap.md)
- Versioning and release automation:
  - [`docs/reference/VERSIONING_MODEL.md`](reference/VERSIONING_MODEL.md)
- Historical pre-v1 tag reset record:
  - [`docs/archive/release/versioning-tag-reset-runbook.md`](archive/release/versioning-tag-reset-runbook.md)

## Rules of Thumb

- Prefer active docs over archive docs.
- Read only the docs needed for the current task.
- If docs conflict, SSOT and code win.

## Related

- [`docs/reference/DOCS_GOVERNANCE.md`](reference/DOCS_GOVERNANCE.md)
- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](reference/HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/reference/DOCS_QUALITY_SCORE.md`](reference/DOCS_QUALITY_SCORE.md)
- [`docs/archive/README.md`](archive/README.md)
