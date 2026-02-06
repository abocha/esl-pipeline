free# ESL Pipeline - Frontend Vision v3 (Agent-Oriented)

Purpose

- Define the ideal, end-to-end product experience for tutors and operators.
- Provide clear direction to AI agents implementing the frontend and coordinating backend contracts.
- Replace v2 as the target state; use alignment docs for current status.

Audience

- AI agents and maintainers building the batch frontend and related backend surfaces.

Status

- Vision (end goal). This document is aspirational and intentionally future-looking.
- Implementation status and gaps live in:
  - docs/frontend-vision-alignment.md
  - docs/backend-frontend/backend-frontend-alignment.md

## 1) North Star

One-line promise

- A tutor can turn a raw lesson recording into a polished, student-ready homework assignment in minutes with total confidence.

What "right" feels like

- Every screen answers: what is ready, what is blocked, what is next.
- Context never disappears on desktop; on tablet/mobile it is always one tap away.
- The system is honest: it shows pipeline stage, errors, retries, and recovery paths.

## 2) Principles (Non-Negotiable)

1. Guided flow, minimal friction

- The wizard behaves like a checklist you can trust.
- Defaults eliminate most decisions; overrides are explicit and reversible.

2. Trust and transparency

- Every action produces a visible outcome: toast, log entry, state update.
- Pipeline stages are visible with timestamps and clear errors.

3. Quality by design

- Draft review shows validation by severity and has direct "jump to line" affordances.
- Preview parity is enforced (what you see is what is published).

4. Scale without chaos

- Dense tables, powerful filters, and fast search over jobs, students, recordings.
- Batch work is first-class, not an afterthought.

5. Resilience by default

- SSE failures degrade to polling with clear status.
- Retriable actions are always available and never hidden.

## 3) Product Objects (Canonical)

Everything in the UI maps to one of these objects and their states:

- Student
- Recording
- Transcript
- Prompt Package
- Draft
- Job
- Assignment (composite view of all of the above)

Invariants

- Every object has a stable ID and readable status; last-updated timestamps are shown when available (or last activity when not).
- Cross-links are guaranteed (job -> recording -> transcript -> draft -> notion).

### 3.1 Canonical States and Stage Mapping

The frontend must align to explicit, shared state enums and DTO field names to prevent drift.

Job stages (pipeline strip)

- validate
- extract
- notion (import + colorizer unless backend splits)
- tts
- upload
- attach

If the backend exposes a separate colorizer stage later, add a distinct stage and update the UI mapping.

Contracts package (JobStatusDto)

- Source: packages/contracts/src/index.ts (JobStatusDto)
- Fields: jobId, state, error, createdAt, updatedAt, finishedAt, recordingId, transcriptId, promptPackageId, draftId, notionUrl

Backend DTOs (non-contract)

- RecordingDto source: packages/batch-backend/src/application/recording-dto.ts
  - Fields: recordingId, status, transcriptId, error, createdAt, updatedAt, source, studentId, displayName, durationSec, channels, bytes
- StudentProfileData source: packages/batch-backend/src/application/student-profiles-store.ts
  - Fields (minimum UI): id, student, profileId, dbId, pageParentId, colorPreset, voices, manifestPreset, accentPreference

Future fields (contract additions required)

- Job: stages (pipeline strip), canceled state
- Transcript/PromptPackage/Draft DTOs with explicit status enums

Authoritative enums (current)

- Job.state: queued | running | awaiting_approval | succeeded | failed
- Recording.status: ingested | queued | transcribing | transcribed | failed

Derived UI states (no contract yet)

- Transcript.status: processing | ready | missing | failed
- PromptPackage.status: creating | ready | failed
- Draft.status: creating | ready | failed | materialized

Mapping rules

- Transcript.status derives from recording status + transcript fetch:
  - transcribing -> processing
  - transcribed + transcript payload -> ready
  - failed -> failed
  - no transcript after max retries (default 6) or 10 minutes without transcript -> missing
- If job stages are present, Job.stages is a map keyed by the pipeline stages above with values:
  - pending | running | succeeded | failed
