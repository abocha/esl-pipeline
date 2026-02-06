# Phase 5: FRONTEND_VISION Alignment Implementation Plan

> **Goal:** Transform the current functional-but-utilitarian batch-frontend into a polished, guided, multi-step workflow that aligns with the end-goal vision described in `docs/design/FRONTEND_VISION.md`.

---

## Problem Statement

The current frontend (`packages/batch-frontend`) is functional but presents a flat, panel-based layout where all features are visible simultaneously. Phase 5 aims to:

1. **Create a Dashboard** with quick actions, activity stream, and pending approvals
2. **Implement a guided multi-step wizard** for the assignment creation flow
3. **Enhance the upload UX** with drag-and-drop and better progress feedback
4. **Add a Markdown editor** with split/preview modes and validation feedback (COMPLETED)
5. **Polish visual aesthetics** to match the premium design vision

---

## User Review Required

> [!IMPORTANT]  
> **Scope Clarification:** This plan includes both frontend improvements and the backend enablement required to support them (jobs listing/summary, recording playback, markdown validation, and job metadata updates).

> [!IMPORTANT]  
> **Technology Decisions:**
>
> - The plan uses React + Vite (existing stack) with no additional frameworks
> - Markdown editing uses CodeMirror 6 for a lightweight, extensible editor
> - Use `react-router-dom` for view + wizard deep links
> - Design system remains CSS-based (no Tailwind) per existing patterns

> [!NOTE]  
> **Phased Delivery:** The implementation is broken into 7 discrete stages that can be reviewed and shipped incrementally.

---

## Current State Analysis

### Existing Components (from `packages/batch-frontend/src/ui/`)

- `App.tsx` — Main layout with header, footer, panel grid
- `jobs/JobTable.tsx` — Job listing with status updates
- `jobs/ActivityFeed.tsx` — Recent job activity sidebar
- `jobs/JobConnectionBanner.tsx` — SSE connection status
- `students/StudentWorkspace.tsx` — Student CRUD and timeline
- `transcription/TranscriptionWorkspace.tsx` — Recording → transcript → draft flow
- `uploader/JobUploader.tsx` — File upload for direct job submission
- `settings/JobSettingsForm.tsx` — Default job configuration
- `profile/ProfilePage.tsx` — User profile settings
- `auth/AuthDialog.tsx` — Login/register modal

### Current Layout

```
┌────────────────────────────────────────────────────────────────┐
│ Header (logo, user, theme toggle)                              │
├────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────┐ ┌──────────────────────────────┐  │
│ │ Main Panels (2.2fr)      │ │ Sidebar (1fr)                │  │
│ │ - JobSettingsForm        │ │ - ActivityFeed               │  │
│ │ - StudentWorkspace       │ │ - NotificationsPanel         │  │
│ │ - TranscriptionWorkspace │ │                              │  │
│ │ - JobUploader            │ │                              │  │
│ │ - JobConnectionBanner    │ │                              │  │
│ │ - JobTable               │ │                              │  │
│ └──────────────────────────┘ └──────────────────────────────┘  │
├────────────────────────────────────────────────────────────────┤
│ Footer                                                         │
└────────────────────────────────────────────────────────────────┘
```

### Target Layout (FRONTEND_VISION)

```
┌────────────────────────────────────────────────────────────────┐
│ Header (logo, search, notifications, user)                     │
├────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Quick Actions: [New Upload] [Recent Jobs] [Students] [⚙️]  ││
│ └─────────────────────────────────────────────────────────────┘│
│ ┌─────────────────────────────┐ ┌─────────────────────────────┐│
│ │ Activity Stream             │ │ Pending Approvals           ││
│ │ Real-time job updates       │ │ Drafts ready for review     ││
│ └─────────────────────────────┘ └─────────────────────────────┘│
│ ┌─────────────────────────────────────────────────────────────┐│
│ │ Weekly Summary: Jobs, TTS usage, student overview           ││
│ └─────────────────────────────────────────────────────────────┘│
├────────────────────────────────────────────────────────────────┤
│ Footer                                                         │
└────────────────────────────────────────────────────────────────┘
```

