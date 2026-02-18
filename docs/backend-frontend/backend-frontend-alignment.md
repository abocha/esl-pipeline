# Backend-Frontend Alignment (Status Tracker)

## Meta

- Audience: AI agents and maintainers coordinating backend/frontend delivery.
- Read Time: 8 minutes.
- Authority Level: Canonical status tracker (human-readable).
- Last Verified Against: 2026-02-18 repo state.

## Purpose

- Track live capability readiness across backend and frontend.
- Surface blockers and the next implementation actions.

## When To Read

- Before implementing cross-layer changes.
- Before exposing or relying on a UI capability.

## Canonical Sources

1. `docs/reference/agents-ssot.md` (contracts/invariants).
2. `docs/backend-frontend/BATCH_SYSTEM.md` (system map).
3. `packages/batch-frontend/README.md` and `packages/batch-backend/README.md` (implementation references).
4. `docs/reference/OPENAI_RESPONSES_WS2B_PROFILE.md` (OpenAI generation request/response mapping for WS2B).
5. `docs/reference/GOOGLE_GENAI_WS2B_PROFILE.md` (Google generation request/response mapping for WS2B).
6. `docs/reference/OPENROUTER_WS2B_PROFILE.md` (OpenRouter generation request/response mapping for WS2B).

## Status Legend

- `Done`: implemented and active.
- `Partial`: available with limitations.
- `Pending`: not implemented or blocked.

## Recent Shipped Highlights (Post-WS2A)

1. Voice-alignment v2 rollout completed with prompt snapshot gating, capability provenance, and
   operational runbook coverage.
2. Executable env bootstrap is standardized through shared `loadCliEnv()` wrappers across CLI,
   workers, and tools.
3. Efficiency track landed parse-once behavior and multiple caching/dedupe improvements across
   backend/frontend/orchestrator path.
4. Artifact identity reuse now spans publish/uploader surfaces, reducing duplicate remote writes.
5. Notion colorization now skips redundant API calls when preset hash is unchanged.
6. WS2B-S0 provider/model/quota decision lock is documented in
   `docs/reference/GENERATION_PROVIDER_POLICY.md`.

## Capability Matrix