- If stages are absent, the UI must render a neutral fallback (no progress claims).

Source of truth

- DTO field names and enums must match @esl-pipeline/contracts and backend SSOTs.
- If contracts change, update this section first to avoid UI drift.

## 4) Information Architecture

### 4.1 Primary Layout: Workshop Console

Three-column, task-centric layout on desktop:

- Left rail: navigation, global search, quick create.
- Center workspace: active view (Dashboard, Wizard, Jobs, Students, Settings).
- Right rail: Work Context + Notification Ledger (persistent on desktop, docked on tablet, accessible on mobile).

Goals

- Context is never lost even when switching screens.
- Notifications are not ephemeral; they are recorded.

### 4.2 Routes

- /dashboard
- /wizard
- /jobs
- /students
- /students/:id
- /settings

### 4.3 Responsive Behavior

Desktop (>= 1200px)

- Three-column layout with persistent left rail and right rail.
- Work Context + Ledger are persistent.

Tablet (768px - 1199px)

- Right rail collapses into a docked sheet with two states:
  - Peek (collapsed) showing summary badges.
  - Pinned (expanded) showing full Work Context + Ledger.
- User can pin/unpin; pinned state persists per session.

Mobile (< 768px)

- Right rail becomes a bottom sheet, opened by a persistent context/ledger button.
- Work Context never disappears; it is always reachable within one tap.

## 5) Core Views

### 5.1 Dashboard (Command Center)

Primary purpose: start work and clear blockers quickly.

Layout

- Work Queue: Ready, Needs Attention, Blocked.
- Event Ledger: chronological actions and errors.
- Status Bar: SSE health, queued jobs count, processing backlog.

Behaviors

- Global search results are surfaced inline.
- Resume flow buttons launch directly into relevant wizard step.

### 5.2 Wizard (Guided Flow)

Primary purpose: move a single assignment from intake to publish without ambiguity.

Model

- Checklist layout with explicit status for each step.
- Summary sidebar shows student, recording, transcript, draft, publish state.

Steps

1. Select student and upload recording
2. Review transcript
3. Notes and prompt settings
4. Draft review and validation
5. Publish (Notion, TTS, storage)
6. Completion receipt (Notion link, actions)

Behaviors

- Processing vs missing transcript are visibly distinct.
- Each step provides a clear "next best action".

Step criteria and recovery

1. Select student and upload recording
   - Entry criteria: none
   - Exit criteria: studentId + recordingId
   - Ready when: recording upload completes
   - Failure: upload failed, validation error
   - Recovery: retry upload, choose existing recording, change student
2. Review transcript
   - Entry criteria: recordingId
   - Exit criteria: transcript status = ready OR user explicitly skips
   - Ready when: transcript status = ready OR user explicitly skips
   - Failure: transcription failed, transcript missing
   - Recovery: retry transcription, re-upload, or skip with warning
   - Skip implications: ledger entry + publish warning (transcript not reviewed)
3. Notes and prompt settings
   - Entry criteria: recordingId (transcript optional)
   - Exit criteria: promptPackageId OR explicit notes + template selection
   - Ready when: prompt package created or notes saved
   - Failure: prompt package create failed
   - Recovery: retry create, edit notes, change template
4. Draft review and validation
   - Entry criteria: promptPackageId
   - Exit criteria: draftId + draft text, validation passes or user acknowledges warnings
   - Ready when: validation passes or user explicitly acknowledges warnings
   - Failure: draft fetch/save failed, validation errors unresolved
   - Recovery: retry fetch/save, fix errors, re-run validation
5. Publish
   - Entry criteria: draftId + draft text
   - Exit criteria: publish succeeds and Notion link is returned
   - Required inputs: job settings (preset, upload target, TTS strategy)
   - Ready when: publish succeeds and Notion link is returned
   - Failure: publish failed
   - Recovery: retry publish, edit settings, open logs
6. Completion receipt
   - Exit criteria: Notion link visible + quick actions available
   - Recovery: if publish is partial, show retries and retain context

### 5.3 Jobs (Ops View)

