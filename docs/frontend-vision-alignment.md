# Frontend Vision Alignment Report (v3)

Last reviewed: 2026-01-30

This report tracks alignment between `docs/design/FRONTEND_VISION_V3.md` and the current
`packages/batch-frontend` implementation. It is updated after each v3 phase.

## Summary

- Phase 0 is complete: new v3 tokens, fonts, and the three-column shell with right-rail dock/bottom-sheet behavior.
- Phases 1–5 are pending; backend dependencies for ledger history and richer DTOs remain.
- Current UI content still reflects pre-v3 screens, now rendered inside the new shell.

## Phase Status Matrix

| Phase | Status | Notes | Key files |
| --- | --- | --- | --- |
| Phase 0: Tokens + Layout Shell | ✅ Complete | V3 tokens/typography applied; shell layout + right rail container in place; reduced-motion + high-contrast supported. | `packages/batch-frontend/src/index.css`, `packages/batch-frontend/index.html`, `packages/batch-frontend/src/layouts/WorkshopShell.tsx` |
| Phase 1: Work Context + Ledger | ⏳ Pending | Right rail shows placeholders only; SSE + polling fallback + ledger filters not wired yet. | TBD |
| Phase 2: Jobs Table + Pipeline Strip | ⏳ Pending | Existing jobs table remains; v3 pipeline strip and job action gating still needed. | TBD |
| Phase 3: Wizard Checklist + Receipt | ⏳ Pending | Wizard flow exists but not mapped to v3 checklist/criteria; completion receipt to be aligned. | TBD |
| Phase 4: Student Hub + Detail | ⏳ Pending | Student hub exists but needs v3 refinements and DTO alignment. | TBD |
| Phase 5: Automation Features | ⏳ Pending | Requires backend automation contracts. | TBD |

## Phase 0 Verification

- Unit tests: `packages/batch-frontend/src/layouts/WorkshopShell.test.tsx` (rail toggle logic).
- E2E tests: `packages/batch-frontend/tests/e2e/layout.spec.ts` (desktop/tablet/mobile shell).
- Manual: verify left rail nav, right rail dock/peek on tablet, bottom sheet on mobile.

## Open Dependencies

- Durable ledger history endpoint (`/events`) for Phase 1.
- Job stage map (`Job.stages`) for Phase 2 pipeline strip fidelity.
- DTOs for Transcript/PromptPackage/Draft status enums (Phase 3/4).
- Automation endpoints for Phase 5.

## Notes

- The shell layout preserves existing routes; no route changes were required in Phase 0.
- Alignment with backend status remains tracked in `docs/backend-frontend/backend-frontend-alignment.md`.
