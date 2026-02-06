# Backend-Frontend Alignment (Status Tracker)

## Meta

- Audience: AI agents and maintainers coordinating backend/frontend delivery.
- Read Time: 8 minutes.
- Authority Level: Canonical status tracker (human-readable).
- Last Verified Against: 2026-02-06 repo state.

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

## Status Legend

- `Done`: implemented and active.
- `Partial`: available with limitations.
- `Pending`: not implemented or blocked.

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
| Draft save/read                                                                            | Done    | Done     | Draft routes                                  | None.                                               |
| Draft materialize (`POST /drafts/:id/materialize`)                                         | Done    | Done     | Draft materialization service                 | Maintain job override validation coverage.          |
| Job approve (`POST /jobs/:jobId/approve`)                                                  | Done    | Done     | Core job routes                               | None.                                               |
| Job status (`GET /jobs/:jobId`)                                                            | Done    | Done     | Job DTO in contracts                          | Ensure DTO fields stay contract-first.              |
| Jobs SSE (`GET /jobs/events`)                                                              | Done    | Partial  | SSE route + frontend consumers                | Keep polling fallback explicit in UI.               |
| Markdown validation (`POST /validation/markdown`)                                          | Done    | Done     | Validation route + frontend draft step        | None.                                               |
| Student summary/list/profile routes                                                        | Done    | Partial  | Student routes                                | Expand UI usage only as needed by minimal workflow. |
| Profile content routes                                                                     | Done    | Partial  | Profile routes                                | Same as above.                                      |
| Job actions: `edit_metadata`                                                               | Done    | Partial  | Job action route and handler                  | Expose only where workflow needs it.                |
| Job actions: `rerun_audio`                                                                 | Pending | Pending  | Job action contract                           | Implement backend action workflow.                  |
| Job actions: `cancel`                                                                      | Pending | Pending  | Job action contract                           | Implement queue/job cancellation semantics.         |

## Open Blockers

1. `rerun_audio` action remains unimplemented.
2. `cancel` action remains unimplemented.
3. SSE resilience remains partly dependent on polling fallback behavior in UI.

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
