# Issue #266 Implementation Plan: Canonical Lesson-Source Ownership

## Meta

- Status: `active`.
- Last Verified Against: 2026-09-23 issue #266 implementation branch.
- Exit Trigger: archive after the implementation pull request merges.
- Current Focus: implement and validate lifetime canonical assignment-source ownership.

## Goal

Make lesson-source ownership a durable backend invariant:

> Within one tutor + student scope, one canonical lesson source can have at most one canonical assignment/session owner at a time.

Re-selecting a currently owned canonical source resumes that assignment, including after Share.

A successful confirmed source replacement transfers ownership to the replacement source and releases the previous source. The released source may later become canonical for another assignment.

Jobs, reruns, corrections, publication attempts, and generated outputs remain descendants of an assignment. They are not assignment identities and do not participate in source ownership.

This change is the prerequisite for #264 first-profile onboarding.

---

# 1. Approved product and data decisions

## 1.1 Assignment identity and job identity are separate layers

The ownership relationship is:

```text
lesson source <-> canonical assignment/session
```

Jobs live below it:

```text
assignment/session
  -> J0
     -> J1
     -> J2
     -> ...
```

Each job may produce an output or no output.

A rerun, correction, output repair, failed job, or new published artifact never creates a second canonical assignment identity.

Do not change existing job ancestry to implement #266.

## 1.2 Audio source identity

For uploaded audio, canonical lesson-source identity is based on the immutable prepared-media SHA-256 already produced by the media-preparation path.

Provider choice, STT model, transcript ID, transcript edits, speaker mapping, and generated transcript content do not define lesson identity.

Persist the identity explicitly rather than treating `recording_id` as source identity.

The fingerprint scheme itself becomes a compatibility contract. Future media-preparation changes that alter canonical bytes must either preserve the previous fingerprint semantics or deliberately version/migrate the scheme.

Do not implement acoustic similarity or fuzzy media matching.

## 1.3 Manual transcript source identity

A pasted transcript is the historical teacher/student dialogue from a lesson, not a description or note.

Before hashing, canonicalize conservatively:

- Unicode NFC;
- line endings normalized to LF;
- outer whitespace trimmed;
- internal whitespace preserved;
- punctuation preserved;
- speaker labels preserved;
- case preserved;
- no semantic or fuzzy normalization.

Persist a SHA-256 of this immutable acquired representation separately from the editable transcript hash.

Tutor corrections after acquisition do not change lesson-source identity.

Within tutor + student scope, re-pasting identical canonicalized transcript content means re-selecting the same lesson source.

## 1.4 Source modalities remain distinct

Audio fingerprint identity and pasted-transcript fingerprint identity are separate namespaces.

#266 does not attempt to infer that an uploaded audio file and a separately pasted transcript describe the same real-world lesson.

No audio-to-text semantic matching is in scope.

## 1.5 Confirmed replacement transfers ownership

Given assignment `S` with confirmed source `A`:

```text
A -> S   canonical
```

Selecting candidate replacement `B` does not release A.

Before confirmation:

```text
A -> S   confirmed canonical
B -> S   working candidate
```

Only successful Source confirmation changes authority:

```text
A -> released
B -> S   confirmed canonical
```

After release, A may later become canonical for another assignment.

Failure, cancellation, navigation, stale writes, or an unconfirmed replacement must not release A.

Any historical evidence that A was once attached to S is nonauthoritative audit/history only. It must not reserve A indefinitely.

## 1.6 Historical duplicate conflicts use best-effort cutover

After #266, runtime/database invariants must prevent new ownership conflicts.

Existing alpha-era conflicts do not block rollout.

When historical data presents several assignment candidates for the same source identity, choose one canonical owner deterministically:

1. shared/completed substantive assignment;
2. otherwise an assignment with that source actually confirmed;
3. otherwise a working-only attachment;
4. earliest assignment by creation time;
5. stable assignment ID as final tie-breaker.

Preserve every losing assignment, job, publication, transcript, and artifact.

Do not merge, delete, or rewrite losing historical content.

Only the selected winner receives canonical ownership.

Record automatic resolutions and retain a narrow operator remap path.

---

# 2. Core source identity representation

## 2.1 Add immutable identity fields to source artifacts

