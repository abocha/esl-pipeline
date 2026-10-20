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
must not be submitted as effective production policies in this state. This revision applies the
maintainer-approved alpha decisions recorded in ABO-58 and the 20 October finalization request.
Final copy and an effective date remain pending approval.

This finalization performs no deployment, Google Console changes, secret provisioning, OAuth
authorization, push or PR creation. The maintainer pushed the earlier implementation; this revision
remains local on `codex/prepare-google-oauth-disclosures`. The dedicated production project/client described in ABO-58 is
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

The existing live homepage returned HTTP 200 during the initial implementation, not rechecked in this revision. The new legal files are local only;
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

## Approved alpha decisions and evidence

| Final-copy position                                                                                                                                                                            | Authority or implementation evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent unregistered project, operated by an individual; public brand and contact are ESL Pipeline and `hello@eslpipeline.com`.                                                            | Maintainer decision in ABO-58 and current request. No company, address, legal name or governing jurisdiction invented.                                                                                                                                                                                                                                                                                                                                                                    |
| Free invite-only alpha for 3–5 tutors in Russia and Vietnam, with no EU targeting.                                                                                                             | Maintainer decision. The public copy says a small tutor alpha; no claim that geography removes legal obligations.                                                                                                                                                                                                                                                                                                                                                                         |
| Tutors authorize submitted learner data, recordings and necessary student/guardian permissions; ESL retains responsibility for its own processing and safeguards.                              | Maintainer-approved allocation. No wholesale transfer of operator duties to tutors.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Tutors retain material rights and grant only service-operation permissions; tutor review of AI output is required.                                                                             | Maintainer-approved content direction; existing processing/publication workflow. No acceptance mechanism, liability cap or jurisdiction clause added.                                                                                                                                                                                                                                                                                                                                     |
| Production source-audio cleanup is enabled. Deletion eligibility and timing vary; transcript/history retention is separate.                                                                    | Maintainer's production confirmation in ABO-58 and current request; [cleanup lifecycle](recording-audio-cleanup.md). The false code default is not production evidence. No new rollout, probe, TTL promise or cleanup behavior change.                                                                                                                                                                                                                                                    |
| Disconnect stops local scheduling/sync and retains encrypted credentials/history; Google revocation is separate.                                                                               | [Existing disconnect](../../packages/batch-backend/src/application/google-calendar-connection.ts). No schema, token erasure or revocation change.                                                                                                                                                                                                                                                                                                                                         |
| Google event scope covers all calendars; app operations target the selected calendar and can read unassociated events there. Invitations transfer event details and recipient email to Google. | [OAuth client](../../packages/batch-backend/src/infrastructure/google-oauth-client.ts), [Calendar client/schema](../../packages/batch-backend/src/infrastructure/google-calendar-client.ts), [scheduling](../../packages/batch-backend/src/application/calendar-scheduling.ts), [sync](../../packages/batch-backend/src/application/calendar-sync.ts).                                                                                                                                    |
| Separate assistant authorization shares supported learner context; Calendar-derived lesson timing can affect recent-context selection.                                                         | [Lesson-memory repository](../../packages/batch-backend/src/domain/lesson-memory-repository.ts) orders eligible completed lesson evidence by `source_lesson.starts_at`; [context builder](../../packages/batch-backend/src/application/student-teaching-context.ts) selects recent entries; [MCP projection](../../packages/batch-backend/src/application/mcp-teaching-context.ts) exposes generated lesson-memory titles and generation dates, not raw Calendar event titles/timestamps. |
| Connected processing, hosting, storage and backup services handle relevant data. Provider arrangements are not invented.                                                                       | [Generation policy](../reference/GENERATION_PROVIDER_POLICY.md), [speech system](../reference/TTS_SPEECH_PERFORMANCE_SYSTEM.md), [storage uploader](../../packages/storage-uploader/README.md). Supported adapters do not establish deployed providers, locations or their contract terms.                                                                                                                                                                                                |

## Remaining publication blockers

1. Maintainer approval of the precise final copy and an effective date. Until then retain the draft
   notices and `noindex`. Do not claim that use of the app accepts the draft.
2. Confirm the actual production recipients and handling of submitted teaching data and
   Google-derived data before making the policy effective, so the category-based sharing disclosure
   and proposed Limited Use commitment match production. Repository adapters cannot establish vendor
   arrangements, processing locations or provider training/retention terms. Add specific disclosures
   only where these facts or an identified applicable requirement demand them; do not invent them.

No exact cleanup TTL is needed for the proposed wording, and no cleanup enablement work is pending.
The approved operator form, tutor/operator responsibility split, free alpha model and content rights
are resolved. An arbitrary age limit, governing-law clause, liability cap, universal erasure SLA or
new acceptance mechanism is not a prerequisite manufactured by this implementation. No determination
of Russian/Vietnamese legal compliance is asserted. Reopen identity or jurisdiction details only for
an identified applicable requirement, rather than treating all previously listed questions as blockers.

## Handoff

Finalization evidence (20 October 2026, current working tree):

- Only the two public HTML pages and this readiness record changed; app links, scopes,
  persistence, Disconnect and cleanup behavior are unchanged.
- Explicit-path Prettier checks and `git diff --check` passed.
- `pnpm docs:check:pr -- --from HEAD~1 --to HEAD` passed core/ops/non-core structure and
  local Markdown link checks against current working-tree content, with existing age-only warnings.
- The already-running local Caddy preview returned anonymous GET/HEAD 200 for both revised pages.
  Served HTML matched the files. Internal links and stylesheet resolved; English language,
  canonical URLs, draft/noindex status, Calendar fragment and approved-copy assertions passed.
- Browser review confirmed the revised Privacy and Terms content, layout and cross-navigation.
  The user-requested preview remains running at `http://127.0.0.1:8787/`.
- No application tests/build were rerun for this static-copy/documentation revision; the initial
  implementation evidence below is historical and is not represented as a new test run.

Initial implementation evidence (before this copy-only revision):

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

Approve the final copy and effective date and resolve the specific factual gate above before production publication. Promote approved
PR/CI execution through ESL Execution per [issue intake](github-issue-intake-and-codex-work-selection.md).
ABO-58 remains the decision owner; [ABO-56](https://linear.app/abocha/issue/ABO-56) owns the separate
Calendar cutover. Its OAuth dependency is: approved and deployed public legal URLs, verified
homepage/domain/branding, Calendar API and exact scopes configured, an audience/verification
decision, and secure production credential handoff. No Linear record was mutated by this local task.
The [Calendar cutover runbook](google-calendar-cutover.md) remains the execution owner.
