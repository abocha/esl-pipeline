# Frontend Vision Alignment Report (v3)

Last reviewed: 2026-01-31

This report tracks alignment between `docs/design/FRONTEND_VISION_V3.md` and the current
`packages/batch-frontend` implementation. It is updated after each v3 phase.

## Summary

- Phases 0–4 are complete: v3 tokens/shell, Work Context + Ledger, Jobs table pipeline strip + action gating, Wizard checklist + receipt flow, and Student Hub refinements.
- Phase 5 remains pending; backend dependencies for automation DTOs remain.
- Current UI reflects v3 shell, durable context/ledger, ops workflows, a checklist-driven wizard experience, and the student-centric hub/detail view.

## Phase Status Matrix

| Phase | Status | Notes | Key files |
| --- | --- | --- | --- |
| Phase 0: Tokens + Layout Shell | ✅ Complete | V3 tokens/typography applied; shell layout + right rail container in place; reduced-motion + high-contrast supported. | `packages/batch-frontend/src/index.css`, `packages/batch-frontend/index.html`, `packages/batch-frontend/src/layouts/WorkshopShell.tsx` |
| Phase 1: Work Context + Ledger | ✅ Complete | Work context checklist + live ledger wired to SSE with polling fallback, stale indicator, and session-scoped labeling. | `packages/batch-frontend/src/ui/rail/WorkContextPanel.tsx`, `packages/batch-frontend/src/ui/rail/NotificationLedger.tsx`, `packages/batch-frontend/src/context/JobMonitorContext.tsx` |
| Phase 2: Jobs Table + Pipeline Strip | ✅ Complete | Pipeline strip renders neutral fallback without `Job.stages`, inline error expansion, and supportedActions gating. | `packages/batch-frontend/src/ui/jobs/JobTable.tsx`, `packages/batch-frontend/src/ui/jobs/PipelineStrip.tsx`, `packages/batch-frontend/src/utils/api.ts` |
| Phase 3: Wizard Checklist + Receipt | ✅ Complete | Checklist-driven wizard summary, explicit entry/exit criteria, skip logging + publish warnings, and completion receipt updates. | `packages/batch-frontend/src/ui/wizard/*`, `packages/batch-frontend/src/context/WizardContext.tsx`, `packages/batch-frontend/src/context/JobMonitorContext.tsx` |
| Phase 4: Student Hub + Detail | ✅ Complete | Student list status + activity metrics, refined detail view with focus areas, and timeline action links. | `packages/batch-frontend/src/ui/students/StudentWorkspace.tsx`, `packages/batch-frontend/src/ui/students/StudentWorkspace.test.tsx`, `packages/batch-frontend/tests/e2e/students.spec.ts` |
| Phase 5: Automation Features | ⏳ Pending | Requires backend automation contracts. | TBD |

## Phase 0 Verification

- Unit tests: `packages/batch-frontend/src/layouts/WorkshopShell.test.tsx` (rail toggle logic).
- E2E tests: `packages/batch-frontend/tests/e2e/layout.spec.ts` (desktop/tablet/mobile shell).
- Manual: verify left rail nav, right rail dock/peek on tablet, bottom sheet on mobile.

## Phase 1 Verification

- Unit tests: `packages/batch-frontend/src/ui/rail/NotificationLedger.test.tsx` (filters + stale indicator).
- E2E tests: `packages/batch-frontend/tests/e2e/ledger.spec.ts` (SSE live + polling fallback).
- Manual: confirm work context links + ledger status updates when SSE is disconnected.

## Phase 2 Verification

- Unit tests: `packages/batch-frontend/src/ui/jobs/PipelineStrip.test.tsx` (stages vs neutral fallback).
- E2E tests: `packages/batch-frontend/tests/e2e/jobs.spec.ts` (pipeline strip, error expansion, action gating).
- Manual: verify jobs table filters, inline error expansion, and action disable tooltips.

## Phase 3 Verification

- Unit tests: `packages/batch-frontend/src/ui/wizard/WizardSummary.test.tsx`, `packages/batch-frontend/src/ui/wizard/Wizard.test.tsx` (checklist status + flow).
- E2E tests: `packages/batch-frontend/tests/e2e/wizard.spec.ts` (full wizard flow with skip warnings).
- Manual: validate checklist status changes, skip warnings in publish, and completion receipt with Notion actions.

## Phase 4 Verification

- Unit tests: `packages/batch-frontend/src/ui/students/StudentWorkspace.test.tsx` (timeline filters + job action).
- E2E tests: `packages/batch-frontend/tests/e2e/students.spec.ts` (list → detail navigation + timeline job link).
- Manual: verify status badges, focus grid details, and timeline action links for recording/prompt/draft/job.

## Open Dependencies

- Durable ledger history endpoint (`/events`) for Phase 1 (still missing; ledger labeled session-only).
- Job stage map (`Job.stages`) for Phase 2 pipeline strip fidelity (optional field still not in contracts).
- DTOs for Transcript/PromptPackage/Draft status enums (Phase 3/4).
- Automation endpoints for Phase 5.

## Notes

- The shell layout preserves existing routes; no route changes were required in Phase 0.
- Alignment with backend status remains tracked in `docs/backend-frontend/backend-frontend-alignment.md`.