---

## Proposed Changes

The implementation is organized into 7 stages, each building on the previous.

---

## Implementation Status (Current)

Status legend: DONE / PARTIAL / MISSING

- Stage 0 (Backend Enablement): PARTIAL
  - DONE: DTOs in `@esl-pipeline/contracts`, `/user/jobs`, `/user/jobs/summary`, `/students/summary`,
    `/recordings/:recordingId/audio` with range support, `/validation/markdown`, `jobOverrides`
    on draft materialize, `edit_metadata` action wired.
  - MISSING: `edit_metadata` should update manifest + emit job_state_changed (TODO in code).
- Stage 1 (Dashboard): DONE
  - Dashboard view, quick actions, pending approvals, weekly summary, and router-backed navigation are in place.
- Stage 2 (Wizard): DONE
  - 5-step flow, deep links, audio playback, prompt package creation, draft review, publish flow wired.
- Stage 3 (Enhanced Upload UX): DONE
  - DropZone + UploadProgress integrated in wizard, uploader, and transcription workspace; progress + cancel hooks.
  - DropZone rejection feedback for invalid file types is implemented.
- Stage 4 (Markdown Editor with Preview): DONE
  - CodeMirror editor, preview, split view, validation panel, debounced validation calls, toolbar actions,
    scroll sync, and “jump to line” validation affordances.
- Stage 5 (Visual Polish & Design System): DONE
  - Glass panels, animations, shared icons, custom toasts, palette/token alignment, button active scale,
    and step indicator gradient progress + stage icons are in place.
- Stage 6 (Integration & Testing): DONE
  - WizardContext routing + deep-link parsing, wizard integration tests, and unit tests for StepIndicator,
    DropZone, WizardContext, and MarkdownEditor are covered. Firefox e2e is allowed to fail.

---

### Stage 0: Backend Enablement (APIs + Contracts) — PARTIAL

Build the API surface needed by the dashboard and wizard so frontend work can ship without mocks.

#### [NEW] Shared DTOs + overrides (`@esl-pipeline/contracts`)

- `JobListResponse`: `{ jobs: JobStatusDto[]; total: number; limit: number; offset: number }`
- `JobSummaryResponse`: `{ total: number; byState: Record<JobState, number>; pendingApprovals: number; last7Days: { total: number; succeeded: number; failed: number }; tts: { enabled: number; succeeded: number } }`
- `StudentSummaryResponse`: `{ items: { id: string; name: string; lastLessonAt: string | null; pendingDrafts: number }[]; total: number; limit: number; offset: number }`
- `MarkdownValidationResponse`: `{ ok: boolean; errors: string[]; warnings: string[]; meta?: { title: string; student: string; level: string; topic: string | string[]; input_type: string; speaker_labels?: string[] } }`
- `JobConfigOverrides`: subset of job settings (`preset`, `notionDatabase`, `withTts`, `forceTts`, `ttsStrategy`, `upload`, `voiceId`, `voiceAccent`)

#### [MODIFY] Jobs list + summary (batch-backend)

- Implement `GET /user/jobs` with pagination + filters:
  - Query: `state` (comma-separated), `studentId`, `from`, `to`, `limit`, `offset`, `order`
  - Response: `JobListResponse` (use `jobRecordToDto`)
- Default sort: `createdAt desc`
- Add `GET /user/jobs/summary`:
  - Query: `from`, `to` (default: last 7 days)
  - Response: `JobSummaryResponse`
- Add repository queries + DTO mapping in `job-repository` and tests

#### [NEW] Student summary endpoint (batch-backend)

- Add `GET /students/summary`:
  - Query: `limit`, `offset`, `order`
  - Response: `StudentSummaryResponse` (last lesson date + pending draft counts)

#### [NEW] Recording audio playback (batch-backend)

- Add `GET /recordings/:recordingId/audio` with auth + `Range` support
- Resolve storage URI and stream content with proper MIME types
- Include `Accept-Ranges`, `Content-Length`, and 206 responses when ranged

