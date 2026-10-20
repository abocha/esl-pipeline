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

Production Google OAuth also depends on approved and publicly deployed legal pages, consent
branding, exact scope registration, and an audience/verification decision. See
[legal/OAuth readiness](google-oauth-legal-readiness.md), owned by ABO-58; ABO-56 retains the
separate production cutover boundary. Approved repository pages alone do not establish deployed public reachability or completed Google publication.

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

Compare exact provider identities, actual timing/duration and the visible ESL schedule. Exact
identities retain lesson IDs. The maintainer-approved continuity boundary permits unused future
projections to change IDs when the resulting schedule has no missing/duplicate appointments or
canceled replacement noise. Completed, charged, elapsed and linked history remains protected.
Registered association plus exact durable create provenance establishes student ownership for a
distinct successor/copy; it never proves a unique predecessor occurrence. Missing or mismatched
provenance stays unlinked. Mock fixtures cannot close the real-provider gate.

### Local provider acceptance findings, 2026-10-19

An authorized disposable Google calendar and isolated local application established real OAuth
consent/callback, encrypted offline credentials, token refresh, writable-calendar selection,
independent Monday/Friday creation, no-email one-off creation, invitation receipt confirmed by the
maintainer, and same-calendar disconnect/reconnect. A renamed/moved single occurrence retained its
ESL lesson ID and original-start binding while changing actual timing and duration. Deleting and
restoring the no-email one-off through Google's Trash retained its ESL lesson ID; no credits were
consumed. Reconnect retained all existing binding and lesson IDs.

Two provider identity cases initially blocked the original stable-ID acceptance contract:

- Google's **This and following events** time edit truncated the original master and created a new
  master and iCalUID, carrying the same private ESL association/request markers. The new event did not
  expose an authoritative predecessor mapping. Before the repair, ESL reported attention and left
  the new master unlinked; the truncated future occurrences became canceled.
- Google's **All events** time/duration edit retained the master ID but changed the generated
  instances' IDs and `originalStartTime`. Existing future lesson rows became canceled and new lesson
  rows were created for the changed instance identities. This failed the original continuity
  requirement. The separate single-occurrence move passed and was not evidence for this whole-series
  case.

The maintainer revised that boundary on 2026-10-19: internal IDs may change for unused future
projections if ESL shows the same resulting schedule without missing/duplicate lessons. Protected
completion, billing, elapsed and downstream history retains its identity and links. ESL-64 implements
this boundary with exact registered association plus durable create-request provenance for student
ownership, distinct master/occurrence identities, staged complete family projection and retained,
hidden obsolete rows. It never guesses an old-to-new occurrence from titles, recipients, nearby
times or iCalUID. Incomplete pages publish no partial replacement; protected conflicts pause with
attention. Migration 0072 fences new references to hidden projections under the lesson row lock;
old schema/data remain compatible with the previous Calendar runtime (scheduler retirement itself
still carries its original incompatible boundary).

Local re-observation of the retained real split/retime state matched **13 provider occurrences to 13
visible ESL lessons** by exact provider identity, actual start and duration, with zero duplicates or
visible canceled replacements. Nine obsolete rows remain retained/hidden. Deterministic regressions
cover retime-back, protected history, page failure, stale reference races, lease renewal and deletion
evidence surviving a completed refresh.

The subsequent disposable-provider acceptance completed before the merge handoff also established:

- Fresh Google UI whole-series retiming and a this-and-following split while the local dispatcher
  was stopped. After restart, all 14 then-associated occurrences matched the visible ESL schedule.
- Deleting the successor series hid its three unused projections; Google Trash restoration restored
  the same three lesson IDs as visible scheduled lessons, without consumed credits.
- Google UI Duplicate omitted the private provenance and remained unlinked. Separate no-attendee
  API copies with exact provenance produced six distinct occurrences/lessons across two masters for
  one synthetic student. Missing association, missing request hash and mismatched hash stayed
  unlinked without merging/reassigning existing lessons. Removing/changing metadata on an already
  bound exact master preserved its binding and lesson IDs. Deliberate provenance conflicts correctly
  surfaced attention.
- A saved operational email with explicit invitation opt-out produced `sendUpdates=none`, no
  attendees and one uncharged lesson.
- One real no-email insert was accepted, then its transport response was deliberately lost before
  local association. Normal durable retry recovered by GET: exactly one POST, the same predetermined
  event and one visible lesson. Separately, replaying the existing invitation-bearing intent in an
  attempted/unknown local state recovered with zero Calendar writes and unchanged event etag,
  attendees, binding and lesson. No additional invitation was sent. These are injected response loss
  and read-only invitation recovery replay, not an OS crash or a fresh invitation delivery test.

The final associated-provider comparison matched **21 occurrences to 21 visible ESL lessons**, with
zero duplicates or visible canceled replacements; 14 obsolete projections remain retained/hidden.
Focused exceptional-risk re-review closed the protected-family deletion checkpoint and actual
waiting-reference-writer regressions. Hosted final-head CI remains a separate merge gate; production
OAuth, deployed ingress, cleanup and recovery remain operator gates. Raw provider responses and
recipient details stay in ignored private evidence, outside Git.

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
- [Implementation history](../archive/plans/2026-10-18-esl-62-google-calendar-cutover.md)
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
