# Frontend Vision v2 Implementation Manual

> **Purpose:** Step-by-step plan to reach `docs/design/FRONTEND_VISION_V2.md` from the current
> batch-frontend state, with concrete backend dependencies, UI deliverables, and verification.
>
> **Read first:**  
> - `docs/design/FRONTEND_VISION_V2.md` (target experience)  
> - `docs/frontend-vision-alignment.md` (current gaps)  
> - `docs/backend-frontend/backend-frontend-alignment.md` (API status + dependencies)

Last updated: 2025-03-10

---

## 0) Scope and Ground Rules

- This is a delivery manual, not a roadmap. Every phase has acceptance criteria and tests.
- The frontend must remain functional throughout; new features should be additive and guarded.
- Backend contracts are authoritative in `docs/backend-frontend/backend-frontend-alignment.md`.
- Update `docs/frontend-vision-alignment.md` after each phase.

---

## Implementer Brief (AI Starting Prompt)

You are the implementer for Frontend Vision v2 in `packages/batch-frontend`. Your job is to execute this manual phase‑by‑phase without breaking the existing UI. Treat this as a constrained upgrade: keep current behavior stable, add guarded enhancements, and document gaps clearly.

**Read first (in this order)**
- `docs/design/FRONTEND_VISION_V2.md` (target UX)
- `docs/design/FRONTEND_VISION_V2_IMPLEMENTATION_MANUAL.md` (this plan)
- `docs/backend-frontend/backend-frontend-alignment.md` (API status + dependencies)
- `docs/frontend-vision-alignment.md` (current implementation coverage)
- `docs/reference/agents-ssot.md` (repo‑wide rules and invariants)

**Your deliverables**
- Implement the Phase A items without backend changes.
- Gate Phase B/C UI on backend capabilities; do not assume missing fields or endpoints.
- Update `docs/frontend-vision-alignment.md` after each phase with what’s now implemented/blocked.

**Constraints you must respect**
- Keep the UI functional at all times; changes are additive.
- Do not invent backend fields: stage/ETA/queue/LLM generation require contract updates first.
- Use existing patterns: inline `<style>` blocks, context providers (`WizardContext`, `NotificationContext`, `JobMonitorContext`).
- Avoid breaking persisted wizard state; if you add state, update `WizardState` carefully and consider storage versioning.

**Immediate blockers you must work around**
- Completion panel: `Step5Publish` calls `onJobPublished`, and `AssignmentWizard` resets state + navigates home immediately. You must add a completion step or delay redirect to show the panel.
- Transcript processing: Step2 already retries on 404 with a “processing” message. Use `RecordingStatus` to distinguish `processing` vs `missing`, not raw 404s.
- Notification center: log exists but is only shown on Dashboard/Jobs/Settings. A v2 “global” center requires a top‑level entry point (likely `App.tsx`).
- Student detail view: `StudentWorkspace` already has profile edit + timeline + metrics. A “detail view” can be a new layout/route using existing data.
- Job stage/ETA/queue: not in `JobStatusDto` yet; UI must be guarded until contracts extend.
- LLM draft generation: no endpoints exist in the API client; UI must be guarded until endpoints land.

**Primary file map**
- Wizard flow: `packages/batch-frontend/src/ui/wizard/AssignmentWizard.tsx`
- Step 2 transcript: `packages/batch-frontend/src/ui/wizard/Step2ReviewTranscript.tsx`
- Step 3 notes: `packages/batch-frontend/src/ui/wizard/Step3AddNotes.tsx`
- Step 4 draft: `packages/batch-frontend/src/ui/wizard/Step4ReviewDraft.tsx`
- Step 5 publish: `packages/batch-frontend/src/ui/wizard/Step5Publish.tsx`
- Wizard state: `packages/batch-frontend/src/context/WizardContext.tsx`
- Notifications: `packages/batch-frontend/src/context/NotificationContext.tsx`, `packages/batch-frontend/src/ui/notifications/NotificationsPanel.tsx`
- Jobs: `packages/batch-frontend/src/ui/jobs/JobTable.tsx`, `packages/batch-frontend/src/ui/jobs/ActivityFeed.tsx`
- Students: `packages/batch-frontend/src/ui/students/StudentWorkspace.tsx`
- Shell/layout: `packages/batch-frontend/src/ui/App.tsx`

**Tests you should update if flows change**
- Wizard integration: `packages/batch-frontend/src/ui/wizard/Wizard.test.tsx`
- Student workspace: `packages/batch-frontend/src/ui/students/StudentWorkspace.test.tsx`

