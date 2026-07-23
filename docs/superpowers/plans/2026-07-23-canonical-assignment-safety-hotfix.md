# Canonical Assignment Safety Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reopen the canonical unfinished assignment when exact-source recovery collides, repair the
known prompt/draft mismatch without losing tutor text, and prevent either failure from recurring
while the approved long-term assignment-state upgrade remains pending.

**Architecture:** Preserve the v10 three-layer recovery/confirmation model. Add a typed backend
source-ownership conflict that carries the canonical session, resolve the known transcript-only
shell to that session on authoritative reads, and let the frontend hydrate it automatically. Harden
draft persistence so a draft is reused only for its owning prompt, validate prompt/draft recovery on
the backend, and lock incompatible authoring actions during generation.

**Tech Stack:** TypeScript 6, React 19, Fastify 5, PostgreSQL, Axios, Vitest, Testing Library, pnpm.

## Global Constraints

- This is a `release:patch` containment change.
- Do not add a migration or implement lifetime uniqueness for completed assignments in this hotfix.
- Do not implement automatic first-profile onboarding or the full server-owned generation command.
- Preserve browser buffer, durable backend recovery, and confirmed snapshots as distinct layers.
- Preserve tutor transcript, guidance, profile history, and draft text.
- Keep completed assignments immutable and all confirmation paths fail-closed.
- Use semantic errors beside the active CTA; never expose raw constraint or HTTP-only feedback.
- Follow TDD: each runtime behavior needs a failing regression observed before implementation.

---

### Task 1: Canonical source ownership conflict and partial-shell resolution

**Files:**

- Modify: `packages/batch-backend/src/domain/assignment-session-repository.ts`
- Modify: `packages/batch-backend/src/application/assignment-sessions.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts`
- Test: `packages/batch-backend/tests/domain.assignment-session-repository.test.ts`
- Test: `packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts`

**Interfaces:**

- Produces: `AssignmentSourceOwnershipConflictError` with code
  `ASSIGNMENT_SOURCE_ALREADY_OWNED` and the canonical `AssignmentSessionRecord`.
- Produces: HTTP `409 { code: "assignment_source_already_owned", session }`.
- Produces: authoritative session reads that resolve the incident's transcript-only empty shell to
  the unfinished canonical session for the same user, student, and recording.

- [ ] **Step 1: Write failing repository regressions**

Add database-backed tests that create two Student-confirmed sessions for one user/student, attach a
recording to the older session, and assert that attaching it to the newer session rejects with the
canonical session rather than a raw PostgreSQL error:

```ts
await expect(
  updateAssignmentSessionRecovery({
    id: newerSessionId,
    userId,
    expectedRevision: 1,
    patch: { recordingId, transcriptId },
  }),
).rejects.toMatchObject({
  code: 'ASSIGNMENT_SOURCE_ALREADY_OWNED',
  session: expect.objectContaining({ id: olderSessionId, recordingId }),
});
```

Add a regression for the observed persisted shape: newer session has `transcript_id` but no
`recording_id`; `getAssignmentSessionForUser()` returns the older canonical session after resolving
the transcript's recording.

- [ ] **Step 2: Run the backend regressions and verify RED**

Run:

```bash
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/domain.assignment-session-repository.test.ts
```

Expected: FAIL because the update leaks PostgreSQL `23505` and authoritative reads return the
newer shell.

- [ ] **Step 3: Implement the domain and application reconciliation**

Add the typed conflict:

```ts
export class AssignmentSourceOwnershipConflictError extends Error {
  readonly code = 'ASSIGNMENT_SOURCE_ALREADY_OWNED';

  constructor(readonly session: AssignmentSessionRecord) {
    super('This lesson source already belongs to another assignment.');
    this.name = 'AssignmentSourceOwnershipConflictError';
  }
}
```

When the named active-recording unique index rejects recovery, query the existing unfinished owner
for the same user and recording and throw the typed error. Do not translate unrelated unique
violations.

In `getAssignmentSessionForUser()`, resolve only this strict recovery alias:

```ts
const canResolvePartialSource =
  session.confirmedStep === 'student' &&
  session.recordingId === null &&
  session.transcriptId !== null &&
  session.promptPackageId === null &&
  session.draftId === null &&
  session.shareJobId === null;
```