Extend the recording/source representation with immutable identity metadata conceptually equivalent to:

```text
source_identity_kind
source_fingerprint_scheme
source_fingerprint
```

Expected kinds:

```text
audio
manual_transcript
```

The exact names should follow current repository conventions.

For new audio acquisitions:

- derive the source fingerprint from canonical prepared-media SHA-256.

For new manual transcript acquisitions:

- derive it from the canonicalized original pasted content.

These values must not change when:

- transcript working content changes;
- STT is retried;
- another STT provider/model is used;
- speaker mapping changes;
- retained audio is deleted;
- lesson-memory generation runs.

`transcripts.content_hash` remains working-content identity and must not double as lesson-source identity.

Update:

- recording domain model/repository;
- migrations;
- `schema.sql`;
- current schema/baseline fixtures;
- affected API/contract projections where required.

## 2.2 Version the fingerprint scheme

Store a scheme/version alongside the fingerprint rather than assuming a SHA-256 column alone permanently defines semantics.

The uniqueness tuple is based on:

```text
source_identity_kind
source_fingerprint_scheme
source_fingerprint
```

This prevents a future media/canonicalization algorithm change from silently colliding incompatible identities.

---

# 3. Canonical assignment-source bindings

## 3.1 Add a narrow ownership table

Introduce a dedicated table such as `assignment_source_bindings`.

It owns current canonical/working assignment ownership, not historical attachment history.

Conceptual fields:

```text
id
workspace_id
user_id
student_id
assignment_session_id

source_identity_kind
source_fingerprint_scheme
source_fingerprint

binding_role          -- confirmed | working

recording_id
transcript_id

created_at
updated_at
```

Row existence represents active ownership/claim.

Do not add a generic lesson-source aggregate unless implementation evidence proves it necessary.

## 3.2 Database invariants

PostgreSQL must enforce:

### One owner per scoped source identity

At most one active binding for:

```text
user
student
source kind
fingerprint scheme
fingerprint
```

A source cannot be working/confirmed in competing assignments.

### One confirmed source per assignment

At most one `confirmed` binding for one assignment session.

### One distinct working source per assignment

At most one `working` binding for one assignment session.

### No duplicate slot for the same identity

If the selected source identity is already the session's confirmed source, do not create a second `working` row.

## 3.3 Persist source identity in confirmed assignment provenance

New confirmed Source snapshots must carry the immutable source identity tuple in addition to existing exact artifact lineage:

```text
source identity
recording ID
transcript ID
transcript working version/hash
storage/provenance data already required
```

This allows canonical readers to distinguish:

- source identity;
- exact artifact/transcript version used by the assignment.

New Source confirmation requires classified source identity.

Historical confirmed snapshots may temporarily lack it if safe reconstruction is impossible.

---

# 4. Artifact lineage is distinct from source identity

## 4.1 Fresh owner gets fresh recording/transcript lineage

A released source may later be owned by a different assignment, but the new owner must not reuse the old assignment's recording/transcript lineage.

Example:

```text
S confirms A using recording RA / transcript TA

S later confirms B
A becomes unowned

S1 later acquires A
```

S1 must receive fresh artifact lineage:

```text
same source fingerprint A
new recording RA2
new transcript TA2
```

Do not reactivate RA/TA as S1's assignment artifacts.

This is required because lesson-memory identity currently depends on transcript/hash lineage. Reusing TA could revive a superseded memory intent from S and allow late work from S to satisfy S1.

## 4.2 Use existing cloning mechanisms where appropriate

For uploaded audio:

- reuse current media/transcript cache cloning machinery where compatible;
- preserve the same source fingerprint;
- create fresh recording/transcript IDs for the new assignment ownership lineage.

For manual transcript acquisition:

- a newly reacquired released source naturally creates fresh recording/transcript lineage from the newly pasted canonical content.

For direct attachment of an existing artifact:

- never attach artifact lineage previously confirmed by another assignment directly to a new owner;
- materialize fresh recording/transcript lineage before attachment;
- preserve the same immutable source fingerprint.

If pre-attachment cloning creates a candidate that then loses an ownership race, clean/retire it using existing compensation patterns rather than transferring old lineage.

