# Product North Star and Closed Alpha Execution Plan (Historical)

## Meta

- Audience: maintainers, implementation agents, product/engineering contributors.
- Authority level: historical planning record; non-authoritative.
- Status: archive.
- Active replacements: `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md` and
  `docs/plans/2026-06-23-alpha-readiness.md`.
- Review cadence: weekly while the product is moving toward closed alpha.
- Scope: managed SaaS for solo ESL tutors.
- Default implementation mode: small vertical slices with evidence, tests, and documented tradeoffs.

## Historical Context

This pre-alpha execution plan is retained for historical decisions and delivery trace. Its cohort
counts, active-phase claims, and implementation checklists are superseded by the active readiness
reference and Alpha Readiness plan named above.

## 1. Current Mission

Reach concierge closed alpha with 3 to 5 real tutors.

The current mission is not to make the product maximally impressive. The current mission is to make the product reachable, usable, observable, and safe enough for invited tutors to use it for real work.

Until the hosted app and invite-only tutor signup are complete, all non-critical feature work is deferred.

## 2. Active Phase

Current phase: hosted deployment plus invite-only tutor signup.

The active phase has two equal priorities:

1. Deploy the product to a stable hosted environment.
2. Allow real tutors to sign up, create a workspace, add students, and run the core homework workflow.

All implementation work should be routed through this phase unless explicitly marked as emergency work.

Emergency work is limited to:

- data loss risk
- security/privacy risk
- provider spend risk
- deployment blocker
- signup blocker
- core assignment flow blocker
- workspace isolation bug
- production recovery blocker

## 3. Deferral Lock: Do Not Build Yet

The following work is intentionally deferred until hosted deployment, invite-only signup, and the core closed-alpha flow are working:

- emotional/vivid TTS improvements unless fixing reliability
- new prompt tracks
- broad prompt library expansion
- Google Calendar sync
- tutor-facing Telegram bot
- student-facing Telegram bot
- public landing page polish
- SaaS billing and pricing implementation
- tax helper
- embedded calls, VOIP, video, or live transcription
- student portal
- advanced admin dashboard
- marketplace/community preset features
- deep customization studio

Allowed exceptions:

- the work fixes a current alpha blocker
- the work reduces support burden for an active alpha workflow
- the work reduces provider failure rate or provider cost risk
- the work is required for data safety, privacy, or deployment stability
- at least two real tutors independently report the same pain point during alpha

Deferred does not mean rejected. Deferred means not now.

## 4. Product North Star

A solo ESL tutor can sign up, create or import students, generate and publish useful homework from lesson context, and track lesson-package balance without technical setup.

The product must feel reliable enough that a non-technical tutor can keep using it weekly.

## 5. Product Success Definition

The product is successful when it consistently does all of the following:

1. Saves tutors time every week.
2. Makes student and lesson-package state clearer.
3. Produces useful homework with low manual cleanup.
4. Runs without local setup.
5. Fails visibly and recoverably.
6. Does not surprise the operator with provider cost, data exposure, or hidden workflow failures.

## 6. Closed Alpha Definition

Closed alpha means limited real usage by invited tutors.

Closed alpha requires:

- hosted app
- invite-only or controlled signup
- login
- workspace creation
- first-student creation
- core assignment workflow
- HTML publish path
- basic lesson-credit/payment tracking
- workspace-scoped data isolation
- provider spend guardrails
- minimal admin/support visibility
- alpha user guide
- known limitations page
- support channel
- weekly feedback loop

Closed alpha does not require:

- public marketing site
- paid subscription plans
- automated SaaS billing
- Google Calendar two-way sync
- Telegram tutor/student bots
- full prompt catalog
- tax helper
- student portal
- embedded calls
- advanced admin suite
- advanced TTS expressiveness

## 7. Alpha Launch Critical Path

The alpha launch critical path is the only active implementation route until closed alpha is reached.

### 7.1 Hosted Internal Environment

Goal: the founder/operator can use the hosted app for real work.

Checklist:

- [ ] Choose hosting provider.
- [ ] Document chosen deployment topology.
- [ ] Deploy frontend.
- [ ] Deploy backend API.
- [ ] Deploy worker process.
- [ ] Configure managed Postgres or equivalent.
- [ ] Configure Redis or queue-compatible service.
- [ ] Configure object storage.
- [ ] Configure production secrets outside local `.env` files.
- [ ] Configure production API base URL and CORS.
- [ ] Run database migrations in hosted environment.
- [ ] Add API health check.
- [ ] Add observable worker startup/heartbeat.
- [ ] Configure logs.
- [ ] Configure database backups.
- [ ] Document restore path.
- [ ] Run one hosted end-to-end assignment publish.
- [ ] Record hosted MVP evidence.

Evidence:

- hosted app URL exists
- backend health check passes
- worker is running
- database persists after redeploy
- uploaded file persists in object storage
- published HTML artifact is reachable
- hosted logs are accessible
- a failed job can be diagnosed without SSH spelunking

### 7.2 Invite-Only Tutor Signup

Goal: invited tutors can create accounts and enter the product without manual database work.

Checklist:

- [ ] Define account states: invited, active, disabled.
- [ ] Implement invite-only or controlled signup.
- [ ] Implement login.
- [ ] Implement password reset or equivalent recovery.
- [ ] Create default workspace during signup.
- [ ] Create default tutor settings during signup.
- [ ] Add first-run onboarding route/state.
- [ ] Add empty state for no students.
- [ ] Add first-student creation path.
- [ ] Add first-assignment entry path.
- [ ] Ensure standard tutors cannot access admin/operator routes.
- [ ] Add auth route rate limits or equivalent abuse protection.
- [ ] Document closed-alpha account lifecycle.

Evidence:

- an invited tutor can sign up
- the tutor receives a workspace
- the tutor can create a student
- the tutor can start the assignment flow
- signup requires no manual DB intervention

### 7.3 First-Run Tutor Onboarding

Goal: a non-technical tutor understands what to do next.

Checklist:

- [ ] Add first-run checklist.
- [ ] Add “create first student” empty state.
- [ ] Add “create first homework assignment” empty state.
- [ ] Explain upload/transcript/draft/publish flow in plain language.
- [ ] Add clear recovery action after generation failure.
- [ ] Add clear recovery action after publish failure.
- [ ] Add clear validation error display.
- [ ] Add alpha feedback/report-problem link.
- [ ] Add known limitations page.
- [ ] Remove or hide confusing internal controls from tutor-facing UI.

Evidence:

- a new tutor can complete the first assignment flow with minimal explanation
- support feedback shows fewer “what am I supposed to do?” blockers over time

### 7.4 Workspace Isolation

Goal: workspace ownership is the primary product data boundary.

Principle:

Any row that can appear in tutor-facing UI, worker execution, provider calls, generated artifacts, memory retrieval, schedule/billing surfaces, or support tooling must carry `workspace_id` directly.

Checklist:

- [ ] Create workspace ownership inventory for all product tables.
- [ ] Identify product tables missing `workspace_id`.
- [ ] Add `workspace_id` to missing product tables.
- [ ] Backfill from existing user/student/lesson relationships.
- [ ] Make `workspace_id` non-null where safe.
- [ ] Add indexes on `workspace_id`.
- [ ] Add composite indexes for common workspace queries.
- [ ] Ensure repository methods require workspace context.
- [ ] Ensure workers carry workspace context.
- [ ] Ensure provider calls carry workspace context.
- [ ] Ensure object storage keys are workspace-scoped or otherwise unguessable and ownership-safe.
- [ ] Add cross-workspace route tests.
- [ ] Add cross-workspace repository tests.
- [ ] Add cross-workspace worker tests where applicable.
- [ ] Upgrade RLS readiness audit from user-scoped to workspace-scoped tables.

Evidence:

- two workspaces can use the app independently
- no tutor-facing route leaks data across workspaces
- no worker publishes or mutates artifacts across workspace boundaries
- RLS readiness audit covers workspace-scoped product tables

### 7.5 Minimal Admin and Support Visibility

Goal: real tutor issues can be inspected without direct database spelunking for every failure.

Checklist:

- [ ] Create admin-only route guard.
- [ ] Add admin dashboard shell.
- [ ] Add recent tutors panel.
- [ ] Add recent assignment sessions panel.
- [ ] Add failed jobs panel.
- [ ] Add provider failures panel.
- [ ] Add basic hosted health panel.
- [ ] Add safe support links to tutor, student, session, job, and artifact details.
- [ ] Ensure admin routes are hidden from standard tutors.
- [ ] Ensure admin access is auditable.
- [ ] Add manual intervention log format.

