# Public legal pages and Google OAuth readiness

## Meta

- Audience: maintainer and production OAuth operator.
- Authority Level: publication handoff and implementation reference.
- Last Verified Against: 2026-10-20 approved alpha copy and current implementation.
- Owner: founder-maintainer.
- Review Cadence: on changes to public disclosures, Google data use or OAuth requirements.
- Status: `active`.

## Approved publication state

The maintainer approved the [Privacy Policy](../../deploy/landing/privacy/index.html) and
[Terms of Service](../../deploy/landing/terms/index.html) for the small free, invite-only alpha,
with **20 October 2026** as the intended effective date. The pages carry that date, ordinary
publication metadata, and no draft notice or `noindex`. No acceptance mechanism is invented.
[ABO-58](https://linear.app/abocha/issue/ABO-58) remains the legal/product decision record.
The bounded PR/CI execution record is [ESL-65](https://linear.app/abocha/issue/ESL-65).

The repository implementation is publication-ready. This does not establish live deployment,
Google branding publication, audience publication or scope verification. The authorized Git
handoff includes commit, push, PR and merge after required CI passes; deployment and Google Cloud
mutations remain outside this task.

## Public URLs and hosting

| Purpose              | Production URL                                             |
| -------------------- | ---------------------------------------------------------- |
| OAuth homepage       | `https://eslpipeline.com/`                                 |
| Privacy Policy       | `https://eslpipeline.com/privacy/`                         |
| Terms of Service     | `https://eslpipeline.com/terms/`                           |
| Server-side callback | `https://app.eslpipeline.com/api/google/calendar/callback` |

The existing [Caddy site](../../deploy/caddy/Caddyfile) serves `deploy/landing` as static files
through the read-only [production Compose mount](../../docker-compose.prod.yml). Directory indexes
provide both legal URLs without authentication or JavaScript. Keep trailing slashes consistent in
branding and application links. No routing or hosting configuration changes are needed.

The public landing footer, sign-in screen, authentication dialog and workspace rail link to both
pages. App legal links open another tab to preserve assignment work. The Calendar connection screen
explains background sync, invitation sharing, OpenAI processing, optional ChatGPT context sharing,
and Disconnect behavior before the user proceeds to Google consent. See
[public landing operations](public-landing-page.md).

## Approved alpha boundaries

- ESL Pipeline is an independent unregistered project operated by an individual, using the public
  brand and `hello@eslpipeline.com`. No company, address or governing jurisdiction is invented.
- The free invite-only alpha is for 3–5 tutors in Russia and Vietnam, without EU targeting.
- Tutors authorize submitted learner data and recordings and obtain necessary student/guardian
  permissions. ESL remains responsible for its own processing and safeguards.
- Tutors retain material rights and permit only the processing/sharing needed to operate the
  service. Tutors review AI output. Payment records do not collect money or create a subscription.
- Production source-audio cleanup is enabled, as confirmed by the maintainer. Eligibility and
  deletion timing vary; no universal deadline is promised. Transcripts/history have separate
  retention. The code's disabled default is not a statement about deployed operation.
- [Disconnect](../../packages/batch-backend/src/application/google-calendar-connection.ts) stops
  local scheduling/sync, retaining credentials and history. Google Account revocation is separate.

## Google data and external AI

[Calendar sync](../../packages/batch-backend/src/application/calendar-sync.ts) projects event titles
and timing into lesson records. The [memory repository](../../packages/batch-backend/src/domain/lesson-memory-repository.ts)
attaches completed lesson timing and internal associations and uses chronology for retrieval.

- Assignment prompts and ordinary incremental memory requests contain selected learning evidence;
  selection/order can depend on Calendar-derived timing.
- [Memory rebuilds](../../packages/batch-backend/src/application/student-memory-snapshot-prompt.ts)
  serialize whole lesson-memory records, including `sourceLessonStartedAt` and `sourceLessonId`.
  [Profile refreshes](../../packages/batch-backend/src/application/profile-draft-refresh.ts) can
  serialize the same fields in the memory overview. These can reach
  [OpenAI API](../../packages/batch-backend/src/application/generation-providers.ts).
- Separately authorized ChatGPT connections receive
  [selected learner context](../../packages/batch-backend/src/application/mcp-teaching-context.ts).
  The projection excludes raw Calendar events and Google credentials; it uses generated lesson
  titles/dates, with chronology-dependent selection. Do not claim that no Google-derived data leaves.

The public policy and in-product disclosure now name these uses. Google's Limited Use commitment
is preserved, including derived data and restrictions on training generalized models. The copy
makes no provider guarantee and does not claim control over individual ChatGPT training settings.
Maintainer approval resolves the requested legal-copy publication gate; this is not a certification
of downstream account settings, zero retention or general legal compliance. Do not turn unverified
provider assumptions into additional speculative implementation gates.

## Exact OAuth scopes

[`GOOGLE_CALENDAR_SCOPES`](../../packages/batch-backend/src/infrastructure/google-oauth-client.ts)
requests exactly:

| Scope                                                            | Purpose and minimum-access rationale                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `openid`                                                         | Verify the Google identity for the Calendar grant; not ESL login.                                                                                                                                                                    |
| `email`                                                          | Verify/display the connected account; `profile` is not requested.                                                                                                                                                                    |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | Select an existing writable subscribed calendar, without Calendar-list write permission.                                                                                                                                             |
| `https://www.googleapis.com/auth/calendar.events`                | Read/sync and create lesson events/series and optional invitations. Read-only/free-busy cannot create events; `events.owned` excludes supported writer calendars; `app.created` would change the existing-calendar product boundary. |

The broad event grant and the app's selected-calendar use are distinct. No scope change is made.
OAuth requests offline access, explicit consent, PKCE S256, state and nonce; exchange verifies actual
scopes and identity. External Testing refresh tokens for this set expire after seven days.

Sources: [Calendar scope reference](https://developers.google.com/workspace/calendar/api/auth),
[token expiry](https://developers.google.com/identity/protocols/oauth2#expiration),
[Google User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
[Workspace policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).

## Before clicking Publish in Google Auth Platform

1. After merge/release, separately authorize deployment of the approved legal files and frontend.
   Verify anonymous HTTPS 200 and readable content at the homepage and both legal URLs, including
   links, the effective date and contextual AI disclosure. This task does not deploy.
2. In the dedicated `esl-pipeline-production` project, use the public landing as homepage and enter
   the exact legal URLs above. Check brand identity/logo, monitored support/developer contacts and
   verified ownership of the authorized domain `eslpipeline.com`. ABO-58 reports Calendar API and
   the requested scopes enabled/added by the maintainer; verify rather than recreate them.
3. Confirm the Web client callback matches the table and the configured app origin. Securely hand
   production credentials to the separately authorized Calendar rollout; never put them in the PR.
4. Complete the Branding verification shown by the Console, then publish the approved brand.
   Branding publication, External audience's **In production** status and scope verification are
   separate actions. Do not assume a Publish button completes all three.
5. Choose the appropriate alpha audience path. Testing requires listed test users and has the
   seven-day refresh limitation. A few personally known users can qualify for Google's personal-use
   verification exception; 3–5 tutors alone do not establish that exception. For broader external
   use, complete sensitive-scope verification with scope justifications and an English demo of
   consent and Calendar/AI features as requested by the Verification Center.

See [branding requirements](https://support.google.com/cloud/answer/15549049),
[verification and exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification),
[audience settings](https://support.google.com/cloud/answer/15549945), and
[production project policy](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).
[ABO-56](https://linear.app/abocha/issue/ABO-56) and the
[Calendar cutover runbook](google-calendar-cutover.md) retain the separately authorized deployment
and production activation boundary.

## Focused validation

The publication revision passed frontend typecheck/build and the existing AuthDialog,
CalmStudioShell and CalendarSchedulingPanel suites (18 tests across three files). Explicit-path
formatting, PR-mode documentation/link checking and `git diff --check` passed. Anonymous local
Caddy GET/HEAD checks confirmed the served legal copy, effective date, canonical URLs, internal
links and stylesheet, with no draft notice, `noindex` or session requirement. Existing warning-only
Vite configuration/chunk-size, Calendar effect-dependency and documentation-age findings remain.
Hosted PR CI remains the required merge gate; local evidence does not establish live deployment.