## 4.3 Same assignment may change artifact lineage without changing source identity

A session may confirm a different recording/transcript instance carrying the same source fingerprint.

That does not release/reclaim source ownership.

Instead:

- update the binding's artifact lineage;
- update confirmed Source provenance;
- apply normal transcript/hash-dependent downstream invalidation where required.

Source identity remains constant.

---

# 5. Acquisition and attachment are separate boundaries

## 5.1 Keep acquisition intermediate

Do not extend the long-running upload/STT acquisition transaction with assignment-session mutation.

Audio upload and manual transcript ingestion remain source-artifact acquisition operations.

They may determine the immutable source fingerprint and produce a candidate recording/transcript.

They are not considered attached to the assignment yet.

## 5.2 Add an explicit assignment-source attachment command

Introduce an authenticated command conceptually equivalent to:

```text
attach source candidate to assignment session
```

Input includes:

- assignment session ID;
- expected assignment revision;
- candidate recording ID;
- candidate transcript ID.

The backend derives source identity from durable source metadata.

The frontend does not send an authoritative fingerprint.

## 5.3 Attachment is atomic

Inside one PostgreSQL transaction:

1. lock/load the assignment session;
2. validate expected revision;
3. validate workspace/student/candidate lineage;
4. derive source identity;
5. reject unclassified source identity;
6. check canonical ownership;
7. resolve current confirmed/working binding state;
8. claim/switch the working binding as required;
9. update session recovery recording/transcript pointers;
10. increment/return authoritative session revision;
11. commit.

Replace any previous wording such as "atomically where practical".

Binding and recovery-pointer update must commit in the same PostgreSQL transaction.

## 5.4 Attachment result

The product-facing result is discriminated:

```text
source_attached
existing_assignment_resumed
```

`source_attached` may be returned only after the binding and recovery pointers have committed together.

`existing_assignment_resumed` returns the authoritative owning assignment/session.

Raw uniqueness errors never reach the tutor.

## 5.5 Editor mutation is blocked until attachment resolves

The frontend must not begin treating an acquired candidate as the session's editable source until attachment resolves.

Before `source_attached`:

- do not install candidate structural lineage into assignment state;
- do not start source-specific recovery writes;
- do not allow transcript/source mutations as if ownership were established.

If `existing_assignment_resumed` is returned, discard the losing local structural path and hydrate the canonical session.

---

# 6. Acquisition behavior

## 6.1 Audio upload

Keep the current durable recording-upload operation protocol:

- browser operation UUID;
- attempt ownership;
- expiry;
- candidate isolation;
- storage compensation;
- durable completion/polling.

After media preparation computes the fingerprint, lookup canonical ownership.

If currently owned:

- stop unnecessary downstream STT/cache-clone work where practical;
- durably complete/reconcile the upload operation as `existing_assignment_resumed`;
- return the canonical assignment.

If unowned:

- produce fresh candidate recording/transcript lineage;
- return it as an intermediate candidate;
- immediately perform the explicit attachment command from the assignment flow.

The tutor-facing source-selection operation is not complete until attachment resolves.

## 6.2 Concurrent first acquisitions

Two different upload operation UUIDs may concurrently acquire identical audio before either sees an owner.

It is acceptable for redundant candidate artifacts to exist transiently.

The attachment binding uniqueness constraint is the final canonical serialization point.

Do not introduce a second distributed lock solely to eliminate every redundant media/STT operation.

The loser:

- receives `existing_assignment_resumed`;
- must retire/clean its unused candidate through existing bounded cleanup/compensation.

## 6.3 Manual transcript acquisition

Before persistence:

1. canonicalize original input;
2. compute immutable source fingerprint;
3. check current ownership.

If already owned:

- return `existing_assignment_resumed`;
- do not create unnecessary recording/transcript artifacts.

If unowned:

- create fresh manual recording/transcript lineage with immutable source identity;
- attach it through the explicit attachment command.

Concurrent identical pastes must converge at database ownership rather than relying on check-then-insert timing.

---

# 7. Lost responses and idempotency

Acquisition replay and assignment attachment are deliberately separate concerns.

## 7.1 Acquisition replay

Audio upload polling/retry replays only the durable acquisition result:

- candidate artifact;
- or existing canonical assignment outcome.