Evidence:

- a failed hosted assignment can be found from the admin UI
- responsible tutor, student, session, job, provider, and error are visible
- normal tutor accounts cannot access admin pages

### 7.6 Real Tutor Alpha Dry Run

Goal: one invited tutor can complete the core product loop with support available but not required at every step.

Checklist:

- [ ] Invite one real tutor.
- [ ] Tutor signs up.
- [ ] Tutor creates or imports at least one student.
- [ ] Tutor creates one homework assignment from real lesson context.
- [ ] Tutor publishes HTML assignment.
- [ ] Tutor records lesson/payment/credit state or verifies existing state.
- [ ] Tutor reports confusing steps.
- [ ] Operator logs any manual intervention.
- [ ] Blockers are fixed before expanding to 3 to 5 tutors.

Evidence:

- real tutor completes core flow
- manual interventions are logged
- top usability blockers are known
- no critical data/privacy/provider-cost issue occurs

## 8. Evidence Gates

### Gate A: Hosted Founder-Operator

The hosted product works for the founder/operator.

Pass conditions:

- hosted environment is live
- assignment publish succeeds
- logs and failure state are inspectable
- database and storage persist across redeploy
- backups exist

### Gate B: Invite-Only First Tutor

One invited tutor can sign up and complete the core workflow.

Pass conditions:

- signup works without manual DB intervention
- workspace is created automatically
- first student can be created
- first assignment can be published
- lesson balance is visible or usable
- support visibility is enough to inspect failures

### Gate C: Concierge Closed Alpha

Three to five invited tutors can use the product with light support.

Pass conditions:

- most tutors complete the core flow with minimal hand-holding
- failure rate is acceptable
- support burden is logged and manageable
- reliability fixes outrank feature work
- repeated tutor pain points are visible

### Gate D: Closed Beta Readiness

The product can support 10 to 30 tutors.

Pass conditions:

- reliability metrics are mostly green for two consecutive weeks
- support load is acceptable
- provider cost is observable and bounded
- pricing/billing decisions are ready to begin
- landing page work may start

## 9. Architecture Guardrails

### 9.1 Workspace Is the Product Boundary

Workspace ownership must be explicit in product data, worker execution, provider calls, and artifact storage.

Indirect ownership through joins is not enough for product-grade authorization.

### 9.2 Jobs Are Execution Attempts

Jobs represent attempts to run work.

Published assignments represent tutor-facing product objects.

Artifacts represent concrete outputs.

Do not keep expanding jobs into the product object model.

### 9.3 Provider Calls Go Through Policy

Generation, STT, TTS, and future AI calls must be governed by provider policy, budget rules, normalized errors, and provenance capture.

Direct provider calls should not spread across feature code.

### 9.4 AI Output Cannot Silently Mutate Business Truth

AI systems may generate, enrich, summarize, classify, or suggest.

AI output must not silently mutate business-critical state such as lesson completion, payment state, credit balance, account access, or workspace ownership.

### 9.5 Presets Are Pedagogic Contracts

Learning presets define:

- prompt strategy
- pedagogic metadata
- output contract
- validation expectations
- provenance requirements

Provider/model choice is runtime policy and must remain separate from preset semantics.

### 9.6 Admin Visibility Is Part of Reliability

If a real tutor can hit a failure, the operator must be able to inspect it without heroic debugging.

Logs alone are not enough.

### 9.7 Deferred Features Require Promotion

Deferred features may not be implemented merely because nearby code is being touched.

A deferred feature must be promoted through the feature promotion rule.

## 10. Feature Promotion Rule

A deferred feature may be promoted only when at least one condition is true:

1. It blocks current alpha usage.
2. At least two real tutors independently report the same pain point.
3. It reduces support burden for an active alpha workflow.
4. It reduces provider cost or failure rate.
5. It is required for data safety, privacy, or deployment stability.
6. It is explicitly selected as the active phase after the current phase is complete.

Promotion must be recorded with:

- feature name
- reason for promotion
- current evidence
- non-goals
- expected implementation slice
- stop condition

