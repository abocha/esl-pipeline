# Assignment Step Confirmation Contract Design

## Meta

- Date: 2026-07-18
- Status: approved
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
2. **The system owns persistence and freshness.** Recoverable edits save automatically, data
   refreshes at defined lifecycle points, pending writes flush as part of confirmation, and manual
   Save or Refresh controls do not appear in the normal path.

Automatic recovery writes remain durable and useful, but they do not silently mark a step complete,
invalidate downstream work, or advance the confirmed workflow boundary. Each explicit confirmation
records one server-authoritative snapshot. Navigation occurs only after that confirmation succeeds.

This is a closed-alpha hard cutover. Pre-cutover assignment sessions are discarded rather than
migrated; testers restart unfinished work under the new contract. Completed jobs and handouts remain
available as outputs, but old editor state creates no compatibility obligation.

## Problem Statement

The current behavior contains six contract failures:

1. Student `Continue` selects a learner and navigates without creating a resumable assignment
   session.
2. Lesson source `Confirm and continue` can advance while transcript edits are still unsaved.
3. Teaching context has a real commit boundary, but dirty, saving, and failure states are not
   represented honestly in the shell.
4. Create `Confirm and continue` ignores a failed draft save and advances to Review & share.
5. Review & share composes materialization, approval, enqueue, and session cleanup in the frontend
   without one stable idempotent job identity.
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
- Explicit confirmation is reserved for semantic consequences, such as choosing authoritative input
  for downstream work or invalidating dependent draft state.

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
- Confirmed Share is terminal. A tutor who wants different inputs starts a new assignment instead of
  reopening or mutating the completed session.
- A later assignment may supersede the older result in presentation, but must not imply that its URL
  was deleted.

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

This adds a schema and contract surface, but directly satisfies the issue without replacing the
assignment architecture. It reuses the repository domains and job orchestration while starting
session and editable-artifact history cleanly at cutover.

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
5. Every session recovery mutation and confirmation uses an expected session revision; transcript
   and draft recovery writes use their expected working version.
6. Every successful session mutation returns the complete updated session and next revision.
7. Every failed confirmation preserves the active step and working input.
8. Automatic retries are bounded and idempotent.
9. A confirmation owns all downstream invalidation caused by the confirmed change.
10. Background effects may persist recovery state but may not advance `confirmedStep`.
11. A published URL is never revoked merely because the active lineage changes.
12. Routine Save and Refresh controls are absent from the primary workflow.

## Durable Session Model

### Replacement DTO contract

The persisted `AssignmentSessionStage` type is removed. `AssignmentSessionDto` becomes:

```ts
export type AssignmentConfirmedStep = 'student' | 'source' | 'context' | 'create' | 'share';

export type AssignmentInvalidatedArtifact = 'transcript' | 'prompt' | 'draft' | 'preview';

export interface ArtifactWorkingContentDto {
  workingVersion: number;
  contentHash: string;
}

export interface AssignmentConfirmedSnapshot {
  student: {
    studentId: string;
  };
  source: {
    lessonId: string | null;
    recordingId: string;
    transcriptId: string;
    transcriptWorkingVersion: number;
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
    draftWorkingVersion: number;
    draftRevisionId: string;
    draftHash: string;
  } | null;
}

export interface AssignmentSessionDto {
  // Top-level fields are the latest durable working/recovery state.
  revision: number;
  selectedProfileId: string | null;
  selectedProfileRevisionId: string | null;
  selectedProfileRevisionHash: string | null;
  confirmedStep: AssignmentConfirmedStep;
  confirmed: AssignmentConfirmedSnapshot;
  shareJobId: string | null;
}
```

The top-level student, recording, transcript, prompt-package, draft, settings, and note
fields remain the latest durable working snapshot. The nested `confirmed` object records the exact
dependencies accepted at each semantic boundary. This avoids duplicating complete artifact content
inside the session while allowing resume to compare working artifact hashes with confirmed hashes.

