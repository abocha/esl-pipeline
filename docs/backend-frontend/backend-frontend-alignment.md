# Backend-Frontend Alignment (Status Tracker)

## Meta

- Audience: AI agents and maintainers coordinating backend/frontend delivery.
- Read Time: 5 minutes.
- Authority Level: canonical status tracker.
- Last Verified Against: 2026-07-02 repository and alpha-readiness state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: weekly while active roadmap work continues.
- Status: `active`.

## Purpose

- Track the current shared capability boundary.
- Route active product work to the Alpha Readiness plan instead of retaining a feature-history log.

## Read This When

- you are changing a backend/frontend workflow
- you need to know whether a capability is live, partial, or still planned

## Canonical Sources

1. [`docs/reference/agents-ssot.md`](../reference/agents-ssot.md)
2. [`docs/backend-frontend/BATCH_SYSTEM.md`](BATCH_SYSTEM.md)
3. package READMEs for the touched surface

Provider-specific generation details stay in:

- [`docs/reference/GENERATION_PROVIDER_POLICY.md`](../reference/GENERATION_PROVIDER_POLICY.md)
- WS2B provider profile docs under `docs/reference/`

## Capability Matrix

| Capability                            | Backend | Frontend | Current boundary                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core assignment flow                  | Done    | Done     | recording → transcript → draft → approve → publish                                                                                                                                                                                                                                  |
| Assignment sessions and job lifecycle | Done    | Done     | sessions cover pre-publish work; jobs cover materialized pipeline runs                                                                                                                                                                                                              |
| Student workspace and schedule        | Done    | Done     | ongoing tutor-facing copy/interaction distillation belongs to Chunk 12                                                                                                                                                                                                              |
| Student memory                        | Done    | Done     | normal refresh is incremental/budgeted; operator health is on Learning + `/students/:id/memory/health`; prompt packages mark unavailable memory lookup separately from absent memory; profile draft refresh shows deterministic draft changes; manual full rebuild remains CLI-only |
| Generation and safety policy          | Done    | Done     | target-model activation remains an explicit operator decision                                                                                                                                                                                                                       |
| Rerun and audio regeneration          | Done    | Done     | detailed contract lives in the orchestrator and speech-performance references                                                                                                                                                                                                       |
| Telegram ops                          | Done    | Partial  | existing operator surface; no new Telegram work before post-alpha review                                                                                                                                                                                                            |

## Current Focus

- Execute the active work in [`docs/plans/2026-06-23-alpha-readiness.md`](../plans/2026-06-23-alpha-readiness.md).
- Treat reproduced tutor reliability failures as priority work; do not maintain speculative blocker lists here.

## Rules

- Update this file when capability status changes.
- Keep implementation detail in runbooks, SSOT, or plans.
- Do not duplicate route/env/provider payload details here.

## Related

- [`docs/PIPELINE_INTEGRATION_VISION.md`](../PIPELINE_INTEGRATION_VISION.md)
- [`docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`](../design/TRANSCRIPTION_PIPELINE_SPEC.md)
- [`docs/archive/pipeline/README.md`](../archive/pipeline/README.md)