## 11. Stop Rules

Pause feature work and switch to reliability or safety if:

- hosted publish flow fails twice in a row
- signup requires manual database intervention
- cross-workspace access bug is found
- provider spend cannot be estimated or bounded
- alpha tutor cannot recover from a failed assignment
- support burden exceeds one manual intervention per tutor per week
- tutor data is exposed through logs, artifacts, URLs, or admin views
- database migration risk is unclear
- production restore path is untested after backup changes

## 12. Closed Alpha Operating Model

Alpha size:

- initial dry run: 1 tutor
- concierge alpha: 3 to 5 tutors
- closed beta: 10 to 30 tutors

Support model:

- support may be manual/direct during alpha
- every manual intervention must be logged
- repeated interventions become product tasks
- bugs found during alpha outrank new feature work

Feedback cadence:

- collect feedback weekly
- review top three tutor pain points weekly
- identify one reliability fix, one usability fix, and one value improvement weekly
- do not expand alpha if reliability or support burden is red

Manual intervention log:

```text
date:
tutor:
student/workspace:
workflow step:
issue:
workaround:
product fix needed:
severity:
follow-up owner:
```

## 13. Privacy and Data Safety Minimum

Before real tutor alpha:

- recordings are private by default
- transcripts are private by default
- generated assignment artifacts have intentional visibility
- object storage paths are workspace-scoped or unguessable
- tutor data can be exported manually if needed
- student data can be deleted or archived manually if needed
- alpha users are told what data is stored
- alpha users are told that AI providers may process lesson content for generation/transcription/TTS
- admin/support access is limited and auditable
- sensitive data is not printed into routine logs

This section is not a complete legal compliance program. It is the minimum product safety bar for handling real tutor/student data.

## 14. Provider Gateway Workstream

Status: P1, important after hosted signup and alpha core are functional unless provider issues block alpha.

Goal: replace scattered or hard-coded GenAI provider behavior with a central provider gateway.

Initial scope:

- GenAI draft generation
- provider/model selection
- provider allowlists
- per-task provider policy
- budget enforcement
- timeout enforcement
- retry/fallback policy
- normalized errors
- request ledger
- workspace-aware usage accounting
- capability metadata for frontend/admin use

Target responsibilities:

```ts
interface ProviderGateway {
  generateDraft(request: GenerateDraftRequest): Promise<GenerateDraftResult>;
  extractStudentMemory(request: StudentMemoryRequest): Promise<StudentMemoryResult>;
  getCapabilities(context: ProviderCapabilityContext): Promise<ProviderCapabilities>;
  reserveBudget(request: ProviderBudgetReservation): Promise<ProviderBudgetReservationResult>;
  recordUsage(result: ProviderUsageRecord): Promise<void>;
}
```

Normalized error codes:

```text
provider_rate_limit
provider_timeout
provider_contract_error
provider_auth_error
provider_unavailable
provider_safety_block
budget_exceeded
model_not_allowed
unknown_provider_error
```

Checklist:

- [ ] Inventory direct GenAI provider calls.
- [ ] Define provider gateway service boundary.
- [ ] Add provider request ledger table.
- [ ] Add workspace-aware provider usage counters.
- [ ] Move provider/model allowlists into gateway policy.
- [ ] Preserve preset semantics separate from provider/model selection.
- [ ] Add normalized error mapper.
- [ ] Add timeout/retry/fallback handling.
- [ ] Add frontend-visible provider capability payload.
- [ ] Add admin-visible provider failure payload.
- [ ] Add tests for fallback behavior.
- [ ] Add tests for budget hard stops.
- [ ] Add tests for contract/schema failure fast-fail behavior.
- [ ] Add migration path from existing generation behavior.

Evidence:

- draft generation goes through the provider gateway
- provider/model choice is visible in output provenance
- budget exhaustion blocks generation safely
- rate limit falls back where configured
- contract failure fails fast
- admin view can show provider failures by workspace/tutor

## 15. Product Object Model Workstream

Status: P1, important after alpha core is hosted and usable.

Goal: separate product-level assignments from execution jobs.

Principle:

Jobs are execution attempts. Published assignments are product objects. Artifacts are concrete outputs.

Target model:

```sql
published_assignments (
  id,
  workspace_id,
  student_id,
  lesson_id,
  assignment_session_id,
  latest_job_id,
  title,
  status,
  published_at,
  archived_at,
  created_at,
  updated_at
)

published_artifacts (
  id,
  workspace_id,
  published_assignment_id,
  job_id,
  artifact_type,
  storage_uri,
  public_url,
  content_hash,
  provider,
  model,
  created_at
)
```

Checklist:

- [ ] Audit current job fields that represent product output.
- [ ] Define `published_assignments`.
- [ ] Define `published_artifacts`.
- [ ] Link successful publish jobs to published assignment records.
- [ ] Treat legacy job output fields as compatibility/projection fields if needed.
- [ ] Update student timeline to prefer product assignments over raw jobs.
- [ ] Update admin/support views.
- [ ] Add migration/backfill for existing successful jobs.
- [ ] Add tests for rerun/republish behavior.
- [ ] Add tests for artifact lineage.

Evidence:

- successful publish creates or updates a published assignment
- rerun creates a new job without destroying assignment identity
- published artifacts can be listed independently of job state
- student timeline can show assignment history without depending on raw job rows

## 16. Assignment Session Event Trail Workstream

Status: P1, useful for alpha support once real usage begins.

Goal: preserve support-grade history of assignment workflow actions.

Principle:

The session row may remain mutable. The event trail records what happened.

Target model:

```sql
assignment_session_events (
  id,
  workspace_id,
  assignment_session_id,
  actor_user_id,
  event_type,
  from_stage,
  to_stage,
  entity_type,
  entity_id,
  payload_json,
  created_at
)
```

Initial event types:

```text
session_created
session_resumed
recording_uploaded
transcript_attached
transcript_edited
prompt_package_created
generation_requested
draft_created
draft_edited
validation_passed
validation_failed
publish_approved
job_queued
job_started
job_succeeded
job_failed
session_archived
```

Checklist:

- [ ] Add event table.
- [ ] Add repository helper for appending events.
- [ ] Emit events from assignment session creation/update.
- [ ] Emit events from draft generation.
- [ ] Emit events from validation.
- [ ] Emit events from publish approval.
- [ ] Emit events from job lifecycle.
- [ ] Add support/admin timeline view.
- [ ] Add tests for event creation.
- [ ] Avoid turning this into full event sourcing.

Evidence:

- failed assignment shows enough event history to understand where it failed
- successful assignment shows source, transcript, generation, validation, approval, job, and publish events
- event history is workspace-scoped

## 17. Deferred Feature Lanes

Deferred feature lanes are intentionally not implementation-ready unless promoted by a later roadmap update.

### 17.1 Google Calendar Two-Way Sync

Status: deferred until alpha core is stable.

Why it matters:

- major scheduling win
- connects lessons, follow-ups, homework creation, and lesson completion
- likely important for long-term product stickiness

Promotion condition:

- core alpha flow is stable with real tutors
- scheduling pain is observed in alpha
- workspace isolation and hosted deployment are already reliable

Future scope:

- Google OAuth
- calendar connection state
- event import
- event-to-student matching
- duplicate prevention
- timezone correctness
- canceled/rescheduled event handling
- manual review queue for uncertain matches
- sync status UI

### 17.2 Tutor and Student Telegram Bots

Status: deferred.

Why it matters:

- strong notification/action channel
- can extend current operator-facing bot
- useful for reminders, homework delivery, and low-balance nudges

Promotion condition:

- schedule/billing and notification pain is repeatedly observed
- permission model is defined
- workspace/student privacy boundaries are clear

Future scope:

- tutor reminders
- failed job notifications
- quick lesson completion
- student homework delivery
- student reminders
- Telegram identity linking
- bot action audit trail

### 17.3 SaaS Billing and Pricing

Status: deferred for initial alpha, required before paid beta.

Why it matters:

- required for business viability
- pricing impacts usage limits, provider cost policy, and tier design

Promotion condition:

- product has repeated real usage
- willingness-to-pay signal exists
- provider cost per workspace is observable
- legal/business setup decisions are ready enough

Open decisions:

- free tier
- plus/pro tier boundaries
- usage-based vs subscription-based pricing
- payment provider
- refund policy
- terms and privacy policy
- jurisdiction/legal structure

