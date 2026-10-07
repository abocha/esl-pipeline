# No-homework lesson implementation

## Meta

- Audience: implementation agents and maintainer.
- Authority Level: approved plan-backed execution contract.
- Owner: founder-maintainer + implementation agents.
- Status: `active`.
- Last Verified Against: 2026-10-08 local implementation and focused validation from c3b33af166796a683176208d00ac5bb1528d3289.
- Exit Trigger: archive after the authorized implementation PR merges.
- Current Focus: local implementation and review complete; commit/push/PR handoff authorized 2026-10-08, then stop without CI monitoring.
- Execution: [ESL-34](https://linear.app/abocha/issue/ESL-34/implement-saved-no-homework-lesson-completion-and-same-source-homework), synchronized to GitHub #356.

Implement the approved corrected design from [ABO-34](https://linear.app/abocha/issue/ABO-34/design-transcript-only-lesson-completion-without-homework) and [full handoff](https://linear.app/abocha/document/no-homework-for-this-lesson-design-and-implementation-handoff-351d44f3c85c).

Implementation authorized 2026-10-07 through complete reviewable local implementation and focused local durable-service validation. This supersedes design-only stop statements below. Plan-backed execution, no runtime goal. The 2026-10-08 handoff additionally authorizes Linear synchronization, commit, push and PR submission, then stop without CI monitoring. Merge/deploy, live/paid providers and production data/mutation remain outside scope. Preserve ordinary homework, canonical ownership, current billing, historical read-only and frozen AssignmentV1 bytes/hash.

# No homework for this lesson — product and integration design

## Status and authorization

Prepared 2026-10-07 from repository HEAD `c3b33af166796a683176208d00ac5bb1528d3289` in `D:/code/esl-pipeline`; the working tree was clean. Repository investigation was read-only. No tests, provider calls, implementation, deployment, or production verification were performed.

The maintainer approved the tutor experience described below and requested a complete design in Linear, then a stop. This document is the proposed technical design for the next implementation handoff. It does not dispatch an agent, authorize deployment, or create an execution issue. The next agent must receive implementation authorization and recheck current contracts before editing.

## Outcome

Let a tutor upload and review a lesson recording, confirm its transcript, and finish without creating homework. Keep canonical lesson memory, student-memory snapshot updates, eligible initial profile enrichment, existing generation budgeting/usage accounting, existing lesson-credit rules, and retained-audio cleanup.

The decision belongs in Lesson source, after the tutor has reached the normal upload/review flow. There is no upfront pipeline-mode picker.

## Approved tutor experience

- Add a native, accessible checkbox below the transcript: **No homework for this lesson**.
- Default unchecked. Persist the choice with the session; never make it a sticky student or account preference.
- When checked, Teaching context and Create are skipped. The last step becomes **Review & finish**.
- Show skipped steps as skipped, with no completed checkmarks. Keep the existing step structure and normal homework path; no separate wizard or renumbering system.
- Path: **Student → Lesson source → Review & finish**.
- Lesson source's forward action becomes **Review transcript**. It saves transcript edits and speaker-role mapping, attaches the source and saves recovery state, but does not newly confirm Source or launch pedagogical processing.
- Review & finish displays the saved transcript (read-only), student, nullable linked lesson, speaker roles and validation warnings, and actual lesson/credit status. Offer Back/Edit transcript and the editable homework choice before completion.
- The final primary action is **Confirm transcript and finish**. This is the only new transcript-confirmation action on this branch.
- After success show **Transcript confirmed — no homework planned**, actual lesson/credit status, and separate memory/enrichment processing states. There are no publication, TTS, preview-handout, Share or download-handout controls.
- Finish must not wait for AI memory generation or initial enrichment. Saving/confirmation failure keeps the workflow open and retryable. Memory failure after successful confirmation does not reopen the workflow or change billing.
- Refresh, browser back and re-entry restore the saved choice and correct step. A completed entry opens a read-only transcript result, not Context or a missing job page.
- A later explicit **Create homework** action reuses the same source owner and enters the ordinary Context path.

### Choice and existing work

The choice remains freely editable while reviewing a new source and before this branch finishes. Unchecking it returns to the ordinary homework path; Source confirmation then happens at that path's usual boundary.

For an existing session with already-confirmed Source but no confirmed Context, prompt, draft, Share reservation or published output, the tutor may choose no homework and finish the same exact source. Already-running/ready memory is reused.

Do not silently clear downstream work to enable this branch. Hide or disable the checkbox with a clear explanation when the session already has Context/prompt/draft/Share state; converting such assignments or deleting their work is outside this slice. Published or historical Markdown sessions never enter this mode. This is an intentional preservation boundary for existing work, not an additional confirmation dialog.

Use neutral page/result wording such as **Lesson for \[student\]** when checked. Do not reproduce student names, transcript excerpts or the source screenshot in this planning record.

## Confirmed repository evidence

1.  Source confirmation already persists exact transcript URI/hash/working version, checks source ownership and speaker roles, requests retained-audio deletion, records a canonical lesson-memory intent and eligible initial-enrichment intent in one PostgreSQL transaction. Queue delivery happens after commit.
2.  Lesson-memory processing requests a student-memory snapshot refresh and can replace a placeholder lesson title. Snapshot processing retains existing profile-candidate gating. Homework-memory extraction is a separate publication-triggered path.
3.  Current completion is `confirmed_step = 'share'`, requiring a Share job. Active-session lists/counts, recovery writes, history/resume and schedule/business projections assume this.
4.  Canonical lesson-memory authority is tied to `assignment_source_bindings`, its assignment session and exact source snapshot; workflow completion is not inherently required to release authority.
5.  Initial profile enrichment explicitly checks `confirmed_step <> 'share'`. Replacing that with a generic “active workflow” condition would wrongly exclude finished transcript-only sources.
6.  Linking an eligible elapsed scheduled lesson at Student confirmation or recovery currently calls `completeElapsedScheduledLessonForHomework`. Confirmation of the transcript is not the existing billing boundary.
7.  Student and business lesson projections and follow-up reminders currently assume homework is expected. Both implementations need the new outcome.
8.  Lesson-memory delivery repair occurs when a confirmed session is loaded. The periodic memory-delivery reconciler currently handles homework and snapshot jobs, not lesson-memory delivery.
9.  Transcript autosave currently checks working-version CAS but has no completed-transcript-only owner guard. A stale writer can otherwise change the current source after finish.
10. Ready lesson-memory publication and snapshot intent creation are separate commits. The lesson-memory worker skips non-pending rows; pending-only queue recovery does not repair a ready extraction with no snapshot intent. Current automatic ready-source snapshot reuse is homework-specific.
11. Ordinary public Source/Context/Create confirmation currently has no homework-intent admission. Identical Source replay occurs before revision validation and can reconcile memory/enrichment effects. The new intent must be checked under the lock before that shortcut.

Evidence anchors (immutable at investigation HEAD):

- [Session creation/recovery and memory repair](https://github.com/abocha/esl-pipeline/blob/c3b33af166796a683176208d00ac5bb1528d3289/packages/batch-backend/src/application/assignment-sessions.ts)
- [Source confirmation transaction and active predicate](https://github.com/abocha/esl-pipeline/blob/c3b33af166796a683176208d00ac5bb1528d3289/packages/batch-backend/src/domain/assignment-session-repository.ts)
- [Canonical lesson-memory authority](https://github.com/abocha/esl-pipeline/blob/c3b33af166796a683176208d00ac5bb1528d3289/packages/batch-backend/src/domain/lesson-memory-repository.ts)
- [Lesson-memory worker](https://github.com/abocha/esl-pipeline/blob/c3b33af166796a683176208d00ac5bb1528d3289/packages/batch-backend/src/application/process-lesson-memory-job.ts)
- [Initial profile enrichment](https://github.com/abocha/esl-pipeline/blob/c3b33af166796a683176208d00ac5bb1528d3289/packages/batch-backend/src/application/profile-initial-enrichment.ts)
- [Schedule/billing](https://github.com/abocha/esl-pipeline/blob/c3b33af166796a683176208d00ac5bb1528d3289/packages/batch-backend/src/application/student-schedule-billing.ts)
- [Business projections](https://github.com/abocha/esl-pipeline/blob/c3b33af166796a683176208d00ac5bb1528d3289/packages/batch-backend/src/application/teacher-business-dashboard.ts)
- [Transcript writes](https://github.com/abocha/esl-pipeline/blob/c3b33af166796a683176208d00ac5bb1528d3289/packages/batch-backend/src/domain/transcript-repository.ts)
- [Current frontend Source transition](https://github.com/abocha/esl-pipeline/blob/c3b33af166796a683176208d00ac5bb1528d3289/packages/batch-frontend/src/ui/minimal/MinimalAssignment.tsx)
- [Memory delivery recovery](https://github.com/abocha/esl-pipeline/blob/c3b33af166796a683176208d00ac5bb1528d3289/packages/batch-backend/src/application/reconcile-memory-delivery.ts)

## Architecture decision

Extend the existing assignment session. Keep its source owner, recording/transcript identities, memory provenance and queues. The checkbox is a persisted homework intent, not an alternate orchestrator pipeline.

Reject a UI-only exit because it leaves an active assignment and missing-homework reminders. Defer a separate lesson-session ownership model: this requirement does not justify migrating source bindings and memory/enrichment provenance to a new root. Reconsider only when independent lesson processing or several assignments per lesson becomes an accepted requirement.

No new service, queue family, generalized workflow framework, global feature flag, manifest format, generation workload, prompt policy or provider is required. The branch stops before any assignment orchestrator invocation; later promotion uses the ordinary typed AssignmentV1 path.

## Durable state and contracts

Suggested names; final spelling may follow local conventions without changing semantics:

- `homework_intent: 'create' | 'none'`, NOT NULL, default `create`.
- `transcript_completed_at: timestamp | null` means **current** transcript-only completion. Only finish sets it. Promotion clears it; merely saving intent never restores it.
- Preserve past finish events as immutable session-owned completion history, e.g. an append-only `transcript_completion_history` JSON array on the same session. Each event records completed timestamp, request expected revision, resulting session revision, student identity and the exact confirmed-source snapshot (lesson/recording/transcript IDs, working version, URI/hash and source fingerprint). This is historical evidence, not a completion predicate. No new source owner or generic event framework is needed.
- Keep `confirmed_step` and immutable confirmed-source snapshot meanings unchanged.
- Current session completion is derived: Share is the existing homework completion; `homework_intent = 'none' AND transcript_completed_at IS NOT NULL` is transcript-only completion, subject to exact source invariants below.
- Active workflow is the complement of these completed cases. Source authority, memory eligibility and enrichment eligibility are separate predicates.

Expose intent, current completion timestamp/kind, and historical source-bound finish evidence separately through `@esl-pipeline/contracts`. History must not make a promoted or re-entered workflow appear finished or suppress reminders.

A completed no-homework entry must have confirmed Source, `confirmed_step = 'source'`, no confirmed Context/Create, no prompt/draft/Share job and exact matching recovery source pointers. Its current completion timestamp and source must match its latest finish-history event. Enforce valid combinations in the database and the exact evidence/append-only rules in authoritative backend transactions. Intent `create` requires a null current transcript-completion marker even when history is nonempty.

Support finish → promotion → reselect no-homework in v1, as long as downstream work has not started. Both unchanged and edited/replaced sources return to unfinished review. A subsequent explicit finish records a new exact-source event. Never replace or retarget the original historical event.

An additive migration defaults all existing sessions to ordinary homework intent, null current transcript completion and empty completion history. Do not infer no-homework decisions or completion for old Source-only sessions. Update still-existing active partial indexes alongside SQL predicates; migration 0054 already removed the active-recording unique index, so do not recreate it from obsolete migration 0044.

### State and transition table

| State / action                                             | Intent    | Current completion     | Historical evidence           | Tutor destination / reminder                           |
| ---------------------------------------------------------- | --------- | ---------------------- | ----------------------------- | ------------------------------------------------------ |
| Fresh or saved no-homework review                          | none      | null                   | unchanged, possibly empty     | Source/Review; unfinished follow-up remains eligible   |
| Successful finish of source A                              | none      | finish timestamp for A | append exact A event          | Read-only result; no-homework follow-up suppressed     |
| Identical replay of that finish                            | none      | same A timestamp       | no append                     | Same completed result                                  |
| Create homework from completed A                           | create    | cleared to null        | retain exact A event          | Context; ordinary homework progress/reminders          |
| Reselect no-homework, no downstream work, unchanged A      | none      | remains null           | retain exact A event          | Review A; unfinished follow-up remains eligible        |
| Edit/replace A with B after promotion, then select none    | none      | remains null           | A event remains bound to A    | Source/Review B; unfinished follow-up remains eligible |
| Finish reviewed A again or reviewed B                      | none      | new finish timestamp   | append new exact-source event | New read-only completed result                         |
| Uncheck none during unfinished review                      | create    | remains null           | unchanged                     | Ordinary path; confirm current Source before Context   |
| Attempt select none after Context/prompt/draft/Share state | unchanged | unchanged              | unchanged                     | Reject; preserve existing downstream work              |

## Commands and concurrency

### Save choice / review

Extend recovery CAS to persist intent. Reject changing to `none` when downstream state exists or the session is completed. A promoted session with no downstream state may freely reselect `none`; its current completion is already null. Every active choice save keeps current completion null, preserves historical events and must not create memory, delete audio, suppress reminders, alter profile state or reserve homework generation. Preserve the existing billing trigger; no new billing effect belongs to changing intent.

Persist and await transcript/speaker-mapping saves before entering review. Review the exact server version/hash. If that version changes before finish, require review of the new version rather than silently confirming unseen content. An eligible already-confirmed Source may be reused internally at finish; ordinary public confirmation remains blocked while intent is none.

### Backend command matrix

Intent is authoritative before completion. Enforce these rules under the same session/source lock or CAS as the mutation, not from an unlocked preflight or UI state. Check intent and revision before an ordinary confirmation's identical-source replay shortcut. Serialize intent saves against confirmation, generation admission/reservation and artifact commits; a stale admission cannot publish or link work after intent changes to none. Recheck authority at existing later provider-result/materialization boundaries. If ordinary admission wins first, persisted downstream work must make the competing none switch conflict.

| Command                                                                      | Unfinished none (marker null)                                       | Completed none                      | Ordinary/promoted create                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| Read/reconcile status                                                        | Allowed; no implicit confirmation or terminal retry                 | Allowed read-only                   | Existing semantics                                           |
| Save choice / recovery, attach/edit source                                   | Allowed with CAS, no downstream state                               | Rejected; use promotion first       | Existing semantics; none switch requires no downstream state |
| Ordinary public confirm-source                                               | Rejected, including identical-source replay                         | Rejected                            | Existing Source confirmation rules                           |
| Public confirm-context / confirm-create                                      | Rejected                                                            | Rejected                            | Existing prerequisites                                       |
| Session-bound prompt/draft generation, draft creation/materialization, Share | Rejected before side effects/reservation                            | Rejected                            | Existing prerequisites and frozen-source checks              |
| finish-transcript                                                            | Sole command that can confirm and finish; exact review/CAS required | Exact current-operation replay only | Rejected                                                     |
| start-homework                                                               | Rejected                                                            | Explicit authorized transition      | Replay/reconciliation must never clear subsequent work       |

Rejecting a command must leave memory/enrichment/deletion intents, generation reservations and assignment artifacts unchanged. The matrix applies to fresh unconfirmed and eligible already-confirmed Source. Existing memory/enrichment work legitimately started before selecting none may continue; that is not permission for an ordinary confirmation call to create or retry effects.

Standalone prompt contracts are unchanged. Finished-source text/mapping and applicable retranscription/retry writes remain guarded as described below.

### Finish transcript

Add a narrowly scoped command, e.g. `POST /assignment-sessions/:id/finish-transcript`, accepting session expected revision and exact source tuple (lesson, recording, transcript, working version and reviewed hash).

Inside the same transaction and established lock order as Source confirmation:

1. Authenticate and enforce existing user/workspace/student/source authority and historical admission.
2. Lock the session; require saved intent none, null current completion, expected revision, source attachment, nullable lesson/student pairing, exact reviewed transcript version/hash, speaker-role mapping and absence of downstream state. Check revision even if Source is already identically confirmed.
3. Reuse the **internal locked** canonical Source-confirmation primitive within this transaction. Do not call the ordinary public confirm endpoint or copy a simplified alternate implementation.
4. Persist the immutable source snapshot, canonical memory/eligible enrichment intents, audio deletion request, current completion timestamp and a new source-bound finish-history event atomically. The event identifies this finish by its request expected revision and resulting session revision.
5. Commit; deliver memory to the existing queue after commit.

No billing mutation belongs in finish. A pre-commit failure rolls back completion and confirmation effects. An after-commit delivery failure returns or reconciles durable success with processing pending; do not suggest the transcript was unconfirmed.

For a completed session, accept replay only when the request expected revision and exact source match the **current finish event**, with intent still none and matching current marker. Return unchanged: no new history event, intent reconciliation or cleanup mutation. Old finish requests cannot complete a re-entered review or match a later finish merely because its transcript bytes are the same. For active/re-entered sessions require current CAS. Resolve ambiguous HTTP outcome by loading current completion and matching that operation's source/revision evidence; matching historical evidence alone does not establish current completion.

All mutations that could change a completed no-homework session or its bound source enforce completion on the server. Unfinished none also obeys the command matrix above. Retain existing source/frozen-hash authorization on typed entrypoints; unrelated standalone contracts remain unchanged.

For transcript writes, serialize against finish using the established session/source lock order and revalidate ownership after acquiring locks. Either the write precedes finish and causes a reviewed-version conflict, or finish wins and the later write is rejected. Do not globally freeze ordinary homework or historical transcript behavior as collateral work.

### Later Create homework

Add one explicit idempotent/CAS transition on the same session, e.g. `POST /assignment-sessions/:id/start-homework`.

Authorize current canonical source; require completed no-homework, then atomically change intent to create, **clear the current transcript-completion marker**, increment revision and preserve immutable source-bound completion history, confirmed Source, binding and content. Context/Create remain empty. Resume at Context; ordinary initial-enrichment gates apply.

Do not upload/retranscribe, reconfirm the unchanged source, reserve assignment generation, bill again or create a second session. Replayed promotion returns current authority and never clears subsequent Context/draft work or a later no-homework completion. Reconcile by current operation/revision rather than a historical “was promoted” inference.

After promotion and before downstream work, selecting No homework again is supported. The marker stays null and the tutor must review and explicitly finish again, whether the source is unchanged, edited or replaced. Selecting/unselecting intent cannot reuse an old completion event as current authority. Existing downstream-state preservation limits continue to apply.

Completed transcript-only sources remain read-only until promotion. Transcript correction uses ordinary Source editing after promotion; if intent is then none, only finish may reconfirm it. A dedicated completed-transcript revision workflow remains deferred.

## Memory, enrichment, billing and retention

### Memory

Reuse transcript/hash/session deduplication, canonical publication checks, existing generation target selection, pacing, budgets, usage recording, snapshot refresh and profile-candidate review rules. No homework-memory row is generated for this branch.

Recover **both** durable handoffs in the existing worker/dispatcher:

1. **Confirmed intent → lesson extraction delivery.** Recover committed pending lesson-memory delivery without page reload. Revalidate canonical ownership/exact source before enqueue. Use stable queue IDs and existing failure/attempt rules. Recover missing delivery or an interrupted pending attempt; do not reset terminal failed extraction rows automatically.
2. **Ready lesson memory → source-linked snapshot intent/delivery.** Ready publication commits before snapshot request today, and the worker returns early for non-pending rows. A crash/requestRefresh failure can therefore leave ready extraction with no snapshot intent. Pending-row redelivery alone does not close this gap.

Use a bounded reconciler over canonical ready lesson-memory evidence that lacks a source-specific snapshot obligation, invoking a shared idempotent ensure-and-deliver path with trigger lesson-memory-ready and sourceEntryId equal to the ready lesson-memory row ID. A ready-row retry resumes this post-publication path only; it never returns through extraction, its provider or extraction budget reservation. Use the ready row's immutable evidence and revalidate current source/historical authority.

For this feature, periodic missing-obligation discovery must at least include the exact ready source of unfinished/completed none sessions and promoted sessions' currently authoritative finish evidence. This includes Source confirmed before opting out and eligible ready memory existing before the migration. Do not infer an authorization to replay all unrelated historical ready entries or incur an unbounded retrospective generation backlog. Shared future lesson publication/retry paths should use the same source-specific ensure logic.

The shared automatic ensure path must serialize on the existing student memory lock and recheck deduplication before committing:

- An existing pending sourceEntryId obligation is delivered in place with its stable queue identity.
- Existing source-specific ready fulfillment or snapshot lineage containing that lesson entry is reused; no second refresh is created.
- Existing failed/cancelled/explicitly obsolete/superseded source obligations are respected as terminal according to current canonical reconciliation rules. Do not treat “no pending row” as permission to create a replacement or reset failed intent. A failed refresh remains visible for explicit existing recovery.
- Genuine absence creates one source-linked intent using the existing snapshot table and generation notes. Queue failure after this commit is handled by existing snapshot-delivery recovery.
- Concurrent scanner and direct worker requests converge to one obligation. Extending current automatic deduplication/terminal admission to lesson sources is necessary: today's ready-source reuse is homework-specific.
- Source replacement/remap and historical exclusions cannot revive obsolete evidence. Ready extraction stays ready if only the post-publication handoff fails; do not relabel it failed or send it through extraction again.

The existing homework-to-snapshot gap recovery in memory-replay-delivery.ts is the local pattern. Do not add a new service, queue family or generic obligation framework. Snapshot rows/generation notes and immutable memory lineage remain the durable evidence.

Keep initial-enrichment dispatch, deferred intents and publication eligible for completed no-homework sources. Do not mechanically reuse active-workflow predicates in those queries. Completing the tutor flow must not freeze learner-context reads to a nonexistent Context pin; display live eligible enrichment progress separately.

Result status distinguishes extraction, refresh and eligible initial enrichment. Reconciliation must also recognize ready extraction with missing/pending downstream intent as refresh not yet complete. Use authoritative records/projections; no second memory-finished flag. Status reads must not silently retry terminal failures. Provider uncertainty and historical read-only exclusions remain unchanged.

### Lesson billing

Preserve the current linking/session-confirmation boundary for both branches. A linked eligible elapsed scheduled lesson may already be completed and charged before transcript finish. Abandoning upload/review does not reverse that factual lesson completion. Make review/result copy truthful; do not say “will charge on finish” or use a checkbox to mark the lesson free.

No-homework intent does not create a lesson when unlinked, force completion of future/cancelled/no-show lessons, convert an already completed non-credit lesson into a chargeable one, refund a credit, or alter payment records. Later homework promotion leaves accounting untouched.

Sequential replay and concurrent linking/completion must leave one active credit-consumed event per chargeable lesson. If the existing ledger path needs a bounded serialization fix to meet this criterion, apply it in the shared lesson/credit helper and test both branches; do not add another billing implementation or assume a sequential test proves concurrent safety.

[ABO-18](https://linear.app/abocha/issue/ABO-18/decide-and-align-the-schedule-to-homework-lesson-completion-boundary) is a canceled historical decision record, not a current implementation dependency. It explains a known docs/code discrepancy. This slice preserves live behavior; update affected workflow documentation to describe that boundary accurately. A global change to billing timing is outside this design.

### Retention

Use the existing confirmed-source audio lifecycle. Review does not request deletion; successful finish does. Keep the confirmed transcript and canonical URI/hash evidence. The result must not promise retained-audio playback after confirmation. Reuploading the same source must resolve the completed canonical owner rather than generate a second pedagogical history.

Existing manual-transcript sources may use the same branch through the current Source mechanisms. Do not add separate manual-source semantics or new audio input options.

## History, lesson surfaces and reminders

- Completed no-homework sessions are excluded from unfinished/resume lists and counts, but discoverable through read-only history and linked lesson results.
- Add a distinct `not_planned` homework status for a successfully finished no-homework lesson. A merely checked checkbox does not qualify.
- Expose a typed nullable transcript-result reference on lesson rows so **View transcript** opens the session result without requiring a job, handout or homework-memory ID. Keep actual homework pointers truthful.
- Before finish, including no-homework re-entry after promotion, keep the lesson's unfinished follow-up eligible. Only current no-homework completion suppresses its missing-homework follow-up in both student Schedule & Billing and teacher business surfaces; immutable historical finish events never suppress it.
- Keep payment, low-balance, no-next-lesson and unrelated reminders unchanged.
- Actual published/publishing/draft/planned-homework work takes precedence over an older no-homework result for the same lesson. Do not label an existing homework assignment “not planned.”
- Later promotion restores ordinary homework progress/reminders without changing lesson status or credit. Multiple sessions linked to one lesson must be projected deterministically; a stale no-homework row cannot suppress newer planned work.
- Minimal history/result visibility is in scope; redesigning the full student timeline or unrelated Telegram menus is not. Shared contract consumers must compile and honor the new status where displayed.

## Failure behavior

| Situation                                                                     | Required result                                                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| STT fails or speaker mapping is incomplete                                    | Remain in Source; no transcript completion                                                               |
| Autosave or session CAS conflicts                                             | Preserve tutor edits; reconcile and review current version                                               |
| Tutor leaves before final confirmation                                        | Saved intent/source review remains resumable; no new memory/deletion effects from this branch            |
| Source already belongs to another session                                     | Resume/inspect the authoritative owner; no duplicate owner or charge                                     |
| Finish commits but HTTP/Redis delivery fails                                  | Recover the exact current finish operation and pending memory delivery                                   |
| Ready lesson-memory publication commits, then snapshot request is interrupted | Reconcile one source-linked refresh without repeating extraction or its provider                         |
| Finish → promotion → reselect none, unchanged or edited/replaced source       | Remain unfinished with current marker null; preserve original source history and require explicit finish |
| AI extraction/refresh/enrichment fails later                                  | Keep transcript completion and billing; show processing failure accurately                               |
| Stale tab edits after finish                                                  | Reject mutation before canonical DB source changes                                                       |
| Another tab promotes to homework                                              | Reconcile to current mode; old finish request cannot revert it                                           |
| Historical Markdown source/session                                            | Retain existing read-only admission; no processing or conversion                                         |

## Acceptance and focused evidence

1.  Fresh default and saved checkbox produce the three-step branch and correct refresh/back navigation; ordinary unchecked homework retains its existing sequence.
2.  Review/choice save never newly confirm Source, enqueue memory, request audio deletion, claim completion or suppress unfinished follow-up. One final action confirms the exact reviewed content.
3.  In PostgreSQL, finish atomically records confirmed Source/current completion, exact-source completion history, canonical memory/enrichment intents and cleanup request; rollback has none of the new committed effects.
4.  Duplicate and ambiguous finish responses match the current operation by expected revision plus source and append no extra history/effects. Changed version/hash/lesson/mode or old historical operation conflicts. No prompt, draft, job, handout, TTS or homework-memory artifact is created.
5.  Real DB concurrency shows stale transcript/mapping writers cannot invalidate completion; finish, promotion and intent changes cannot overwrite current truth or treat history as completion.
6.  In PostgreSQL/Redis, lost extraction enqueue delivery recovers after worker restart without page revisit, retaining canonical authority and retry limits. Superseded/historical owners and terminal failures are not revived.
7.  Fault-inject after canonical lesson-memory publication commits ready but before snapshot intent creation. Restart worker/reconciler with no page revisit: create/deliver one sourceEntryId-linked refresh and obtain an updated snapshot, with zero repeated lesson-memory provider calls. Repeat for an eligible already-confirmed Source converted to no-homework whose ready extraction already has this gap. Race direct worker and scanner; reuse existing pending/fulfilled obligations and respect failed/cancelled/obsolete/superseded intent instead of recreating them.
8.  Lesson memory, snapshot refresh and eligible tutor-only enrichment continue after completion; status distinguishes each outcome, including a ready extraction whose refresh is not yet created/complete. Profile candidates retain their review gate.
9.  Linked elapsed lessons retain existing completion/credit behavior; completed non-credit, future, cancelled/no-show and unlinked cases retain their respective ledger state. Replays/concurrent completion leave one active debit, including ordinary homework.
10. Completed results disappear from active lists/counts, remain viewable without a Share job and suppress only missing-homework follow-up on both lesson surfaces. Historical finish evidence alone never suppresses a promoted/re-entered workflow.
11. Same-source reupload resolves the completed owner. Later Create homework uses the same session/source, clears current completion, retains source-bound history, enters Context and does not bill or repeat memory; ordinary enrichment prerequisites apply.
12. State-transition tests cover finish A → promotion → reselect none with unchanged A, edited A and replaced B, before downstream work. Choice save stays unfinished with marker null and leaves A history unchanged; only explicit final finish appends a new exact-source event. Unchecking still permits ordinary homework. Old finish/promotion retries cannot restore or clear a later outcome.
13. Direct API/DB tests on saved unfinished none, both fresh unconfirmed Source and eligible already-confirmed Source, reject ordinary confirm-source/context/create and session-bound downstream creation with no new memory/enrichment/deletion intents, generation reservation or assignment artifacts. Finish is the sole confirmation/completion command. Race intent switches with confirmation and generation admission/artifact commits: one valid intent wins; no stale path bypasses it. Standalone contracts retain existing behavior.
14. Migration defaults old rows correctly, enforces current-marker/history/source combinations and preserves frozen AssignmentV1 bytes/hash and historical admission.
15. Owning docs and shared DTO consumers describe and handle the new outcome accurately.

Use existing meaningful frontend workflow/resume/source suites, deterministic HTTP contract tests, PostgreSQL assignment/source/memory/billing tests, migration tests and bounded real PostgreSQL/Redis delivery and post-publication fault-injection tests. New DB/worker tests must be registered in `vitest.projects.mjs` under their actual prerequisites. Provider behavior can be deterministic; paid live calls are unnecessary. These criteria describe required implementation evidence, not tests already run. Focused evidence prepares a PR for hosted CI; hosted checks remain the comprehensive merge gate.

## Local implementation evidence (2026-10-08)

The local implementation uses branch `codex/abo-34-no-homework` from the baseline above. Evidence uses disposable PostgreSQL 18 and Redis 8, isolated fixture databases, production repository/application/worker paths and deterministic injected generators. No production learner data or live/paid provider calls were used.

| Acceptance criteria | Evidence obtained                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1–2, 4, 10–12       | Frontend workflow, resume, API recovery, transcript result/history and both lesson-surface suites; exact reviewed-version finish, ambiguous response reconciliation, same-owner promotion and unchanged/edited/replaced-source re-entry.                                                                                                                                                               |
| 3–5, 11–14          | PostgreSQL session and source tests: atomic rollback, operation-aware replay, immutable completion history, ordinary command rejection, intent/artifact and source-write races, stale promotion, terminal-memory preservation and completed-owner reacquisition. Deterministic HTTP tests exercise public commands and history reads.                                                                  |
| 6–8                 | Real PostgreSQL/Redis recovery tests: queue/worker restart, lost pending delivery, fault after ready publication before refresh intent, pre-existing ready sources, direct/scanner deduplication, terminal/historical/remap exclusions, claim-lock barriers and read-only status. Completed-source enrichment publishes while profile candidates keep review gating and teaching context remains live. |
| 9–10                | 44 billing/schedule tests pass, including concurrent ordinary and no-homework linking/completion, one active debit, non-credit/future/cancelled/no-show preservation, reminder precedence and both lesson projections. Finish/promotion add no billing boundary.                                                                                                                                       |
| 14                  | 22 migration tests pass; fresh schema baseline and contract-version checks pass. Nine assignment-artifact tests retain frozen native AssignmentV1 bytes/hash.                                                                                                                                                                                                                                          |
| 15                  | Contracts build, backend/frontend typechecks, frontend build, prerequisite registration checks and documentation checks. Owning documentation and generated routes/plan indexes synchronized.                                                                                                                                                                                                          |

Focused passing runs: PostgreSQL session/source 70 (new no-homework 14 and existing session repository 56), confirmation application 7, HTTP session 20, migrations 22, schedule/billing 44, memory recovery/replay 44, memory application unit 23 and frozen assignment-artifact 9. The final status-lineage regression passed separately (1 passed, 17 intentionally unselected in the recovery suite). Frontend runs passed 133/133 and final additions 80/80, covering 185 distinct cases; the latter includes the final 18 no-homework cases, fixed-page history offsets over 65 mixed history entries and API query verification. Backend test-project registry checks passed 5/5. Frontend retained eight existing lint warnings and one informational finding; these do not fail the configured checks.

Integration review identified and closed a delivery lock-order risk, a snapshot-status lineage issue and a history page-limit issue. Delivery now locks Batch items/claims, student and lesson on one connection; barrier tests cover waiting import and terminalization. Snapshot progress uses the canonical eligible-lineage predicate, reports invalid ready evidence as superseded and preserves valid-ready priority and terminal visibility. Its regression verifies agreement with canonical reads and no database/queue effects on read. History uses fixed-size offset pages within the existing limit. Exceptional-risk review and its narrow lineage-fix re-review found no remaining blockers in the assigned durable paths; primary integration review accepted the frontend and lesson projections.

Migration 0066 is runtime-incompatible with old readers/writers; API is 10.0.0 and DB schema is 4.0.0. Manifest, prompt and validator versions are unchanged. Hosted CI, browser/manual acceptance and production deployment are not established by this local evidence. Commit/push/PR are authorized for the handoff; merge and deployment are not. The standard deploy script already handles incompatible-boundary writer quiescence, verified pre-migration backup, packaged migrations and coordinated restart. No new environment values, prompt activation, manual backfill, queue purge or feature-enable command is required. After the boundary, recover with a schema-compatible image or explicitly restore a verified backup from before migration 0066; previous-image rollback alone is blocked.

## Candidate implementation boundaries

1. Contracts and durable state: intent/completion, migration/constraints/indexes, finish and promotion commands, canonical authorization and write serialization.
2. Background integration: completed-source memory/enrichment eligibility, pending extraction delivery recovery and idempotent ready-extraction-to-snapshot handoff repair.
3. Product surfaces: checkbox/review/result/resume, lesson history/reference and both reminder projections.
4. Focused validation and owning documentation.

These are responsibility boundaries, not mandatory separate PRs or delegated agents. An incomplete intermediate branch must not expose a finish button before backend guards, result reads and delivery recovery exist.

Update backend/frontend READMEs, backend/frontend alignment, relevant Source/memory/billing references and SSOT completion semantics. Preserve source authority and frozen assignment contracts.

## Compatibility and execution boundary

The migration is additive structurally but old applications would misread and potentially mutate completed Source-only sessions. Classify it through the repository's runtime-compatibility policy; do not call old-image rollback safe merely because columns are additive. Once no-homework writes exist, recovery requires capable readers/writers. Feature withdrawal should disable entry while retaining completed-source reads and worker processing; never relabel these rows as shared or unfinished assignments.

Production deploy/recovery procedures and any live rollout require a separate authorized step. No implementation issue, repository changes, PR, migration execution, paid call, learner-data upload or deployment was authorized in this design-only task.

## Design-review correction record

All three findings were checked against unchanged repository HEAD on 2026-10-07; no tests or implementation were performed.

- **P1 historical vs current completion:** current marker clears on promotion; immutable exact-source history is separate. Re-entry to no-homework remains supported before downstream work. Added state/transition table, operation-aware replay and unchanged/edited/replaced-source acceptance cases.
- **P1 ready extraction → snapshot gap:** specified periodic missing-obligation reconciliation plus shared source-specific deduplication/terminal admission, reusing ready extraction without another provider call. Added interruption/restart and pre-existing-ready-source fault injection criteria.
- **P2 unfinished intent admission:** added locked/CAS command matrix and checks before identical-source replay; ordinary public confirmation/downstream commands require create intent, while finish reuses the internal primitive. Added direct API/DB and intent-switch concurrency criteria.

The approved tutor experience and existing source owner remain unchanged. No product restriction on no-homework re-entry was introduced and no unresolved product decision is needed to resolve these findings.

## Handoff note

The tutor path is maintainer-approved. Technical names and endpoint spelling are proposals; changing the durable ownership model, billing boundary, source mutability, later-homework behavior or scope requires explicit product/contract deliberation. The next step is an authorized implementation handoff, with a bounded ESL Execution record linked to this planning design and allowed to sync to GitHub. Do not manually create duplicate issues.
