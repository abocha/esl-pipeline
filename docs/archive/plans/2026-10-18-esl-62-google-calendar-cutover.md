# ESL-62 Google Calendar cutover

## Meta

- Status: `archived`.
- Last Verified Against: 2026-10-19, ESL-64 local provider reprojection and focused regression evidence.
- Exit Trigger: implementation and provider acceptance complete; archive in the merging PR and retain operator gates in the owning runbook.
- Current Focus: implementation history for PR #420; final-head CI is the merge gate. Production activation and recovery remain separate operator work.
- Owner: ESL-62 implementation primary.

## Authority

[ESL-62](https://linear.app/abocha/issue/ESL-62) and its complete
[approved design](https://linear.app/abocha/document/google-calendar-scheduling-cutover-proposed-technical-design-and-ed388f12c39a)
own scope and acceptance. Design section 20 supersedes historical pending-approval wording.
The synchronized execution ledger is [GitHub issue 419](https://github.com/abocha/esl-pipeline/issues/419).

## Implementation boundaries

1. Concrete Google OAuth, encrypted credentials, workspace connection, callback/session lifecycle
   and log protection. Google authorization never provisions an ESL account.
2. Durable per-series creation/recovery, selected-calendar adapter and background projection. Google
   owns timing; ESL keeps lesson IDs, billing, completion and teaching lineage.
3. Student email, multi-slot setup, independent operation outcomes and Calendar connection UI.
   Remove local recurrence generation, materializing reads and scheduling bypass controls.
4. Versioned schema/trigger retirement, nonexecuting historical origin snapshots, scoped reviewed
   hide-only cleanup manifest, owning contracts/docs and generated schema references.
5. Focused mock/disposable evidence, independent security/concurrency/migration review and hosted
   PR checks. Primary owns integration and reports missing external evidence explicitly.

## Acceptance and authority boundaries

Multiple weekly slots remain separate operations; safe retries reuse provider event identity and
cannot resend invitations as recovery. Callback attempts are bound to current same-user cookies,
invalidated on logout/account changes, and fenced before grant commit. Background writes recheck
both initiator and grant-authorizer authority. Sync pagination/dirty intents survive interruption;
410 resets provider state without deleting the ledger. Completion and provider projection share
lesson locks. Reads cannot regenerate retired schedules.

The maintainer authorized the disposable-calendar/local-app exercise and controlled invitation,
then authorized completing acceptance and merging PR #420, plus read-only VPS readiness assessment.
Production environment mutation, cleanup and deployment remain unauthorized. Production offline
OAuth readiness, reviewed cleanup counts and recovery remain separate operator gates. Mock tests
do not establish those facts.

## Evidence ledger

Local evidence covers independent series/idempotency/recovery, OAuth/session/authority cases,
pagination/tombstones/410 and protected lineage, retired-history migration, scoped hide-only cleanup,
UI and HTTP contracts. Backend/frontend typechecks, schema baseline verification, contract-version
verification, Compose lint and test-project isolation checks passed. The disposable nginx/Caddy
sentinel harness passed 13 outcomes with no secrets in logs or redirects.

Independent exceptional-risk review closed three findings: review-state reconnect generation,
lineage committed while waiting on a lesson lock, and unbounded SDK requests. The lineage regression
failed before the fix and passed after it. The final cursor trust-boundary review had no blockers.

Real Google acceptance passed connection/offline refresh, selected-calendar creation, single-instance
move, invitation receipt, no-email cancellation/restoration and same-calendar reconnect. It exposed
an upload-limiter bug in connection status polling; the authenticated local status read now avoids
that action budget, while explicit provider actions retain it. The focused regression failed before
and passed after the fix; all 17 OAuth/PostgreSQL tests and backend typecheck passed.

Initial provider acceptance found that a this-and-following edit creates a new master with copied markers
and no authoritative predecessor mapping, while an all-events time edit changes instance identities
under the same master and currently cancels/recreates future ESL lesson rows. See the
[owning runbook's findings](../../operations/google-calendar-cutover.md#local-provider-acceptance-findings-2026-10-19).
The maintainer subsequently clarified that unused future projections may change IDs if the visible
schedule remains equivalent without missing or duplicate lessons. ESL-64 applies complete creation
families atomically, associates successor masters using exact registered creation provenance,
and hides obsolete unused projections without losing their audit rows. Protected history remains
unchanged and conflicting replacements pause with attention. New downstream references cannot attach
to a superseded row after a stale browser request. The revised design records this in section 22.

Real local re-observation of the retained split and retime cases matched all 13 current Google
occurrences exactly by provider ID, time and duration, with zero visible canceled rows or duplicate
IDs; nine obsolete projections remain retained/hidden. This is local provider evidence, not hosted
CI or production delivery. Other provider/operator proof gates remain as recorded in the runbook.

The repair passed 28 Calendar/PostgreSQL tests and 57 billing/timeline tests, backend typecheck,
schema baseline and contract verification. Exceptional-risk review found and closed stale-reference
admission, retained master-deletion evidence and lease-renewal gaps; focused regressions include
both source-link ordering boundaries and protected multi-master retry. Migration 0072 adds only
the reference guard and is compatible with the preceding Calendar runtime.

The remaining disposable-provider acceptance subsequently passed fresh retime/split, series
delete/restore, copy/provenance variants, saved-email opt-out and accepted-insert response-loss
recovery. The existing invitation intent recovered through read-only replay with unchanged
attendees and no resend; no fresh invitation crash test was performed. Final comparison matched
21 associated Google occurrences to 21 visible lessons with zero duplicates or canceled replacement
noise. The runbook owns current evidence details and production gates. The PR owns final-head hosted
state; neither local nor hosted success establishes production delivery.

## Calendar presentation follow-up

[ESL-63](https://linear.app/abocha/issue/ESL-63) records the maintainer's local visual rejection and
the bounded UI repair plan, implemented in the same draft PR. The shared Calendar panel now owns its
styles, keeps source/status and the common action visible, groups connection management in a
keyboard-accessible disclosure, and uses responsive labeled lesson rows. Recovery displays the
captured submitted request rather than disabled controls populated from new defaults.

Local desktop and mobile browser checks covered Business status, connection disclosure, and
multi-row student setup without submitting another provider write or invitation. Six focused
Calendar component tests and frontend typecheck passed, including immutable-request reload/retry,
invitation opt-out, exact-event association, and explicit operation adoption. The two provider
identity blockers were subsequently closed by ESL-64 and its separate provider acceptance; the
presentation changes alone did not resolve them.