**Definition of done for your work**
- Each implemented phase meets its acceptance criteria.
- Manual check: full wizard flow still completes.
- Alignment doc updated with new status + remaining blockers.

---

## 1) Current State Snapshot (Baseline)

**Already implemented**
- Dashboard with quick actions, activity feed, pending approvals, weekly summary.
- Wizard flow (steps 1–5), split editor, validation panel, and publish settings.
- Job monitoring view + live updates.
- Student management workspace.
- Settings for job defaults and API keys (Notion + ElevenLabs).
- Dark theme support.
- Notification panel with recent toast log.

**Known gaps vs v2**
- LLM draft generation, regenerate workflow.
- Transcript UI richness and explicit transcript status semantics.
- Job stage visualization, ETA, queue position.
- Student profile detail view.
- Global notification center (beyond the panel).

**Code scan notes (current batch-frontend)**
- Wizard publish flow resets state + navigates home immediately; a completion panel requires a new step or blocking that redirect.
- Transcript step already retries on 404 and shows a "processing" message; explicit status should key off recording status when available.
- Notification log exists and persists (toast history), but only shows as a panel on dashboard/jobs/settings; no global drawer yet.
- Student workspace already includes profile editing + timeline + metrics; the "detail view" may be a layout/route change, not new data.
- Job status DTO has no stage/ETA/queue fields in contracts or API client; those are backend/contract gaps, not UI.
- No LLM draft endpoints exist in the API client; current flow is prompt package + manual draft creation.

---

## 2) Dependencies (Backend Work Required)

These are mandatory for full v2 delivery. Track status in the alignment doc.

1. **LLM Draft Generation**
   - Endpoint(s) to generate a draft from a prompt package.
   - Optional regenerate endpoint with version history.

2. **Transcript Status Semantics**
   - Distinguish “processing,” “ready,” and “missing” in transcript endpoints or recording DTOs.

3. **Job Progress Metadata**
   - Per-stage status, queue position, ETA.

4. **Notification Delivery**
   - Email/SMS hooks or a generic “notify student” endpoint.

5. **Usage/Cost Signals**
   - TTS usage estimate data for UI cost display.

---

## 3) Phase A — High‑ROI UX Polish (No New Backend Required)

**Goal:** Make the existing flow feel “complete” without backend changes.

### A1. Wizard Completion Panel
**Deliverable**
- After publish, show a completion panel with Notion link and quick actions.

**Implementation targets**
- `packages/batch-frontend/src/ui/wizard/Step5Publish.tsx`
- `packages/batch-frontend/src/ui/wizard/AssignmentWizard.tsx`

**Acceptance criteria**
- After publish success, show Notion link (if available) + “Start new assignment.”
- Action buttons appear within 1 second of success toast.

**Implementation notes**
- Current publish handler calls `onJobPublished`, and the wizard resets + navigates home immediately.
- To show a completion panel, keep the wizard mounted and either add a new step or delay the reset/redirect.

### A2. Transcript Processing Indicator
**Deliverable**
- Explicit “processing” state and friendly retry feedback.

**Implementation targets**
- `packages/batch-frontend/src/ui/wizard/Step2ReviewTranscript.tsx`
- `packages/batch-frontend/src/context/JobMonitorContext.tsx` (if status needed)

**Acceptance criteria**
- When transcript is not ready, show “processing” state (not a raw 404).
- User is not stuck in a polling loop without feedback.

**Implementation notes**
- Step2 already treats 404 as "processing" with capped retries.
- Recording status values are available (`ingested`, `queued`, `transcribing`, `transcribed`, `failed`) and should drive explicit states.

### A3. Wizard Summary Sidebar
**Deliverable**
- Sticky context summary across steps (student, recording, prompt, draft).

**Implementation targets**
- `packages/batch-frontend/src/ui/wizard/AssignmentWizard.tsx`
- `packages/batch-frontend/src/context/WizardContext.tsx`

**Acceptance criteria**
- Summary updates as IDs change (recording, prompt, draft).
- Works on desktop; collapses on mobile.

**Implementation notes**
- Wizard state is centralized and persisted in `WizardContext`; summary should read from there.

### A4. Notification Center (Lightweight)
**Deliverable**
- A global notification drawer using the existing toast log.

**Implementation targets**
- `packages/batch-frontend/src/context/NotificationContext.tsx`
- `packages/batch-frontend/src/ui/notifications/NotificationsPanel.tsx` (or new drawer)

**Acceptance criteria**
- Recent alerts are accessible on every page.
- Clickable log entries are optional; log visibility is mandatory.

