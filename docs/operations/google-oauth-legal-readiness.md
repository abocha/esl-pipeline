# Public legal pages and Google OAuth readiness

## Meta

- Audience: maintainer and production OAuth operator.
- Authority Level: implementation evidence and pending decision record.
- Last Verified Against: 2026-10-20 local implementation and Google documentation.
- Owner: founder-maintainer.
- Review Cadence: before legal publication or OAuth submission.
- Status: `active`.

## Current boundary

[ABO-58](https://linear.app/abocha/issue/ABO-58) owns legal/product decisions. The English
[Privacy Policy](../../deploy/landing/privacy/index.html) and
[Terms of Service](../../deploy/landing/terms/index.html) are implemented **drafts**, with visible
notices and no effective date or acceptance claim. They are not approved legal commitments and
must not be submitted as effective production policies in this state. The maintainer confirmed
`hello@eslpipeline.com` for public contact during this implementation.

No production deployment, Google Console changes, secret provisioning, OAuth authorization, push,
or PR is part of this work. The dedicated production project/client described in ABO-58 is
issue-reported evidence, not a Console inspection performed by this implementation task.

## URLs and hosting

| Purpose              | Proposed production URL                                    |
| -------------------- | ---------------------------------------------------------- |
| OAuth homepage       | `https://eslpipeline.com/`                                 |
| Privacy Policy       | `https://eslpipeline.com/privacy/`                         |
| Terms of Service     | `https://eslpipeline.com/terms/`                           |
| Server-side callback | `https://app.eslpipeline.com/api/google/calendar/callback` |

The existing [Caddy configuration](../../deploy/caddy/Caddyfile) serves `deploy/landing` from
`/srv/landing`, mounted read-only by [production Compose](../../docker-compose.prod.yml).
Directory index files provide the legal URLs without authentication or JavaScript. No proxy,
OAuth, or deployment configuration changes are required. Trailing slashes are intentional;
use these same URLs in branding and app links. The landing footer, unauthenticated screen,
authentication dialog, authenticated workspace rail, and Calendar connection disclosure link to
the pages. App links open another tab to preserve in-progress assignment work.

The existing live homepage returned HTTP 200 during this task. The new legal files are local only;
their live reachability must be checked after a separately authorized deployment. The drafts use
`noindex`; remove it alongside draft notices only after approval. See
[public landing operations](public-landing-page.md) for the existing hosting boundary.

## Exact requested scopes and minimum-access assessment

The source of truth is
[`GOOGLE_CALENDAR_SCOPES`](../../packages/batch-backend/src/infrastructure/google-oauth-client.ts).
No scope or authorization behavior is changed by this implementation.

| Exact scope                                                      | Code-backed purpose                                                                                           | Narrower alternative and conclusion                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `openid`                                                         | Verify Google subject, issuer, audience and nonce for the Calendar grant.                                     | Needed to bind the external account; does not sign the user into ESL.                                                                                                                                                                                                                                                        |
| `email`                                                          | Verify and display the connected Google email.                                                                | No `profile` scope needed. Exchange accepts Google's `userinfo.email` equivalent.                                                                                                                                                                                                                                            |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | List subscribed calendars filtered to writer/owner access for selecting an existing calendar.                 | Read-only list permission; full Calendar or Calendar-list write access is unnecessary.                                                                                                                                                                                                                                       |
| `https://www.googleapis.com/auth/calendar.events`                | Read and synchronize selected-calendar events and create lesson events/series, optionally inviting a student. | Read-only/free-busy cannot create events or supply all scheduling facts. `calendar.events.owned` would exclude supported calendars where the account is a writer rather than owner. `calendar.app.created` would require changing the product to create its own calendar instead of selecting an existing writable calendar. |

The selected-calendar boundary is enforced by application behavior, **not** by Google's grant:
`calendar.events` permits event access across calendars. Preserve that distinction in the consent
justification and UI. The integration does not request Gmail, Drive, Contacts, full Calendar,
calendar creation, ACL management, or Google profile scope.

[Google's Calendar scope reference](https://developers.google.com/workspace/calendar/api/auth)
and [event insertion reference](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
support these capabilities. Google identifies Calendar event access as sensitive in its
[sensitive-scope verification guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).
Plan for sensitive-scope review because of `calendar.events`; do not label the entire requested set
restricted or assume a restricted-scope security assessment. Google's public Calendar reference
does not label every scope's classification. Confirm the exact per-scope categories in the production
Data Access picker/Verification Center before submission, including Calendar-list read access;
do not assume every Calendar scope is sensitive.

The authorization URL requests `access_type=offline`, `prompt=consent`, PKCE S256, state and nonce,
with `include_granted_scopes=false`. Exchange checks the **actual** granted scopes and verified
identity. Stored encrypted refresh credentials support background sync. The grant persistence path
requires offline access; tokens can still expire or be revoked. External Testing refresh tokens
expire after seven days for this scope set; the basic-identity-only exception does not apply.
See [Google token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## Publication and verification requirements

- Use separate test and production projects, as required by
  [Google production policy](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).
  ABO-58 reports a dedicated `esl-pipeline-production` project; its settings remain to be checked
  by the authorized operator. Enable Calendar API and declare exactly the source scope set.
- For External production, provide a meaningful public homepage, Privacy Policy, and Terms URLs
  on an owned/verified authorized domain, with the same Privacy Policy linked on the homepage
  and consent screen. The app host's invite-only sign-in is not a sufficient homepage.
  [Current branding requirements](https://support.google.com/cloud/answer/15549049) require all
  three links. Verify Search Console ownership, brand identity/logo and monitored support email.
- Brand verification/publication and scope verification are separate. Current branding guidance
  requires published branding before requesting data-access verification. Switching the audience
  to In production does not complete verification.
- For a few users personally known to the maintainer, Google's personal-use exception can permit
  unverified use with warnings and a user cap. Testing is another exception, with an allowlist,
  tester warnings and seven-day refresh expiry here. A closed alpha of unrelated tutors is not
  automatically personal use. Decide the actual audience; for broader external use, prepare scope
  justifications and an English demonstration of consent and each sensitive-scope feature.
  See [verification exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification#exceptions-verification-requirements)
  and [audience settings](https://support.google.com/cloud/answer/15549945).
- The [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
  requires accurate access/use/storage/sharing disclosures, minimum access, and applicable Limited
  Use restrictions, including restrictions on transfers and human access. The proposed public
  commitment needs operational and legal approval; source inspection alone cannot prove provider,
  employee, backup, security or contractual compliance. Do not assert certification.

## Data-flow evidence and decisions

| Proposed public language or position                                                                         | Current repository evidence                                                                                                                                                                                                                                                                                                                                                                                                                                 | Genuinely unresolved decision                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invite-only tutor workspace; contact `hello@eslpipeline.com`.                                                | Auth invitation screen, existing landing; email confirmed by maintainer.                                                                                                                                                                                                                                                                                                                                                                                    | Legal operator name, individual/business identity and required address/disclosures. Do not infer from the brand or Google organization.                                                                                       |
| Account, student, transcript, profile, homework, lesson and payment records are processed.                   | [Backend README](../../packages/batch-backend/README.md), [frontend README](../../packages/batch-frontend/README.md), [alignment](../backend-frontend/backend-frontend-alignment.md).                                                                                                                                                                                                                                                                       | Tutor/operator privacy roles, lawful grounds, student/guardian information, eligibility and minors. No arbitrary age limit chosen.                                                                                            |
| Calendar account/list/event fields support selected-calendar scheduling and invitations.                     | [OAuth adapter](../../packages/batch-backend/src/infrastructure/google-oauth-client.ts), [Calendar schema/client](../../packages/batch-backend/src/infrastructure/google-calendar-client.ts), [selection/disconnect](../../packages/batch-backend/src/application/google-calendar-connection.ts), [scheduling](../../packages/batch-backend/src/application/calendar-scheduling.ts), [sync](../../packages/batch-backend/src/application/calendar-sync.ts). | Approve Limited Use commitments and review operational access and downstream use of Google-derived scheduling facts. A selected calendar can contain unassociated events; do not promise only associated events are read.     |
| Credentials are encrypted; history, operation payloads and some event observations are retained.             | [Credential repository](../../packages/batch-backend/src/domain/google-connection-repository.ts), [migration 0069](../../packages/batch-backend/migrations/0069_google_calendar_connection.sql), sync operation observations.                                                                                                                                                                                                                               | Retention schedule, erasure workflow, backup expiry, and handling retained disconnected credentials. No universal encryption or deletion guarantee.                                                                           |
| Disconnect stops sync without revocation or erasure; users can revoke at Google and email deletion requests. | Disconnect changes grant/connection status, leaving encrypted credentials and records. No Google revocation call in that operation.                                                                                                                                                                                                                                                                                                                         | Approve request handling, identity checks, response obligations and exceptions; a self-service account erasure workflow is not established.                                                                                   |
| Audio playback unavailability is separate from physical cleanup; transcripts remain.                         | [Recording retention config](../reference/env.md), [cleanup operations](recording-audio-cleanup.md), backend recording lifecycle.                                                                                                                                                                                                                                                                                                                           | Approve deployed cleanup settings and all retention periods. Default cleanup disabled; a seven-day recovery default is not a seven-day deletion promise.                                                                      |
| AI/STT/TTS providers receive relevant teaching content; published URLs and assistant grants disclose data.   | [Generation policy](../reference/GENERATION_PROVIDER_POLICY.md), [speech system](../reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md), [storage uploader](../../packages/storage-uploader/README.md), [MCP transport](../../packages/batch-backend/src/transport/mcp-oauth.ts).                                                                                                                                                                                   | Confirm actual production providers, regions, contracts, training/retention terms, transfers, and any Google-derived data entering learner-context output. Supported adapters are not proof of active processors.             |
| Functional cookies/storage and logs; no ad/analytics trackers found in reviewed frontend/landing.            | Auth/refresh handling, Calendar attempt cookie, theme and Calendar draft browser storage, static landing.                                                                                                                                                                                                                                                                                                                                                   | Confirm production edge/host logging and any external telemetry; approve legal cookie disclosures.                                                                                                                            |
| Review generated output; share only authorized material; payment recording does not collect funds.           | Existing assignment publication and Business UI.                                                                                                                                                                                                                                                                                                                                                                                                            | Content ownership/licence, commercial terms, eligibility, availability, suspension/termination, liability, governing law, disputes, effective date and update/acceptance process. No new legal contract silently established. |

## Handoff

Focused local evidence obtained:

- Frontend `typecheck` and production `build` passed.
- Existing AuthDialog, CalmStudioShell and CalendarSchedulingPanel suites: 18 tests passed across
  three files. No test expectations or fixtures changed.
- Biome passed on changed frontend source with one existing Calendar effect-dependency warning;
  Vite reported existing configuration/chunk-size warnings.
- A disposable local Caddy 2.11 file server, using a read-only mount of the same landing directory,
  returned anonymous HTTP 200 for both legal pages, the homepage, stylesheet and internal links.
  Slashless legal paths redirected to the chosen trailing-slash paths; HEAD returned HTML without
  a session cookie. Both legal pages rendered in the browser and cross-navigation worked.
- Browser inspection of the local app sign-in screen confirmed canonical legal destinations and
  separate-tab links with `noopener noreferrer`.
- Generated docs indexes were refreshed without a generated-file diff. PR-mode core/ops/non-core
  structure checks and changed-Markdown link regression checks passed against the working tree
  and HEAD baseline (365 authored sources scanned). The check-library entrypoints were used
  directly because the CLI requires a committed diff; no commit was created. Only existing
  age warnings remained. Changed Markdown formatting and `git diff --check` passed.

This is local evidence; hosted CI, deployed legal URLs, production OAuth settings, token issuance,
provider policy compliance and legal approval are not established.

Approve legal copy and settle the decision table before production publication. Promote approved
PR/CI execution through ESL Execution per [issue intake](github-issue-intake-and-codex-work-selection.md).
ABO-58 remains the decision owner; [ABO-56](https://linear.app/abocha/issue/ABO-56) owns the separate
Calendar cutover. Its OAuth dependency is: approved and deployed public legal URLs, verified
homepage/domain/branding, Calendar API and exact scopes configured, an audience/verification
decision, and secure production credential handoff. No Linear record was mutated by this local task.
The [Calendar cutover runbook](google-calendar-cutover.md) remains the execution owner.