Resume destination is derived, never persisted. Initial hydration first selects the earliest step
whose durable recovery differs from its confirmed snapshot. With no dirty recovery, `confirmedStep`
maps `student → source`, `source → context`, `context → assignment`, and `create → review`.
`confirmedStep: 'share'` is completed work and resolves to the linked job rather than an editable
session destination.

### Database representation

The assignment-session table adds:

- `revision integer NOT NULL DEFAULT 1`
- `confirmed_step text NOT NULL`
- `confirmed_snapshot jsonb NOT NULL`
- `creation_request_id text NULL`
- `selected_profile_id text NULL`
- `selected_profile_revision_id uuid NULL`
- `selected_profile_revision_hash text NULL`
- `share_job_id uuid NULL`

`current_stage` and `archived_at` are removed. The first is derived state; the second duplicated
completion for a workflow whose successful Share is already terminal.

`share_job_id` is a foreign key to the existing jobs table and unique across sessions, so the
session can link exactly one job and no job can satisfy two Share operations. The client's Share
request UUID becomes this job ID; a separate persisted request ID would duplicate the same identity.

Transcripts and drafts gain `working_version integer` and `content_hash text`. Every automatic save
supplies the expected working version. The backend computes the content hash, writes a
content-addressed recovery object, and conditionally swaps the artifact's `storage_uri`, hash, and
`working_version`. A stale compare-and-swap leaves at most an unreferenced recovery object and cannot
overwrite the winning pointer.

Immutable `transcript_content_revisions` and `draft_content_revisions` are created only when Source
or Create is confirmed. A confirmation locks the current artifact working version, inserts one
immutable revision record referencing that content-addressed object, and stores its ID/hash in the
confirmed snapshot in the same database transaction as the session CAS. Each revision is unique by
artifact and source working version, so replay selects the existing record instead of fabricating a
second confirmation snapshot. Superseded unconfirmed recovery objects may remain unreachable; this
issue adds no garbage collector. Objects referenced by confirmed revisions are retained. This
preserves confirmation provenance and cross-tab safety without building permanent version history
for every debounce save.

`confirmed_snapshot` is an internal structured representation validated at the contracts and
application boundaries. It is not an untyped extension point; only the fields in
`AssignmentConfirmedSnapshot` are accepted. Student confirmation is the sole session-creation path,
so `confirmed_step` and `confirmed_snapshot.student` are non-null from the first persisted row.

The session revision increments on every successful session recovery mutation, confirmation, Share
reservation, and Share completion. Transcript/draft autosaves use their artifact working-version CAS
and do not increment the session merely because text changed.

### Closed-alpha cutover

The deployment is a hard workflow cutover, not a compatibility migration. Migration deletes every
pre-cutover assignment-session row, including unfinished and archived sessions. None of their
working state, stage, confirmation, or artifact lineage is imported into the new aggregate. Tutors
restart unfinished work by creating a new assignment.

Completed jobs, generated handouts, published URLs, and their referenced storage artifacts remain
readable as historical outputs. Pre-cutover transcripts, prompt packages, and drafts are not
converted into revisioned editor inputs and cannot be attached to or edited through a new assignment
session. Nullable working-version/hash columns exist only so rows referenced by historical jobs can
remain readable; all new transcript and draft creation paths must create content-addressed working
content with `working_version = 1` in the same operation.

Recording-cache reuse accepts only source transcripts with a non-null working version/hash and
creates a new content-addressed working object for the cloned recording. A pre-cutover null-version
cache hit is ignored rather than upgraded.

There is no legacy-session hydration, legacy artifact initialization, compatibility endpoint, data
repair UI, or migration-only Save/Refresh behavior. Old clients are unsupported after the coordinated
frontend/backend deployment. Cutover tests prove that sessions are removed, completed outputs remain,
and historical artifacts are not promoted; creation tests prove every new editable artifact starts
with a CAS-protected working version.

## Transport and Application Contract

### Step 1 creation

Student confirmation uses `POST /assignment-sessions/confirm-student`. The old general session-create
contract is removed in the same coordinated release:

```ts
export interface ConfirmStudentAssignmentSessionRequest {
  requestId: string;
  studentId: string;
  // Stored as working Source context, not as confirmed Student state.
  lessonId?: string | null;
}
```