**Implementation notes**
- NotificationContext already tracks a persistent toast log; reuse it for a global drawer.
- The existing NotificationsPanel is only mounted on Dashboard/Jobs/Settings; a global entry point likely belongs in `App.tsx`.

**Verification**
- `pnpm --filter @esl-pipeline/batch-frontend test`
- Manual: publish job, confirm completion panel and log entry.

---

## 4) Phase B — Power‑User Workflows (Minimal Backend Extensions)

**Goal:** Improve operational clarity for heavy users.

### B1. Job Stage Visualization
**Deliverable**
- Visual pipeline stage progress (validate → extract → notion → tts → upload → attach).

**Backend dependency**
- Job DTO includes per-stage status.

**Implementation notes**
- Current contracts and API client do not include stage metadata; UI must be guarded until added.

**Implementation targets**
- `packages/batch-frontend/src/ui/jobs/JobTable.tsx`
- `packages/batch-frontend/src/ui/jobs/ActivityFeed.tsx`

### B2. ETA + Queue Position
**Deliverable**
- Display queue position and ETA when provided.

**Backend dependency**
- Job status includes queue position and ETA.

**Implementation notes**
- Current contracts and API client do not include ETA/queue fields; UI must be guarded until added.

**Acceptance criteria**
- Jobs show “Waiting for TTS capacity” when queued.
- ETA shows only when backend provides it; otherwise hidden.

### B3. Student Hub Detail View
**Deliverable**
- Dedicated student profile page with focus areas, goals, history, vocabulary log.

**Backend dependency**
- Student detail API (summary + history + focus metadata).

**Implementation notes**
- Student workspace already fetches profiles + timeline + metrics; a "detail view" may be a new layout/route using existing data.

**Implementation targets**
- `packages/batch-frontend/src/ui/students/StudentWorkspace.tsx`
- `packages/batch-frontend/src/ui/students/StudentProfile.tsx` (new)

**Verification**
- Manual: view student → verify timeline and profile details.
- Tests: add UI tests for profile rendering.

---

## 5) Phase C — Automation (Backend‑Driven)

**Goal:** Enable LLM generation and auto‑publish workflows.

### C1. LLM Draft Generation
**Deliverable**
- “Generate draft” button (and optional “Regenerate”).

**Backend dependency**
- Draft generation endpoints + version handling.

**Implementation notes**
- No LLM draft endpoints exist in the current API client; new client functions are required before wiring UI.

**Implementation targets**
- `packages/batch-frontend/src/ui/wizard/Step3AddNotes.tsx`
- `packages/batch-frontend/src/ui/wizard/Step4ReviewDraft.tsx`

**Acceptance criteria**
- One-click draft generation; errors are recoverable and logged.
- Regenerate only appears once backend supports it.

### C2. Student Notifications
**Deliverable**
- Send notification to student after publish with delivery state.

**Backend dependency**
- Notification pipeline or endpoint with delivery status.

**Implementation notes**
- NotificationContext currently logs local toasts; delivery status requires backend-provided events/data.

**Implementation targets**
- `packages/batch-frontend/src/ui/wizard/Step5Publish.tsx`
- Notification center (log new delivery result).

---

## 6) UI Content & Copy Standards

- Error messages must include a next step.
- Success toasts must show a “next action” (open Notion, copy link).
- Step headings should always reflect the current action, not the backend state.

---

## 7) Testing & Verification

**Minimum automated checks**
- `pnpm --filter @esl-pipeline/batch-frontend lint`
- `pnpm --filter @esl-pipeline/batch-frontend typecheck`
- `pnpm --filter @esl-pipeline/batch-frontend test`

**Manual checks**
- Full wizard flow from upload → publish.
- Transcript behavior on processing and failure.
- Dashboard activity stream updates.
- Notification log persists and is visible globally.

---

## 8) Definition of Done (for v2 Completion)

All of the following are true:
- Wizard supports LLM draft generation and regenerate.
- Transcript UI clearly distinguishes “processing” vs “missing.”
- Job monitoring shows stage progress and ETA when available.
- Student hub includes detailed profile view and history.
- Notification center provides persistent history and student delivery status.
- All tests pass; alignment doc updated to mark v2 as implemented.

---

## 9) Maintenance Notes

- If a backend dependency is missing, keep the UI functional and disclose the limitation.
- Update `docs/frontend-vision-alignment.md` at the end of each phase.
- Track backend readiness in `docs/backend-frontend/backend-frontend-alignment.md`.