Load the transcript, find the unfinished owner of its recording, and return it only when it belongs
to the same user and student. Otherwise return the requested session unchanged.

- [ ] **Step 4: Add and verify the HTTP semantic-conflict regression**

Mock `updateAssignmentSessionRecoveryForUser()` to reject with the typed shape and assert:

```ts
expect(response.statusCode).toBe(409);
expect(response.json()).toEqual({
  code: 'assignment_source_already_owned',
  session: canonicalSession,
});
```

Run:

```bash
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the backend reconciliation slice**

```bash
git add packages/batch-backend/src/domain/assignment-session-repository.ts \
  packages/batch-backend/src/application/assignment-sessions.ts \
  packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts \
  packages/batch-backend/tests/domain.assignment-session-repository.test.ts \
  packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts
git commit -m "fix(assignment): reconcile canonical lesson ownership"
```

### Task 2: Frontend canonical-session resume and actionable recovery feedback

**Files:**

- Modify: `packages/batch-frontend/src/utils/api.ts`
- Modify: `packages/batch-frontend/src/utils/api.assignment-recovery.test.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx`

**Interfaces:**

- Produces: `AssignmentSourceOwnershipApiError` with `canonicalSession`.
- Produces: `resume.openAssignmentSession(sessionId)` for authoritative hydration.
- Produces: tutor copy `This lesson already has an assignment. We reopened it.`.

- [ ] **Step 1: Write failing API and UI regressions**

Add an API test that returns the new 409 envelope and expects a typed error without transient retry:

```ts
await expect(updateAssignmentSessionRecovery('new-session', request)).rejects.toMatchObject({
  name: 'AssignmentSourceOwnershipApiError',
  canonicalSession: expect.objectContaining({ id: 'canonical-session' }),
});
```

Add UI regressions that:

1. reject a Source recovery write with the typed error;
2. fetch and hydrate the canonical session;
3. replace the query target with the canonical session ID;
4. show `This lesson already has an assignment. We reopened it.`; and
5. do not submit Source confirmation for the superseded shell.

Add a generic recovery failure regression that keeps the tutor on the current step and displays
`Could not save this step: <message>` beside `Confirm and continue`.

- [ ] **Step 2: Run the frontend regressions and verify RED**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/utils/api.assignment-recovery.test.ts \
  src/ui/minimal/MinimalAssignment.resume-basic.test.tsx \
  src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
```

Expected: FAIL because the 409 becomes a generic error and recovery cannot invoke authoritative
session hydration.

- [ ] **Step 3: Implement typed API parsing and authoritative resume**

Add:

```ts
export class AssignmentSourceOwnershipApiError extends Error {
  constructor(public readonly canonicalSession: AssignmentSession) {
    super('This lesson already has an assignment.');
    this.name = 'AssignmentSourceOwnershipApiError';
  }
}
```

Parse only `assignment_source_already_owned` with a complete `session`. Expose
`openAssignmentSession(sessionId)` from the resume controller and make it fetch the authoritative
session rather than trusting a cached resume-list row.

- [ ] **Step 4: Reconcile recovery and surface failures**

In `saveAssignmentSessionProgress()`:

```ts
if (error instanceof AssignmentSourceOwnershipApiError) {
  const opened = await resume.openAssignmentSession(error.canonicalSession.id);
  if (opened.ok) {
    setActiveStep(opened.destination);
    setAssignmentRecoveryNotice('This lesson already has an assignment. We reopened it.');
  }
  return null;
}
```

Track a separate recovery error for noncanonical failures, clear it on the next successful write,
and render it with `role="alert"` beside the primary CTA. When a ready transcript is recovered,
send `recordingId` and `transcriptId` together so future source writes do not manufacture the
incident's transcript-only shape.

- [ ] **Step 5: Run the focused frontend tests and verify GREEN**

Run the Step 2 command again.

Expected: PASS.

- [ ] **Step 6: Commit the frontend reconciliation slice**

```bash
git add packages/batch-frontend/src/utils/api.ts \
  packages/batch-frontend/src/utils/api.assignment-recovery.test.ts \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume.ts \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.test-harness.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.resume-rehydration.test-groups.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
git commit -m "fix(frontend): reopen canonical assignment sources"
```

