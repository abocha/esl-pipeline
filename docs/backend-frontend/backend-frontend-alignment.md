# Backend-Frontend Alignment (Status Tracker)

## Meta

- Audience: AI agents and maintainers coordinating backend/frontend delivery.
- Read Time: 3 minutes.
- Authority Level: Canonical status tracker.
- Last Verified Against: 2026-07-14 repository and deployed-alpha state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: weekly while alpha work continues.
- Status: `active`.

## Purpose

Record which shared product capabilities are live and where their current boundary is. This is not a
feature history, route catalog, or backlog.

## Canonical Sources

1. [`docs/reference/agents-ssot.md`](../reference/agents-ssot.md)
2. [`docs/backend-frontend/BATCH_SYSTEM.md`](BATCH_SYSTEM.md)
3. Package README for the touched surface

Provider/model detail stays in
[`docs/reference/GENERATION_PROVIDER_POLICY.md`](../reference/GENERATION_PROVIDER_POLICY.md).

## Capability Matrix

| Surface                                | Status                        | Current boundary                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Assignment builder                     | Live                          | Five tutor-owned steps: Student, Lesson source, Teaching context, Create, Review & share. New/resume entry states are mutually exclusive; readiness updates never select a step. Resume initially shows four recent lineages, groups only proven `sourceJobId` reruns while preserving exact-version selection, and loads older job/session records progressively through existing APIs. It is not a searchable archive and does not retrieve lesson titles. |
| Lesson sources                         | Live                          | OPUS recording and tutor-pasted transcript converge on the same student-owned workflow. Manual transcripts bypass STT and retain explicit provenance.                                                                                                                                                                                                                                                                                                        |
| Draft, publish, and post-share actions | Live                          | Sessions own pre-publish work; jobs own materialized runs. Published work stays complete until Start another assignment; rerun/republish actions appear only after sharing.                                                                                                                                                                                                                                                                                  |
| Student workspace and schedule         | Live                          | Directory, overview, learning, history, scheduling/billing, lesson completion, and lesson-linked homework entrypoints are available. Product evolution remains roadmap-driven.                                                                                                                                                                                                                                                                               |
| Student memory and profile review      | Live with operator safeguards | Incremental refresh, health inspection, unavailable-vs-absent provenance, deterministic profile diffs, and CLI-only full rebuild are supported.                                                                                                                                                                                                                                                                                                              |
| Generation and safety policy           | Live                          | GPT-5.6 workload defaults are active in code; explicit overrides, provider budgets, eval gates, and disabled-by-default Batch replay remain authoritative controls.                                                                                                                                                                                                                                                                                          |
| Audio regeneration                     | Live                          | Family selection and clip reuse follow orchestrator and speech-performance contracts; the frontend exposes capability-gated actions.                                                                                                                                                                                                                                                                                                                         |
| Telegram operations                    | Live internal surface         | The separate bot package provides allowlisted status, browsing, share, backup, drill, and approval operations over backend APIs. It is not a batch-frontend feature.                                                                                                                                                                                                                                                                                         |

## Current Focus

- Use production observations and tutor reports to select work from
  [`docs/plans/2026-06-23-alpha-readiness.md`](../plans/2026-06-23-alpha-readiness.md).
- Treat reproduced reliability or workflow failures as priority evidence.
- Keep speculative roadmap items in their plan; do not add them to this status matrix until a shared
  capability boundary changes.

## Update Rules

- Update this file when a capability moves between planned, partial, and live or its ownership
  boundary changes.
- Put route/env/payload detail in generated indexes, package READMEs, references, or runbooks.
- Keep historical implementation narrative in plans or archive docs.

## Related

- [`packages/batch-frontend/README.md`](../../packages/batch-frontend/README.md)
- [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
- [`packages/telegram-ops-bot/README.md`](../../packages/telegram-ops-bot/README.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../PIPELINE_INTEGRATION_VISION.md)
