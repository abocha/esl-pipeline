# Documentation IA Map (Agent Task Router)

## Meta

- Audience: AI agents and maintainers.
- Read Time: 3 minutes.
- Authority Level: Active routing map.
- Last Verified Against: 2026-07-14 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly.
- Status: `router`.

## Purpose

Map common tasks to the smallest doc set needed for safe implementation. Start with the first doc;
open the second only when the task crosses that boundary.

## Engineering and Runtime

| Task                                    | Read first                                            | Then read                                               |
| --------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Repository orientation                  | `docs/PROJECT_OVERVIEW.md`                            | `docs/reference/agents-ssot.md`                         |
| Setup or local development              | `docs/QUICK_START.md`                                 | `docs/reference/env.md`                                 |
| Test selection or test changes          | `docs/reference/TESTING_GUIDELINES.md`                | `docs/reference/agents-ssot.md`                         |
| Contracts or invariants                 | `docs/reference/agents-ssot.md`                       | Relevant package README                                 |
| Frontend workflow or mock-auth sandbox  | `packages/batch-frontend/README.md`                   | `docs/backend-frontend/backend-frontend-alignment.md`   |
| Backend service or route behavior       | `packages/batch-backend/README.md`                    | `docs/backend-frontend/batch-backend-ssot.md`           |
| Backend/frontend capability status      | `docs/backend-frontend/backend-frontend-alignment.md` | `docs/backend-frontend/BATCH_SYSTEM.md`                 |
| Orchestrator ownership or refactor      | `docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`        | `docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`       |
| Orchestrator API v2 cutover             | `docs/reference/ORCHESTRATOR_API_V2_MIGRATION.md`     | `docs/reference/VERSIONING_MODEL.md`                    |
| Manifest compatibility                  | `docs/reference/pipeline-manifest.md`                 | `docs/reference/agents-ssot.md`                         |
| Markdown validator rules                | `docs/reference/MD_VALIDATOR_RULESET_CONVENTIONS.md`  | `packages/md-validator/README.md`                       |
| Generation models, quotas, or providers | `docs/reference/GENERATION_PROVIDER_POLICY.md`        | Relevant WS2B provider profile                          |
| Homework prompt structure               | `docs/reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md`   | `docs/reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md` |
| Speech planning or TTS rendering        | `docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`     | `docs/reference/pipeline-manifest.md`                   |

## Operations

| Task                                           | Read first                                          | Then read                                                   |
| ---------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Deployment or local production Compose         | `docs/backend-frontend/DEPLOYMENT.md`               | `docs/operations/production-env-checklist.md`               |
| Docker recovery, host paths, or pnpm hydration | `docs/operations/docker-host-paths.md`              | `docs/operations/rollup-optional-binary-troubleshooting.md` |
| Postgres backup or restore                     | `docs/operations/postgres-backup-restore.md`        | `docs/operations/postgres-backup-s3.md`                     |
| Ops status, alerts, or key rotation            | `docs/operations/postgres-ops-health.md`            | `docs/reference/env.md`                                     |
| Telegram ops bot                               | `docs/operations/telegram-ops-control-panel.md`     | `packages/telegram-ops-bot/README.md`                       |
| Prompt gallery runtime                         | `docs/operations/prompt-gallery-bootstrap.md`       | `docs/reference/env.md`                                     |
| Voice-alignment rollout                        | `docs/operations/voice-alignment-v2-runbook.md`     | `docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`           |
| Student-memory replay or backfill              | `docs/operations/student-memory-replay-backfill.md` | `packages/batch-backend/README.md`                          |
| Legacy profile normalization                   | `docs/operations/legacy-profile-normalization.md`   | `docs/reference/STUDENT_SYSTEM_ROADMAP.md`                  |

## Product and Planning

| Task                                        | Read first                                                              | Then read                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Recording, transcript, or draft design      | `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`                            | `docs/PIPELINE_INTEGRATION_VISION.md`                        |
| Student-system boundaries                   | `docs/reference/STUDENT_SYSTEM_ROADMAP.md`                              | `docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md`           |
| Student memory or profile enrichment        | Relevant topic README under `docs/plans/`                               | `docs/reference/STUDENT_SYSTEM_ROADMAP.md`                   |
| Scheduling, billing, or business surfaces   | `docs/reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md`                  | `docs/reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md` |
| Product readiness                           | `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`                    | `docs/plans/2026-06-23-alpha-readiness.md`                   |
| Broad V1 continuity                         | `docs/reference/V1_IMPLEMENTATION_TRACKER.md`                           | `docs/playbooks/RESTART_TOMORROW.md`                         |
| Create or locate an active plan             | `docs/plans/README.md`                                                  | `docs/generated/plans-index.md`                              |
| Execute an approved implementation artifact | Exact file under `docs/superpowers/specs/` or `docs/superpowers/plans/` | Current task-specific reference or runbook                   |

## Docs, Agent Harness, and Release

| Task                                      | Read first                                 | Then read                                                           |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------- |
| Docs gardening or archive work            | `docs/reference/DOCS_GOVERNANCE.md`        | `docs/reference/DOCS_GARDENING_PLAYBOOK.md`                         |
| Package README or generated inventory     | `docs/generated/README.md`                 | `docs/reference/DOCS_GOVERNANCE.md`                                 |
| `AGENTS.md` or agent-harness upkeep       | `docs/reference/AGENT_LEGIBILITY_MODEL.md` | `docs/reference/DOCS_GOVERNANCE.md`                                 |
| PR workflow, release label, or versioning | `docs/reference/VERSIONING_MODEL.md`       | `docs/operations/pr-style-release-notes.md`                         |
| Resume after context loss                 | `docs/playbooks/RESTART_TOMORROW.md`       | Exact active plan and `docs/reference/V1_IMPLEMENTATION_TRACKER.md` |

## Routing Rules

- Prefer active docs over archive docs; use archive only for historical rationale.
- Treat package READMEs as implementation entrypoints, not substitutes for canonical contracts.
- Use approved specs and plans for their named task. After merge, verify behavior against code and
  current reference/runbook docs.
- If docs conflict, code and [`docs/reference/agents-ssot.md`](agents-ssot.md) win.

## Related

- [`AGENTS.md`](../../AGENTS.md)
- [`docs/README.md`](../README.md)
- [`docs/reference/DOCS_GOVERNANCE.md`](DOCS_GOVERNANCE.md)
- [`docs/archive/README.md`](../archive/README.md)
