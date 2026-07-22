# First-Profile Safety Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent assignment refresh from temporarily presenting an existing profile as absent or
persisting null profile lineage while the long-term first-profile onboarding replacement is pending.

**Architecture:** Treat the assignment session as the immediate authority for profile lineage during
resume. Track whether the asynchronous student-options lookup has resolved, and do not expose
empty-profile actions or declare empty lineage ready until either a complete session lineage is
pinned or that lookup has completed successfully.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, existing assignment-session recovery
and profile APIs.

## Global Constraints

- This is a frontend-only safety patch; do not change public DTOs, database schema, profile
  population semantics, or the long-term onboarding flow.
- Existing complete assignment-session profile lineage outranks the asynchronously loaded
  student-options list.
- Never persist a partial profile id/revision/hash triple.
- Do not display first-profile actions while profile authority is unresolved.
- Preserve the existing no-profile path after student options authoritatively resolve with no bound
  profile.
- Keep the long-term product design in `docs/design/FIRST_PROFILE_ONBOARDING.md`; do not implement it
  in this patch.

---

### Task 1: Lock the Refresh Regression

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-basic.test.tsx`

**Interfaces:**

- Consumes: `AssignmentSession.confirmed.context`, the existing resume query path, and mocked delayed
  `fetchStudentOptions()`.
- Produces: a regression proving confirmed profile lineage is visible and complete before student
  options resolve, with no false first-profile action or null-lineage recovery request.

- [x] **Step 1: Write the failing resume regression**

  Create a session whose mutable profile fields are null while `confirmed.context` contains a
  complete profile id/revision/hash. Delay `fetchStudentOptions()`, resume by `sessionId`, and assert:

  ```ts
  expect(api.getProfileContent).toHaveBeenCalledWith(confirmedContext.profileId);
  expect(screen.queryByRole('button', { name: /Populate first profile from lesson/i })).toBeNull();
  expect(screen.queryByText(/^First profile setup$/i)).toBeNull();
  ```

  After a local notes edit and recovery flush, assert every recovery request that carries profile
  fields carries the complete confirmed triple.

- [x] **Step 2: Run the test and verify RED**

  Run:

  ```bash
  pnpm --filter @esl-pipeline/batch-frontend test:unit -- \
    MinimalAssignment.resume-basic.test.tsx -t "keeps confirmed profile lineage authoritative"
  ```

  Expected: FAIL because the current resume snapshot derives the profile from the unresolved
  student-options list and exposes the empty-profile assistant.

### Task 2: Make Session Lineage Authoritative During Hydration

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.context.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.source.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`

**Interfaces:**

- Consumes: complete profile lineage from mutable recovery or `confirmed.context`, plus successful
  student-options resolution.
- Produces: hydrated profile id/revision/hash, `profileAuthorityResolved`, and
  `studentOptionsResolved` safety state.

- [x] **Step 1: Preserve profile lineage in the resume snapshot**

  Extend `HydratedAssignmentSnapshot` with optional revision id/hash and an authority flag. For
  sessions with confirmed Context, prefer a complete current triple and otherwise use the complete
  confirmed triple. Only fall back to `resolveBoundProfileId()` when no session-level profile
  authority exists.

- [x] **Step 2: Track successful student-options resolution**

  Add `studentOptionsResolved` to the source controller. It starts false and becomes true only after
  `fetchStudentOptions()` succeeds. A refresh failure preserves already loaded options but cannot
  turn an unresolved initial lookup into an authoritative empty result.

- [x] **Step 3: Gate Context readiness and first-profile visibility**

  Pass the source resolution state into the Context controller. Define readiness so that a complete
  pinned lineage is immediately safe, while empty/unstructured lineage is safe only after profile
  authority resolves. Require the same resolved state before rendering first-profile assistance.

- [x] **Step 4: Pass hydrated revision lineage into Context**

  Update `applyHydratedSnapshot()` in `MinimalAssignment.tsx` to pass the session-derived profile
  revision id/hash and authority flag. Existing recovery logic must omit profile fields while
  unresolved and persist only a complete triple once ready.

- [x] **Step 5: Run the focused regression and verify GREEN**

  Run the Task 1 command. Expected: PASS.

- [x] **Step 6: Run the focused assignment suites**

  ```bash
  pnpm --filter @esl-pipeline/batch-frontend test:unit -- \
    MinimalAssignment.resume-basic.test.tsx MinimalAssignment.workflow-ui.test.tsx \
    MinimalAssignment.prompt-editor.test.tsx
  pnpm --filter @esl-pipeline/batch-frontend typecheck
  ```

  Expected: all selected tests and TypeScript checks pass.

### Task 3: Synchronize Documentation and Validate the Patch

**Files:**

- Modify: `packages/batch-frontend/README.md`
- Verify: `docs/design/FIRST_PROFILE_ONBOARDING.md`
- Verify: `docs/operations/hosted-mvp-evidence.md`
- Verify: `docs/plans/student-profile-enrichment/README.md`
- Verify: `docs/reference/STUDENT_SYSTEM_ROADMAP.md`

**Interfaces:**

- Consumes: the implemented hydration safety behavior and the approved long-term product decision.
- Produces: current frontend behavior documentation plus fresh repository validation evidence.

- [x] **Step 1: Document the temporary frontend safety contract**

  Add a concise package README note that resume uses assignment-session profile lineage before
  asynchronous student discovery and that first-profile actions remain unavailable while authority
  is unresolved.

- [x] **Step 2: Self-review documentation**

  Check for placeholders, contradictions, private tutor/student identifiers, stale links, and any
  accidental long-term implementation plan. Confirm the incident record is anonymized and the
  design distinguishes one-time automatic enrichment from ongoing teacher-reviewed enrichment.

- [x] **Step 3: Run documentation and repository gates**

  ```bash
  pnpm docs:generate:indexes
  pnpm format
  pnpm docs:check
  pnpm run lint:repo-hygiene
  pnpm --silent run check:fast:agent
  ```

  Expected: all applicable gates pass. If the repository-wide formatter reports unchanged
  pre-existing files, keep them out of scope and record the exact failure in the PR validation.

- [x] **Step 4: Inspect the final diff**

  ```bash
  git diff --check
  git status --short
  ```

  Expected: only the safety implementation, its tests, the incident/design records, and directly
  affected documentation are present.