Primary purpose: diagnose and recover batch work at scale.

Key features

- Dense table with row-level pipeline strip.
- One-click retry/cancel when supported.
- Inline error expansion with recommended fix.

### 5.4 Students (Student Hub)

Primary purpose: organize work by student, not by file.

Key features

- Student list with status badges and last activity.
- Student detail page: timeline, goals, focus areas, vocabulary log.

### 5.5 Settings and Integrations

Primary purpose: defaults are respected, integrations are reliable.

Key features

- Defaults: preset, TTS strategy, upload target.
- Integrations: health checks and last known status.
- Notification preferences and audit log access.

## 6) Interaction Model

### 6.1 Work Context Panel (Persistent/Docked/Accessible)

- Student, recording, draft, job, and publish state in a vertical checklist.
- Each item links to its source and indicates readiness.
- Persistent on desktop, docked on tablet, one-tap access on mobile.

### 6.2 Notification Ledger (Persistent/Docked/Accessible)

- Durable log of actions, errors, and outcomes.
- Filter by severity (success, warning, error).
- Each entry links to the relevant object.
- Persistent on desktop, docked on tablet, one-tap access on mobile.

### 6.3 Pipeline Strip (Jobs)

- A compact row showing stage completion for validate -> extract -> notion (import + colorizer) -> tts -> upload -> attach.
- Stages are binary or progress-based if backend provides detail.

## 7) Visual Direction (New System)

Goal: a calm, high-signal production console. No marketing visuals.

Typography

- Display: Newsreader
- UI/Body: Sarabun
- Mono: IBM Plex Mono

Color

- Base: #F6F2EA (paper)
- Ink: #1B1B1D
- Accent: #2B51FF
- Success: #2E7D5A
- Warning: #C9871B
- Error: #E04E39

Surface language

- Thin borders, subtle elevation, no glassmorphism.
- Shadows only for hierarchy, not decoration.

## 8) Reliability and Recovery

Required behaviors

- If SSE fails, show banner and start polling.
- All failures show recovery actions (retry, re-run, open logs).
- Every user-visible error is written to the ledger.
- Polling fallback: target 5s interval; show a stale-data indicator if no fresh updates for 15s.

## 9) Data and State Ownership

Ledger persistence (audit trail)

- Target state: durable and server-backed; the UI never treats toasts as the source of truth.
- Current state: session-scoped log until the /events history endpoint exists.
- Backend exposes a paginated event stream (by job/student/recording) plus global feed.
- Frontend caches recent events but can always rehydrate from the backend once /events exists.

Wizard state ownership

- The authoritative state for an assignment is the backend job/recording/draft chain.
- Frontend wizard state is a convenience cache that can be rebuilt from object IDs.
- On load, hydrate from job status when a job exists; otherwise use recording-first hydration until a job is created.

Source-of-truth rules

- Job state and pipeline stages come from backend DTOs.
- Local optimistic updates are allowed only for UI responsiveness, not for truth.

## 10) Ledger Contract

Event schema (minimum fields)

- id (string)
- type (string)
- severity (success | warning | error | info)
- objectType (job | recording | transcript | draft | student)
- objectId (string)
- timestamp (ISO 8601)
- message (human readable)
- actor (system | user:<id> | agent:<id>)
- metadata (optional object)

Retention and pagination

- Retain at least 90 days by default (configurable).
- Cursor-based pagination required for both global and scoped feeds.

Query model

- Global feed: GET /events?cursor=...
- Scoped feed: GET /events?objectType=job&objectId=...&cursor=...
- Live stream (current): SSE via GET /jobs/events
- Note: /events is a required backend addition; until implemented, the ledger is session-scoped.

## 11) Automation and Intelligence

High ROI automation (when backend supports it)

- Auto-match student based on recording metadata.
- Auto-suggest prompt templates based on level and history.
- Auto-draft preview with manual override.

Strict guardrails

- Automation must always expose a manual override.
- All automation outputs must be reviewable and editable before publish.

## 12) Design Tokens and Accessibility

Semantic token map (examples)