It must never silently perform a new assignment attachment on replay.

## 7.2 Attachment reconciliation

If the attachment HTTP response is lost after commit:

- reload authoritative assignment/session state;
- inspect current working/confirmed source identity and binding ownership;
- if the candidate is already attached to that session, reconcile success;
- if assignment revision/source ownership has subsequently changed, do not re-execute the old attachment blindly.

A stale expected revision remains a conflict.

This distinction prevents an old acquisition result from becoming a new attachment after the tutor has already moved the session to another source.

---

# 8. Binding transition rules

The implementation must explicitly cover these state transitions.

## 8.1 Selecting the already-confirmed source

If fingerprint A is already confirmed by S:

```text
A confirmed -> S
```

selecting A again:

- reuses the confirmed binding;
- creates no working binding;
- does not release/reclaim ownership;
- returns the authoritative current session.

## 8.2 Returning from working B to confirmed A

Given:

```text
A confirmed -> S
B working   -> S
```

selecting A:

- releases B's working claim;
- preserves A's confirmed binding;
- restores recovery pointers to the confirmed A artifact lineage;
- does not create a new binding for A.

## 8.3 Confirming different artifact lineage with same fingerprint

Given source fingerprint A with a new recording/transcript instance:

- keep the existing source ownership;
- update binding artifact lineage;
- update confirmed Source snapshot;
- perform transcript/hash-dependent invalidation normally;
- do not release/reacquire A.

## 8.4 Confirming different fingerprint B

Given:

```text
A confirmed -> S
B working   -> S
```

successful B confirmation atomically:

- promotes B to confirmed;
- releases A;
- clears the working slot;
- updates confirmed Source snapshot;
- performs existing downstream invalidation/memory reconciliation.

Failure rolls back the complete transition.

## 8.5 Share and working claims

Share must not leave a distinct working source claim stranded.

If a different working source exists:

- Share is not allowed to proceed as though the old confirmed source were the only state.

Resolve/reject according to current dirty/recovery semantics.

A redundant same-identity working state should not be representable.

## 8.6 Confirmation replay does not bypass ownership

Canonical ownership checks run before any "identical Source confirmation" replay shortcut.

A historical nonowner must not regain authority because its requested snapshot happens to equal its old confirmed snapshot.

Idempotent replay applies only after current ownership has been established for that session.

---

# 9. Source confirmation transaction

Source confirmation remains the semantic ownership-transfer boundary.

Within the current Source confirmation transaction:

1. lock the assignment session;
2. load and validate transcript;
3. validate recording/student/workspace ownership;
4. require classified immutable source identity;
5. check canonical assignment-source binding before replay shortcuts;
6. determine whether this is:
   - same confirmed identity;
   - working identity promotion;
   - different identity replacement;
7. validate exact recording/transcript/version/hash lineage;
8. update confirmed Source snapshot;
9. update/promote binding and release old binding as one transaction;
10. invalidate downstream Context/Create state as already required;
11. reconcile lesson-memory authority;
12. commit.

Direct confirmation must not bypass attachment ownership.

If a caller somehow presents a candidate source owned by another session, return the canonical session outcome or a semantic ownership error suitable for reconciliation.

---

# 10. Lesson-memory identity and authority

## 10.1 Add assignment ownership to new lesson-memory intents

Extend lesson-memory provenance so new lesson-memory intents know the assignment session whose confirmed Source authorized them.

Conceptually add:

```text
assignment_session_id
```

to lesson-memory entries/provenance.

New Source confirmations always populate it.

This is an authority field, not merely diagnostic metadata.

Historical rows may be nullable during migration where ownership cannot be reconstructed safely.

## 10.2 New owner gets a new memory lineage

Because a released source reused by another assignment receives fresh recording/transcript IDs:

```text
S / A / TA
```

and later:

```text
S1 / A / TA2
```

cannot collide on the existing transcript/hash memory identity.

Do not revive S's superseded lesson-memory row for S1.

## 10.3 Worker commit revalidates assignment authority

Before a lesson-memory worker publishes `ready` output, validate that:

- the memory row still belongs to its assignment session;
- that assignment session still owns the relevant source identity;
- its confirmed Source still matches exact recording/transcript/content hash authority;
- the lesson-memory row is still the current pending intent.