Successful creation records the Student confirmed snapshot and returns `confirmedStep: 'student'`
plus the initial revision. The client derives Lesson source as the destination. Creation does not
require a recording.

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
    promptPackageId: string | null;
    draftId: string | null;
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

Recovery mutation cannot update `confirmedStep`, `confirmed`, or the Share reservation. It uses a
new `PATCH /assignment-sessions/:id/recovery` route. The existing revisionless generic PATCH route is
removed in the coordinated frontend/backend release. Retaining it would allow delayed clients to
bypass revision checks and mutate confirmed or artifact identities.
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
      transcriptWorkingVersion: number;
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
      draftWorkingVersion: number;
    };

export interface ConfirmAssignmentSessionStepResponse {
  session: AssignmentSessionDto;
  invalidated: AssignmentInvalidatedArtifact[];
}
```

The route is `POST /assignment-sessions/:id/confirm`. The application service validates ownership,
revision, step prerequisites, artifact ownership, and lineage. It then updates the confirmed
snapshot, clears dependent confirmed entries and active working references where required,
increments the revision, and returns the invalidation result in one database transaction.

The client echoes the server-issued working version from its successful autosave; it cannot declare
its own hash or immutable revision ID. Confirmation locks that artifact row and rejects the request
unless the working version is still current. It then inserts the immutable confirmed revision from
the server-owned storage URI/hash and records the new revision ID in the confirmed snapshot. A
delayed tab therefore cannot confirm content it did not see.

The confirmation endpoint never edits transcript or draft content. The frontend first flushes that
content through its existing artifact API, receives the durable working version/hash, then submits
the confirmation. If artifact persistence succeeds but confirmation fails, the CAS-protected working
content remains a safe recovery snapshot and the step remains unconfirmed.

If the client loses a successful confirmation response, it fetches the session automatically. When
the requested confirmed snapshot is already present, the client treats the confirmation as
successful without submitting another mutation. A different snapshot is handled as a revision
conflict.

### Share confirmation

Review & share uses a new backend orchestration route,
`POST /assignment-sessions/:id/share`, backed by one stable Share reservation on the session:

```ts
export interface ConfirmAssignmentSessionShareRequest {
  expectedRevision: number;
  requestId: string;
}
```

The first accepted request atomically creates one `awaiting_approval` job whose ID is the request
UUID and stores only `share_job_id` on the session. That existing job row is the sole durable Share
record; there is no second attempt table or duplicate request-ID column. The same request resumes
even when its original expected session revision is stale, while a different request conflicts.
While Share is pending, other session mutations fail with `SHARE_IN_PROGRESS` instead of racing the
final confirmed inputs.

The backend verifies that Source, Context, and Create recovery match their confirmed snapshots, then
inspects the reserved job. An `awaiting_approval` job is materialized idempotently from the immutable
URI in the confirmed Create revision, never from the draft's mutable working pointer, and approved.
A `queued` job is enqueued or re-enqueued using the same BullMQ job ID.
`running`, `succeeded`, or `failed` proves the queue previously accepted the stable job. A missing or
wrong-lineage linked job is an integrity error, not permission to create another. Existing job state
therefore supplies the retry state; there is no parallel five-state Share ledger.

After enqueue succeeds—or the job is already running/terminal—the backend sets
`confirmedStep: 'share'` and returns the session plus job. That is the terminal assignment event.
The session remains as provenance, is excluded from resumable-session lists, and is surfaced through
its linked job. There is no automatic archive, `archivePending`, archive endpoint, cleanup retry, or
post-Share session mutation. A lost response is recovered by repeating the same request or loading
the session/job; neither path can create a second job.

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
| Dirty state    | Working lesson, source identity, working version, or transcript hash differs from confirmed Source      |
| Primary action | `Confirm and continue`                                                                                  |
| Automatic work | Upload/paste persists immediately; transcript edits autosave; confirmation flushes any pending edit     |
| Confirmation   | Lesson/source accepted while the backend creates one immutable transcript revision from working content |
| Completion     | Confirmed Source snapshot exists for the active lineage                                                 |
| Resume         | Load latest recovery transcript; mark dirty if its hash differs from confirmed hash                     |
| Failure        | Stay on Lesson source with editor contents intact; retry safe saves automatically                       |
| Invalidation   | A changed confirmed lesson or source clears Context and Create                                          |

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
| Invalidation   | Changed confirmed notes or profile revision clear Create; source remains confirmed               |

The current teacher-note commit behavior is the implementation baseline. The new contract adds
visible dirty/saving/error state, revision checks, and backend-owned invalidation without moving
confirmation into keystroke handlers.

Profile confirmation resolves and stores an immutable `profileRevisionId` and its content hash.
Prompt-package generation receives that exact revision ID and must not re-resolve whichever profile
revision happens to be active later.

### Step 4: Create

| Concern        | Contract                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Editable state | Prompt-package selection, generation settings, and draft markdown                                 |
| Dirty state    | Working draft identity/hash differs from confirmed Create snapshot                                |
| Primary action | `Confirm and continue`                                                                            |
| Automatic work | Generated drafts persist automatically; edited drafts autosave; confirmation flushes pending text |
| Confirmation   | Prompt/draft accepted while the backend creates one immutable draft revision from working content |
| Completion     | Confirmed Create snapshot exists for the active lineage                                           |
| Resume         | Load latest recovery draft and mark it dirty when it differs from confirmed hash                  |
| Failure        | Stay on Create with markdown intact; never navigate on a null/failed save                         |
| Invalidation   | Changed confirmed draft clears derived Preview                                                    |

The standalone `Save draft` control is removed from the normal path. Validation errors remain
inline and prevent confirmation until the draft can be durably saved.

### Step 5: Review & share

| Concern        | Contract                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Editable state | Publish options and the preview derived from confirmed Create content                                                    |
| Dirty state    | Publish configuration is not durably recovered or no longer matches the confirmed Create snapshot                        |
| Primary action | `Share assignment`                                                                                                       |
| Automatic work | Flush settings; reserve one stable job ID; materialize, approve/enqueue, link, and begin asynchronous job-status updates |
| Confirmation   | `confirmedStep` becomes Share only after the stable approved job is enqueued or already running/terminal                 |
| Completion     | Confirmed Share is terminal; processing continues through the linked job                                                 |
| Resume         | Open the linked job, not the completed session editor                                                                    |
| Failure        | Preserve the stable job and request identity, inspect job state, and resume without creating a duplicate                 |
| Invalidation   | None after completion; changing inputs requires a new assignment and never revokes the existing handout                  |

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
  narrower value. Transcript and draft writes include their last server-issued working version.
- Confirmation cancels the pending timer, awaits the queued recovery write, and then submits the
  latest returned working version.
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

- Student, profile, and recent-assignment collections load on workflow entry and refresh once per
  window-focus return.
- A successful mutation applies its response locally and may refresh directly affected collections
  once after completion.
- Polling/SSE is limited to genuinely asynchronous recording/transcript and job states, and stops at
  terminal state.
- Stable collections and confirmed sessions have no background interval, reconnect loop, or
  speculative refresh timer.
- Manual refresh actions may exist under Support details for operator diagnosis, not as tutor-owned
  workflow responsibilities.

## Navigation and Dirty-State Behavior

- Back preserves working state and never confirms it.
- Selecting an earlier completed step preserves later confirmed snapshots until the tutor confirms
  an actual upstream change.
- Selecting a later step is allowed only through already confirmed boundaries. Dirty working state
  cannot be bypassed by clicking ahead.
- This stepper prerequisite is not a data-loss navigation guard. Route/browser exit protection is
  governed only by recovery durability and mutation certainty below.
- SPA navigation first flushes a pending unambiguous recovery write. A guard appears only while
  local changes are not durably recovered, a recovery write has exhausted retry, or a mutation's
  outcome is ambiguous because its response was lost.
- Durable recovery that is newer than confirmed truth does not trigger a route or browser warning;
  being unconfirmed is not itself a data-loss risk.
- Initial hydration selects the earliest step whose durable recovery state differs from confirmed
  truth: Lesson source, then Teaching context, then Create. If no step is dirty, it derives the
  destination from `confirmedStep`; confirmed Create naturally opens Review & share. Confirmed Share
  opens the linked job. Later saves, retries, artifact readiness, or job status updates never move
  the visible step.
- Confirmation and Share independently reject while any required upstream recovery state differs
  from its confirmed snapshot, even if a stale UI attempted to bypass the visible navigation guard.

## Invalidation and Supersession

The backend confirmation service owns this dependency table:

| Confirmed change                 | Clear from active confirmed snapshot |
| -------------------------------- | ------------------------------------ |
| Lesson, recording, or transcript | Context, Create                      |
| Teaching context                 | Create                               |
| Draft                            | Derived Preview                      |

Preview is derived frontend state and clears whenever its confirmed input hash changes. Working
recovery data that belongs to an invalidated downstream lineage is removed from the active session
only after the tutor accepts the destructive confirmation. Historical prompt packages, drafts,
jobs, HTML, and audio remain in their owning stores for traceability and existing-link continuity.

The confirmation response lists invalidated artifact categories so the frontend can clear matching
local state without reimplementing dependency decisions. The existing pure dependency helper may
remain as a presentation/test adapter, but backend results are authoritative.

Invalidating a later confirmed snapshot also regresses `confirmedStep` to the newly confirmed
boundary in the same conditional database update. Resume routing derives from that result.

Learner identity is immutable within an assignment session. Choosing a different learner creates a
new session and preserves the prior new-contract session as resumable history; there is no in-place
Student mutation or Student invalidation operation.

## Concurrency and Conflict Recovery

Every session mutation includes `expectedRevision`. Repository updates use a conditional predicate:

```sql
WHERE id = $1
  AND user_id = $2
  AND revision = $expected_revision
