# Documentation Router (Agent-First)

## Meta

- Audience: AI agents, maintainers.
- Read Time: 2 minutes.
- Authority Level: Router.
- Last Verified Against: 2026-05-12 repo state.
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
- Batch-backend service boundary: [`docs/backend-frontend/batch-backend-ssot.md`](backend-frontend/batch-backend-ssot.md)
- Batch-backend migration parity inventory: [`docs/backend-frontend/batch-backend-legacy-schema-inventory.md`](backend-frontend/batch-backend-legacy-schema-inventory.md)
- Batch system map: [`docs/backend-frontend/BATCH_SYSTEM.md`](backend-frontend/BATCH_SYSTEM.md)
- Orchestrator architecture and ownership:
  - [`docs/reference/ORCHESTRATOR_SYSTEM_REVIEW.md`](reference/ORCHESTRATOR_SYSTEM_REVIEW.md)
  - [`docs/reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md`](reference/ORCHESTRATOR_OWNERSHIP_LEDGER.md)
- Env contracts: [`docs/reference/env.md`](reference/env.md)
- Manifest schema and compatibility: [`docs/reference/pipeline-manifest.md`](reference/pipeline-manifest.md)
- TTS speech-performance planning and provider rendering:
  [`docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`](reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md)
- Test methodology + lane model: [`docs/reference/TESTING_GUIDELINES.md`](reference/TESTING_GUIDELINES.md)
- Validator ruleset conventions: [`docs/reference/MD_VALIDATOR_RULESET_CONVENTIONS.md`](reference/MD_VALIDATOR_RULESET_CONVENTIONS.md)

## Operations Paths

- Docker host paths and port collisions:
  - [`docs/operations/docker-host-paths.md`](operations/docker-host-paths.md)
- Batch deployment runbook:
  - [`docs/backend-frontend/DEPLOYMENT.md`](backend-frontend/DEPLOYMENT.md)
- Postgres backup/restore:
  - [`docs/operations/postgres-backup-restore.md`](operations/postgres-backup-restore.md)
- S3 archival + scheduling:
  - [`docs/operations/postgres-backup-s3.md`](operations/postgres-backup-s3.md)
- Ops health alerts/status/key rotation:
  - [`docs/operations/postgres-ops-health.md`](operations/postgres-ops-health.md)
- Telegram ops control panel bot:
  - [`docs/operations/telegram-ops-control-panel.md`](operations/telegram-ops-control-panel.md)
- Voice-alignment rollout and diagnostics:
  - [`docs/operations/voice-alignment-v2-runbook.md`](operations/voice-alignment-v2-runbook.md)
  - [`docs/reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md`](reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md)
- Student-memory replay and backfill:
  - [`docs/operations/student-memory-replay-backfill.md`](operations/student-memory-replay-backfill.md)
- Legacy profile normalization during live transition:
  - [`docs/operations/legacy-profile-normalization.md`](operations/legacy-profile-normalization.md)
- Prompt gallery DB bootstrap:
  - [`docs/operations/prompt-gallery-bootstrap.md`](operations/prompt-gallery-bootstrap.md)
- Local dependency-hydration troubleshooting:
  - [`docs/operations/rollup-optional-binary-troubleshooting.md`](operations/rollup-optional-binary-troubleshooting.md)
- Versioning and release automation:
  - [`docs/reference/VERSIONING_MODEL.md`](reference/VERSIONING_MODEL.md)
- Historical pre-v1 tag reset record:
  - [`docs/archive/release/versioning-tag-reset-runbook.md`](archive/release/versioning-tag-reset-runbook.md)

## Design and Product Paths

- Transcription and publish-flow design:
  - [`docs/design/README.md`](design/README.md)
  - [`docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`](design/TRANSCRIPTION_PIPELINE_SPEC.md)
  - [`docs/PIPELINE_INTEGRATION_VISION.md`](PIPELINE_INTEGRATION_VISION.md)
- Learning preset architecture and provider policy:
  - [`docs/reference/PRESET_V2_SPEC.md`](reference/PRESET_V2_SPEC.md)
  - [`docs/reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md`](reference/HOMEWORK_PROMPTING_SYSTEM_GUIDE.md)
  - [`docs/reference/gpt-5.4_prompt-guidance.md`](reference/gpt-5.4_prompt-guidance.md)
  - [`docs/reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md`](reference/HOMEWORK_PEDAGOGY_AND_TEMPLATE_SPEC.md)
  - [`docs/reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md`](reference/STUDENT_MEMORY_EXTRACTION_CAPABILITY_POLICY.md)
  - [`docs/reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md`](reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md)
  - [`docs/reference/GENERATION_PROVIDER_POLICY.md`](reference/GENERATION_PROVIDER_POLICY.md)