#### [NEW] Markdown validation endpoint (batch-backend)

- Add `POST /validation/markdown` accepting `{ text, strict?: boolean }`
- Run `@esl-pipeline/md-validator` and return `MarkdownValidationResponse`

#### [MODIFY] Job metadata updates (batch-backend + contracts)

- Extend `SubmitJobRequest` with `voiceId` and `voiceAccent`
- Implement `edit_metadata` job action:
  - Endpoint: `POST /jobs/:jobId/actions` with `{ type: "edit_metadata", payload: JobConfigOverrides }`
  - Allowed when job is `awaiting_approval` (reject when running/succeeded/failed)
- Extend `POST /drafts/:id/materialize` to accept `jobOverrides: JobConfigOverrides` to seed the approval job
  - Use overrides if provided; otherwise fall back to defaults

#### [DEFERRED] Draft regeneration

- No LLM generation service exists today; remove/regress “Regenerate” until a generator is added

---

### Stage 1: Dashboard Foundation — DONE

Create the dashboard as the new home view, replacing the current flat panel layout.

#### [NEW] `Dashboard.tsx` (`src/ui/dashboard/Dashboard.tsx`)

- Quick Actions bar with prominent "New Assignment" button
- Activity Stream (refactored from existing `ActivityFeed`)
- Pending Approvals panel showing awaiting_approval jobs
- This Week summary with job counts and student overview
  - Data sources:
    - `GET /user/jobs?state=awaiting_approval` for Pending Approvals
    - `GET /user/jobs` (limit + order desc) to hydrate Activity Feed alongside SSE
    - `GET /user/jobs/summary` + `GET /students/summary` for Weekly Summary

#### [MODIFY] `App.tsx` (`src/ui/App.tsx`)

- Add router-backed navigation for Dashboard, Wizard, Students, Jobs, Settings
- Create a simple tab-based navigation in the header or as a sidebar
- Refactor `AuthenticatedPanels` to render the active view
  - Trigger initial job hydration via `/user/jobs` on login and merge with SSE updates

#### [NEW] `QuickActions.tsx` (`src/ui/dashboard/QuickActions.tsx`)

- Card-style buttons: New Upload, Recent Jobs, Students, Settings
- Each button navigates to the appropriate view

#### [NEW] `PendingApprovals.tsx` (`src/ui/dashboard/PendingApprovals.tsx`)

- List jobs with state `awaiting_approval`
- Show student name, recording name, timestamp
- Click to open directly in the review step of the wizard

#### [NEW] `WeeklySummary.tsx` (`src/ui/dashboard/WeeklySummary.tsx`)

- Summary stats: jobs completed, pending, failed
- Student summary: last lesson dates, pending drafts
- Data sourced from `GET /user/jobs/summary` + `GET /students/summary`

---

### Stage 2: Multi-Step Assignment Wizard — DONE

Implement the guided 5-step workflow from FRONTEND_VISION §2.2 and replace the
current `/wizard` placeholder. Support deep links from the dashboard.

#### [NEW] `AssignmentWizard.tsx` (`src/ui/wizard/AssignmentWizard.tsx`)

- Main wizard container with step indicator and router integration
- Read query params: `jobId` and `step` (expected: `select`, `transcript`, `notes`, `review`, `publish`)
  - `PendingApprovals` links to `/wizard?jobId=...&step=review`, so map `review` to Step 4
- Hydrate job context from `JobMonitorContext` or `GET /jobs/:id` when `jobId` is provided
- State management via local reducer or `WizardContext` (keep state in-session)

#### [NEW] `WizardStep.tsx` (`src/ui/wizard/WizardStep.tsx`)

- Wrapper component for each step with consistent styling
- Navigation buttons (Back, Continue, Skip where applicable)
- Guard required actions before moving to the next step

#### [NEW] `Step1SelectStudent.tsx` (`src/ui/wizard/Step1SelectStudent.tsx`)