### Task 3: Prompt/draft self-repair and recovery lineage guard

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`
- Modify: `packages/batch-backend/src/domain/assignment-session-repository.ts`
- Modify: `packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts`
- Test: `packages/batch-backend/tests/domain.assignment-session-repository.test.ts`
- Test: `packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts`

**Interfaces:**

- Produces: prompt-aware `persistDraftText()` behavior that only updates a draft owned by the target
  prompt.
- Produces: `ASSIGNMENT_RECOVERY_LINEAGE_INVALID` / HTTP
  `assignment_recovery_lineage_invalid` for illegal prompt/draft recovery.

- [ ] **Step 1: Write failing authoring regressions**

Extend the existing fresh-prompt regression to require:

```ts
expect(api.createDraft).toHaveBeenCalledWith('pkg-fresh', expect.any(String));
expect(api.updateDraft).not.toHaveBeenCalledWith('draft-1', expect.anything(), expect.anything());
```

Add a resumed-session regression with session prompt `pkg-fresh` and loaded draft owned by
`pkg-old`. Confirming Create must preserve its text, create a replacement draft under `pkg-fresh`,
recover the replacement ID, and confirm that pair.

- [ ] **Step 2: Run the prompt-editor test and verify RED**

Run:

```bash
pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/ui/minimal/MinimalAssignment.prompt-editor.test.tsx
```

Expected: FAIL because generated persistence updates the closure-captured old draft and hydrated
mismatches are considered clean.

- [ ] **Step 3: Implement prompt-aware persistence**

Make draft dirtiness include ownership mismatch:

```ts
const draftLineageMismatch = Boolean(
  state.promptPackage?.id &&
  state.draft?.id &&
  state.draft.promptPackageId !== state.promptPackage.id,
);
```

Extend the private persistence options with `promptPackageId` and `forceCreate`. Reuse a draft only
when its `promptPackageId` equals the target. Generated text always calls:

```ts
await persistDraftText(generated.text, {
  promptPackageId,
  forceCreate: true,
});
```

When a fresh prompt reaches session recovery, atomically set `draftId: null` unless the loaded draft
already belongs to that prompt. The replacement draft's later recovery write installs the valid
pair.

- [ ] **Step 4: Write and verify the backend lineage-guard RED test**

Create `Prompt A`, `Prompt B`, and `Draft A`. Assert that recovering `Prompt B + Draft A` rejects:

```ts
await expect(
  updateAssignmentSessionRecovery({
    id: sessionId,
    userId,
    expectedRevision,
    patch: { promptPackageId: promptB, draftId: draftA },
  }),
).rejects.toMatchObject({ code: 'ASSIGNMENT_RECOVERY_LINEAGE_INVALID' });
```

Run the Task 1 repository command and observe the expected failure.

- [ ] **Step 5: Implement the backend recovery guard and semantic route error**

Before applying a patch that touches `promptPackageId` or `draftId`, merge it with the current
recovery values. Permit no draft, or require that the draft exists, belongs to the current student,
and has `draft.promptPackageId === nextPromptPackageId`. Return HTTP 409 with
`assignment_recovery_lineage_invalid` for a mismatch.

- [ ] **Step 6: Run focused frontend and backend tests and verify GREEN**

Run the Task 1 and Task 2 focused commands plus the prompt-editor command.

Expected: PASS.

- [ ] **Step 7: Commit the lineage-hardening slice**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.authoring.ts \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx \
  packages/batch-backend/src/domain/assignment-session-repository.ts \
  packages/batch-backend/src/transport/extended-routes/auth-user-routes.ts \
  packages/batch-backend/tests/domain.assignment-session-repository.test.ts \
  packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts
git commit -m "fix(assignment): keep prompt and draft lineage atomic"
```

### Task 4: Serialize authoring controls and align current-behavior docs

**Files:**

- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx`
- Modify: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx`
- Test: `packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx`
- Modify: `packages/batch-frontend/README.md`
- Modify: `packages/batch-backend/README.md`

**Interfaces:**

- Produces: one `authoringOperationBusy` guard for generation-time editing, navigation, Back, and
  confirmation.

