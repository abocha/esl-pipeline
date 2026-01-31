# Frontend Vision Alignment Report (v3)

Last reviewed: 2026-01-31

This report tracks alignment between `docs/design/FRONTEND_VISION_V3.md` and the current
`packages/batch-frontend` implementation. It is updated after each v3 phase.

## Summary

- Phase 0 and Phase 1 are complete: v3 tokens/shell plus Work Context + Ledger with SSE + polling fallback.
- Phases 2–5 are pending; backend dependencies for ledger history and richer DTOs remain.
- Current UI content still reflects pre-v3 screens, now rendered inside the new shell with live context and log panels.

## Phase Status Matrix

| Phase | Status | Notes | Key files |
| --- | --- | --- | --- |
| Phase 0: Tokens + Layout Shell | ✅ Complete | V3 tokens/typography applied; shell layout + right rail container in place; reduced-motion + high-contrast supported. | `packages/batch-frontend/src/index.css`, `packages/batch-frontend/index.html`, `packages/batch-frontend/src/layouts/WorkshopShell.tsx` |
| Phase 1: Work Context + Ledger | ✅ Complete | Work context checklist + live ledger wired to SSE with polling fallback, stale indicator, and session-scoped labeling. | `packages/batch-frontend/src/ui/rail/WorkContextPanel.tsx`, `packages/batch-frontend/src/ui/rail/NotificationLedger.tsx`, `packages/batch-frontend/src/context/JobMonitorContext.tsx` |
| Phase 2: Jobs Table + Pipeline Strip | ⏳ Pending | Existing jobs table remains; v3 pipeline strip and job action gating still needed. | TBD |
| Phase 3: Wizard Checklist + Receipt | ⏳ Pending | Wizard flow exists but not mapped to v3 checklist/criteria; completion receipt to be aligned. | TBD |
| Phase 4: Student Hub + Detail | ⏳ Pending | Student hub exists but needs v3 refinements and DTO alignment. | TBD |
| Phase 5: Automation Features | ⏳ Pending | Requires backend automation contracts. | TBD |

## Phase 0 Verification

- Unit tests: `packages/batch-frontend/src/layouts/WorkshopShell.test.tsx` (rail toggle logic).
- E2E tests: `packages/batch-frontend/tests/e2e/layout.spec.ts` (desktop/tablet/mobile shell).
- Manual: verify left rail nav, right rail dock/peek on tablet, bottom sheet on mobile.

## Phase 1 Verification

- Unit tests: `packages/batch-frontend/src/ui/rail/NotificationLedger.test.tsx` (filters + stale indicator).
- E2E tests: `packages/batch-frontend/tests/e2e/ledger.spec.ts` (SSE live + polling fallback).
- Manual: confirm work context links + ledger status updates when SSE is disconnected.

## Open Dependencies

- Durable ledger history endpoint (`/events`) for Phase 1 (still missing; ledger labeled session-only).
- Job stage map (`Job.stages`) for Phase 2 pipeline strip fidelity.
- DTOs for Transcript/PromptPackage/Draft status enums (Phase 3/4).
- Automation endpoints for Phase 5.

## Notes

- The shell layout preserves existing routes; no route changes were required in Phase 0.
- Alignment with backend status remains tracked in `docs/backend-frontend/backend-frontend-alignment.md`.