- Student selection grid (reuse student options APIs + `StudentSelectionContext`)
- Upload audio via `POST /recordings/upload`
- Track uploaded recording in `JobMonitorContext`

#### [NEW] `Step2ReviewTranscript.tsx` (`src/ui/wizard/Step2ReviewTranscript.tsx`)

- Load transcript via `GET /recordings/:id/transcript`
- Allow minor edits with `PUT /recordings/:id/transcript`
- Audio player backed by `GET /recordings/:id/audio`
- Approve & Continue or Skip

#### [NEW] `Step3AddNotes.tsx` (`src/ui/wizard/Step3AddNotes.tsx`)

- Notes textarea plus prompt template/profile selectors (from `GET /config/prompts`)
- Create prompt package when advancing

#### [NEW] `Step4ReviewDraft.tsx` (`src/ui/wizard/Step4ReviewDraft.tsx`)

- Create/load draft via `POST /prompt-packages/:id/draft` and `GET /drafts/:id`
- Use a simple textarea/preview placeholder in Stage 2
  - Stage 4 replaces this with `SplitEditor` + markdown validation

#### [NEW] `Step5Publish.tsx` (`src/ui/wizard/Step5Publish.tsx`)

- TTS settings (enable/disable, voice, strategy)
- Notion publishing settings (database + preset)
- Storage target selection (auto, S3, none)
- Publish flow:
  - If creating a new approval job, call `POST /drafts/:id/materialize` with `jobOverrides`
  - If an approval job already exists, call `POST /jobs/:id/actions` with `edit_metadata` before approval
  - Approve via `POST /jobs/:id/approve` and register in `JobMonitorContext`

#### Cross-cutting

- Use existing styling primitives in `index.css` (cards, panels, buttons)
- Keep wizard state in-session; no persistence across reload required
- Extend `src/utils/api.ts` for any missing helper calls (`jobOverrides`, `edit_metadata`)

---

### Stage 3: Enhanced Upload UX — PARTIAL

Improve the file upload experience throughout the application.

#### [NEW] `DropZone.tsx` (`src/ui/shared/DropZone.tsx`)

- Reusable drag-and-drop component
- Visual feedback: drag-over state, file validation
- Accepts audio files (opus, mp3, wav, m4a, aac, ogg)
- Progress indicator with cancel support
- Single-file mode for the wizard; multi-file mode for job uploader

#### [MODIFY] `Step1SelectStudent.tsx` uses DropZone

- Replace the file input with `DropZone` (single-file)
- Keep existing `uploadRecording` flow and status messaging

#### [MODIFY] `JobUploader.tsx` → `DropZone` integration

- Replace the multi-file input with `DropZone` (multi-file)
- Preserve upload queue behavior and error handling

#### [MODIFY] `TranscriptionWorkspace.tsx` → `DropZone` integration (optional if time)

- Replace the recording upload input with `DropZone`
- Show upload progress inline

#### [NEW] `UploadProgress.tsx` (`src/ui/shared/UploadProgress.tsx`)

- Animated progress bar with percentage
- File name and size display
- Cancel button

#### [MODIFY] API helpers (`src/utils/api.ts`)

- Add optional `onProgress` + `signal`/`AbortController` support to `uploadMarkdown` and `uploadRecording`
- Use these hooks in `DropZone` + upload flows to drive progress and cancel

---

### Stage 4: Markdown Editor with Preview — PARTIAL

Add a proper markdown editing experience for draft review.

#### [NEW] `MarkdownEditor.tsx` (`src/ui/editor/MarkdownEditor.tsx`)

- Uses CodeMirror 6 with markdown syntax highlighting
- Line numbers, word wrap
- Basic toolbar: Bold, Italic, Heading, Link, Code

#### [NEW] `MarkdownPreview.tsx` (`src/ui/editor/MarkdownPreview.tsx`)

- Renders markdown to HTML using remark/unified (add deps to batch-frontend)
- Styled to match Notion-like output
- Scrolls in sync with editor (if feasible)

#### [NEW] `SplitEditor.tsx` (`src/ui/editor/SplitEditor.tsx`)

