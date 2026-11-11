# Calm Studio v2 profile maintenance handoff

## Meta

- Status: active
- Last Verified Against: 2026-11-02 PostgreSQL acceptance and independent persistence review
- Exit Trigger: archive after the implementation merges and its runtime contracts move to the owning references
- Current Focus: deterministic automatic additions, selective undo, and mandatory profile revision preconditions
- Execution: [ESL-95](https://linear.app/abocha/issue/ESL-95/integrate-calm-studio-v2-frontend-and-prepare-verified-switch)

This records the implemented profile capability and release constraints in the
[integrated frontend plan](calm-studio-v2-switch.md). This document changes no runtime, schema,
provider behavior, or deployment state. The parent retains integration and rollout authority.
Follow the [SSOT](../reference/agents-ssot.md) and
[evidence route](../reference/TESTING_GUIDELINES.md#choose-the-evidence-route).

## Product and data boundary

Maintain the existing student-owned `foundational_profile_v1` and revision history. Add exact,
eligible facts to permitted list fields; never regenerate or replace the full active profile.
Protect existing `overallLevel`, `primaryGoals`, `durableConstraints`, and `teacherNotes`; the
existing empty-seed initial bootstrap exception is defined below. Preserve every
tutor value, including values in permitted fields. Contradictory replacement, inferred field
rewrites, automatic deletion, and automatic reapplication after undo are outside this delivery.

Undo applies to one recorded automatic addition. It creates a new revision containing the current
profile minus that addition; it never restores an old whole-profile revision. An intervening
tutor/manual/unknown change to the same field blocks undo, even when the field later returns to
the old value. Validated selective undo updates the remaining automatic siblings' undo expectations
atomically, so multiple additions in one field can be undone one by one. Changes
to other fields do not block it. Source replay cannot silently restore an undone fact. Genuinely
newer evidence can mark reconsideration while leaving the suppression effective.

The v2 presentation flag is not an authorization or consistency boundary. Both v1 and v2 use the
same production profile APIs. Background writes must remain disabled until every active mutation
path enforces the precondition below. No paid provider calls are needed to implement or validate
this deterministic maintenance path.

## Existing execution and evidence owners

All source paths below are relative to `packages/batch-backend/src/` unless otherwise stated.

| Owner                                                                                                                                                                                                  | Current behavior and required change                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `application/student-profile-candidates.ts`: `refreshStudentProfileCandidatesFromCanonicalMemory`, `resolveSelectedLessonMemoryIds`, `buildCandidateDrafts`, `collectLessonFactObservations`           | Reads the pinned snapshot and selected lesson observations. Reuse original observations for maintenance; do not infer eligibility from aggregated candidate flags. Ordinary lesson triggers select the triggering lesson, not all historical evidence. Recurrence must explicitly inspect verified corroborating sources contained in the pinned snapshot. |
| `domain/student-profile-candidate-repository.ts`: `persistStudentProfileCandidateRefresh`                                                                                                              | Takes the student lock, checks the expected active revision, snapshot/source validity, then suppresses duplicate candidate keys. Maintenance and newer-evidence reconsideration must still execute when candidate insertion returns no new rows.                                                                                                           |
| `domain/student-memory-snapshot-repository.ts`: `buildProfileCandidateSourceSnapshotSqlPredicate`                                                                                                      | Preserve candidate-specific admission. A successful aggregate superseded by a canonical successor may remain valid; invalidated, remapped, foreign, or unfinished source lineage may not. Never substitute the latest snapshot for a delayed job's recorded snapshot.                                                                                      |
| `domain/lesson-memory-repository.ts`: `buildVerifiedLessonMemoryEvidenceSqlPredicate`, `listVerifiedReadyLessonMemoryEntriesByIds`                                                                     | Reuse student/workspace, confirmed binding, recording/transcript identity, URI/hash and ready-source validation. Revalidate inside the mutation transaction under the student lock.                                                                                                                                                                        |
| `application/process-student-memory-snapshot-job.ts`: candidate-refresh decision and enqueue handling                                                                                                  | Existing refresh intent is persisted in snapshot generation notes and retried. Preserve manual replay opt-in and its source identity.                                                                                                                                                                                                                      |
| `application/process-student-profile-candidate-refresh-job.ts`: `processStudentProfileCandidateRefreshJob`                                                                                             | After candidate refresh, reconcile deterministic maintenance for the same pinned snapshot, including duplicate-only retries. Propagate maintenance failure so retry can finish it; do not treat an earlier candidate insertion as maintenance completion. No new queue is necessary.                                                                       |
| `application/profile-content.ts` and `domain/profile-revision-repository.ts`                                                                                                                           | Current revision operations use separate transactions and lack caller CAS. Introduce a client-owned revision primitive for atomic profile, change-ledger, suppression and operation writes. Public helpers delegate to it; no nested independent transactions.                                                                                             |
| `domain/profile-initial-enrichment-repository.ts`: `reconcileInitialEnrichmentIntent`; `application/profile-initial-enrichment.ts`: `lockOperation`, `authority`, `preserveSeed`, `publishReadyResult` | Retain assignment -> student -> operation lock order, source fences, seed revision/hash checks, claim fencing and uncertain-submission handling. Restrict publication as described below.                                                                                                                                                                  |

## Eligibility policy v1

Use the original `StudentFact` values: authority is `student_stated`, `teacher_confirmed`, or
`model_inferred`; confidence is `low`, `medium`, or `high`; `reviewNeeded` is boolean; evidence
contains quote, source identity, speaker role and optional span/note. Categories are free text.

1. A high-quality single factual observation requires `confidence === 'high'`,
   `reviewNeeded === false`, `authority` equal to `student_stated` or `teacher_confirmed`, and a
   nonempty evidence quote with the corresponding student/teacher role. It must come from a
   verified source and classify into an unambiguous permitted section.
2. A recurring pattern requires matching normalized facts in at least two distinct, verified,
   completed lesson identities, each independently high confidence, not requiring review, and
   carrying evidence. Re-extraction, two memory rows for one lesson, aggregate copies, and replay
   are not independent corroboration. Model-inferred patterns qualify only through this repeated
   evidence route. Unlinked sources without a provable distinct lesson identity cannot establish
   recurrence in this first version.
3. Single factual additions may target `communicationContexts`, `interestsAndUsefulThemes`, and
   `studyPreferences`. `stableStrengths` requires recurring evidence. The combined
   `persistent_challenges_constraints` section is ineligible: current data cannot safely split
   recurring challenge from protected constraint. `goals_motivation` is ineligible.
4. Skip transient facts, represented values, empty normalized identities, archived students,
   unavailable/invalid source lineage, tutor-rejected/deferred candidates, suppressed facts, and
   absent or legacy-only structured profiles. Preserve the existing manual candidate workflow.
   Automatic application must not fabricate tutor approval or change `reviewState` to approved.

Do not combine the strongest authority from one observation with the strongest confidence from
another. Current `collectLessonFactObservations` does that for review opportunities; it is not an
automatic admission proof. Existing strength eligibility also accepts one observation and must
not be reused as recurrence proof.

Use a new versioned Unicode NFC/whitespace-normalized field-and-fact digest for maintenance
identity. The existing `normalizeProfileFactText` strips non-ASCII text; leave candidate behavior
compatible rather than using that key for durable suppression. Store the exact displayed value
separately. This policy does not claim semantic equivalence between paraphrases.

## Durable additions and transaction contract

Add versioned migrations for these proposed tables, retaining existing profile and candidate rows:

- `student_profile_maintenance_changes`: `id`, `student_id`, deterministic `application_key`,
  `policy_version`, `fact_key`, target field, exact added value, immutable evidence observations
  and source hashes/identities, pinned snapshot or initial-operation reference, optional candidate
  reference, base/result revision IDs, target-field before/after hashes, applied timestamp,
  irreversible undo-block timestamp/reason, undo revision/actor/time.
- `student_profile_fact_suppressions`: unique student/fact key, nullable originating automatic change, reason and
  actor/time, suppressed source identities, and separately retained newer source evidence requiring
  reconsideration. Suppression remains effective after reconsideration is recorded.

Enforce unique application keys, composite student/revision ownership foreign keys, and valid
field/status values. Keep source observations immutable; reconsideration must not rewrite the
original evidence. Extend revision sources with explicit automatic-maintenance and undo origins,
and synchronize `domain/profile-revision-model.ts`, frontend types, and activity attribution in
the successor to migration `0068_student_activity.sql`.

In one apply transaction: lock student; lock candidate/change/suppression rows in stable order;
validate active head, original evidence, tutor decisions and suppression; append exact eligible
values to the locked current profile; create one revision for the batch; insert per-item changes;
record completion. No additions means no profile revision. A retry must discover already recorded
applications and finish any remaining deterministic work without duplicate revisions or entries.

Before every active profile transition, compare the old/new canonical field values and durably
block undo for older applied changes in fields that changed. An unchanged field stays eligible.
This marker survives A -> B -> A changes and old-revision reactivation; current-value hash equality
alone does not prove no intervening write. New automatic batches in the same field block older undo in this conservative version.
A selected-item undo is exempt only after SQL verifies its internal ledger claim and the exact
base-profile-minus-that-item transition; the revision source string does not grant an exemption. Every future tutor removal of an allowed-field value records suppression, including a manually
authored value with no automatic ledger origin. Use the same JS fact-key function in client-owned
revision insertion/activation transactions. Manual-only tombstones do not become fake automatic
changes. Historical removals before this migration are unknown and receive no inferred backfill.

Undo locks student and the selected change, checks request CAS, verifies its undo-block marker and
current target-field hash, and removes only that recorded addition. Create revision, undo result,
suppression and activity atomically. Check already-completed undo first on retry and return its
recorded change with the current active profile/head, never stale content paired with a current CAS token; a mismatched retry must never perform a second removal. A changed field returns
typed `409 profile_change_conflict` without mutation.

Only a distinct verified lesson with later completed-lesson chronology can mark newer evidence.
Generation time and reprocessing of a corrected transcript are insufficient. If ordering cannot
be proved, retain suppression without claiming the evidence is newer. No automatic restore or
unsuppression endpoint is part of this scope.

## Mandatory active-head precondition and callers

Define `expectedActiveRevisionId: UUID | null` as required. `null` asserts that there is no active
profile; omission is an error, not another spelling of null. Validate ownership first, then compare
with the active row while holding the student lock. Missing precondition returns typed
`428 profile_revision_precondition_required`; mismatch returns
`409 profile_revision_conflict`. Neither creates a revision, copies candidate links, activates a
hash-deduplicated historical revision, nor updates provenance. Include authoritative active-head
identity in the conflict response, while preserving the caller's edit buffer.

Extend the shared request/response/error DTOs in `packages/contracts/src/` and consume them from
both backend and frontend. Do not continue duplicating new public shapes in local interfaces.

| Mutation/caller                                                                                                                  | Exact integration work                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport/extended-routes/student-profile-routes.ts`: `PUT /students/:id/profile` -> `upsertProfileContent`                     | Require the request baseline; thread through `upsertProfileContentWithRevision` / `saveProfileRevision` to insertion and the hash-reuse activation branch under the same lock.                                                                                                                             |
| Same route owner: `POST /students/:id/profile/revisions` -> `saveProfileRevisionContent`                                         | Require baseline even for a draft. Store its durable base active revision; draft saving alone never updates the active profile.                                                                                                                                                                            |
| Same route owner: `POST .../:revisionId/restore` -> `restoreProfileRevision`                                                     | Distinguish selected historical revision from expected current head; copy it as a new active revision only against that head. Mark affected fields as tutor-owned changes for undo fencing.                                                                                                                |
| Same route owner: `POST .../:revisionId/activate` -> `activateProfileRevisionForStudent`                                         | Validate current head and the draft's recorded base. Activating an old draft against a newly fetched head is not conflict resolution. Require explicit compare/rebase before changing its durable base. Keep candidate represented-fact proof truthful and within the transition's transaction.            |
| `transport/extended-routes/students-routes.ts`: initialize -> `initializeStudentProfileDraft`                                    | Require null baseline and repeat the absence check under lock. Frontend activation of its returned empty draft must still use null; it must conflict if another process created a profile meanwhile.                                                                                                       |
| Same owner: candidate promote / refresh routes -> `promoteStudentProfileCandidates`, `refreshProfileDraftFromApprovedCandidates` | Keep `baseRevisionId` (selected content) distinct from expected active head. Preserve the baseline across any existing provider operation and check again before saving/linking the draft. Record its durable base; never auto-refresh the baseline before commit.                                         |
| `application/student-profiles-store.ts`: `createStudentProfile` starter `saveRevision` call                                      | Newly inserted student has null expected head. Keep this initialization explicit; no general unchecked active-write bypass.                                                                                                                                                                                |
| `application/legacy-profile-migration.ts`: `migrateLegacyStudentProfiles` -> `saveRevision`, including `status: active`          | Pass the inspected active revision as baseline and fail on intervening writes. Operator apply is not exempt from concurrency protection.                                                                                                                                                                   |
| `application/legacy-profile-normalization.ts`: `normalizeLegacyStudentProfile` -> draft `saveRevision`                           | Pass inspected active head; preserve it across generation and into the saved draft base.                                                                                                                                                                                                                   |
| `domain/profile-revision-repository.ts`: `insertProfileRevision`, `activateProfileRevision`, `deprecateActiveProfileRevision`    | Require explicit authority for active mutations, perform CAS inside the student transaction, and reuse the client-owned primitive. Update tests/direct callers. `create-prompt-package.ts` declares an activation dependency but does not currently call it; do not invent a prompt-generation write path. |
| `application/profile-initial-enrichment.ts`: direct SQL publication                                                              | Existing seed revision/hash is its CAS authority. Retain it and publish ledger, profile and operation result atomically; it must use the same field-undo fencing as other active transitions.                                                                                                              |

Persist the base of a draft in the revision owner, for example nullable
`base_active_revision_id` plus an explicit known/unknown base distinction for old drafts. Null is
a known empty-profile base; migrated unknown must not be interpreted as null. Legacy drafts remain
readable but require explicit comparison before activation. Their old contents cannot be blessed
by silently attaching the current head at open time.

## Frontend and API consumer readiness

Current production browser mutations all originate in
`packages/batch-frontend/src/ui/students/StudentLearningPage.tsx`, shared by v1 and v2:

- `handleSaveProfile` -> `upsertProfileContent`.
- `handleSaveDraft` -> `saveProfileDraftRevision`.
- `handleStartEmptyProfile` -> initialize, then `activateProfileRevision`.
- `handleActivateDraft` -> `activateProfileRevision`.
- `handleRestoreRevision` -> `restoreProfileRevision`.
- `handleRefreshDraftFromCandidates` -> candidate draft refresh; candidate promotion API remains
  exported even when a particular UI action uses refresh instead.
- `useStudentPageEdits` invokes the same save handlers during guarded navigation. It must retain
  the original baseline and buffer when saving fails; it cannot grant a fresh baseline implicitly.

The four helpers in `packages/batch-frontend/src/utils/api.ts` (`upsertProfileContent`,
`saveProfileDraftRevision`, `restoreProfileRevision`, `activateProfileRevision`) currently cannot
send CAS. Initialization and candidate-generation request types also lack this precondition.
Their generic error wrapping loses structured conflict information and must retain typed errors.

`ProfileContentResponse.currentRevisionId` supplies an active head, but `currentRevision` in
Student Learning is the editor-selected revision and becomes historical or draft on Open. Add a
separate buffer-associated active baseline, initialized from the authoritative learning/profile
surface and retained during typing. Keep the selected draft's durable base separate. Never use
`currentRevision.id`, a paged revision-list guess, focus refresh, or a fresh pre-save GET to erase
the baseline on an existing buffer. Existing revision detail must expose its durable base.

No other production browser profile mutation consumer was found in the current checkout.
`dev/frontend-sandbox-api.ts` handles these routes and must implement matching precondition and
conflict fixtures. The isolated `dev/calm-studio-v2` prototype uses local fixture state and is not
a production API consumer. MCP teaching-context access is read-only. Unseen external/old browser
clients cannot be proven upgraded; mandatory server rejection protects against them.

## Initial enrichment publication policy

Keep every existing seed field verbatim at the structured-value level, including goals,
constraints, notes and level. Preserve nonempty protected seed values exactly. The existing first-profile bootstrap may establish empty protected fields when there is no prior learner context; do not label untracked generated bootstrap values as selectively undoable. Starting
with that seed, add only permitted deterministic facts admitted by eligibility policy v1 from
the operation's verified lesson evidence. A first lesson alone cannot establish recurring
strengths. Generated full-profile prose is not permission to add unsupported or protected values.

`preserveInitialProfileSeed` retains the structured seed and appends eligible original facts.
Preserve the original legacy seed text without rewriting it into
new generated notes. An unstructured legacy profile remains ineligible for automatic additions
until explicitly normalized. Any retained initial provider result is filtered through this same
deterministic policy; do not add a provider call or change unresolved-submission recovery.

Publication writes per-item change records with the initial operation and source evidence so
these new additions have the same undo capability. Existing historical enrichments receive no
invented retroactive ownership. For an eligible structured seed with zero additions, finish the
operation without a new profile revision or an "updated" claim; keep its seed revision as the
result reference and do not change profile provenance merely to imply enrichment occurred.
Before publication, recheck current reviewed candidate decisions and suppression keys under the
student lock. Exclude those new facts even in the empty-seed bootstrap, and deduplicate against
the exact preserved seed using the ledger's shared case/whitespace normalization. A filtered fact
must not prevent unrelated eligible additions or leave the operation retrying forever. Retain the
validated result and its integrity hash; derive the filtered publication without resubmitting the
model request.

Retain seed ID/hash comparison through commit and preserve assignment -> student -> operation
lock order. A maintenance transaction must not acquire an assignment lock after taking student.

## Contract owners and focused acceptance evidence

| Boundary                  | Existing tests / required regression                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Candidate/evidence policy | `tests/application.student-profile-candidates.test.ts`, `tests/domain.student-profile-candidate-repository.test.ts`; add focused maintenance policy cases for single high-quality facts, two distinct lessons, same-lesson replay, mixed authority/confidence, protected/ambiguous fields, Unicode keys, represented/rejected/deferred facts.                                                    |
| Profile mutation and CAS  | `tests/application.profile-content.test.ts`, `tests/application.initialize-student-profile-draft.test.ts`, `tests/application.profile-draft-refresh.test.ts`, `tests/application.profile-candidate-promotion.test.ts`; missing/null/stale baseline, hash reuse, old draft base and full-buffer preservation. Add PostgreSQL owner tests for actual serialization, not only mocked service calls. |
| Initial enrichment        | `tests/domain.assignment-session-repository.test.ts` owns current operation fixtures; verify seed protection, deterministic additions, no-op result, source replacement, late response, operation retry and atomic ledger publication with stubbed provider results.                                                                                                                             |
| Worker delivery           | `tests/application.process-student-memory-snapshot-job.test.ts`, `tests/transport.student-memory-worker.test.ts`; crash after candidate persistence, duplicate-only retry, failed maintenance, pinned delayed snapshot and durable replay suppression.                                                                                                                                           |
| Authorization and routes  | `tests/integration.student-area-authorization.test.ts`, `tests/transport.http-server.integration.students-profile-candidates.test.ts`; ownership precedes body/CAS checks, foreign change/revision denied, typed 428/409 and pagination.                                                                                                                                                         |
| History                   | `tests/application.student-timeline.test.ts`; automatic system actor, undo tutor actor, per-item provenance and no fabricated approved/promoted candidate history.                                                                                                                                                                                                                               |
| Browser API and editing   | `src/utils/api.profile-routes.test.ts`, `src/ui/students/StudentLearningPage.test.tsx`, `src/ui/students/StudentWorkspace.test.tsx`, sandbox API tests in the frontend; both presentations send CAS, stale save/activate/restore retain buffers and block navigation, selected historical ID cannot masquerade as active head, per-item Undo handles conflict/retry honestly.                    |

New transaction tests must cover concurrent automatic apply/manual save, undo/manual edit,
candidate reject/apply, initial enrichment/maintenance, duplicate worker jobs, same-field A -> B
-> A, unrelated-field changes, and rollback between revision/ledger/suppression writes. Verify
same-evidence suppression separately from later-evidence reconsideration. No live paid calls.

## Rollout order and stop conditions

1. Prepare shared contracts, schema, client-owned persistence/CAS, typed errors, durable draft
   bases, and frontend buffer/conflict support as one coordinated backend/frontend release.
   Require preconditions from the first new API process; there is no permissive runtime stage or
   new backend feature flag. Local frontend presentation remains reversible independently.
2. Before migration, quiesce old API and worker writers, including initial-enrichment jobs. Follow
   existing incompatible-cutover procedure; do not run an old server against the migrated schema.
   Database/API compatibility versions and the release handoff must identify this boundary.
3. Deploy the paired CAS-capable frontend, backend and workers. Verify a deliberately old browser
   request without CAS fails with 428 and no mutation. An old frontend must preserve its buffer and
   reload to regain editing; never retry automatically with the new head. Exercise save/draft/
   activate/restore, guarded navigation, first profile and typed conflicts before final activation.
4. Run PostgreSQL race, source-validity, suppression and worker retry acceptance, then verify
   change-list/Undo behavior. Final production activation is separately authorized. New-source
   processing is the default; historical replay/backfill requires separate authorization.
5. Rollback must stop new writers and restore a compatible paired release and database state
   under the existing rollback procedure. A server accepting unchecked writes is incompatible
   with retained automatic changes. Do not drop provenance, reset suppressions, or silently
   downgrade the server against this schema.

If backend/frontend rollout cannot establish step 3, do not start the new writers; report the
blocker. Implementation must not silently weaken preconditions, recurring-evidence admission,
protected-field rules, or same-field undo conflicts to make the UI appear complete.
