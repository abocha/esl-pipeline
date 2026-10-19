# ESL-62 Google Calendar cutover

## Meta

- Status: `active`.
- Last Verified Against: 2026-10-18, clean source `944d6679e5b3e8cfc952d94bc7dd90e27f768a01`.
- Exit Trigger: archive after the implementation PR merges, retaining operator/provider gates in the owning runbook.
- Current Focus: implementation and independent review complete locally; prepare draft PR and obtain hosted evidence, retaining external provider/operator gates.
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
Real Google authorization/writes/invitations require explicit suitable test authorization. Real UI
this-and-following identity, production offline OAuth readiness, live cleanup counts and recovery
remain separate acceptance gates. Mock tests do not establish those facts.

## Evidence ledger

Local evidence covers independent series/idempotency/recovery, OAuth/session/authority cases,
pagination/tombstones/410 and protected lineage, retired-history migration, scoped hide-only cleanup,
UI and HTTP contracts. Backend/frontend typechecks, schema baseline verification, contract-version
verification, Compose lint and test-project isolation checks passed. The disposable nginx/Caddy
sentinel harness passed 13 outcomes with no secrets in logs or redirects.

Independent exceptional-risk review closed three findings: review-state reconnect generation,
lineage committed while waiting on a lesson lock, and unbounded SDK requests. The lineage regression
failed before the fix and passed after it. The final cursor trust-boundary review had no blockers.

Keep this plan active while provider identity or operator acceptance remains outstanding. The PR and
handoff own exact commands/results and hosted state; local or hosted success is not provider or
production delivery.