```

No matching row distinguishes not-found and revision-conflict outcomes at the application boundary.
A successful update increments the revision and returns the new session. A session with
`confirmedStep: 'share'` rejects every further recovery or confirmation mutation as completed.

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

Transcript and draft writes use the same conflict shape with `expectedWorkingVersion`. On artifact
conflict, the client fetches the latest working content automatically, preserves its local editor
buffer, and never proceeds to confirmation until the tutor-visible buffer corresponds to a
successful CAS write. Confirmed downstream consumers load the immutable revision ID from the
confirmed snapshot rather than the artifact's current working pointer.

## Error Presentation

Errors are attached to the operation the tutor attempted:

- Student: `We couldn't start this assignment yet. Your learner selection is still here.`
- Lesson source: `We couldn't confirm this lesson source yet. Your transcript is saved for retry.`
- Teaching context: `We couldn't confirm these teaching notes yet. Your edits are still here.`
- Create: `We couldn't confirm this draft yet. Your assignment text is still here.`
- Review & share: distinguish recovery, materialization, approval/enqueue, and linked-job processing
  failures without exposing raw internal identifiers in primary copy.

Busy CTAs remain disabled against duplicate submission. Error copy includes Retry only when a safe
automatic retry is no longer running. Support details may expose error codes and identifiers needed
for operator diagnosis.

