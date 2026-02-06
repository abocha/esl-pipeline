# ESL Pipeline - Frontend Implementation Guide v3 (Agent-Oriented)

Purpose
- Turn the v3 vision into a step-by-step implementation plan that an agent can execute without ambiguity.
- Provide phased execution, definitions of done, and required tests.
- Complement (not replace) `docs/design/FRONTEND_VISION_V3.md`.

Audience
- AI agents implementing the batch frontend and coordinating backend contracts.

Status
- Implementation manual aligned to v3 vision.
- If this conflicts with the SSOT, the SSOT wins: `docs/reference/agents-ssot.md`.


## 0) Scope and Assumptions
- Scope includes both frontend and backend when contract changes are required, but focus is frontend delivery.
- The repo is runnable; this guide does not include local setup steps.
- Follow the v3 phases from `docs/design/FRONTEND_VISION_V3.md` unless a phase split is required for contract work.
- Update alignment docs whenever a phase introduces or unblocks a dependency, or changes implementation status.
- When SSE is unavailable, implement a polling fallback with explicit stale-state UI as defined in the vision.
- Unit and E2E tests are required per phase; if a backend dependency is missing, use mocked E2E plus a TODO for real-backend E2E once contracts land (see §5).


## 1) Source of Truth and Document Map
- Precedence (highest to lowest):
  1) `docs/reference/agents-ssot.md`
  2) `packages/contracts/src/index.ts` (shared DTOs + SSE event types)
  3) `docs/design/FRONTEND_VISION_V3.md`
  4) `docs/backend-frontend/backend-frontend-alignment.md`
  5) `docs/frontend-vision-alignment.md`
  6) `packages/batch-backend/src/application/*` and `packages/batch-backend/README.md` (backend DTOs + endpoints, including `packages/batch-backend/src/application/recording-dto.ts`)
  7) `packages/batch-frontend/*` (current UI implementation)
- When a conflict is found:
  - Prefer SSOT → Contracts → Vision → Alignment → Code.
  - Contracts override alignment docs for DTOs and events.
  - Update alignment docs when the conflict is about implementation status or missing backend dependency.
  - Update the vision doc only if the end-goal intent changes.


## 2) Global Rules (Do-Not-Ship)
- Do not introduce new frontend-consumed fields unless they are defined in the authoritative surface (contracts or backend DTO).
- Do not claim pipeline progress when `Job.stages` is absent; render a neutral fallback.
- Do not ship UI that hides failures; every failure must be visible and linked to recovery actions.
- Do not rely on toasts as truth; ledger is the durable source when `/events` exists.
- Do not break existing routes or flows while introducing the three-column shell.
- Do not skip accessibility: keyboard navigation, focus states, reduced motion, high contrast.
- Do not merge a phase without unit + E2E coverage and the phase’s DoD met.


## 3) Phased Implementation Plan (v3)
Each phase follows the same execution pattern:
1) Re-read the phase section in `docs/design/FRONTEND_VISION_V3.md`.
2) Check current alignment docs for gaps.
3) Implement frontend changes first; add backend/contract updates only when required.
4) Update alignment docs if a new dependency is introduced or status changes.
5) Run unit + E2E tests; fix regressions before moving on.
6) Verify DoD checklist for the phase.

### Phase 0: Design Tokens + Layout Shell
Goal
- Establish the visual system and layout scaffolding without changing existing routes.

Steps
1) Add or align design tokens (semantic tokens, focus ring, status colors, high-contrast overrides).
2) Implement the three-column shell with desktop/tablet/mobile behaviors.
3) Wire the right rail container (empty state allowed) with docked/bottom-sheet behavior.
4) Add font loading strategy and reduced-motion handling.

Definition of Done
- Tokens exist and are applied consistently across the shell.
- Layout matches the desktop/tablet/mobile behaviors in the vision doc.
- Right rail is persistent on desktop, docked on tablet, accessible on mobile.
- Existing screens render inside the shell with no route changes.
- Reduced-motion and high-contrast mode are respected.

Tests
- Unit: layout state/rail toggle logic.
- E2E: shell renders at desktop/tablet/mobile breakpoints; right rail access verified.

### Phase 1: Work Context Panel + Ledger
Goal
- Make context and ledger always reachable with reliable live updates and clear recovery.

Steps
1) Build Work Context panel (student/recording/draft/job/publish state links).
2) Build Notification Ledger UI with severity filters and object links.
3) Wire live updates from `/jobs/events` (SSE).
4) Implement polling fallback with stale-data indicator and explicit interval.
5) If `/events` is missing, label ledger as session-scoped; log dependency in alignment docs.

Definition of Done
- Context panel shows the active assignment state and links to source objects.
- Ledger shows events with severity filters and object links.
- SSE updates work; polling fallback activates on SSE failure.
- Stale-data indicator appears when on polling fallback.
- Session-scoped vs durable ledger is explicitly labeled when `/events` is absent.