If any authority changed:

- do not publish it as canonical ready memory;
- supersede/discard according to current worker semantics.

## 10.4 Regression: late A worker versus S1

Required race test:

```text
S confirms A
worker for S/A begins

S confirms B
A is released

S1 acquires identical A
S1 receives fresh artifact lineage
S1 confirms A

old S/A worker completes late
```

The old worker must not:

- satisfy S1's pending memory intent;
- become canonical for S1;
- re-enter a canonical student-memory snapshot.

S1's memory is generated from S1's own exact confirmed lineage.

---

# 11. Canonical student-memory reads

Canonical memory reads must derive source authority from assignment ownership, not merely from a stored `ready` status.

For new lesson-memory rows:

- require valid `assignment_session_id`;
- require the row's exact source provenance to remain confirmed by that session;
- require that session to remain canonical owner of that source identity.

A row belonging to a historical nonowner is not canonically eligible even if it remains `ready`.

Update snapshot eligibility/read predicates accordingly.

This makes authority changes immediately visible to readers without relying exclusively on cleanup mutations.

---

# 12. Historical nonowner sessions

Historical conflict resolution creates one winner and zero or more preserved nonowners.

## 12.1 Read behavior

Historical nonowners remain readable.

Preserve:

- confirmed snapshots;
- drafts;
- jobs;
- publication history;
- existing rendered outputs.

Do not fabricate new ownership merely to make history look cleaner.

## 12.2 Mutation behavior

A historical nonowner cannot use its nonowned source to:

- reconfirm Source;
- replay lesson-memory intent;
- generate new assignment content;
- confirm downstream authoring based on that source;
- initiate a new Share transition from that nonowned source.

It may recover by selecting and confirming a different currently available source.

Once it successfully confirms a different source, it becomes canonical owner of that new source and may continue normally.

## 12.3 Frozen completed-job operations remain separate

Existing valid frozen-job operations remain allowed according to their current contracts:

- historical rerun;
- publication repair;
- post-Share correction where currently valid.

These operations consume frozen job/artifact lineage and do not establish assignment-source ownership.

Do not block them merely because the historical session lost canonical source ownership during cutover.

## 12.4 Session GET must not revive nonowner memory

Loading a historical nonowner session must not call normal confirmed-source memory reconciliation in a way that recreates/requeues canonical memory.

The read path must determine canonical ownership before replaying memory intent.

---

# 13. Operator remap semantics

Historical automatic conflict resolution remains reversible.

Provide the smallest operator mechanism that can remap canonical ownership between historical sessions that claim the same classified source identity.

A remap is allowed only when the target session's stored confirmed Source provenance matches that source identity.

After remap:

- the new owner becomes canonical;
- the old owner becomes a historical nonowner;
- sessions/jobs/artifacts remain untouched.

## 13.1 Binding-only remap is allowed only after readers are authority-aware

A binding-only remap is safe only if:

- lesson-memory worker commits revalidate assignment/source ownership;
- canonical lesson-memory reads derive ownership;
- student-memory snapshot eligibility derives ownership;
- session memory reconciliation derives ownership.

These protections are part of #266.

If any affected reader remains stateful rather than authority-derived, the remap command must transactionally invalidate/supersede its dependent projections instead.

Do not ship operator SQL that changes a binding while leaving current readers able to treat the former owner's evidence as canonical.

---

# 14. Unclassified historical sources

Historical identity may not always be reconstructable.

Manual transcript recordings are particularly important because edited historical transcript content must not be mistaken for original acquisition content.

## 14.1 Reads remain available

Historical sessions with unclassified source identity remain readable.

Existing publication history and valid frozen-job operations remain available.

## 14.2 New canonical mutations are rejected

An unclassified historical source cannot be used for a new:

- working source claim;
- Source confirmation;
- memory replay;
- downstream generation based on renewed source authority.

Return a semantic response such as:

```text
source_identity_required
```

or the repository-appropriate equivalent.

The tutor can recover by:

- reacquiring the original audio;
- repasting the historical transcript;
- or an operator explicitly classifying the source when justified.

## 14.3 Never reconstruct manual identity from edited text