- Two-column layout: Editor | Preview
- Toggle buttons: Editor only, Preview only, Split
- Responsive: stacks on mobile

#### [MODIFY] `Step4ReviewDraft.tsx` uses `SplitEditor`

#### [NEW] `ValidationPanel.tsx` (`src/ui/editor/ValidationPanel.tsx`)

- Shows warnings/errors from `POST /validation/markdown`
- Click to jump to line (if editor supports)
- Collapsible panel

#### [MODIFY] `Step4ReviewDraft.tsx` uses the editor stack

- Replace the placeholder textarea with `SplitEditor`
- Call `POST /validation/markdown` on debounced draft updates
- Surface warnings/errors in `ValidationPanel`
- Keep the Save/Approve flow intact

#### [MODIFY] API helpers (`src/utils/api.ts`)

- Add `validateMarkdown(text, strict?)` helper for `POST /validation/markdown`
- Standardize error handling and return `MarkdownValidationResponse`

---

### Stage 5: Visual Polish & Design System Enhancements — PARTIAL

Apply premium aesthetics across the application, aligning with the `FRONTEND_VISION.md` guidelines (Glassmorphism, Indigo/Slate palette).

#### [MODIFY] `index.css` & Global Styles

- **Color Palette:** Enforce vision tokens (`--background: #0f0f17`, `--surface: #1e1e2e`, `--primary: #6366f1`).
- **Glassmorphism:** Add utility class `.glass-panel` (backdrop-filter blur + semi-transparent border).
- **Typography:** Ensure modern font stack (Inter/Roboto) with refined weights.
- **Animations:** Add `@keyframes` for `fadeIn`, `slideIn`, `pulse` and utility classes like `.animate-in`.

#### [NEW] `Icons.tsx` (`src/ui/shared/Icons.tsx`)

- Create a lightweight set of inline SVG components (Heroicons style) for:
  - Navigation (Back, Next, Home)
  - Stages (Upload, Document, Edit, Check, Publish)
  - Actions (Save, Copy, Refresh)
- Avoid adding new heavy dependencies; use "zero-install" compatible approach.

#### [NEW] `StepIndicator.tsx` (`src/ui/wizard/StepIndicator.tsx`)

- Implement "Step X of Y ━━○○○○" visual style using the new icons.
- Animated progress filling (gradient transition).
- Responsive labels (hide on small screens).

#### [MODIFY] Wizard Layout (`AssignmentWizard.tsx`)

- Apply "Card variant" with larger padding (`--space-6`) and subtle shadow (`--shadow-card`).
- Use `.glass-panel` for the main container.
- Ensure responsive "stacking" of panels (e.g., Student Selection / Upload split).

#### [MODIFY] Shared Components

- **Buttons:** Update `index.css` button classes for `transform: scale(0.98)` on active, subtle shadow on hover.
- **Inputs/Selects:** Style with `--surface` background, `--border-light` borders, and ring focus states.
- **Toasts:** Ensure `react-hot-toast` uses custom styles (dark background, light text).

#### Animations & Micro-interactions

- **Page Transitions:** Wrap wizard steps in a container with generic fade-in animation.
- **Micro-interactions:** Add hover states for student cards, job list rows, and interactive elements.

---

### Stage 6: Integration & Testing — DONE

Refactor the Wizard to use a centralized Context for state management (replacing local state in `AssignmentWizard`) and finalize application routing.

#### [NEW] `WizardContext.tsx` (`src/context/WizardContext.tsx`)

- **State:** `currentStep`, `activeJobId`, `studentId`, `recordingId`, `transcriptId`, `promptPackageId`, `draftId`, `notes`, `metadataOverrides`
- **Actions:**
  - `loadJob(jobId)`: Hydrate state from backend/JobMonitor
  - `updateField(field, value)`: Generic updater
  - `goToStep(step)`: Navigation guard
  - `reset()`: Clear state
- **Integration:** Wrap `AssignmentWizard` (or `App` specific route) in `WizardContext.Provider`.

