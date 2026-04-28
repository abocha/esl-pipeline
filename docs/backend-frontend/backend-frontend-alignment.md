# Backend-Frontend Alignment (Status Tracker)

## Meta

- Audience: AI agents and maintainers coordinating backend/frontend delivery.
- Read Time: 5 minutes.
- Authority Level: canonical status tracker.
- Last Verified Against: 2026-04-14 repo state.
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
- student-memory backend surfaces, prompt runtime packaging, provenance, replay tooling, and minimal workspace inspection UI are live
- support-facing provenance surfaces now show rerun audio fallback notices without requiring worker-log access
- Telegram ops control surface is live for operator workflows
- rerun is now a single regeneration-intent workflow with explicit study-text / pronunciation-main / pronunciation-chunk controls
- student-area overview/learning/history route-level payloads are live, and job/recording SSE subscriptions can now target specific IDs instead of requiring wildcard streams

## Capability Matrix

| Capability                                 | Backend | Frontend | Next Note                                                                                                 |
| ------------------------------------------ | ------- | -------- | --------------------------------------------------------------------------------------------------------- |
| Auth routes                                | Done    | Done     | maintain parity in errors/session UX                                                                      |
| Recording upload/read/transcript flow      | Done    | Done     | keep polling/SSE fallback explicit                                                                        |
| Manual transcription retry                 | Done    | Done     | none                                                                                                      |
| Prompt options / prompt package flow       | Done    | Done     | keep allowlists aligned                                                                                   |
| Draft save/materialize/publish approve     | Done    | Done     | none                                                                                                      |
| Job status and core job actions            | Done    | Done     | rerun is a single action; chunk defaults remain mode-aware                                                |
| Student summary/profile/bindings           | Done    | Partial  | student-area route payloads are live; workspace hardening continues                                       |
| Student timeline + provenance              | Done    | Done     | support-facing provenance now includes rerun audio fallback notices; continue ergonomics pass             |
| Student memory inspection + replay tooling | Done    | Done     | backend routes, prompt-package provenance, replay tools, and the minimal workspace inspection UI are live |
| Direct generation provider/model selection | Done    | Done     | keep quota semantics aligned                                                                              |
| Generation safety guardrails               | Done    | Done     | continue battle-testing telemetry                                                                         |
| STT provider metadata + persistence        | Done    | Done     | keep defaults aligned with env policy                                                                     |
| Voice-alignment provenance and readiness   | Done    | Partial  | dashboard UX remains thin                                                                                 |
| Telegram ops control panel                 | Done    | Partial  | Telegram is the operator UI for this slice                                                                |

## Current Blockers

1. Frontend SSE resilience now supports targeted subscriptions, but some assignment polling fallback hardening remains.
2. Student workspace needs continued UX hardening even though the core route is live.
3. Voice-alignment readiness counters and thresholds still need fuller frontend treatment.
4. Parser-only telemetry cutover remains deferred; parity monitoring is still active.

## Rerun Contract Snapshot

- The old split `rerun_audio` / `rerun_publish` UI is retired.
- The live rerun surface is one canonical action with:
  - republish-only
  - study-text regeneration
  - main pronunciation regeneration
  - pronunciation chunk regeneration
- Regeneration intent derives the runtime stage chain automatically; operators do not select `tts` / `upload` / `add-audio` directly.
- Unchecked rerun families must keep the previously published audio and their existing persisted provider/model defaults.
- Checked rerun families must replace the published audio for that family, even if regeneration produces the same deterministic object key.
- Provider-specific voice IDs must not be inherited across rerun provider changes. When a family switches providers, the runtime may keep the accent preference but must resolve any replacement voice from that provider's own catalog.
- Pronunciation chunk provider defaults are mode-aware:
  - `google` for all pronunciation chunk modes by default
  - explicit reruns can still force `elevenlabs` or `edge-tts`
- Study-text ElevenLabs reruns preserve original-run defaults unless the user explicitly selects another model:
  - `dialogue` -> `eleven_v3`
  - `tts` -> `eleven_multilingual_v2`

## Rules

- Update this file when capability status changes.
- Keep implementation detail in runbooks, SSOT, or plans.
- Do not duplicate route/env/provider payload details here.

## Related

- [`docs/PIPELINE_INTEGRATION_VISION.md`](../PIPELINE_INTEGRATION_VISION.md)
- [`docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`](../design/TRANSCRIPTION_PIPELINE_SPEC.md)
- [`docs/archive/pipeline/README.md`](../archive/pipeline/README.md)
