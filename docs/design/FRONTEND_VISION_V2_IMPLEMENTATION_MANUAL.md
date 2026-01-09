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

### A2. Transcript Processing Indicator
**Deliverable**
- Explicit “processing” state and friendly retry feedback.

**Implementation targets**
- `packages/batch-frontend/src/ui/wizard/Step2ReviewTranscript.tsx`
- `packages/batch-frontend/src/context/JobMonitorContext.tsx` (if status needed)

**Acceptance criteria**
- When transcript is not ready, show “processing” state (not a raw 404).
- User is not stuck in a polling loop without feedback.

### A3. Wizard Summary Sidebar
**Deliverable**
- Sticky context summary across steps (student, recording, prompt, draft).

**Implementation targets**
- `packages/batch-frontend/src/ui/wizard/AssignmentWizard.tsx`
- `packages/batch-frontend/src/context/WizardContext.tsx`

**Acceptance criteria**
- Summary updates as IDs change (recording, prompt, draft).
- Works on desktop; collapses on mobile.

### A4. Notification Center (Lightweight)
**Deliverable**
- A global notification drawer using the existing toast log.

**Implementation targets**
- `packages/batch-frontend/src/context/NotificationContext.tsx`
- `packages/batch-frontend/src/ui/notifications/NotificationsPanel.tsx` (or new drawer)

**Acceptance criteria**
- Recent alerts are accessible on every page.
- Clickable log entries are optional; log visibility is mandatory.

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

**Implementation targets**
- `packages/batch-frontend/src/ui/jobs/JobTable.tsx`
- `packages/batch-frontend/src/ui/jobs/ActivityFeed.tsx`

### B2. ETA + Queue Position
**Deliverable**
- Display queue position and ETA when provided.

**Backend dependency**
- Job status includes queue position and ETA.

**Acceptance criteria**
- Jobs show “Waiting for TTS capacity” when queued.
- ETA shows only when backend provides it; otherwise hidden.

### B3. Student Hub Detail View
**Deliverable**
- Dedicated student profile page with focus areas, goals, history, vocabulary log.

**Backend dependency**
- Student detail API (summary + history + focus metadata).

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