#### [MODIFY] `AssignmentWizard.tsx`

- Refactor to consume `useWizardContext` instead of local `useState`.
- Move deep link parsing (URLSearchParams) into the `WizardContext` initialization or a `useWizardInitialization` hook.
- Ensure back/next buttons trigger Context actions.

#### [MODIFY] `App.tsx`

- Ensure all routes are protected (`AuthenticatedRoutes`).
- Verify `Navigate to="/" ` catch-all works.

#### [NEW] `src/ui/wizard/Wizard.test.tsx`

- **Integration Test:** Render `AssignmentWizard` within `JobMonitorProvider` and `WizardContext`.
- **Scenarios:**
  - "Happy Path": Select student -> Upload (mock) -> Transcript (mock) -> Review -> Publish.
  - "Deep Link": Render with `?step=review&jobId=123`. Verify it loads Step 4.

#### [NEW] `src/ui/editor/Editor.test.tsx`

- **Unit Test:** `MetricValidationPanel` shows errors when passed.
- **Unit Test:** `SplitEditor` toggles views (Editor/Preview/Split).

#### [NEW] `src/ui/editor/MarkdownEditor.test.tsx`

- **Unit Test:** Toolbar actions apply formatting (bold/heading).

---

## Verification Plan

### Automated Tests

0. **Backend tests** for new endpoints:
   - `/user/jobs` pagination + filtering
   - `/user/jobs/summary` aggregation
   - `/students/summary` aggregation
   - `/recordings/:id/audio` range streaming
   - `/validation/markdown` output format
1. **Unit tests** for new components:
   - `StepIndicator` renders correct active step
   - `DropZone` handles file drop and validation
   - `MarkdownEditor` initializes with content
   - `WizardContext` state transitions correctly

2. **Integration tests** for wizard flow:
   - Complete wizard from step 1 to step 5
   - Skip functionality (step 2 transcript review)
   - Back navigation preserves state

3. **Wizard Integration Test (`src/ui/wizard/Wizard.test.tsx`):**
   - Use `vi.mock` for the API layer.
   - Test flow:
     - 1. Render `<AssignmentWizard />`.
     - 2. Select a student (click grid item).
     - 3. Verify transition to Step 1 (Upload).
     - 4. Simulate file drop -> wait for "Mock Recording" -> click Next.
     - 5. Verify transition to Step 2 (Transcript).

4. **Run existing test suite:** `pnpm --filter @esl-pipeline/batch-frontend test`

### Manual Verification

1. End-to-end flow:
   - Login → Dashboard → New Assignment → Select student → Upload audio
   - Wait for transcription → Review → Add notes → Save draft
   - Review draft with split editor → Configure publishing → Publish

2. Responsive behavior:
   - Test on mobile viewport (< 768px)
   - Test on tablet viewport (768-1024px)
   - Verify wizard steps stack properly

3. SSE integration:
   - Activity stream updates in real-time
   - Pending approvals refreshes on job state change

---

## Dependencies

**New npm packages:**

- `@codemirror/lang-markdown` — Markdown mode for CodeMirror
- `@codemirror/basic-setup` — Basic editor setup (may already be available)
- `codemirror` — Core editor (if not already present)
- `unified`, `remark-parse`, `remark-rehype`, `rehype-stringify` — Markdown preview rendering (not currently in batch-frontend deps)
- `react-router-dom` — routing for view + wizard deep links

**Note:** `react-dropzone` is already a dependency; reuse it for new DropZone components.

---

## Risks and Mitigations

| Risk                               | Mitigation                                                    |
| ---------------------------------- | ------------------------------------------------------------- |
| CodeMirror integration complexity  | Start with basic setup, add features incrementally            |
| Wizard state management edge cases | Use reducer pattern for predictable state transitions         |
| Mobile responsiveness issues       | Design mobile-first, test on real devices                     |
| SSE reconnection during wizard     | Keep JobMonitorContext, show reconnection banner              |
| Audio streaming (Range handling)   | Use backend storage streaming helpers + add integration tests |
| Jobs list/summary performance      | Start with indexed queries + pagination limits                |