## Component and Ownership Boundaries

- `packages/contracts/src/index.ts` owns public session, confirmation, revision, and response types.
- `packages/batch-backend/src/application/assignment-sessions.ts` owns Student creation and recovery
  orchestration.
- A focused step-confirmation service owns Source, Context, and Create prerequisites, immutable
  promotion, invalidation, idempotency, and conflict classification.
- A focused Share service owns stable-job reservation, job-state retry/re-enqueue, and terminal Share
  completion. The existing job row remains the sole durable attempt record.
- An artifact-content repository owns working-version CAS and confirmation-only immutable revision
  promotion.
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

## Hard Cutover and Release Boundary

- The frontend and backend deploy together. Old assignment clients and old session payloads are not
  supported after cutover.
- Every pre-cutover assignment session is deleted. There is no legacy resume path.
- Revisionless assignment create/PATCH, transcript update, and draft update contracts are removed.
- New sessions start revisioned; new transcripts and drafts start with CAS-protected working content
  and gain immutable revisions only at confirmation.
- Pre-cutover editor artifacts are historical/read-only and cannot enter a new assignment lineage.
- Completed jobs, published artifacts, and shared URLs are not rewritten or revoked.
- The change requires the repository's contract-version and DB-baseline verification commands.
- The release classification is `release:major`: incompatible payloads and mutations are intentionally
  removed because retaining them would weaken the new integrity contract.