- [ ] **Step 1: Write the failing operation-lock regression**

Hold `generateDraft()` pending. After `Generate assignment`, assert that:

```ts
expect(screen.getByRole('textbox', { name: /Draft markdown/i })).toBeDisabled();
expect(screen.getByRole('button', { name: /Confirm and continue/i })).toBeDisabled();
```

Clicking Teaching context or Back must not leave Create. Resolve generation and assert the controls
become available with the new draft installed.

- [ ] **Step 2: Run the prompt-editor test and verify RED**

Run the Task 3 frontend command.

Expected: FAIL because the editor, workflow navigation, and CTA remain interactive.

- [ ] **Step 3: Implement the minimal operation lock**

Define:

```ts
const authoringOperationBusy = authoring.promptLoading || authoring.generatingDraft;
```

Include it in `continueDisabled`, return early from step requests and Back, and pass it to
`AssignmentStageSection` as `editorDisabled`. Do not disable ordinary autosave editing after the
operation settles.

- [ ] **Step 4: Update current-behavior package documentation**

Document only shipped containment behavior:

- exact-source conflicts reopen the canonical unfinished assignment;
- recovery rejects cross-prompt draft ownership;
- the frontend preserves draft text while repairing the known mismatch; and
- authoring controls lock during generation.

Keep lifetime completed-assignment uniqueness and the full automatic first-profile replacement in
the active product-design documents, not the package current-state sections.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Task 3 focused commands.

Expected: PASS.

- [ ] **Step 6: Commit the operation-lock slice**

```bash
git add packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.stages.tsx \
  packages/batch-frontend/src/ui/minimal/MinimalAssignment.prompt-draft.test-groups.tsx \
  packages/batch-frontend/README.md packages/batch-backend/README.md
git commit -m "fix(frontend): serialize assignment generation"
```

### Task 5: Validate and publish the patch PR

**Files:**

- Modify if formatting requires it: files already changed by Tasks 1 through 4.
- Verify: `docs/superpowers/plans/2026-07-23-canonical-assignment-safety-hotfix.md`

**Interfaces:**

- Produces: one ready `release:patch` PR targeting `main`.

- [ ] **Step 1: Run formatting and focused validation**

```bash
pnpm format:write
pnpm format
pnpm docs:check
pnpm --filter @esl-pipeline/batch-frontend exec vitest run \
  src/utils/api.assignment-recovery.test.ts \
  src/ui/minimal/MinimalAssignment.prompt-editor.test.tsx \
  src/ui/minimal/MinimalAssignment.resume-basic.test.tsx \
  src/ui/minimal/MinimalAssignment.workflow-ui.test.tsx
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/transport.http-server.integration.assignment-sessions.test.ts
pnpm exec vitest run --config vitest.config.ts --reporter=dot --maxWorkers=1 \
  packages/batch-backend/tests/domain.assignment-session-repository.test.ts
```

Expected: all commands exit zero.

- [ ] **Step 2: Run the normal pre-push gate**

```bash
pnpm run lint:repo-hygiene
pnpm --silent run check:fast:agent
```

Expected: exit zero. If the agent lane reports a broad-risk fallback, accept its completed
`check:pre-pr` evidence rather than rerunning it.

- [ ] **Step 3: Review scope and plan coverage**

```bash
git diff --check
git status --short
git diff origin/main...HEAD --stat
git log --oneline origin/main..HEAD
```

Confirm that the long-term architecture remains documentation-only and that no migration, contract
version, deployment file, or production state changed.

- [ ] **Step 4: Push and create the PR**

```bash
git push -u origin codex/canonical-assignment-safety-hotfix
gh pr create --base main --head codex/canonical-assignment-safety-hotfix \
  --title "fix(assignment): reconcile canonical lesson state" \
  --body-file .github/pull_request_template.md \
  --label release:patch
```

Populate the template's `Summary`, `Validation`, `Risk Notes`, and `Checklist` sections with only
commands actually run and observed production risks.

- [ ] **Step 5: Verify PR metadata and stop**

```bash
gh pr view --json number,url,state,isDraft,headRefName,baseRefName,labels
```

Expected: ready PR, base `main`, correct branch, and exactly one `release:patch` label. Do not
monitor CI unless the user asks.
