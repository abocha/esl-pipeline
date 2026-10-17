# Student History overhaul

## Meta

- Status: `archived`.
- Owner: founder-maintainer and implementation primary.
- Last Verified Against: 2026-10-18 local implementation based on `dbf8458c`.
- Current Focus: historical implementation contract; backend/frontend package READMEs own current behavior.
- Archive Trigger: implementation PR carries this archive; ESL-60 records hosted CI, merge, release-image
  verification and the manual deployment handoff. Production deployment is explicitly excluded.

## Approved outcome

The maintainer approved the reviewed
[History overhaul plan](https://linear.app/abocha/document/student-history-overhaul-approved-product-evidence-and-delivery-plan-1c76cb08fb36)
and its test/complexity review on 2026-10-17. Linear owns durable planning; this file is the
historical repository execution contract. [ESL-60](https://linear.app/abocha/issue/ESL-60) owns History
implementation. Existing local Business and Student work remains in ESL-57/58/59.

History answers what happened with a learner, what changed, and where to open the result. Replace
the ornamental mixed feed with a compact, flat, student-scoped chronological list. Main filters
are All, Lessons & homework, Profile, and Payments & credits; date filtering and Load older are
included. Keep practical facts and destinations visible, with technical provenance in Details.
No unsupported metrics, confidence scores, placeholder pending metadata, or workspace-wide noise.

## Recording and read contracts

- Record otherwise-lost effective transitions at their actual transactional backend owner.
  Compare locked before/after values, omit no-ops, and append atomically with domain state.
- One committed transition is not an exactly-once HTTP command guarantee. Existing commands
  without operation identity retain their current replay semantics. Reuse existing CAS only
  where it actually exists.
- Reuse retained publication, ledger, revision and immutable transcript-finish evidence rather
  than duplicating every domain record. Older unknown actors/transitions remain unknown.
- Page stable parent activity/outcome rows before attaching their related effects. Do not group
  by title/time or collapse repeated transitions into the latest entity state.
- Required reads return a page or fail unavailable; do not advance past a failed mandatory
  source. Optional enrichment can fail separately. A traversal time bound is not a database
  snapshot; later commits become discoverable on Refresh.
- Authorize the student/workspace before filters or pagination. Preserve current transcript
  user authorization and old timeline consumers, including Overview and `/timeline`.
  Published HTML outcomes retain the old timeline's student-scoped visibility, including legacy
  student links through recording/prompt/draft. Private transcript sessions and recovery attempts
  remain requesting-user scoped; publication rows do not expose private source content or errors.
- Coverage begins only when relevant recording-capable writers are active. Schema creation
  does not establish continuous coverage. Recovery to non-recording writers creates a known gap.
- Transcript finish remains historical evidence after homework promotion; it never reestablishes
  the current completion marker or changes lesson billing.

## Scope

Include meaningful lesson/status/time/duration changes and restoration; profile revisions and
candidate decisions; payment/credit facts and supported reversals; student lifecycle; reminder
hide/undo as secondary detail; transcript finishes, publication and correction relations.
Optional memory summaries enrich a lesson but never prove completion/publication.

Defer text search, entity-specific activity views, reminder-preference history, new memory-health
instrumentation, manual notes, messaging, exports and read receipts. Do not introduce event
sourcing, an event bus, outbox, worker, audit SDK, cache framework, calendar rewrite or new billing
policy. Remove obsolete local mapping/CSS/requests only when replacement coverage exists.

## Delivery and authorization

1. Preserve the prior tracked and untracked tree: snapshot branch
   `codex/history-pre-overhaul-snapshot`, commits `4f989037` and `dbf8458c`.
2. Complete backend, frontend, migration tests and representative fictional browser QA locally.
3. Partition three large thematic PRs: Business/browser reliability; Student truthfulness and
   availability; complete History overhaul. Preserve the current History availability fixes as
   the redesign baseline. Validate each PR's actual boundary and the final integrated tree.
4. Submit and merge sequentially after required hosted CI, allowing release publication to finish
   between merges and reconciling release-bot commits. Use actual release labels; runtime changes
   do not qualify for `release:none`.
5. Verify the final complete immutable release-image bundle and prepare the manual handoff.

The user explicitly authorized local implementation, commits, submission, required CI follow-up,
sequential merges and publication verification. **Do not deploy.** Do not invoke production deploy
scripts, including `--plan`, migrate production, recreate services, or mutate production records.
The maintainer will deploy manually later. Any live acceptance checks are handed off, not claimed.

Use `.codex/ORCHESTRATION.md` for ownership/review and the testing guide for evidence selection.
No runtime goal subgoals or agent-per-phase topology is required. Material scope/contract changes
beyond the approved plan remain escalation points; routine implementation choices do not.

## Acceptance evidence

- Real PostgreSQL mutation-to-feed sequences preserve repeated reschedules and
  complete/restore/complete, review transitions, activation, lifecycle, supported reversal and
  transcript-finish/promotion semantics.
- Failed activity persistence rolls back its domain transition; no-op repeat emits no duplicate;
  foreign-workspace calls do not read/write either entity or history.
- Parent-row pagination handles same-time ties, related effects, older matching records and
  date filters. Late commits appear on Refresh without a cross-request snapshot promise.
- UI distinguishes empty/unavailable/partial, preserves loaded data on failed Retry, and cannot
  expose learner A data after switching to B with a late A response and failed B load.
- Existing transcript access and timeline callers survive migration. Retire transport-shape tests
  only after new boundary coverage preserves their independently useful behavior.
- Migration declarations, `schema.sql`, contract verification and disposable upgrade evidence
  match actual SQL. Additive SQL is not automatically declared compatible.
- Fictional desktop/narrow/zoom/keyboard QA verifies the flat list, contextual links, loaded dates
  and stable shell. Final frontend production build and relevant effective CSP/header evidence
  cover the integrated tree.
- Hosted CI and complete final release-image publication are verified after submission/merges.
  No local test or publication success is described as production validation.

## Current state

Implementation and focused local validation are complete. ESL-60 owns the remaining hosted CI,
merge, publication verification and manual deployment handoff; those outcomes are not implied by
this archived design record. No production deployment or live acceptance is included.