| Capability                                                                                 | Backend | Frontend | Contract Source                               | Next Action                                         |
| ------------------------------------------------------------------------------------------ | ------- | -------- | --------------------------------------------- | --------------------------------------------------- |
| Auth routes (`/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`, `/auth/me`) | Done    | Done     | `@esl-pipeline/contracts`, API route handlers | Maintain parity in error handling.                  |
| Recording upload (`POST /recordings/upload`)                                               | Done    | Done     | Backend transport + frontend API client       | Monitor max-file defaults for long lessons.         |
| Recording status/read (`GET /recordings/:id`)                                              | Done    | Done     | Backend recording routes + frontend polling   | Keep SSE/polling fallback behavior aligned.         |
| Transcript read (`GET /recordings/:id/transcript`)                                         | Done    | Done     | Recording transcript routes                   | None.                                               |
| Transcript update (`PUT /recordings/:id/transcript`)                                       | Done    | Done     | Recording transcript routes                   | None.                                               |
| Manual transcription retry (`POST /recordings/:id/transcribe`)                             | Done    | Done     | Recording transcribe route                    | None.                                               |
| Prompt options (`GET /config/prompts`)                                                     | Done    | Done     | Config routes + frontend prompt step          | Keep allowlists synchronized with storage roots.    |
| Prompt package create/read                                                                 | Done    | Done     | Prompt-package routes                         | None.                                               |
| Prompt capability provenance (`voiceCapabilitiesGeneratedAt/hash`)                         | Done    | Partial  | Prompt-package response + lineage payload     | Frontend can surface provenance metadata in inspector views. |
| Remote config conditional revalidation + stale-if-error cache                              | Done    | Partial  | Config provider + workspace fetch wiring      | Frontend now benefits from reduced churn; keep stale-state UX explicit. |
| Artifact identity reuse (`audio.key/hash`, `htmlKey/hash`)                                 | Done    | Partial  | Manifest + publisher/uploader behavior         | Continue exposing artifact reuse diagnostics in operator views. |
| Notion preset hash idempotence skip                                                         | Done    | Done     | Orchestrator + notion adapter colorizer        | Monitor skip-rate and fallback behavior in publish telemetry. |
| Draft generation provider/model preselection + quota panel                                  | Done    | Done     | WS2B generation contracts + `/config/job-options` extension | Keep baseline quota refresh and runtime snapshot precedence regression-covered. |
| WS3 provider runtime seam extraction (shared package)                                       | Partial | Partial  | `@esl-pipeline/provider-runtime` + generation service wiring | Complete TTS runtime-path adoption in WS3-S1/S2 without changing public job contracts. |
| Prompt/template/profile lineage (`GET /prompt-packages/:id/lineage`)                      | Done    | Done     | Prompt-package lineage API + frontend client  | None.                                               |
| Draft save/read                                                                            | Done    | Done     | Draft routes                                  | None.                                               |
| Draft materialize (`POST /drafts/:id/materialize`)                                         | Done    | Done     | Draft materialization service                 | Maintain job override validation coverage.          |
| Job approve (`POST /jobs/:jobId/approve`)                                                  | Done    | Done     | Core job routes                               | None.                                               |
| Job status (`GET /jobs/:jobId`)                                                            | Done    | Done     | Job DTO in contracts                          | Ensure DTO fields stay contract-first.              |
| Jobs SSE (`GET /jobs/events`)                                                              | Done    | Partial  | SSE route + frontend consumers                | Keep polling fallback explicit in UI.               |
| Markdown validation (`POST /validation/markdown`)                                          | Done    | Done     | Validation route + frontend draft step        | None.                                               |
| Voice diagnostics + shadow mismatch payload (`voiceDiagnostics.shadowMode`)                | Done    | Partial  | Markdown validation contract                  | Frontend may optionally visualize mismatch classes during rollout. |
| Student summary/list/profile routes                                                        | Done    | Partial  | Student routes                                | Workspace now supports student creation; phase E hardening remains. |
| Profile content routes                                                                     | Done    | Partial  | Profile routes                                | Restore/activate/edit supported in workspace; continue UX hardening. |
| Job actions: `edit_metadata`                                                               | Done    | Partial  | Job action route and handler                  | Expose only where workflow needs it.                |
| Job actions: `rerun_audio`                                                                 | Done    | Done     | Job action contract                           | Maintain payload parity as backend adds rerun knobs. |
| Job actions: `cancel`                                                                      | Done    | Done     | Job action contract                           | Keep cooperative-cancel UX explicit for running jobs.      |
| Student timeline + explainability (`/students/:id/timeline`, `/jobs/:id/provenance`)      | Done    | Done     | Timeline/provenance app services + UI panel   | Continue filtering and ergonomics pass in phase E follow-ups. |
| Readiness voice-alignment counters (`/metrics/readiness.voiceAlignment`)                   | Done    | Partial  | Readiness metrics contract                    | Dashboard thresholds/visualizations still pending in frontend. |

## Open Blockers

1. SSE resilience remains partly dependent on polling fallback behavior in UI.
2. Frontend currently keeps `edit_metadata` as a partial/operator path (not broad UX exposure).
3. Cancellation is cooperative for running jobs; already-issued external side effects remain best-effort.
4. Student workspace is now available, but advanced guardrails and end-to-end tutor ergonomics still need completion.
5. Phase E is in progress; keep parity between workspace interactions and backend governance rules.
6. Readiness dashboard still needs UI treatment for new voice-alignment counters and thresholds.
7. WS3 seam extraction is active; generation path uses shared provider runtime utilities, but TTS runtime-path adoption remains pending.

## Do / Don't

- Do update this file when capability status changes.
- Do keep this file status-focused and concise.
- Don't add long implementation playbooks here.
- Don't duplicate deep contracts that already live in SSOT/contracts.

## Historical Detail

Detailed phase-by-phase implementation notes were archived at:

- `docs/archive/pipeline/2026-02/backend-frontend-alignment-detailed-pre-agent-pass2.md`

## Related

- `docs/backend-frontend/BATCH_SYSTEM.md`
- `docs/PIPELINE_INTEGRATION_VISION.md`
- `docs/design/TRANSCRIPTION_PIPELINE_SPEC.md`
- `docs/archive/pipeline/README.md`