---

## File Summary

### New Files (19)

- `src/ui/dashboard/Dashboard.tsx`
- `src/ui/dashboard/QuickActions.tsx`
- `src/ui/dashboard/PendingApprovals.tsx`
- `src/ui/dashboard/WeeklySummary.tsx`
- `src/ui/wizard/AssignmentWizard.tsx`
- `src/ui/wizard/WizardStep.tsx`
- `src/ui/wizard/Step1SelectStudent.tsx`
- `src/ui/wizard/Step2ReviewTranscript.tsx`
- `src/ui/wizard/Step3AddNotes.tsx`
- `src/ui/wizard/Step4ReviewDraft.tsx`
- `src/ui/wizard/Step5Publish.tsx`
- `src/ui/wizard/StepIndicator.tsx`
- `src/ui/shared/DropZone.tsx`
- `src/ui/shared/UploadProgress.tsx`
- `src/ui/editor/MarkdownEditor.tsx`
- `src/ui/editor/MarkdownPreview.tsx`
- `src/ui/editor/SplitEditor.tsx`
- `src/ui/editor/ValidationPanel.tsx`
- `src/context/WizardContext.tsx`

### Modified Frontend Files

- `src/ui/App.tsx` — Navigation and view switching
- `src/ui/transcription/TranscriptionWorkspace.tsx` — DropZone integration
- `src/index.css` — New design tokens and styles
- `src/utils/api.ts` — new endpoints (jobs list/summary, validation, audio)
- `src/context/JobMonitorContext.tsx` — dashboard + wizard data sources

### Shared Contracts

- `packages/contracts/src/index.ts` — extend `SubmitJobRequest` and add new DTOs
- `packages/contracts/src/job-actions.ts` — refine `edit_metadata` payload typing (optional)

### Backend Files (Modified/New)

- `packages/batch-backend/src/transport/extended-routes.ts` — new endpoints (jobs list/summary, validation, audio streaming)
- `packages/batch-backend/src/domain/job-repository.ts` — list/summary queries
- `packages/batch-backend/src/application/list-jobs.ts` — user jobs query orchestration
- `packages/batch-backend/src/application/job-summary.ts` — summary aggregation helpers
- `packages/batch-backend/src/application/student-summary.ts` — aggregated student metrics
- `packages/batch-backend/src/application/job-actions/edit-metadata.ts` — implement metadata updates
- `packages/batch-backend/src/application/approve-job.ts` (optional) — handle overrides on approval
- `packages/batch-backend/src/application/materialize-draft.ts` (optional) — accept overrides

---

## Implementation Order

0. **Stage 0: Backend Enablement** (~6-10 backend changes)
   - Jobs list + summary, student summary, audio streaming, validation, metadata updates

1. **Stage 1: Dashboard** (~4-6 components)
   - Foundation for navigation and new layout

2. **Stage 2: Wizard** (~7 components)
   - Core multi-step flow with existing functionality

3. **Stage 3: Upload UX** (~3 components)
   - Shared dropzone, progress indicators

4. **Stage 4: Editor** (~4 components)
   - Markdown editing with preview

5. **Stage 5: Polish** (CSS + refinements)
   - Visual enhancements, animations

6. **Stage 6: Integration** (wiring + tests)
   - Final assembly and verification

---

## Estimated Effort

| Stage     | Estimated Tool Calls | Description                 |
| --------- | -------------------- | --------------------------- |
| 0         | 12-16                | Backend enablement          |
| 1         | 15-20                | Dashboard and navigation    |
| 2         | 25-30                | Wizard components           |
| 3         | 10-12                | Upload UX                   |
| 4         | 15-18                | Editor components           |
| 5         | 8-10                 | Visual polish               |
| 6         | 10-12                | Integration and tests       |
| **Total** | **~95-120**          | Full Phase 5 implementation |

---

> **Ready for review.** Please confirm this plan aligns with your vision, or let me know if you'd like to adjust scope, priorities, or technical choices.