Tests
- Unit: event filtering, fallback toggle, stale indicator state.
- E2E: SSE happy path and polling fallback path (simulated disconnect); switch to real-backend E2E for ledger once `/events` exists.

### Phase 2: Jobs Table + Pipeline Strip
Goal
- Deliver a dense, high-signal ops view with clear pipeline visibility and recovery actions.

Steps
1) Implement jobs table with filters, search, and key columns (state, timestamps, errors).
2) Implement pipeline strip; when `Job.stages` is missing, render neutral state.
3) Fetch `/config/job-options` and gate actions using `supportedActions`.
4) Add inline error expansion with recommended fix.
5) Wire supportedActions (rerun_audio/cancel/edit_metadata) and handle unsupported actions gracefully.

Definition of Done
- Jobs table renders fast and supports search/filter interactions.
- Pipeline strip reflects stage states when available; otherwise neutral fallback.
- Errors are visible inline with recovery guidance.
- Actions are correctly enabled/disabled based on support and job state, with disabled tooltips when not implemented.

Tests
- Unit: pipeline strip rendering with/without stages.
- E2E: jobs list filters, error expansion, and action flows.

### Phase 3: Wizard Checklist + Completion Receipt
Goal
- Implement the full guided flow with explicit entry/exit criteria and recovery.

Steps
1) Implement step checklist with clear status indicators.
2) Enforce entry/exit criteria and skip implications per step.
3) Hydrate from job status when present; otherwise use recording-first hydration.
4) Implement Publish step with settings inputs and clear failure recovery.
5) Implement completion receipt with Notion link and next actions.

Definition of Done
- Each step enforces entry/exit rules and shows “next best action.”
- Skip actions create ledger entries and display publish warnings.
- Wizard state persists via backend objects (no stale local-only state).
- Publish succeeds or fails with explicit recovery options.
- Completion receipt shows Notion link + actions.

Tests
- Unit: step gating logic and skip implications.
- E2E: full wizard flow including skip + recovery paths; require real-backend E2E once publish/draft contracts are available end-to-end.

### Phase 4: Student Hub + Detail View Refinement
Goal
- Organize work by student with actionable status, history, and focus areas.

Steps
1) Implement student list with status badges and last activity.
2) Implement student detail with timeline and focus areas.
3) Wire timeline interactions to open related job/recording/draft when available.
4) Ensure student detail view aligns with available backend DTOs.

Definition of Done
- Student list is searchable and shows last activity + status.
- Detail view shows timeline and core metadata without contract drift.
- Cross-links to jobs/recordings/drafts work.

Tests
- Unit: timeline rendering and link actions.
- E2E: student list → detail navigation and timeline interactions.

### Phase 5: Automation Features (LLM Draft, Auto-Publish)
Goal
- Add automation safely with explicit overrides and review gates.

Steps
1) Verify backend capability for each automation feature; log dependencies if missing.
2) Implement auto-match student and auto-suggest prompts with clear override UI.
3) Implement auto-draft preview gated by manual review.
4) Never auto-publish without explicit opt-in and review confirmation.

Definition of Done
- Automation features are opt-in and fully reviewable.
- Manual override is always visible and reversible.
- Ledger records automation actions and user overrides.

Tests
- Unit: automation toggle + override logic.
- E2E: automation enabled flow with manual override.


## 4) Contract and Backend Alignment Workflow
Use this workflow whenever UI requirements exceed current contracts:
1) Identify missing field or status in UI requirements.
2) Check `@esl-pipeline/contracts` for existing DTO coverage.
3) If missing, update contracts first and document in alignment docs.
4) Implement backend support (DTO, endpoint, or event).
5) Wire frontend to the new contract; add feature flags if needed.
6) Update alignment docs to reflect new dependency and status.


## 5) Verification and Testing
Minimum per phase:
- Unit tests for new UI logic/state.
- E2E tests for the primary flow added in the phase.
- If a backend dependency is missing, provide mocked E2E coverage for the gated UI and track a TODO for real-backend E2E once contracts land.

Recommended commands:
- `pnpm test`
- `pnpm lint`
- E2E tests live in `packages/batch-frontend/tests/e2e`; run the package-specific script as defined in `package.json`.

Acceptance checks:
- Desktop/tablet/mobile layouts behave as specified.
- SSE + polling fallback behaviors verified.
- No regressions in existing flows (wizard, jobs, students).


## 6) Change Management
- Add or update alignment docs when dependencies or status change.
- If a phase introduces new backend requirements, list them in the Dependencies section of the vision doc.
- Keep this guide and the vision doc in sync when phase boundaries change.
- Prefer small, reviewable increments; avoid multi-phase merges.
