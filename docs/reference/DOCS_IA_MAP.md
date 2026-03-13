# Documentation IA Map (Agent Task Router)

## Meta

- Audience: AI agents and maintainers.
- Read Time: 3 minutes.
- Authority Level: Active routing map.
- Last Verified Against: 2026-03-13 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly.
- Status: `router`.

## Purpose

- Map common tasks to the smallest doc set needed for safe implementation.

## Canonical Sources

1. [`AGENTS.md`](../../AGENTS.md)
2. [`docs/README.md`](../README.md)
3. [`docs/reference/agents-ssot.md`](agents-ssot.md)

## Agent Task -> Doc Path

| Task                                                           | Read First                                            | Then Read                                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Repo orientation                                               | `docs/PROJECT_OVERVIEW.md`                            | `docs/reference/agents-ssot.md`                                                      |
| Setup/run commands                                             | `docs/QUICK_START.md`                                 | `docs/reference/env.md`                                                              |
| Write/update tests                                             | `docs/reference/TESTING_GUIDELINES.md`                | `docs/reference/agents-ssot.md`                                                      |
| Contracts/invariants                                           | `docs/reference/agents-ssot.md`                       | `docs/backend-frontend/backend-frontend-alignment.md`                                |
| Orchestrator architecture review / ownership refactor planning | `docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`        | `docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`, `docs/reference/agents-ssot.md`   |
| Orchestrator API v2 migration and cutover status               | `docs/reference/ORCHESTRATOR_API_V2_MIGRATION.md`     | `docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`, `docs/reference/VERSIONING_MODEL.md` |
| Markdown validator rules/rulesets                              | `docs/reference/MD_VALIDATOR_RULESET_CONVENTIONS.md`  | `docs/reference/agents-ssot.md`                                                      |
| Backend/frontend capability status                             | `docs/backend-frontend/backend-frontend-alignment.md` | `docs/backend-frontend/BATCH_SYSTEM.md`                                              |
| Prompt gallery DB runtime                                      | `docs/operations/prompt-gallery-bootstrap.md`         | `docs/reference/env.md`                                                              |
| Docker dev stack recovery                                      | `docs/operations/docker-host-paths.md`                | `docs/QUICK_START.md`                                                                |
| Postgres backup/restore routine                                | `docs/operations/postgres-backup-restore.md`          | `docs/operations/postgres-backup-s3.md`                                              |
| Ops health alerts and key checks                               | `docs/operations/postgres-ops-health.md`              | `docs/reference/env.md`                                                              |
| Telegram ops control panel                                     | `docs/operations/telegram-ops-control-panel.md`       | `docs/reference/env.md`                                                              |
| Voice-alignment rollout and diagnostics                        | `docs/operations/voice-alignment-v2-runbook.md`       | `docs/reference/env.md`                                                              |
| Transcription / recording / draft flow                         | `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`          | `docs/PIPELINE_INTEGRATION_VISION.md`, `docs/backend-frontend/backend-frontend-alignment.md` |
| Learning preset architecture and prompt governance             | `docs/reference/PRESET_V2_SPEC.md`                    | `docs/reference/GENERATION_PROVIDER_POLICY.md`, `docs/reference/agents-ssot.md`      |
| Generation provider/model decision review                      | `docs/reference/GENERATION_PROVIDER_POLICY.md`        | `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`, `docs/reference/OPENROUTER_WS2B_PROFILE.md`, `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md` |
| Student system roadmap and DB migration lineage                | `docs/reference/STUDENT_SYSTEM_ROADMAP.md`            | `docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md`, `docs/reference/agents-ssot.md`  |
| Product readiness / weekly review planning                     | `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`  | `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`                                   |
| Resume broad V1 continuity work                                | `docs/reference/V1_IMPLEMENTATION_TRACKER.md`         | `START_HERE.md`, `docs/playbooks/RESTART_TOMORROW.md`                                |
| Docs gardening / archive / generated-reference work            | `docs/reference/DOCS_GOVERNANCE.md`                   | `docs/reference/AGENT_LEGIBILITY_MODEL.md`, `docs/reference/DOCS_GARDENING_PLAYBOOK.md`, `docs/generated/README.md` |
| Package README sync                                            | `docs/reference/DOCS_GARDENING_PLAYBOOK.md`           | `docs/generated/package-readme-index.md`, `docs/reference/DOCS_GOVERNANCE.md`        |
| Repo inventories / generated indexes                           | `docs/generated/README.md`                            | `docs/generated/backend-route-index.md`, `docs/generated/env-surface-index.md`, `docs/generated/package-readme-index.md`, `docs/generated/plans-index.md` |
| Plan lifecycle / where to put a new plan                       | `docs/plans/README.md`                                | `docs/generated/plans-index.md`, `docs/reference/DOCS_GARDENING_PLAYBOOK.md`         |
| PR workflow, release notes, and versioning                     | `AGENTS.md`                                           | `docs/reference/VERSIONING_MODEL.md`, `docs/operations/pr-style-release-notes.md`    |
| Restart after context overload                                 | `START_HERE.md`                                       | `docs/playbooks/RESTART_TOMORROW.md`                                                 |

## Routing Rules

- Prefer active docs in `docs/` before archive docs.
- Use archive docs only for historical rationale.
- If docs conflict, SSOT and code win.

## Related

- [`docs/reference/DOCS_GOVERNANCE.md`](DOCS_GOVERNANCE.md)
- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/archive/README.md`](../archive/README.md)
