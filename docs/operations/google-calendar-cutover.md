# Google Calendar scheduling cutover

## Meta

- Audience: maintainers and operators.
- Authority Level: operational runbook.
- Last Verified Against: 2026-10-18 approved ESL-62 design and implementation work.
- Owner: founder-maintainer + ESL-62 implementation owner.
- Review Cadence: on Calendar, OAuth, schema or deployment changes.
- Status: `active`.

## Scope and completion boundary

[ESL-62](https://linear.app/abocha/issue/ESL-62) and the
[approved design](https://linear.app/abocha/document/google-calendar-scheduling-cutover-proposed-technical-design-and-ed388f12c39a)
replace the independent scheduler with one explicitly selected writable Google lesson calendar.
Google is required for scheduling only. ESL retains lesson identity, completion/no-show, billing,
credits, payments, homework and teaching history. Google login/signup and student self-booking are
outside this change.

Code and mocked/disposable validation do not establish real provider behavior or production
activation. Keep these gates distinct in every handoff:

- Local implementation, focused tests and independent security/concurrency/migration review.
- Required hosted PR checks and `CI gate` for the final PR head.
- Explicitly authorized disposable Google UI/invitation acceptance and offline OAuth readiness.
- Separately authorized live inventory, reviewed cleanup manifest, recovery and deployment.

No command in this runbook itself grants production or provider authorization.

## Scheduling and recovery contracts

An owner/admin connects an external Google account and selects a writable calendar by provider ID.
Google identity need not match ESL email and grants no ESL login authority. Owner/admin/member may
create student schedules; viewers cannot. Grant-authorizer role loss fences the connection until
explicit authorized reconnect. Initiator role loss prevents new queued writes, even through an
otherwise valid grant. Read-only recovery of an already attempted known event needs an authorized
connection; owner adoption preserves the original operation/event identity.

Each independent weekly row creates a separate Google series. A Monday success and Friday failure
remain separate outcomes. Retries retain the immutable request key and allocated event ID. A provider
success followed by local failure recovers through GET/provenance verification, never invitation
resend or automatic compensation deletion. Changing student email affects future creation only.
Invitation delivery and RSVP remain Google behavior; RSVP never silently changes credits.

Only selected-calendar events with verified internal bindings become lessons. Unknown events remain
unlinked. Copies/splits cannot establish occurrence identity through title, email, time proximity,
iCalUID or marker alone. Provider instance original start and stable event/master mapping are
independent of actual moved start time. Preserve protected history and display discrepancies.

Background polling and bounded instance projection run independently of HTTP reads. Page checkpoints
and dirty refresh intents are committed together; `Synced` requires projection completion too.
Incomplete pages are never cancellation proof. A 410 resets provider sync state, not ledger IDs,
bindings, operations or history. Provider cancellation of an upcoming uncompleted lesson does not
charge a credit; completed, no-show, charge/history and elapsed cases require explicit review.

## OAuth and logging readiness

Configure the exact canonical callback URI in the Google OAuth client. Enable only the approved
openid/email, calendar-list read and event permissions. Calendar event scope is broader than one
calendar; disclose this while enforcing selection server-side. Require actual granted scopes and an
offline refresh credential before calling the connection ready.

Provider tokens use dedicated versioned encryption keys; never reuse JWT secrets. Keep old read keys
available through rotation and record key IDs privately. Both API and worker need compatible config.
Partial enabled configuration must fail closed for Calendar while unrelated workflows remain usable.
Never put credentials, tokens, OAuth URLs or recipient/event payloads in normal evidence or logs.

The browser redirect uses a narrow same-user refresh-cookie verifier plus one-time browser/state
binding. It never carries ESL bearer tokens in URLs or creates/rotates ESL sessions. Login/account
switch/logout invalidate unfinished browser-bound attempts in PostgreSQL and clear the consistently
scoped cookie. Ordinary refresh preserves the attempt. Callback grant commit rechecks invalidation
and current authority under lock.

Before enabling callback ingress, exercise synthetic sentinels through backend and frontend nginx:
success/error, malformed parameters, not-found and upstream failure. Inspect access, error and
upstream logs and redirects. Raw code/state/headers must be absent; bounded route/status/request-ID
outcomes remain observable. Keep Caddy's canonical routing and avoid enabling raw callback URL logs.
An isolated backend test alone does not prove the deployed ingress chain.

## Reviewed internal schedule cleanup

Migration retirement preserves old rule/slot/occurrence snapshots as nonexecuting historical data
and replaces activity triggers before dropping obsolete columns/tables. Useful lesson duration,
timezone and notes remain. Old generators, materializing reads and bypass routes are removed.
Protected rows remain unmanaged lessons usable for completion/homework; no retroactive Google
events or invitations are created for them.

The operator CLI `packages/batch-backend/src/tools/calendar-cutover.ts` works after the cutover
schema is installed. Run `pnpm --filter @esl-pipeline/batch-backend calendar:cutover --` followed by
the arguments below, or use the
compiled `dist/tools/calendar-cutover.js` in the matching release. It accepts exactly one mode:

```text
--plan --workspace-id <workspace UUID> --manifest <new private JSON path>
--apply --workspace-id <same workspace UUID> --manifest <reviewed JSON path> --confirm-fingerprint <reviewed fingerprint>
```

Plan reads one consistent snapshot and writes a new manifest without overwriting an existing file.
It records rule/slot IDs, candidate/protected lesson IDs, reference reasons and fingerprints, without
contact addresses or operational notes. Review exact workspace, IDs, counts and exclusion reasons.
It does not perform production inventory without separate authorization.

Apply requires the exact reviewed fingerprint. It locks the ledger and reference owners briefly,
rechecks the complete snapshot and aborts on drift. It only hides eligible scheduled placeholders
with `internal_scheduler_retired`; it never deletes a lesson, nulls a lineage FK, rewrites activity or
calls Google. Credit references in either direction, lifecycle facts, downstream links, immutable
lifecycle activity, assignment-source snapshots and reminder references protect a row. Creation/change
activity stays attached to hidden unused placeholders. New Calendar bindings protect provider rows.

Pause application writers during the authorized controlled cutover; do not run old images containing
the scheduler against the retired schema. A lock timeout or drift failure needs a fresh plan/review,
not relaxed predicates. Keep the manifest and sanitized apply result with private operator evidence.

## Provider UI evidence gate

Use an explicitly authorized disposable calendar, synthetic students and controlled invitation
addresses. Capture before/after provider JSON privately, stripping credentials and recipient data
from shared results. Record calendar ID, operation/master/instance IDs, originalStartTime, actual
timing, version, opaque marker and explicit cancellation evidence for:

1. One-off and Monday 11:00/Friday 09:00 independent series; invite/no-email/opt-out cases.
2. Rename/move one occurrence, whole-series time/duration changes and this-and-following time changes.
3. One-occurrence deletion, truncation/deletion/restoration and reconnect.
4. Copy carrying a marker, missing/changed metadata and an interrupted split.
5. Accepted insert followed by local interruption: same event and lesson IDs, no second invitation.

Compare against the stable ESL lesson and billing/source IDs. Do not interpret a shared marker as
unique predecessor continuity. If Google returns a new master without authoritative continuation,
retain history and report association required. Return the precise automatic-handling limitation for
maintainer approval before claiming the approved product contract is satisfied. Mock fixtures cannot
close this gate.

## Production release and recovery

Follow the existing [deployment guide](../backend-frontend/DEPLOYMENT.md) and immutable release-image
handoff. No merge, release, deployment or cleanup is authorized by ESL-62 implementation alone.
Before an authorized rollout, record the backup/recovery point, previous immutable images, schema
compatibility, exact selected workspace and reviewed inventory. OAuth consent publishing/verification,
exact redirect registration, offline availability and ingress logs require environment evidence.

Retirement is incompatible with old scheduler images. Recovery must restore a reviewed compatible
database/application pair; restarting an old image is not a safe rollback. Keep secrets and raw
operator inventory in the private operations record. Never delete events in other Google calendars
as cleanup. Explain that original appointments there may remain visible alongside recreated lessons.

## Related

- [Scheduling and billing decisions](../reference/SCHEDULE_BILLING_PRODUCT_DECISIONS.md)
- [Execution plan](../plans/2026-10-18-esl-62-google-calendar-cutover.md)
- [Testing guide](../reference/TESTING_GUIDELINES.md)

## OAuth configuration and callback observability

Calendar scheduling uses `GOOGLE_CALENDAR_ENABLED` (default `false`),
`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, and
`GOOGLE_CALENDAR_REDIRECT_URI`. Register the exact canonical callback
`https://app.eslpipeline.com/api/google/calendar/callback`; the internal backend route is
`/google/calendar/callback`. Do not register a transition host. Disabled or invalid Calendar
configuration closes Calendar operations while other teaching, homework and billing stay usable.
Connection status exposes a bounded configuration reason, never secret values.

Configure the dedicated `INTEGRATION_CREDENTIAL_ACTIVE_KEY_ID` and
`INTEGRATION_CREDENTIAL_KEYS` JSON object. Each key value is a base64-encoded random 32-byte
AES key; retain old read keys while rotating the active key. There is no JWT/settings key fallback.
Both API and batch-worker receive these settings through their existing Compose `env_file` owner;
no credentials belong in Compose YAML or public execution records.

Consent requests only OpenID/email, Calendar list read access and Calendar event access. Event
permission covers calendars beyond the selected lesson calendar; ESL enforces the chosen calendar
for scheduling. Require verified identity, actual scopes and offline refresh availability before
selection. A selected source needs current writer/owner Calendar access. Connecting a different
Google account never changes ESL login identity. Full Google revocation is project-wide; local
Calendar disconnect preserves ledger/mappings and does not call that revocation API.

The callback reads only the configured HTTP-only ESL refresh cookie and a separate short-lived
`esl_calendar_attempt` cookie. The binding cookie uses Path `/`, the refresh-cookie domain and
Secure setting, HTTP-only and SameSite=Lax. In production the refresh cookie must be Secure,
callback-compatible and not SameSite=Strict. Logout works without a surviving ESL cookie and
invalidates unfinished attempts for the presented browser binding in PostgreSQL. Explicit successful
login/registration also invalidate that binding; ordinary refresh preserves it. Callback commit and
invalidation serialize on the attempt row. The callback always redirects to the fixed query-free
`/calendar/connection-result`; status and calendar selection happen after returning to ESL.

nginx emits only a fixed route label, method, status and generated request ID in access logs. Raw
nginx error diagnostics are suppressed because parser/upstream failures can include sensitive request
lines before a location handler runs. Caddy keeps access logging disabled and excludes its raw
`http.log.error` request diagnostics; nginx supplies sanitized outcomes while available. Backend
callback error/not-found/security logging omits raw URL, headers, exception payloads and descriptions.
Callback responses use no-store and no-referrer. Do not enable edge debug or raw URL logs for an
OAuth incident; use sanitized classifications and the browser-visible status instead.

Run `node scripts/test/google-calendar-callback-ingress.mjs` for disposable nginx/Caddy sentinel
coverage. It creates an isolated Docker network, synthetic backend and temporary containers, then
removes them. It uses current ingress configurations and checks success, provider/error-shaped,
malformed, unmatched and upstream-failure requests. It requires the repository development Node
image plus the frontend nginx and production Caddy images. This local proof does not establish
production configuration, real Google consent, invitations or recurring-series behavior.