- bg/page, bg/surface, bg/raised
- text/primary, text/secondary, text/muted
- border/subtle, border/strong
- action/primary, action/primary-hover, action/secondary
- status/success, status/warning, status/error
- focus/ring

Font loading and fallback

- Use @font-face with font-display: swap.
- Provide local fallbacks and system fallbacks.
- Preconnect to font sources and preload critical weights.

Contrast targets

- WCAG AA: 4.5:1 for body text, 3:1 for large text and UI icons.
- Focus ring must be visible at 3:1 against adjacent surfaces.

Motion and high-contrast

- Respect prefers-reduced-motion: minimize transitions and remove non-essential motion.
- High-contrast activation: OS prefers-contrast OR explicit Settings toggle.
- High-contrast scope: override text/primary, bg/surface, border/strong, focus/ring, status colors.

Requirements

- Full keyboard navigation for all primary flows.
- Visible focus states and ARIA coverage for core controls.
- Tablet is first-class; mobile is secondary but functional.

## 13) Performance and Latency Budgets

Targets

- Dashboard first meaningful render: p75 < 2s, p95 < 3s.
- Core tables (jobs/students): p75 < 1s for first page, p95 < 1.5s.
- Filter changes: p75 < 300ms, p95 < 600ms.
- Event ledger update latency: p75 < 500ms, p95 < 1s.
- Wizard step transitions: p75 < 200ms, p95 < 400ms after data is ready.

Guidance

- Progressive rendering for large tables.
- Background prefetch for the next wizard step.

Measurement spec

- Reference device: mid-tier laptop (4-core, 8GB RAM) and mid-tier tablet.
- Network: 20 Mbps down / 5 Mbps up, 30ms RTT.
- Instrumentation: RUM for real users + synthetic tests in CI.
- Start/stop definitions:
  - Dashboard render: navigation start -> first meaningful panel rendered.
  - Tables: filter interaction -> first row rendered.
  - Wizard transition: step submit -> next step interactive.
- Include server time for API-bound interactions; isolate client-only times where possible.
- Event latency: server timestamp -> UI render; report SSE vs polling separately.

## 14) Observability

All key events are logged with timestamps and object IDs:

- Upload started/completed
- Transcript requested/completed/failed
- Draft generated/edited/validated
- Publish started/completed/failed
- Job state transitions

## 15) Success Metrics

Primary

- Median time to publish: < 5 minutes from upload
- Draft correction rate: < 10% major edits after generation
- Error recovery time: < 2 minutes
- Tutor confidence: > 4.5/5

Operational

- SSE uptime: > 99%
- No silent failures: 100% failures logged in ledger

## 16) Dependencies (Backend Contracts)

Required to fully realize v3

- Transcript status semantics (processing vs missing vs failed)
- Job pipeline stage data and optional ETA
- LLM draft generation endpoints and versioning
- Notification delivery and status feedback
- Usage/cost signals for TTS
- Durable ledger history endpoint (global + scoped feeds)
- Formal DTOs for Transcript, PromptPackage, Draft statuses
- Optional canceled job state (if adopted, decide canceled vs cancelled)

## 17) Migration Strategy (High-Level)

Constraints

- Keep current routes stable while introducing the three-column layout.
- Introduce new components in parallel; avoid large rewrites until parity is reached.

Phased approach (summary)

- Phase 0: new design tokens + layout shell
- Phase 1: Work Context panel + Ledger
- Phase 2: Jobs table + pipeline strip
- Phase 3: Wizard checklist + completion receipt
- Phase 4: Student hub and detail view refinement
- Phase 5: Automation features (LLM draft, auto-publish)

## 18) Relationship to Other Docs

- This is the end-goal design target.
- For current implementation status use:
  - docs/frontend-vision-alignment.md
  - docs/backend-frontend/backend-frontend-alignment.md
- For repo-wide rules, use docs/reference/agents-ssot.md

## 19) Design Constraints for Agents

Agents implementing this vision must:

- Preserve current functionality while adding guarded enhancements.
- Avoid introducing new backend fields without contracts.
- Update alignment docs after each phase of implementation.

End of document.
