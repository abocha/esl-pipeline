# Documentation Router (Agent-First)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 2 minutes.
- Authority Level: Router.
- Last Verified Against: 2026-07-14 repo state.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly.
- Status: `router`.

## Purpose

Route each task to the smallest authoritative doc set. Use
[`docs/reference/DOCS_IA_MAP.md`](reference/DOCS_IA_MAP.md) when the task is not listed here.

## Canonical Read Order

1. [`AGENTS.md`](../AGENTS.md)
2. This router
3. Task-specific doc or package README
4. [`docs/reference/agents-ssot.md`](reference/agents-ssot.md) for contracts and invariants

## Start Here

| Need                                       | Read                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Repository orientation                     | [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md)                                                       |
| Install, validate, or run locally          | [`QUICK_START.md`](QUICK_START.md)                                                                 |
| Choose a task-specific doc path            | [`reference/DOCS_IA_MAP.md`](reference/DOCS_IA_MAP.md)                                             |
| Hard repository contracts                  | [`reference/agents-ssot.md`](reference/agents-ssot.md)                                             |
| Test-lane selection                        | [`reference/TESTING_GUIDELINES.md`](reference/TESTING_GUIDELINES.md)                               |
| Current backend/frontend capability status | [`backend-frontend/backend-frontend-alignment.md`](backend-frontend/backend-frontend-alignment.md) |

## System Routes

| Surface                                 | Canonical entrypoint                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Batch architecture                      | [`backend-frontend/BATCH_SYSTEM.md`](backend-frontend/BATCH_SYSTEM.md)                                                                                                                |
| Backend service boundary                | [`backend-frontend/batch-backend-ssot.md`](backend-frontend/batch-backend-ssot.md)                                                                                                    |
| Frontend workflow and mock-auth sandbox | [`packages/batch-frontend/README.md`](../packages/batch-frontend/README.md)                                                                                                           |
| Orchestrator architecture and ownership | [`reference/ORCHESTRATOR_SYSTEM_REVIEW.md`](reference/ORCHESTRATOR_SYSTEM_REVIEW.md), then [`reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`](reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md) |
| Environment contracts                   | [`reference/env.md`](reference/env.md)                                                                                                                                                |
| Manifest compatibility                  | [`reference/pipeline-manifest.md`](reference/pipeline-manifest.md)                                                                                                                    |
| Generation models and provider policy   | [`reference/GENERATION_PROVIDER_POLICY.md`](reference/GENERATION_PROVIDER_POLICY.md)                                                                                                  |
| Speech planning and TTS rendering       | [`reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`](reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md)                                                                                            |

## Operations Routes

| Task                             | Runbook                                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment and production images | [`backend-frontend/DEPLOYMENT.md`](backend-frontend/DEPLOYMENT.md)                                                                                                                                                                 |
| Production environment           | [`operations/production-env-checklist.md`](operations/production-env-checklist.md)                                                                                                                                                 |
| Docker paths and local recovery  | [`operations/docker-host-paths.md`](operations/docker-host-paths.md)                                                                                                                                                               |
| Postgres backup, S3, and health  | [`operations/postgres-backup-restore.md`](operations/postgres-backup-restore.md), [`operations/postgres-backup-s3.md`](operations/postgres-backup-s3.md), [`operations/postgres-ops-health.md`](operations/postgres-ops-health.md) |
| Telegram operations              | [`operations/telegram-ops-control-panel.md`](operations/telegram-ops-control-panel.md)                                                                                                                                             |
| Student-memory replay            | [`operations/student-memory-replay-backfill.md`](operations/student-memory-replay-backfill.md)                                                                                                                                     |
| Prompt gallery bootstrap         | [`operations/prompt-gallery-bootstrap.md`](operations/prompt-gallery-bootstrap.md)                                                                                                                                                 |
| Speech-planner evaluation        | [`operations/speech-planner-evaluation.md`](operations/speech-planner-evaluation.md)                                                                                                                                               |

## Product and Planning Routes

- Product and transcription design: [`design/README.md`](design/README.md)
- Student-system roadmap: [`reference/STUDENT_SYSTEM_ROADMAP.md`](reference/STUDENT_SYSTEM_ROADMAP.md)
- Readiness policy and active evidence intake:
  [`reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](reference/PRODUCT_NORTH_STAR_AND_READINESS.md),
  then [`plans/2026-06-23-alpha-readiness.md`](plans/2026-06-23-alpha-readiness.md)
- Active plan router: [`plans/README.md`](plans/README.md)
- Generated plan inventory: [`generated/plans-index.md`](generated/plans-index.md)

Approved artifacts under `docs/superpowers/specs/` and `docs/superpowers/plans/` are execution
context for their named task. After implementation lands, current code, package READMEs,
references, and runbooks remain authoritative.

## Docs System

- Policy and substantive freshness reviews:
  [`reference/DOCS_GOVERNANCE.md`](reference/DOCS_GOVERNANCE.md)
- Agent legibility and harness model:
  [`reference/AGENT_LEGIBILITY_MODEL.md`](reference/AGENT_LEGIBILITY_MODEL.md)
- Gardening procedure: [`reference/DOCS_GARDENING_PLAYBOOK.md`](reference/DOCS_GARDENING_PLAYBOOK.md)
- Generated inventories: [`generated/README.md`](generated/README.md)
- Historical, non-authoritative material: [`archive/README.md`](archive/README.md)

## Routing Rules

- Prefer active docs over archive docs.
- Read only what the task requires.
- Re-read the exact active plan after context loss.
- Do not use completed plans as substitutes for current behavior docs.
- If docs conflict, code and [`agents-ssot.md`](reference/agents-ssot.md) win.