## Test Contract

### Pure workflow tests

- Step status derives from confirmed snapshots, not readiness booleans.
- Recovery-only values produce dirty/current presentation without completion.
- Resume derives from earliest dirty durable recovery, then `confirmedStep`; no persisted stage is
  consulted.
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
- route/browser navigation warns only for unrecovered changes or ambiguous mutation outcome, not for
  durable-but-unconfirmed recovery;
- refresh/resume hydrates recovered values and distinguishes them from confirmed values;
- refresh selects the earliest dirty upstream step rather than a later confirmed destination;
- stable collections refresh only on load, focus return, or directly related mutation
  completion; only asynchronous recording/job work polls;
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
- Transcript and draft updates reject stale working versions without overwriting newer pointers.
- Delayed confirmation rejects an artifact working version changed by another tab.
- A newer transcript or draft autosave leaves every confirmed immutable revision readable and
  unchanged.
- Non-overlapping recovery retry cannot overwrite newer confirmed state.
- Duplicate idempotent confirmation returns the already-confirmed result.
- Share linking accepts only a job derived from the confirmed draft.
- Prompt generation uses the exact confirmed profile revision even if another revision becomes
  active before generation begins.
- Confirming a different profile revision invalidates confirmed Create state.
- Share retry after reservation, job creation/materialization, approval, enqueue, or response loss
  resumes from the stable session/job pair and never creates a second job.
- A queued job is safely re-enqueued with its stable BullMQ job ID; running/terminal job states do
  not enqueue again.
- Confirmed Share is excluded from resumable sessions, resolves to its linked job, and has no archive
  cleanup state.
- Cutover migration fixtures prove all old sessions are removed while completed jobs, handouts, and
  referenced historical artifacts remain readable.
- New transcript and draft creation fixtures always return working version `1` plus a server hash;
  old null-version artifacts are rejected as new-session inputs.

### Focused journey suite

One five-step suite covers a fresh assignment through Share plus representative failures:

1. Student creation failure and retry.
2. Dirty transcript autosave followed by Source confirmation.
3. Context invalidation cancellation, failure, and success.
4. Draft autosave followed by Create confirmation failure and retry.
5. Share interruption after reservation, job creation/materialization, approval, enqueue, or response
   loss.
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
4. Stable Share job linking, completed-session presentation, and full resume/conflict coverage.
5. Documentation synchronization, broad validation, and plan lifecycle closeout.

Each slice must begin with a focused failing test and end with an independently reviewable passing
state. Cross-cutting validation runs after the integrated branch is complete.

## Non-Goals

- Replacing React state management or rewriting the assignment frontend.
- Event sourcing or a general audit-log platform.
- Permanent revision history for every transcript/draft autosave.
- A new recovery-object garbage collector; unreachable content-addressed blobs are acceptable during
  closed alpha and can be cleaned by a later storage-maintenance task.
- Assignment-session archival or cleanup state after confirmed Share.
- Changing the five visible assignment steps or Step 1 entry presentation.
- Adding manual Save or Refresh responsibilities to compensate for unreliable automation.
- Deleting completed jobs, published handouts, shared HTML, or their required storage artifacts.
- Making pre-cutover transcripts, prompt packages, or drafts resumable/editable in the new workflow.
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
11. `currentStage` and session archival are absent; resume/completion derive from confirmed and
    recovery/job state.
12. Share succeeds only after the stable approved job is enqueued or already running/terminal, then
    remains completed without cleanup machinery.
13. Navigation guards only unrecovered or ambiguous work, and stable data refreshes only on load,
    focus, or mutation completion.
14. Existing stale-write, hydration, assignment-entry, and publish-order protections remain intact.
15. Focused and broad validation required by the repository contracts passes before PR readiness.
