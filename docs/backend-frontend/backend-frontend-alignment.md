# Backend-Frontend Alignment (Status Tracker)

## Meta

- Audience: AI agents and maintainers coordinating backend/frontend delivery.
- Read Time: 5 minutes.
- Authority Level: canonical status tracker.
- Last Verified Against: 2026-03-13 repo state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: weekly while active roadmap work continues.
- Status: `active`.

## Purpose

- Track what is live across backend and frontend.
- Show the remaining blockers without retelling implementation history.

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

## Recent Highlights

- direct generation, TTS fallback, and generation safety guardrails are shipped
- prompt catalog runtime is DB-canonical
- STT provider architecture now mirrors TTS
- Telegram ops control surface is live for operator workflows

## Capability Matrix

| Capability | Backend | Frontend | Next Note |
| --- | --- | --- | --- |
| Auth routes | Done | Done | maintain parity in errors/session UX |
| Recording upload/read/transcript flow | Done | Done | keep polling/SSE fallback explicit |
| Manual transcription retry | Done | Done | none |
| Prompt options / prompt package flow | Done | Done | keep allowlists aligned |
| Draft save/materialize/publish approve | Done | Done | none |
| Job status and core job actions | Done | Done | keep DTOs contract-first |
| Student summary/profile/bindings | Done | Partial | workspace hardening continues |
| Student timeline + provenance | Done | Done | continue ergonomics pass |
| Direct generation provider/model selection | Done | Done | keep quota semantics aligned |
| Generation safety guardrails | Done | Done | continue battle-testing telemetry |
| STT provider metadata + persistence | Done | Done | keep defaults aligned with env policy |
| Voice-alignment provenance and readiness | Done | Partial | dashboard UX remains thin |
| Telegram ops control panel | Done | Partial | Telegram is the operator UI for this slice |

## Current Blockers

1. Frontend SSE resilience still depends on explicit polling fallback behavior.
2. Student workspace needs continued UX hardening even though the core route is live.
3. Voice-alignment readiness counters and thresholds still need fuller frontend treatment.
4. Parser-only telemetry cutover remains deferred; parity monitoring is still active.

## Rules

- Update this file when capability status changes.
- Keep implementation detail in runbooks, SSOT, or plans.
- Do not duplicate route/env/provider payload details here.

## Related

- [`docs/PIPELINE_INTEGRATION_VISION.md`](../PIPELINE_INTEGRATION_VISION.md)
- [`docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`](../design/TRANSCRIPTION_PIPELINE_SPEC.md)
- [`docs/archive/pipeline/README.md`](../archive/pipeline/README.md)
