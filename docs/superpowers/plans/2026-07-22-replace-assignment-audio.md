# Replace Assignment Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let tutors safely replace an uploaded recording within the same unfinished assignment and scheduled lesson.

**Architecture:** Extend the existing Source controller with explicit replacement UI state while reusing `uploadRecording` and transcript monitoring. Keep the old source until upload success, then let existing assignment recovery and Source confirmation perform durable lineage replacement and memory invalidation. Guard first-profile drafting with the confirmed Source authority captured at request time.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Fastify application/domain persistence, PostgreSQL.

## Global Constraints

- Do not add or change public DTOs, endpoints, contract versions, or migrations.
- Retain the current student, assignment session, and scheduled `lessonId`.
- Completed and Share-in-progress assignments remain immutable.
- Do not delete replaced recordings or transcript rows.
- Follow red-green-refactor for every production behavior change.

---

### Task 1: Replacement interaction and upload safety

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`

**Interfaces:**

- Consumes: existing `uploadRecording`, `SourceController`, `SourceStageSection`, and assignment-session recovery queue.
- Produces: `replacingAudio`, `beginAudioReplacement()`, and `cancelAudioReplacement()` on `SourceController`.

- [ ] **Step 1: Write the failing workflow test**

  Add a test that uploads source A, clicks `Replace audio`, uploads source B, verifies the same
  assignment session and lesson remain selected, and confirms Source with source B. Add a failure
  case proving source A stays visible when source B upload rejects.

- [ ] **Step 2: Run the focused test and verify RED**

  Run from `packages/batch-frontend`:
  `..\..\node_modules\.bin\vitest.CMD run src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx --testTimeout=30000`

  Expected: failure because `Replace audio` does not exist.

- [ ] **Step 3: Implement the minimal replacement state**

  Add explicit replacement state to the Source controller. During replacement upload, retain the
  current recording/transcript. On success clear only the replaced transcript state, adopt the new
  recording, and close replacement mode. On rejection or cancellation retain the old source.

- [ ] **Step 4: Add the inline product interaction**

  Render a secondary `Replace audio` action next to uploaded recording metadata. Reveal the existing
  drop zone inline while replacement mode is active and provide `Cancel replacement`. Do not expose
  the action when assignment-session writes are disallowed.

- [ ] **Step 5: Run the focused test and verify GREEN**

  Re-run the Step 2 command and expect all tests in the file to pass.

### Task 2: First-profile stale-source guard

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`

**Interfaces:**

- Consumes: the confirmed Source tuple `(recordingId, transcriptId, transcriptHash)`.
- Produces: an authority comparison that rejects stale population responses after replacement.

- [ ] **Step 1: Write the failing stale-response test**

  Start first-profile population for source A with a deferred response, replace the working source,
  resolve the old response, and assert that no `Approve profile draft` action is shown.

- [ ] **Step 2: Run the focused group and verify RED**

  Run from `packages/batch-frontend`:
  `..\..\node_modules\.bin\vitest.CMD run src/ui/minimal/MinimalAssignment.test.tsx --testTimeout=30000`

  Expected: failure because the stale response currently installs the draft.

- [ ] **Step 3: Implement the authority guard**

  Capture the confirmed Source tuple before population. After the response, compare it with the
  current confirmed Source and working recording. Ignore the result when authority changed.
  Suppress the first-profile assistant during replacement mode or upload.

- [ ] **Step 4: Re-run the focused test and verify GREEN**

  Re-run the Step 2 command and expect all relevant first-profile tests to pass.

### Task 3: Documentation and complete verification

**Files:**

- Modify: `packages/batch-frontend/README.md`
- Verify: `packages/batch-backend/tests/application.assignment-step-confirmation.test.ts`

**Interfaces:**

- Consumes: existing Source confirmation invalidation contract.
- Produces: durable operator-facing behavior documentation.

- [ ] **Step 1: Document replacement behavior**

  State that unfinished assignments can replace uploaded audio in place, retain lesson/session
  linkage, and supersede old lesson memory only when the replacement Source is confirmed.

- [ ] **Step 2: Run focused frontend and backend tests**

  Run the affected frontend test file from its package and the named PostgreSQL confirmation test
  proving source A is superseded when source B is confirmed.

- [ ] **Step 3: Run formatting and the affected gate**

  Run `pnpm format:write`, `pnpm format`, `pnpm run lint:repo-hygiene`, and
  `pnpm --silent run check:fast:agent`. Inspect generated artifacts on any failure.

- [ ] **Step 4: Review the diff and commit**

  Run `git diff --check`, inspect `git diff`, then commit with
  `feat(assignments): replace uploaded lesson audio`.
