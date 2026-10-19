# ESL-62 Google Calendar cutover

## Meta

- Status: `active`.
- Last Verified Against: 2026-10-18, clean source `944d6679e5b3e8cfc952d94bc7dd90e27f768a01`.
- Exit Trigger: archive after the implementation PR merges, retaining operator/provider gates in the owning runbook.
- Current Focus: draft PR #420; real local Google acceptance found this-and-following and whole-series identity blockers requiring a continuity decision before merge.
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

No production access, environment mutation, cleanup, deployment, merge or release is authorized.
Real Google authorization/writes/invitations require explicit suitable test authorization. The
maintainer authorized the 2026-10-19 disposable-calendar/local-app exercise and its controlled
invitation. Production offline OAuth readiness, live cleanup counts and recovery remain separate
acceptance gates. Mock tests do not establish those facts.

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

Provider acceptance is blocked: a this-and-following edit creates a new master with copied markers
and no authoritative predecessor mapping, while an all-events time edit changes instance identities
under the same master and currently cancels/recreates future ESL lesson rows. See the
[owning runbook's findings](../operations/google-calendar-cutover.md#local-provider-acceptance-findings-2026-10-19).
Preserving lesson continuity requires an approved reconciliation design or explicit revised product
boundary. Do not infer that the earlier green hosted checks or passing single-instance move close
these real-provider blockers.

Keep this plan active while provider identity or operator acceptance remains outstanding. The PR and
handoff own exact commands/results and hosted state; local or hosted success is not provider or
production delivery.