### 17.4 Public Landing Page

Status: deferred until product is ready to sell to strangers.

Why it matters:

- needed for public acquisition
- useful for waitlist and positioning

Promotion condition:

- closed alpha evidence exists
- product promise is grounded in working features
- pricing/waitlist strategy is selected

Future scope:

- positioning
- waitlist/invite request
- workflow demo
- privacy note
- pricing if available

### 17.5 Admin Dashboard Expansion

Status: basic admin visibility is P0; advanced dashboard is deferred.

Why it matters:

- useful for operations, support, metrics, and product learning

Promotion condition:

- basic admin visibility exists
- alpha usage creates recurring support questions
- metrics are already being collected

Future scope:

- cohort metrics
- provider cost dashboard
- reliability dashboard
- tutor activation funnel
- retention dashboard
- support intervention analytics

### 17.6 Student Progress Timeline

Status: deferred.

Why it matters:

- strong tutor-facing value
- reuses lesson memory and homework memory
- improves long-term student management

Promotion condition:

- core student workspace is stable
- published assignment model is clean
- real tutors ask for longitudinal student insight

### 17.7 Embedded Calls, VOIP, Video Lessons, and Live Transcription

Status: deferred long-term bet.

Why it matters:

- could radically improve UX
- could make lesson-to-homework flow nearly automatic

Risks:

- high technical complexity
- browser/device compatibility
- real-time infrastructure
- consent/privacy/legal complexity
- recording storage and processing cost

Promotion condition:

- hosted product is stable
- transcription pipeline is robust
- legal/privacy posture is clearer
- enough real usage exists to justify the complexity

### 17.8 Prompt Library Expansion

Status: deferred beyond one trusted core track unless promoted by tutor evidence.

Possible tracks:

- Business English
- Medical English
- IELTS
- TOEFL
- exam preparation
- pronunciation-focused assignments
- vocabulary review
- grammar remediation
- conversation clubs

Rules:

- do not expand catalog before preset evaluation harness exists
- each prompt track needs fixtures, quality checks, and versioning
- prompt breadth must not reduce core reliability

### 17.9 Tax Helper

Status: deferred.

Why it matters:

- likely high-value pain point for freelance tutors
- possible premium feature

Risks:

- legal complexity
- country-specific rules
- liability
- maintenance burden

Promotion condition:

- target jurisdictions are selected
- legal boundaries are defined
- core SaaS billing strategy is clearer

### 17.10 Advanced TTS Expressiveness

Status: deferred unless tied to reliability or clear alpha value.

Why it matters:

- can improve learner experience
- can differentiate assignment output

Risk:

- high distraction potential
- easy to over-optimize before launch-critical work is complete

Rule:

TTS improvements may proceed only when they fix reliability, cost, fallback behavior, or a repeated alpha tutor/learner pain point.

## 18. Alpha Metrics

Track weekly during alpha.

### Product Utility

- median time from session start to published assignment
- percent of assignment sessions completed without manual fallback
- number of published assignments per active tutor per week
- tutor-reported weekly time saved

### Reliability

- end-to-end assignment success rate
- generation failure rate
- publish failure rate
- TTS failure rate
- failed run recovery success rate

### Usability

- new tutor first-session success
- support interventions per active tutor per week
- number of “what do I do next?” reports
- number of onboarding drop-offs

### Business Signals

- weekly active tutors
- tutors retained for 4+ weeks
- students managed per tutor
- assignments generated per tutor
- tutor willingness-to-pay signal
- most requested missing feature

### Cost

- provider requests per assignment
- estimated provider cost per assignment
- TTS cost per assignment
- storage growth per workspace
- failed provider spend

## 19. Weekly Operating Loop

Every week:

1. Confirm current phase.
2. Review alpha readiness metrics.
3. Review top three tutor pain points.
4. Pick one reliability fix.
5. Pick one usability fix.
6. Pick one value improvement only if P0 gates are healthy.
7. Record shipped evidence.
8. Record rejected distractions.
9. Do not expand alpha if reliability or support burden is red.

## 20. Work-in-Progress Limit

At most one primary workstream may be active at a time.

Default order:

1. Hosted deployment.
2. Tutor signup.
3. First-run onboarding.
4. Workspace isolation audit.
5. Minimal admin visibility.
6. One-tutor alpha dry run.
7. Concierge alpha with 3 to 5 tutors.

Do not start the next workstream until the current one has passing evidence or a documented blocker.

## 21. Implementation Rules for Codex/Agents

### Before Starting a Slice

- Read this document.
- Identify the current phase.
- Select one checklist item or one tightly related group.
- State non-goals.
- Avoid opportunistic feature expansion.
- Preserve existing architecture decisions unless the task explicitly changes them.

### During Implementation

- Prefer small vertical slices.
- Add or update tests.
- Update docs only where behavior changes.
- Keep provider/model policy separate from preset semantics.
- Keep workspace boundaries explicit.
- Avoid new manual repair paths when a productized recovery path is possible.
- Do not build deferred features while touching nearby code.

### Completion Evidence

Every implementation slice must leave evidence:

- tests run
- files changed
- behavior added
- manual verification steps
- known limitations
- follow-up task if needed

### Stop Conditions

Stop and report instead of expanding scope when:

- a task requires a product decision not made here
- a migration would risk existing data without a rollback plan
- a feature touches auth, billing, provider spend, or privacy without tests
- a deferred feature tries to enter a P0/P1 slice through the side door
- implementation reveals that the current phase is blocked by missing infrastructure

## 22. Implementation Slice Template

Each implementation slice should use this structure:

```md
## Slice: <name>

### Goal

### Non-Goals

### Current Phase

### Files Likely Involved

### Data/Migration Impact

### Tests Required

### Manual Verification

### Evidence to Record

### Stop Condition
```

## 23. Hosting Decision Matrix

Prefer the option that minimizes operational burden while satisfying closed-alpha needs.

Required capabilities:

- deploy API container
- deploy worker container
- serve frontend
- managed Postgres
- Redis or queue-compatible service
- object storage
- secret management
- logs
- backups
- custom domain later
- low closed-alpha cost

Decision output must include:

- chosen provider
- chosen services
- deployment topology
- estimated monthly alpha cost
- deployment commands
- migration command
- rollback path
- backup/restore path

Target closed-alpha infrastructure cost should remain low unless explicitly justified.

## 24. Open Decisions

- hosting provider
- deployment platform
- invite-only vs controlled public signup
- exact alpha tutor onboarding flow
- admin dashboard depth for alpha
- pricing model
- payment provider
- legal jurisdiction and business structure
- public landing page positioning
- Google Calendar conflict-resolution policy
- Telegram bot permission model
- student portal timing
- tax-helper scope and legal boundaries

## 25. Decision Ledger

### Locked Decisions

- The product is managed SaaS.
- Closed alpha comes before public launch.
- Signup and hosting are the highest priorities.
- Provider keys are centralized.
- Workspace is the long-term product boundary.
- Preset semantics remain separate from provider/model policy.
- Jobs are execution attempts, not final product objects.
- Reliability and usability beat feature breadth before alpha.
- Deferred features require explicit promotion.

### New Decisions

Record new decisions here using:

```text
date:
decision:
reason:
alternatives considered:
impact:
follow-up:
```

## 26. Current Recommended Next Slices

### Slice 1: Deployment Decision and Minimal Hosted Environment

Outcome:

- hosting provider selected
- deployment topology documented
- hosted internal environment live
- one successful hosted assignment publish

### Slice 2: Signup to Workspace to First Student

Outcome:

- invited tutor can sign up
- workspace is created
- default settings are created
- first student can be created
- empty states guide next action

### Slice 3: Hosted Core Flow With Admin Failure Visibility

Outcome:

- hosted assignment flow works
- failed jobs are inspectable from basic admin view
- logs and provider errors are visible

### Slice 4: Workspace Boundary Audit

Outcome:

- product tables are inventoried
- missing workspace ownership columns are identified
- migration plan exists
- cross-workspace tests are added or planned

### Slice 5: Provider Gateway Foundation

Outcome:

- GenAI draft generation enters through a central gateway
- provider requests are recorded
- budget and error behavior become inspectable

## 27. Final Rule

Do not optimize deferred feature polish while the hosted private product is still missing.

The product must first become reachable, usable, observable, and safe for real tutors. After that, the backlog can bloom.
