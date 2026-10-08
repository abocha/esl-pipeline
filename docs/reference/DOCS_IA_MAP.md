# Documentation IA Map

## Meta

- Audience: AI agents and maintainers.
- Read Time: 3 minutes.
- Authority Level: detailed routing map.
- Last Verified Against: 2026-09-12 repository routes.
- Owner: founder-maintainer + automation agents.
- Review Cadence: biweekly or after documentation-topology changes.
- Status: `router`.

## Purpose

Use this matrix when the category router in [`docs/README.md`](../README.md) does not identify the
smallest authoritative set. Read the first document; open the second only if the task crosses that
boundary.

## Engineering and Runtime

| Task                                            | Read first                                            | Then read                                               |
| ----------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Repository orientation                          | `docs/PROJECT_OVERVIEW.md`                            | `docs/reference/agents-ssot.md`                         |
| Setup or local development                      | `docs/QUICK_START.md`                                 | `docs/reference/env.md`                                 |
| Test selection or test changes                  | `docs/reference/TESTING_GUIDELINES.md`                | `docs/reference/agents-ssot.md`                         |
| Contracts or invariants                         | `docs/reference/agents-ssot.md`                       | owning package README                                   |
| Frontend workflow or mock-auth sandbox          | `packages/batch-frontend/README.md`                   | `docs/backend-frontend/backend-frontend-alignment.md`   |
| Backend service or route behavior               | `packages/batch-backend/README.md`                    | `docs/backend-frontend/batch-backend-ssot.md`           |
| Backend/frontend capability status              | `docs/backend-frontend/backend-frontend-alignment.md` | `docs/backend-frontend/BATCH_SYSTEM.md`                 |
| Orchestrator ownership or refactor              | `docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`        | `docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`       |
| Orchestrator API v2 cutover                     | `docs/reference/ORCHESTRATOR_API_V2_MIGRATION.md`     | `docs/reference/VERSIONING_MODEL.md`                    |
| Manifest compatibility                          | `docs/reference/pipeline-manifest.md`                 | `docs/reference/agents-ssot.md`                         |
| Assignment validation and historical retirement | `docs/reference/ASSIGNMENT_V1.md`                     | `packages/contracts/README.md`                          |
| Generation models, quotas, or providers         | `docs/reference/GENERATION_PROVIDER_POLICY.md`        | relevant WS2B provider profile                          |
| Homework prompt structure                       | `docs/reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md`   | `docs/reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md` |
| Speech planning or TTS rendering                | `docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`     | `docs/reference/pipeline-manifest.md`                   |

## Operations

| Task                                                    | Read first                                          | Then read                                                   |
| ------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Find a current procedure or dated operations evidence   | `docs/operations/README.md`                         | the named runbook or evidence record                        |
| Isolated no-spend UI/API assignment rehearsal           | `docs/operations/local-product-smoke.md`             | `docs/reference/ASSIGNMENT_V1.md` for typed draft contracts  |
| Deployment or local production Compose                  | `docs/backend-frontend/DEPLOYMENT.md`               | `docs/operations/production-env-checklist.md`               |
| Docker recovery, host paths, or pnpm hydration          | `docs/operations/docker-host-paths.md`              | `docs/operations/rollup-optional-binary-troubleshooting.md` |
| Postgres backup or restore                              | `docs/operations/postgres-backup-restore.md`        | `docs/operations/postgres-backup-s3.md`                     |
| PostgreSQL backup status or alerts                      | `docs/operations/postgres-ops-health.md`            | `docs/reference/env.md`                                     |
| Production host, container, filesystem, or route health | `docs/operations/host-runtime-health.md`            | `docs/backend-frontend/DEPLOYMENT.md`                       |
| Telegram ops bot                                        | `docs/operations/telegram-ops-control-panel.md`     | `packages/telegram-ops-bot/README.md`                       |
| Prompt asset runtime                                    | `docs/operations/prompt-gallery-bootstrap.md`       | `docs/reference/env.md`                                     |
| Voice-alignment rollout                                 | `docs/operations/voice-alignment-v2-runbook.md`     | `docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`           |
| Speech-planner evaluation                               | `docs/operations/speech-planner-evaluation.md`      | its linked dated evidence                                   |
| Student-memory replay or backfill                       | `docs/operations/student-memory-replay-backfill.md` | `packages/batch-backend/README.md`                          |
| Legacy profile normalization                            | `docs/operations/legacy-profile-normalization.md`   | `docs/reference/STUDENT_SYSTEM_ROADMAP.md`                  |

## Product, Planning, and Task Artifacts

| Task                                      | Read first                                                           | Then read                                                    |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| Recording, transcript, or draft design    | `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`                         | `docs/PIPELINE_INTEGRATION_VISION.md`                        |
| Student-system boundaries                 | `docs/reference/STUDENT_SYSTEM_ROADMAP.md`                           | `docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md`           |
| Student memory or profile enrichment      | relevant topic README under `docs/plans/`                            | `docs/reference/STUDENT_SYSTEM_ROADMAP.md`                   |
| Scheduling, billing, or business surfaces | `docs/reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md`               | `docs/reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md` |
| Product readiness                         | `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`                 | `docs/plans/2026-06-23-alpha-readiness.md`                   |
| Create or locate a durable active plan    | `docs/plans/README.md`                                               | `docs/generated/plans-index.md`                              |
| Repair speech-planner evaluation          | `docs/plans/2026-07-29-speech-planner-evaluation-gap-remediation.md` | `docs/operations/speech-planner-evaluation.md`               |
| Execute a named approved task artifact    | exact file under `docs/superpowers/`                                 | current reference/runbook and the owning package README      |
| Resume after context loss                 | `docs/playbooks/RESTART_TOMORROW.md`                                 | current branch/worktree, GitHub issue, and exact active plan |

## Lifecycle and Maintenance

| Task                                      | Read first                                 | Then read                                                     |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| Docs gardening or lifecycle work          | `docs/reference/DOCS_GOVERNANCE.md`        | `docs/reference/DOCS_GARDENING_PLAYBOOK.md`                   |
| Package README or generated inventory     | `docs/generated/README.md`                 | `docs/reference/DOCS_GOVERNANCE.md`                           |
| Named-task artifact lifecycle             | `docs/superpowers/README.md`               | `docs/plans/README.md`                                        |
| Draft disposition                         | `docs/drafts/README.md`                    | `docs/archive/drafts/README.md` when retained history matters |
| Historical rationale                      | `docs/archive/README.md`                   | the relevant archive-domain README                            |
| `AGENTS.md` or agent-harness upkeep       | `docs/reference/AGENT_LEGIBILITY_MODEL.md` | `docs/reference/DOCS_GOVERNANCE.md`                           |
| PR workflow, release label, or versioning | `docs/reference/VERSIONING_MODEL.md`       | `docs/operations/pr-style-release-notes.md`                   |

## Routing Rules

- Prefer active docs over task artifacts and archive material.
- Treat package READMEs as implementation entrypoints, not replacements for canonical contracts.
- A `docs/superpowers/**` artifact is authoritative only for its explicitly named execution task.
- Dated operational evidence is evidence, not procedure; a current runbook owns instructions.
- If docs conflict, code and [`agents-ssot.md`](agents-ssot.md) win.