Do not derive an "original" manual transcript fingerprint from current editable transcript content.

Unknown remains unknown.

---

# 15. API and contract behavior

The shared contract should expose the source-selection outcome as:

```text
source_attached
existing_assignment_resumed
```

Both return enough authoritative state for the frontend to proceed without structural inference.

`existing_assignment_resumed` includes the canonical assignment/session DTO.

Intermediate acquisition transport may still return a candidate artifact internally, but the tutor-facing source-selection flow is not successful until attachment resolves.

Do not expose:

- source fingerprint values as user-facing concepts;
- constraint names;
- raw PostgreSQL conflicts;
- recording IDs as lesson identity.

The existing `AssignmentSourceOwnershipApiError` may remain temporarily as defensive compatibility, but normal product flow should use the explicit discriminated outcome.

---

# 16. Frontend reconciliation

Keep the #265 assignment UI structure.

When `existing_assignment_resumed` is returned:

1. cancel obsolete upload/recovery activity for the losing local session;
2. stop pending source writes;
3. discard structural lineage belonging to the losing session;
4. do not copy its browser buffers into the canonical session;
5. hydrate the canonical session from backend truth;
6. show:
   `This lesson already has an assignment. We reopened it.`

If canonical assignment is shared:

- enter immutable completed-history mode.

The frontend never decides source equality.

It never chooses the winning assignment.

It never turns a unique constraint into user-facing workflow.

During replacement, if B belongs to another assignment:

- S retains confirmed A;
- S keeps its existing semantic state;
- canonical owner of B is returned/reopened;
- no ownership transfer occurs.

---

# 17. Share, reruns, corrections, and jobs

Do not change job identity semantics.

Share freezes the canonical assignment/session.

Its confirmed source binding remains owned after Share until a product-supported source replacement occurs. Normal shared assignments are immutable, so ordinary replacement is unavailable there.

Re-selecting its source reopens the completed assignment.

Reruns, output repair, republishing, and correction:

- remain jobs or child jobs of the same assignment;
- preserve current `source_job_id` ancestry;
- may create many artifacts;
- may fail without producing output;
- never create another assignment-source binding.

Job ID, output ID, and publication URI are never source-ownership keys.

---

# 18. Migration and historical cutover

Use a versioned migration and update current schema/baseline owners.

## 18.1 Fingerprint backfill

### Audio

Backfill source identity from durable existing prepared-media SHA-256 where available and trustworthy under the current scheme.

### Manual transcript

Backfill only when immutable original acquisition content can actually be established.

If not, leave source identity unclassified.

Never fabricate a manual fingerprint from potentially edited transcript state.

## 18.2 Confirmed snapshot source identity backfill

Where source fingerprint is known, add/derive the corresponding identity in historical confirmed Source provenance as needed by the runtime model.

Where unknown, preserve historical snapshot and mark/derive it as unclassified.

## 18.3 Lesson-memory assignment provenance backfill

Backfill `assignment_session_id` where an exact assignment/source/transcript/hash relationship can be determined safely.

When historical lesson-memory ownership is ambiguous:

- associate it only when deterministic under the selected canonical winner policy;
- otherwise leave it noncanonical/unclassified rather than guessing.

Historical loss of canonical learner-memory eligibility is acceptable; fabricated authority is not.

## 18.4 Binding candidates

Build binding candidates from assignment authority, not jobs.

Priority sources:

- confirmed Source snapshot;
- distinct current working/recovery source where applicable.

Shared assignments retain their confirmed-source candidacy.

## 18.5 Conflict resolution

Group by scoped source identity and choose winner:

1. completed/shared;
2. confirmed;
3. working-only;
4. earliest creation;
5. stable ID.

Only winner receives active canonical binding.

Losers remain untouched historical sessions.

## 18.6 Migration report

Produce auditable counts for:

- audio identities classified;
- manual identities classified;
- unclassified sources;
- canonical bindings created;
- historical conflicts;
- winner reason;
- lesson-memory ownership rows backfilled;
- lesson-memory rows left noncanonical/unknown.

Historical conflicts do not fail migration.

Schema/data-integrity failures still fail normally.

---

# 19. Runtime concurrency guarantees

PostgreSQL must guarantee the canonical invariant independently of frontend timing.

