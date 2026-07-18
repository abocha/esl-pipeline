# Assignment Step Confirmation Contract Design

## Meta

- Date: 2026-07-18
- Status: approved direction, awaiting written-spec review
- Scope: durable confirmation, recovery persistence, invalidation, resume, and failure semantics for
  the five-step assignment workflow
- Issue: [#141](https://github.com/abocha/esl-pipeline/issues/141)
- Delivery: one short-lived feature branch with review-gated implementation slices
- Branch: `codex/issue-141-confirmed-step-contract`
- Deployment: excluded; production deployment requires a separate explicit request

## Summary

The five-step assignment workflow presents Student, Lesson source, Teaching context, Create, and
Review & share as tutor-owned decisions. The current persistence model does not consistently match
that presentation. Some data saves through dedicated controls, some saves in background effects,
some primary actions only navigate, and completion is inferred from artifact readiness rather than
successful confirmation.

This design separates two responsibilities:

1. **The tutor owns semantic decisions.** A step's primary action confirms the intended learner,
   source, context, draft, or share operation.
2. **The system owns persistence and freshness.** Recoverable edits save automatically, routine data
   refreshes automatically, pending writes flush as part of confirmation, and manual Save or Refresh
   controls do not appear in the normal path.

Automatic recovery writes remain durable and useful, but they do not silently mark a step complete,
invalidate downstream work, or advance the confirmed workflow boundary. Each explicit confirmation
records one server-authoritative snapshot. Navigation occurs only after that confirmation succeeds.

## Problem Statement

The current behavior contains six contract failures:

1. Student `Continue` selects a learner and navigates without creating a resumable assignment
   session.
2. Lesson source `Confirm and continue` can advance while transcript edits are still unsaved.
3. Teaching context has a real commit boundary, but dirty, saving, and failure states are not
   represented honestly in the shell.
4. Create `Confirm and continue` ignores a failed draft save and advances to Review & share.
5. Review & share can report publish success even when the prerequisite draft save returns no saved
   draft, and session archive failure is not distinguished from successful job approval.
6. The shell's global `Saved` label means only that a session object exists; it does not describe
   the visible step's recovery or confirmation state.

The backend compounds these UI mismatches. Assignment-session PATCH writes are partial,
last-writer-wins updates without an expected revision. A same-tab promise queue reduces local
interleaving but cannot prevent stale writes from another tab or delayed client. Artifact
invalidation is partly described by a pure frontend helper and partly implemented in individual
handlers rather than owned by one authoritative backend operation.

## Product Principles

### The tutor owns decisions; the system owns mechanics

- The tutor must never perform routine Save followed by Continue.
- The tutor must never refresh routine collections, processing status, or resumable data manually.
- The primary CTA expresses intent and automatically flushes every safe prerequisite write.
- Automatic retry is preferred when the desired outcome remains unambiguous.
- A visible Retry action appears only after bounded automatic recovery is exhausted.
- Explicit confirmation is reserved for semantic consequences, such as invalidating downstream
  work or replacing the working lineage after an assignment has already been shared.

### Recovery is not confirmation

- Automatic persistence protects work from refresh, navigation, crashes, and intermittent network
  failures.
- Confirmation declares which durable values downstream steps may rely on.
- A recovery snapshot may be newer than the confirmed snapshot.
- Resuming newer recovery data must preserve it as an editable dirty buffer rather than silently
  treating it as confirmed.

### Existing shared work is immutable history

- Changing upstream inputs never silently revokes an already shared handout.
- An existing handout remains accessible at its existing URL.
- The current working lineage becomes stale and requires explicit regeneration and republishing.
- The UI may call the older result superseded, but must not imply that its URL was deleted.

## Alternatives Considered

### Frontend-only confirmation coordinator

Keep the existing assignment-session DTO and PATCH endpoint. Add step-specific frontend handlers
that await the current save functions before navigating.

This is the smallest change and would fix the immediate Lesson source and Create navigation bugs.
It does not establish server-authoritative confirmation, cannot distinguish recovery from confirmed
truth after refresh, leaves invalidation scattered, and does not prevent cross-tab stale writes.

### Session-backed confirmations with revision control (selected)

Keep automatic artifact persistence, add a typed confirmed snapshot and monotonic session revision,
and route every step confirmation through one backend application boundary. Recovery mutations and
confirmations both use expected revisions. The confirmation operation owns confirmed-state changes,
workflow advancement, and downstream invalidation.

This adds a migration and contract surface, but directly satisfies the issue without replacing the
assignment architecture. It preserves current repositories, artifacts, and job orchestration while
making their ownership explicit.

### Immutable workflow event ledger

Append every edit, save, confirmation, invalidation, and publish transition as an immutable event
and derive the current assignment state from the event stream.

This provides the strongest audit trail, but introduces event versioning, projection, replay, and
operational complexity that the closed-alpha workflow does not need. It is outside the issue's
bounded scope.

## Terminology

- **Working state:** the newest local or durably recovered values visible in the editor.
- **Recovery write:** an automatic durable write that protects working state without confirming it.
- **Confirmed snapshot:** the server-authoritative values downstream steps may consume.
- **Confirmed step:** the latest step whose primary confirmation completed successfully.
- **Dirty:** working state differs from the confirmed snapshot for the visible step.
- **Current stage:** the resume destination immediately after the latest confirmed step.
- **Invalidation:** removal of confirmed downstream dependencies from the active lineage.
- **Superseded handout:** a previously shared immutable artifact that no longer represents the
  active working lineage.

## Global Invariants

1. Only an explicit tutor action may change the visible step after initial hydration.
2. Back and completed-step navigation never commit working state.
3. A forward transition never occurs before its step confirmation succeeds.
4. Artifact readiness may enable a confirmation action, but never marks a step confirmed.
5. Every recovery mutation and confirmation uses an expected session revision.
6. Every successful session mutation returns the complete updated session and next revision.
7. Every failed confirmation preserves the active step and working input.
8. Automatic retries are bounded and idempotent.
9. A confirmation owns all downstream invalidation caused by the confirmed change.
10. Background effects may persist recovery state but may not advance `currentStage`.
11. A published URL is never revoked merely because the active lineage changes.
12. Routine Save and Refresh controls are absent from the primary workflow.

## Durable Session Model

### Backward-compatible DTO additions

`AssignmentSessionDto` gains:

```ts
export type AssignmentConfirmedStep = 'student' | 'source' | 'context' | 'create' | 'share';

export type AssignmentInvalidatedArtifact =
  | 'transcript'
  | 'prompt'
  | 'draft'
  | 'preview'
  | 'publishedJob';

export interface AssignmentConfirmedSnapshot {
  student: {
    studentId: string;
  } | null;
  source: {
    lessonId: string | null;
    recordingId: string;
    transcriptId: string;
    transcriptRevisionId: string;
    transcriptHash: string;
  } | null;
  context: {
    teacherNotes: string | null;
    profileId: string | null;
    profileRevisionId: string | null;
    profileRevisionHash: string | null;
  } | null;
  create: {
    promptPackageId: string;
    draftId: string;
    draftRevisionId: string;
    draftHash: string;
  } | null;
  share: {
    jobId: string;
    approvedAt: string;
    requestId: string;
  } | null;
}

export interface AssignmentSessionDto {
  // Existing fields remain available as the latest durable working/recovery state.
  revision: number;
  transcriptContentRevisionId: string | null;
  draftContentRevisionId: string | null;
  selectedProfileId: string | null;
  selectedProfileRevisionId: string | null;
  selectedProfileRevisionHash: string | null;
  confirmedStep: AssignmentConfirmedStep | null;
  confirmed: AssignmentConfirmedSnapshot;
}
```

The existing top-level student, recording, transcript, prompt-package, draft, settings, and note
fields remain the latest durable working snapshot. The nested `confirmed` object records the exact
dependencies accepted at each semantic boundary. This avoids duplicating complete artifact content
inside the session while allowing resume to compare working artifact hashes with confirmed hashes.

`currentStage` remains in the public DTO for compatibility, but its meaning becomes strict: it is
the resume destination derived from the latest successful confirmation. Recovery writes cannot set
it.

| Confirmed operation | `confirmedStep` | Resulting `currentStage`                              |
| ------------------- | --------------- | ----------------------------------------------------- |
| None                | `null`          | `source` is not exposed because no session exists yet |
| Student             | `student`       | `source`                                              |
| Lesson source       | `source`        | `context`                                             |
| Teaching context    | `context`       | `assignment`                                          |
| Create              | `create`        | `review`                                              |
| Share               | `share`         | `review` until automatic archival completes           |

### Database representation

The assignment-session table adds:

- `revision integer NOT NULL DEFAULT 1`
- `confirmed_step text NULL`
- `confirmed_snapshot jsonb NOT NULL`
- `creation_request_id text NULL`
- `transcript_content_revision_id uuid NULL`
- `draft_content_revision_id uuid NULL`
- `selected_profile_id text NULL`
- `selected_profile_revision_id uuid NULL`
- `selected_profile_revision_hash text NULL`

The implementation also adds immutable `transcript_content_revisions` and
`draft_content_revisions` records. Each record owns a unique revision ID, parent artifact ID,
revision-specific storage URI, server-computed content hash, and creation time. Transcript and draft
heads point to their latest revision IDs.

Every content update supplies the expected head revision ID. The backend writes the proposed
content to a new revision-specific storage key, then conditionally inserts the revision record and
swaps the artifact head only when the expected head still matches. A failed compare-and-swap can
leave only an unreferenced immutable object, which scheduled storage cleanup may remove; it can
never overwrite the current or confirmed object. Any revision referenced by a confirmed assignment
snapshot is retained. Assignment-session revisioning cannot protect content stored in separate
mutable records, so immutable artifact revisions are part of the same contract.

`confirmed_snapshot` is an internal structured representation validated at the contracts and
application boundaries. It is not an untyped extension point; only the fields in
`AssignmentConfirmedSnapshot` are accepted.

The revision increments on every successful recovery mutation, confirmation, share link, and
archive. Incrementing recovery writes matters because cross-tab recovery changes can otherwise be
silently overwritten by a confirmation based on an older working snapshot.

### Existing-session migration

Existing active sessions remain resumable. Migration derives the minimum confirmed boundary from
their current stage only after validating the complete ownership and lineage chain:

- `source`: confirm Student when `student_id` exists; preserve recording fields as working recovery
  data.
- `context`: confirm Student and Lesson source when the recording belongs to the student and the
  transcript belongs to that recording.
- `assignment`: confirm Student, Lesson source, and Teaching context; preserve prompt/draft fields as
  working recovery data only when the selected profile belongs to the student.
- `review`: confirm through Create only when the prompt package belongs to the same student/source
  lineage and the draft belongs to that prompt package.

If a legacy row has missing or mismatched ownership—even when every referenced ID exists—migration
chooses the highest lower valid boundary instead of manufacturing confirmation. Migration tests
include cross-student recording, cross-recording transcript, cross-profile context, cross-prompt
draft, and complete valid fixtures. Archived sessions and historical jobs remain untouched.

## Transport and Application Contract

### Step 1 creation

Student confirmation uses a new `POST /assignment-sessions/confirm-student` route so the existing
general create contract remains backward-compatible during rollout:

```ts
export interface ConfirmStudentAssignmentSessionRequest {
  requestId: string;
  studentId: string;
  // Stored as working Source context, not as confirmed Student state.
  lessonId?: string | null;
}
```

Successful creation records the Student confirmed snapshot, returns `confirmedStep: 'student'`,
`currentStage: 'source'`, and the initial revision. It does not require a recording.

The frontend creates one UUID `requestId` when the tutor begins the confirmation attempt and reuses
it for automatic and manual retries. `creation_request_id` is unique per user. Repeating a completed
request with the same learner returns the existing owned session instead of creating another empty
session. Reusing the request ID with different learner or lesson recovery data returns a conflict.

### Recovery mutation

Automatic persistence uses:

```ts
export interface UpdateAssignmentSessionRecoveryRequest {
  expectedRevision: number;
  patch: Partial<{
    lessonId: string | null;
    recordingId: string | null;
    transcriptId: string | null;
    transcriptContentRevisionId: string | null;
    promptPackageId: string | null;
    draftId: string | null;
    draftContentRevisionId: string | null;
    publishTarget: PublishTarget | null;
    selectedTtsProvider: TtsProviderId | null;
    selectedTtsStrategy: TtsStrategy | null;
    selectedTtsModel: string | null;
    selectedPreset: string | null;
    selectedGenerationProvider: GenerationProvider | null;
    selectedGenerationModel: string | null;
    teacherNotes: string | null;
    selectedProfileId: string | null;
    selectedProfileRevisionId: string | null;
    selectedProfileRevisionHash: string | null;
  }>;
}
```

Recovery mutation cannot update `currentStage`, `confirmedStep`, `confirmed`, or a share job link.
It uses a new `PATCH /assignment-sessions/:id/recovery` route. The existing revisionless generic
PATCH route is removed after the assignment frontend migrates in the same release. Retaining it
would allow delayed clients to bypass revision checks and mutate canonical stage or artifact IDs.
This is an intentional breaking contract change and therefore requires a major release.

### Step confirmation

Steps 2 through 4 use one discriminated request:

```ts
export type ConfirmAssignmentSessionStepRequest =
  | {
      step: 'source';
      expectedRevision: number;
      lessonId: string | null;
      recordingId: string;
      transcriptId: string;
      transcriptRevisionId: string;
    }
  | {
      step: 'context';
      expectedRevision: number;
      teacherNotes: string | null;
      profileId: string | null;
      profileRevisionId: string | null;
      profileRevisionHash: string | null;
    }
  | {
      step: 'create';
      expectedRevision: number;
      promptPackageId: string;
      draftId: string;
      draftRevisionId: string;
    };

export interface ConfirmAssignmentSessionStepResponse {
  session: AssignmentSessionDto;
  invalidated: AssignmentInvalidatedArtifact[];
}
```

The route is `POST /assignment-sessions/:id/confirm`. The application service validates ownership,
revision, step prerequisites, artifact ownership, and lineage. It then updates the confirmed
snapshot, clears dependent confirmed entries and active working references where required, advances
`currentStage`, increments the revision, and returns the invalidation result in one database
transaction.

Transcript and draft hashes are computed by the backend from immutable durable revisions. The
client identifies the artifact and echoes the server-issued revision ID from its successful write;
it cannot declare its own hash. Confirmation loads that exact revision and rejects the request if
it is not the artifact's current working head, preventing a delayed tab from confirming content it
did not see while retaining older confirmed content.

The confirmation endpoint never edits transcript or draft content. The frontend first flushes that
content through its existing artifact API, receives the durable artifact and hash, then submits the
confirmation. If artifact persistence succeeds but confirmation fails, the artifact remains a safe
recovery snapshot and the step remains unconfirmed.

If the client loses a successful confirmation response, it fetches the session automatically. When
the requested confirmed snapshot is already present, the client treats the confirmation as
successful without submitting another mutation. A different snapshot is handled as a revision
conflict.

### Share confirmation

Review & share uses a new backend orchestration route,
`POST /assignment-sessions/:id/share`, backed by a durable share-attempt state machine:

```ts
export interface ConfirmAssignmentSessionShareRequest {
  expectedRevision: number;
  requestId: string;
}
```

The database adds `assignment_session_share_attempts` keyed uniquely by `(session_id, request_id)`.
An attempt stores one reserved job ID and advances through `reserved`, `materialized`, `approved`,
`enqueued`, and `linked`. The reservation is committed before materialization or queue side effects.

The backend verifies that no Source, Context, or Create recovery state is newer than its confirmed
snapshot. It then reserves one job ID, materializes the confirmed draft into that job, approves it,
enqueues that stable job ID, and records the job, approval time, and `requestId` in
`confirmed.share`. The existing approval application boundary is made retry-aware: if the database
job is already queued but the attempt is not marked enqueued, retry enqueues the same BullMQ job ID
instead of creating or approving another job.

Repeating a request resumes from its stored attempt state and returns the already-linked job after
completion. Share-attempt lookup includes archived sessions even though normal resume lists do not.
Only after the durable job link exists does the UI report Share as successful.

Session archival follows automatically as idempotent cleanup. An archive failure does not turn a
confirmed Share into failure; the frontend retries it in the background and on the next
authenticated assignment-workflow load. An unarchived session with confirmed Share is presented as
completed, not as duplicate unfinished work. If the Share or archive response is lost, lookup by
`requestId` recovers the attempt and linked job even after archival. The attempt ledger prevents
duplicate materialization or enqueueing during cleanup recovery.

## Per-Step Product Contract

### Step 1: Student

| Concern        | Contract                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Editable state | New-versus-resume choice and one valid learner selection                                                                                  |
| Dirty state    | A selected learner not yet represented by a created session                                                                               |
| Primary action | `Continue`                                                                                                                                |
| Automatic work | Ensure learner data is current; create the session with the selected learner                                                              |
| Confirmation   | Successful session creation with confirmed Student snapshot                                                                               |
| Completion     | `confirmedStep` is Student or later                                                                                                       |
| Resume         | Opens Lesson source for the confirmed learner                                                                                             |
| Failure        | Stay on Student, preserve selection, retry safe transient failure automatically, then show Retry                                          |
| Invalidation   | Learner identity is immutable per session; selecting another learner creates a new session and preserves the old one as resumable history |

The existing mutually exclusive Resume/New entry-state design remains authoritative. This change
adds durable behavior to New `Continue`; it does not redesign Step 1 presentation.

### Step 2: Lesson source

| Concern        | Contract                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Editable state | Uploaded/pasted source and transcript editor buffer                                                     |
| Dirty state    | Working lesson, source identity, transcript revision, or transcript hash differs from confirmed Source  |
| Primary action | `Confirm and continue`                                                                                  |
| Automatic work | Upload/paste persists immediately; transcript edits autosave; confirmation flushes any pending edit     |
| Confirmation   | Lesson, recording, transcript, server-issued transcript revision, and transcript hash accepted together |
| Completion     | Confirmed Source snapshot exists for the active lineage                                                 |
| Resume         | Load latest recovery transcript; mark dirty if its hash differs from confirmed hash                     |
| Failure        | Stay on Lesson source with editor contents intact; retry safe saves automatically                       |
| Invalidation   | A changed confirmed lesson or source clears Context, Create, and Share but does not revoke old handouts |

The normal UI no longer exposes `Save existing transcript`, `Save transcript edits`, or Refresh.
Those operations become automatic. Error recovery exposes one contextual Retry only after automatic
attempts fail.

### Step 3: Teaching context

| Concern        | Contract                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------ |
| Editable state | Teacher notes and the exact selected learner profile owned by this step                          |
| Dirty state    | Working notes, profile ID, revision ID, or revision hash differs from confirmed Context          |
| Primary action | `Confirm and continue`                                                                           |
| Automatic work | Recovery-save notes without changing confirmed truth                                             |
| Confirmation   | Persist notes plus profile identity/version and confirm downstream invalidation once when needed |
| Completion     | Confirmed Context snapshot exists for the active lineage                                         |
| Resume         | Load recovery notes/profile and compare them with the confirmed notes/profile version            |
| Failure        | Stay on Teaching context, preserve notes and downstream artifacts, show bounded Retry            |
| Invalidation   | Changed confirmed notes or profile revision clear Create and Share; source remains confirmed     |

The current teacher-note commit behavior is the implementation baseline. The new contract adds
visible dirty/saving/error state, revision checks, and backend-owned invalidation without moving
confirmation into keystroke handlers.

Profile confirmation resolves and stores an immutable `profileRevisionId` and its content hash.
Prompt-package generation receives that exact revision ID and must not re-resolve whichever profile
revision happens to be active later.

### Step 4: Create

| Concern        | Contract                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Editable state | Prompt-package selection, generation settings, and draft markdown                                    |
| Dirty state    | Working draft identity/hash differs from confirmed Create snapshot                                   |
| Primary action | `Confirm and continue`                                                                               |
| Automatic work | Generated drafts persist automatically; edited drafts autosave; confirmation flushes pending text    |
| Confirmation   | Prompt package, draft, server-issued draft revision, and durable draft hash accepted together        |
| Completion     | Confirmed Create snapshot exists for the active lineage                                              |
| Resume         | Load latest recovery draft and mark it dirty when it differs from confirmed hash                     |
| Failure        | Stay on Create with markdown intact; never navigate on a null/failed save                            |
| Invalidation   | Changed confirmed draft clears Preview and Share confirmation; historical handouts remain accessible |

The standalone `Save draft` control is removed from the normal path. Validation errors remain
inline and prevent confirmation until the draft can be durably saved.

### Step 5: Review & share

| Concern        | Contract                                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Editable state | Publish options and the preview derived from confirmed Create content                                                                        |
| Dirty state    | Preview or publish configuration no longer matches the confirmed Create snapshot                                                             |
| Primary action | `Share assignment`                                                                                                                           |
| Automatic work | Refresh preview when derivation is obvious; flush recovery settings; materialize, approve/enqueue, link job, refresh status, archive session |
| Confirmation   | Session durably records the approved job derived from the confirmed draft                                                                    |
| Completion     | Confirmed Share snapshot exists; processing may continue visibly                                                                             |
| Resume         | Open Review & share and resume automatic job status updates                                                                                  |
| Failure        | Preserve the approved job if one exists, retry idempotently, and never materialize a duplicate merely because linking or cleanup failed      |
| Invalidation   | Later upstream confirmation supersedes this lineage but does not revoke the shared URL                                                       |

`Start another assignment` remains the explicit action that leaves completed work and returns to
Student. Job processing status continues to update automatically through the existing polling/SSE
path. A routine Refresh status control is not part of the normal surface.

Prompt-package and draft generation consume confirmed Student, Source, and Context snapshots.
Preview and Share consume the confirmed Create snapshot. These surfaces may display newer recovery
state for editing, but they must not consume an unconfirmed lesson, transcript, profile revision,
teacher note, or draft.

## Automatic Persistence and Freshness

### Recovery scheduling

- Text inputs debounce recovery writes using the existing cadence unless focused tests justify a
  narrower value. Transcript and draft writes include their last server-issued content revision ID.
- Confirmation cancels the pending timer, awaits the queued recovery write, and then submits the
  latest returned revision.
- Upload, pasted-transcript creation, generation, and materialization persist immediately because
  they already create durable server artifacts.
- The shell reports `Saving changes`, `Changes saved`, `Confirming`, `Retrying`, or a contextual
  error from real mutation state. It never derives `Saved` from session existence.

### Automatic retry

- Retry only idempotent reads and writes with an idempotency key or stable artifact identity.
- For transient network, HTTP 429, and HTTP 5xx failures, make at most three total attempts with
  delays of 250 ms and 1 second. Honor a server `Retry-After` value up to 5 seconds instead.
- Do not retry validation, authorization, ownership, or revision-conflict errors blindly.
- After retry exhaustion, retain working state and show one contextual Retry action.
- Raw provider or transport diagnostics remain under Support details.

### Automatic refresh

- Student and recent-assignment collections load automatically on entry.
- Job and transcript processing states continue their existing automatic polling/SSE behavior.
- A successful mutation updates the local session from its response; it does not require a follow-up
  manual refresh.
- Returning focus or reconnecting may refresh stale collections automatically when the existing
  cache policy permits it.
- Manual refresh actions may exist under Support details for operator diagnosis, not as tutor-owned
  workflow responsibilities.

## Navigation and Dirty-State Behavior

- Back preserves working state and never confirms it.
- Selecting an earlier completed step preserves later confirmed snapshots until the tutor confirms
  an actual upstream change.
- Selecting a later step is allowed only through already confirmed boundaries. Dirty working state
  cannot be bypassed by clicking ahead.
- Leaving the assignment route with unconfirmed working state triggers an assignment navigation
  guard. It does not appear for clean recovery state.
- Browser refresh does not warn when the newest working state is already durably recovered.
- Initial hydration selects the earliest step whose durable recovery state differs from confirmed
  truth: Lesson source, then Teaching context, then Create, then Review & share. If no step is dirty,
  it uses `currentStage`. Later saves, retries, artifact readiness, or job status updates never move
  the visible step.
- Confirmation and Share independently reject while any required upstream recovery state differs
  from its confirmed snapshot, even if a stale UI attempted to bypass the visible navigation guard.

## Invalidation and Supersession

The backend confirmation service owns this dependency table:

| Confirmed change                 | Clear from active confirmed snapshot |
| -------------------------------- | ------------------------------------ |
| Lesson, recording, or transcript | Context, Create, Share               |
| Teaching context                 | Create, Share                        |
| Draft                            | Share                                |

Preview is derived frontend state and clears whenever its confirmed input hash changes. Working
recovery data that belongs to an invalidated downstream lineage is removed from the active session
only after the tutor accepts the destructive confirmation. Historical prompt packages, drafts,
jobs, HTML, and audio remain in their owning stores for traceability and existing-link continuity.

The confirmation response lists invalidated artifact categories so the frontend can clear matching
local state without reimplementing dependency decisions. The existing pure dependency helper may
remain as a presentation/test adapter, but backend results are authoritative.

Invalidating a later confirmed snapshot also moves `confirmedStep` and `currentStage` back to the
newly confirmed boundary. This regression is part of the same conditional database update; the
session can never claim a later confirmed step after its required snapshot was cleared.

Learner identity is immutable within an assignment session. Choosing a different learner creates a
new session and preserves the old session as resumable history; there is no existing-session Student
mutation or Student invalidation operation.

## Concurrency and Conflict Recovery

Every session mutation includes `expectedRevision`. Repository updates use a conditional predicate:

```sql
WHERE id = $1
  AND user_id = $2
  AND archived_at IS NULL
  AND revision = $expected_revision
```

No matching row distinguishes not-found, archived, and revision-conflict outcomes at the
application boundary. A successful update increments the revision and returns the new session.

On conflict:

1. Fetch the latest session automatically.
2. If the local operation is a recovery write and the touched fields do not conflict, rebase and
   retry once.
3. If there are no local dirty buffers, replace local state with the latest confirmed/recovery
   snapshot automatically.
4. If local dirty values overlap newer remote values, preserve the local buffer, keep the current
   step selected, and show that newer saved work was found.
5. Retry confirmation only after the user has reviewed the preserved value; never silently discard
   either side.

The same-tab promise queue and hydration-version guards remain in place. Revision control extends
their protection across tabs and delayed clients rather than replacing them.

Transcript and draft writes use the same conflict shape with their own
`expectedContentRevisionId`.
On artifact conflict, the client fetches the latest content automatically, preserves its local
editor buffer, and never proceeds to step confirmation until the tutor-visible buffer corresponds
to a successful server-issued immutable revision. Confirmed downstream consumers load the exact
revision ID from the confirmed snapshot rather than the artifact's mutable head pointer.

## Error Presentation

Errors are attached to the operation the tutor attempted:

- Student: `We couldn't start this assignment yet. Your learner selection is still here.`
- Lesson source: `We couldn't confirm this lesson source yet. Your transcript is saved for retry.`
- Teaching context: `We couldn't confirm these teaching notes yet. Your edits are still here.`
- Create: `We couldn't confirm this draft yet. Your assignment text is still here.`
- Review & share: distinguish draft save, materialization, approval, job-link, and processing
  failures without exposing raw internal identifiers in primary copy.

Busy CTAs remain disabled against duplicate submission. Error copy includes Retry only when a safe
automatic retry is no longer running. Support details may expose error codes and identifiers needed
for operator diagnosis.

## Component and Ownership Boundaries

- `packages/contracts/src/index.ts` owns public session, confirmation, revision, and response types.
- `packages/batch-backend/src/application/assignment-sessions.ts` owns confirmation orchestration,
  prerequisites, invalidation, idempotency, and conflict classification.
- `packages/batch-backend/src/domain/assignment-session-repository.ts` owns transactional conditional
  updates and revision increments.
- Assignment-session transport routes authenticate, validate payload shape, and map conflicts to
  HTTP 409 without duplicating domain decisions.
- `packages/batch-frontend/src/ui/assignments/assignment-workflow.ts` owns pure presentation mapping
  from confirmed/recovery state to step status and dirty state.
- A focused frontend confirmation controller owns timer flushing, mutation sequencing, retry state,
  and navigation results. It must not duplicate backend invalidation rules.
- `MinimalAssignment.tsx` remains the composition root during this work, but step confirmation
  sequencing should move out of its generic `handleFocusedContinue` branch into the focused
  controller.
- Existing source, authoring, resume, and publish modules retain artifact-specific persistence and
  hydration responsibilities.

This scope does not authorize a general frontend state-management replacement or unrelated
`MinimalAssignment` decomposition.

## Compatibility and Release Boundary

- Response DTO additions are backward-compatible for readers that ignore new fields.
- `currentStage` remains present and retains its resume-routing role.
- Revisionless assignment-session PATCH is replaced by revision-aware recovery and confirmation
  operations after the frontend cutover. Transcript and draft update requests also gain mandatory
  expected content revisions.
- The migration preserves every active session at the highest dependency-complete legacy boundary.
- Historical jobs and published artifacts are not rewritten.
- The change requires the repository's contract-version and DB-baseline verification commands.
- The expected release classification is `release:major`: revisionless session, transcript, and
  draft mutations are intentionally removed because retaining them would bypass the new integrity
  contract. The implementation plan must include the contract-version bump and coordinated
  frontend/backend cutover in the same release.

## Test Contract

### Pure workflow tests

- Step status derives from confirmed snapshots, not readiness booleans.
- Recovery-only values produce dirty/current presentation without completion.
- Back and initial hydration mappings remain user-owned and deterministic.
- The invalidation presentation adapter matches backend invalidation categories.

### Frontend integration tests

For every step, prove:

- confirmation success advances exactly once;
- automatic prerequisite persistence completes before confirmation;
- failed persistence or confirmation stays on the current step;
- working input survives failure and Retry;
- Back never initiates confirmation, advancement, invalidation, or a forced save; an already
  scheduled recovery write may finish normally;
- forward navigation cannot bypass dirty unconfirmed state;
- refresh/resume hydrates recovered values and distinguishes them from confirmed values;
- refresh selects the earliest dirty upstream step rather than a later confirmed destination;
- Share remains blocked when any required upstream recovery state is dirty;
- automatic retry does not duplicate artifacts or submissions;
- visible save state reflects real operations rather than session existence.

Retain and strengthen existing tests for teacher-note invalidation, stale autosave responses,
user-owned navigation, Step 1 entry states, resume hydration, and publish ordering. Assertions must
continue to follow the visible UI route and primary action rather than calling internal handlers.

### Backend and repository tests

- Student confirmation creates a session without a recording.
- Confirmation validates artifact ownership and lineage.
- Each step advances only from satisfied prerequisites.
- Each confirmed change clears exactly its dependent confirmed entries.
- A stale expected revision returns a conflict without mutation.
- Transcript and draft updates reject stale content revisions without overwriting newer text.
- Delayed confirmation rejects an artifact revision changed by another tab.
- A newer transcript or draft autosave leaves every confirmed immutable revision readable and
  unchanged.
- Non-overlapping recovery retry cannot overwrite newer confirmed state.
- Duplicate idempotent confirmation returns the already-confirmed result.
- Share linking accepts only a job derived from the confirmed draft.
- Prompt generation uses the exact confirmed profile revision even if another revision becomes
  active before generation begins.
- Confirming a different profile revision invalidates confirmed Create and Share state.
- Share retry after reservation, materialization, approval, enqueue, link, response loss, and archive
  resumes one durable attempt and never creates a second job.
- Queued-but-not-enqueued recovery re-enqueues the stable reserved job ID safely.
- Migration fixtures validate ownership and lineage, including mismatched-but-existing IDs, and fall
  back conservatively.

### Focused journey suite

One five-step suite covers a fresh assignment through Share plus representative failures:

1. Student creation failure and retry.
2. Dirty transcript autosave followed by Source confirmation.
3. Context invalidation cancellation, failure, and success.
4. Draft autosave followed by Create confirmation failure and retry.
5. Share interruption after reservation, materialization, approval, enqueue, link, response loss,
   or archive cleanup.
6. Refresh/resume at every confirmed boundary.
7. Refresh with dirty recovered Source or Context beneath confirmed Create returns to the earliest
   dirty step and blocks Share.
8. Cross-tab session and artifact revision conflicts with preserved local input.

## Documentation Impact

Implementation updates:

- `packages/batch-frontend/README.md`: confirmed steps, automatic recovery, navigation, and status
  behavior.
- `packages/batch-backend/README.md`: assignment-session confirmation, revision, and conflict
  ownership.
- `docs/backend-frontend/backend-frontend-alignment.md`: sessions own working and confirmed
  pre-publish state; jobs own materialized/published runs.
- `docs/reference/TESTING_GUIDELINES.md` only if a new reusable cross-package test lane is added.
- Contract version and generated indexes required by the repository admin workflow.

The July 10 and July 11 workflow specs remain historical design evidence. This spec supersedes their
assumptions where artifact readiness, frontend-only invalidation, or existing session persistence
was treated as sufficient confirmation.

## Implementation Slices

The detailed implementation plan will preserve these reviewer gates:

1. Contract types, migration, revision-aware repository operations, and backend confirmation tests.
2. Frontend confirmation controller plus Student and Lesson source behavior.
3. Teaching context and Create alignment, including automatic transcript/draft persistence and
   removal of routine Save controls.
4. Share job linking, idempotent cleanup, supersession behavior, and full resume/conflict coverage.
5. Documentation synchronization, broad validation, and plan lifecycle closeout.

Each slice must begin with a focused failing test and end with an independently reviewable passing
state. Cross-cutting validation runs after the integrated branch is complete.

## Non-Goals

- Replacing React state management or rewriting the assignment frontend.
- Event sourcing or a general audit-log platform.
- Changing the five visible assignment steps or Step 1 entry presentation.
- Adding manual Save or Refresh responsibilities to compensate for unreliable automation.
- Deleting historical prompt packages, drafts, jobs, HTML, or audio.
- Automatically revoking shared URLs.
- Redesigning Student, Business, Templates, authentication, or unrelated Calm Studio surfaces.
- Changing generation, STT, TTS, storage-provider, or manifest semantics.
- Deploying to production from the design or implementation task.

## Completion Criteria

1. Every step has one explicit server-observable confirmation boundary matching its primary CTA.
2. A step becomes complete only after confirmation succeeds.
3. Automatic recovery persists obvious work without requiring routine Save or Refresh actions.
4. Navigation alone never commits, invalidates, or advances confirmed state.
5. Dirty working state is visibly distinct from confirmed state.
6. Failed commits preserve input, stay on the current step, retry safely, and expose bounded recovery.
7. Refresh and resume restore the newest durable recovery snapshot while identifying whether it is
   newer than confirmed truth.
8. Backend-owned confirmation performs downstream invalidation exactly once.
9. Existing shared handouts remain accessible when a newer lineage supersedes them.
10. Session revisions prevent cross-tab last-writer-wins loss.
11. Share succeeds only after the approved/enqueued job is durably linked to the session.
12. Archive cleanup failure cannot create duplicate jobs or falsely erase a successful Share.
13. Existing stale-write, hydration, assignment-entry, and publish-order protections remain intact.
14. Focused and broad validation required by the repository contracts passes before PR readiness.