- Prompt rewrite drafts and candidate payloads:
  - [`docs/reference/HOMEWORK_PROMPT_DEFINITIVE_ASSEMBLY_DRAFT.md`](reference/HOMEWORK_PROMPT_DEFINITIVE_ASSEMBLY_DRAFT.md)
  - [`docs/reference/HOMEWORK_PROMPT_CANDIDATE_TEMPLATE_PAYLOAD.md`](reference/HOMEWORK_PROMPT_CANDIDATE_TEMPLATE_PAYLOAD.md)
- Generation-provider evaluation profiles:
  - [`docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md`](reference/OPENAI_RESPONSES_WS2B_PROFILE.md)
  - [`docs/reference/OPENROUTER_WS2B_PROFILE.md`](reference/OPENROUTER_WS2B_PROFILE.md)
  - [`docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md`](reference/GOOGLE_GENAI_WS2B_PROFILE.md)
- Student system roadmap and migration runbook:
  - [`docs/reference/STUDENT_SYSTEM_ROADMAP.md`](reference/STUDENT_SYSTEM_ROADMAP.md)
  - [`docs/reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md`](reference/STUDENT_SYSTEM_PHASE_A_RUNBOOK.md)
  - [`docs/plans/student-area-redesign/README.md`](plans/student-area-redesign/README.md)
- Student scheduling, billing, credits, and teacher business surfaces:
  - [`docs/reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md`](reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md)
  - [`docs/reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md`](reference/TEACHER_BUSINESS_DASHBOARD_PRODUCT_DRAFT.md)
- Product readiness and review cadence:
  - [`docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`](reference/PRODUCT_NORTH_STAR_AND_READINESS.md)
  - [`docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`](playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md)
- Implementation continuity tracker:
  - [`docs/reference/V1_IMPLEMENTATION_TRACKER.md`](reference/V1_IMPLEMENTATION_TRACKER.md)
  - [`docs/playbooks/RESTART_TOMORROW.md`](playbooks/RESTART_TOMORROW.md)

## Docs System Paths

- Docs governance and agent legibility:
  - [`docs/reference/DOCS_GOVERNANCE.md`](reference/DOCS_GOVERNANCE.md)
  - [`docs/reference/AGENT_LEGIBILITY_MODEL.md`](reference/AGENT_LEGIBILITY_MODEL.md)
  - [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](reference/HARNESS_AGENTIC_DOCS_MODEL.md)
- Docs gardening and scorecards:
  - [`docs/reference/DOCS_GARDENING_PLAYBOOK.md`](reference/DOCS_GARDENING_PLAYBOOK.md)
  - [`docs/reference/DOCS_GARDENING_SCORECARD.md`](reference/DOCS_GARDENING_SCORECARD.md)
  - [`docs/reference/DOCS_QUALITY_SCORE.md`](reference/DOCS_QUALITY_SCORE.md)
- Generated reference indexes:
  - [`docs/generated/README.md`](generated/README.md)
  - [`docs/generated/env-surface-index.md`](generated/env-surface-index.md)

## Planning Paths

- Plans router:
  - [`docs/plans/README.md`](plans/README.md)
- Active/completed planning topics:
  - [`docs/plans/backlog/README.md`](plans/backlog/README.md)
  - [`docs/archive/plans/README.md`](archive/plans/README.md)

## Rules of Thumb

- Prefer active docs over archive docs.
- Read only the docs needed for the current task.
- If docs conflict, SSOT and code win.

## Related

- [`docs/reference/DOCS_GOVERNANCE.md`](reference/DOCS_GOVERNANCE.md)
- [`docs/reference/HARNESS_AGENTIC_DOCS_MODEL.md`](reference/HARNESS_AGENTIC_DOCS_MODEL.md)
- [`docs/reference/DOCS_QUALITY_SCORE.md`](reference/DOCS_QUALITY_SCORE.md)
- [`docs/archive/README.md`](archive/README.md)