Cover:

- two sessions racing for same source;
- two browser tabs;
- distinct upload-operation UUIDs for same audio;
- simultaneous identical manual transcript acquisition;
- lost HTTP response after acquisition;
- lost HTTP response after attachment commit;
- stale attachment retry after source subsequently changed;
- direct confirmation bypass attempt;
- replacement B racing with another assignment claiming B;
- replacement confirmation racing with Share;
- stale recovery write after canonical-session resume;
- identical confirmation replay from historical nonowner;
- operator remap while an old worker is completing.

At every committed state:

> One scoped classified source identity has at most one canonical assignment owner.

Transport ambiguity reconciles from durable state.

---

# 20. Focused validation

## Pure/domain tests

Cover:

- manual transcript normalization;
- NFC equivalence;
- CRLF/LF equivalence;
- outer trim equivalence;
- meaningful punctuation/case/internal-whitespace differences remain distinct;
- transcript edits do not change source identity;
- fingerprint scheme/version handling.

## PostgreSQL tests

Use real PostgreSQL for:

- working claim;
- confirmed promotion;
- one-source/one-owner uniqueness;
- same-session replay;
- selecting already-confirmed source;
- A confirmed + B working;
- B cancellation;
- A -> B confirmation;
- failed B confirmation preserves A;
- released A -> fresh S1 lineage;
- different artifact with same fingerprint;
- competing claims;
- completed/shared owner;
- historical conflict cutover;
- historical nonowner behavior;
- operator remap;
- unclassified-source rejection.

## Acquisition/application tests

Cover:

- same audio before Share -> canonical resume;
- same audio after Share -> immutable canonical resume;
- identical pasted transcript -> canonical resume;
- distinct transcript -> distinct source;
- different student -> independent source scope;
- different tutor -> independent scope;
- provider/model changes do not change lesson identity;
- acquisition replay;
- attachment lost-response reconciliation;
- attachment stale revision;
- source candidate not editable before attachment;
- ownership race loser cleanup.

## Fresh-lineage tests

Explicitly prove:

```text
S owns A using RA/TA
S replaces A with B
A released
S1 acquires A
```

S1 receives:

```text
RA2 != RA
TA2 != TA
fingerprint(A2) == fingerprint(A)
```

Apply equivalent expectations to direct attachment/reuse paths.

## Memory tests

Cover:

- S confirms A;
- A memory pending;
- S confirms B;
- A superseded;
- A released;
- S1 confirms A with fresh lineage;
- late S/A worker completion;
- S1's own memory completion;
- snapshot eligibility;
- historical nonowner memory exclusion;
- operator remap authority change.

Assert generation/commit counts where useful.

## Publication/job regression

Prove unchanged:

- Share root behavior;
- structural Share versus publication;
- rerun ancestry;
- correction ancestry;
- failed child jobs;
- multiple outputs;
- no child job creates a source binding.

## Frontend tests

Cover:

- `existing_assignment_resumed`;
- stale local work cancellation;
- canonical hydration;
- completed-history reopen;
- replacement conflict;
- no DB error leakage;
- no losing-session buffer transfer;
- unresolved ownership blocks editor source mutations;
- historical nonowner recovery by choosing a different source;
- unclassified historical source recovery guidance.

Use the narrowest repository-owned lanes plus affected package typechecks.

Real PostgreSQL evidence is mandatory because the changed invariant is transactional.

Hosted CI remains the comprehensive merge gate.

Do not run a broad local aggregate merely because the diff is substantial unless current repository policy or a concrete failure requires it.

---

# 21. Documentation corrections

Update active documentation, not historical incident artifacts.

At minimum reconcile:

- `docs/design/CANONICAL_ASSIGNMENT_STATE.md`;
- batch backend README;
- batch frontend README where canonical resume is documented;
- backend/frontend alignment or public-contract docs if affected.

## Correct the old "lifetime" wording explicitly

This implementation deliberately changes the earlier stronger interpretation.

The new contract is:

> A canonical lesson source cannot belong to competing assignments while it is owned. Explicit successful Source replacement transfers ownership and releases the previous source.

Do not continue describing the released source as permanently belonging to the old assignment.

Clarify separately:

> Job/output lineage remains permanently associated with its assignment lineage and is unaffected by source ownership transfer.

When GitHub issue mutation is next authorized, update #266's description to match this corrected contract rather than leaving "lifetime ownership" as misleading shorthand.

Historical plans/incidents should remain historical.

---

# 22. Explicit non-goals

Do not implement:

- #264 first-profile onboarding;
- acoustic similarity detection;
- fuzzy transcript identity;
- semantic audio/transcript equivalence;
- cross-student deduplication;
- cross-tutor deduplication;
- generic lesson-source framework;
- generic distributed locking;
- job/publication redesign;
- assignment UI redesign;
- destructive cleanup of historical duplicate assignments;
- forensic reconstruction of unknown historical manual transcript identity;
- automatic restoration of a replaced source.

---

# 23. Implementation sequence

Use one coherent branch/PR because schema, ownership, memory authority, acquisition, confirmation, and frontend reconciliation are one invariant.

Recommended sequence:

1. Add source fingerprint scheme + immutable recording identity.
2. Add manual canonicalization and pure tests.
3. Add assignment-source binding schema/repository and PostgreSQL invariants.
4. Add source identity to new confirmed Source provenance.
5. Add `assignment_session_id` authority to new lesson-memory intents.
6. Update worker/read/snapshot predicates to derive canonical memory authority.
7. Implement historical migration/backfill/reporting.
8. Implement explicit atomic source attachment command.
9. Integrate direct Source confirmation and replay ordering.
10. Integrate audio acquisition and durable upload outcomes.
11. Integrate manual transcript acquisition.
12. Implement fresh recording/transcript lineage for released-source reuse.
13. Implement historical nonowner and unclassified-source runtime guards.
14. Update frontend source-selection/reconciliation flow.
15. Verify replacement transfer and Share boundary.
16. Run focused job/publication regressions.
17. Add/document operator remap.
18. Update active documentation.
19. Perform integration review focused on:
    - concurrency;
    - migration/data integrity;
    - memory authority;
    - stale-response reconciliation;
    - historical nonowner escape paths.
20. Run only additional evidence justified by review/current repository policy.

Do not split into independently deployable PRs that leave one source-acquisition or direct-confirmation path outside the invariant.

Intermediate commits are fine if internally valid.

---

# 24. Stop and escalation conditions

Implementation should not reopen the approved product decisions above.

Escalate only if current repository evidence demonstrates that one of these requires a materially different architecture:

- prepared-media fingerprint cannot safely remain stable as audio identity;
- fresh artifact lineage cannot be produced without destructive history changes;
- assignment-source binding cannot be enforced atomically with recovery/confirmation;
- canonical memory authority cannot be derived without materially redesigning student memory;
- current migration framework cannot support nonblocking historical conflict resolution safely.

Routine schema/API/file-shape choices are implementation decisions and do not require maintainer approval.

Do not silently introduce a generic source framework or rewrite job/session architecture to avoid a local integration problem.

---

# 25. Completion boundary

#266 is complete only when:

- every new audio/manual source has immutable classified source identity;
- source ownership is persisted and DB-enforced;
- attachment and recovery-pointer update are one transaction;
- every acquisition/attachment/direct-confirmation path respects canonical ownership;
- same source resumes its current canonical assignment before and after Share;
- confirmed replacement releases the old source;
- released source can later be owned by another assignment;
- new owner receives fresh recording/transcript lineage;
- old memory lineage cannot be revived for the new owner;
- historical losers remain readable but cannot regain source/memory authority implicitly;
- unclassified historical sources cannot bypass ownership through new mutation;
- operator remap immediately changes canonical reader/worker authority;
- jobs/reruns/corrections remain unchanged below assignment identity;
- historical conflicts are deterministically cut over without destructive cleanup;
- frontend treats canonical resume as an ordinary product outcome;
- focused concurrency/migration/memory/frontend evidence passes;
- active documentation reflects ownership-until-confirmed-replacement semantics;
- required hosted CI is green.

Production migration/deployment remains separately authorized.

---

## Execution metadata

Branch:

`codex/266-lifetime-canonical-assignment`

Conventional Commit / PR title:

`fix(assignments): enforce canonical lesson source ownership`
