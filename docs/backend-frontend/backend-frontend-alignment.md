# Backend-Frontend Alignment (Status Tracker)

## Meta

- Audience: AI agents and maintainers coordinating backend/frontend delivery.
- Read Time: 3 minutes.
- Authority Level: Canonical status tracker.
- Last Verified Against: 2026-10-11 deterministic candidate application and promotion feedback (ESL-47).
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: weekly while alpha work continues.
- Status: `active`.

## Purpose

Record which shared product capabilities are live and where their current boundary is. This is not a
feature history, route catalog, or backlog.

## Canonical Sources

1. [`docs/reference/agents-ssot.md`](../reference/agents-ssot.md)
2. [`docs/backend-frontend/BATCH_SYSTEM.md`](BATCH_SYSTEM.md)
3. Package README for the touched surface

Provider/model detail stays in
[`docs/reference/GENERATION_PROVIDER_POLICY.md`](../reference/GENERATION_PROVIDER_POLICY.md).

## Capability Matrix

Public English Privacy Policy and Terms are approved for the alpha, effective 20 October 2026,
with static landing pages, app links and contextual Calendar/AI-processing disclosure. No API or
OAuth scope contract changes. Deployment and Google Auth Platform publication remain operator-owned; see
[OAuth/legal readiness](../operations/google-oauth-legal-readiness.md).

| Surface                                | Status                        | Current boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignment builder                     | Live                          | Five tutor-owned confirmed steps: Student, Lesson source, Teaching context, Create, Review & share. Automatic recovery is distinct from confirmation; readiness and navigation never advance confirmed truth. Explicit source attachment atomically claims the classified source fingerprint with recovery pointers or reopens its current owner. Ownership lasts through working replacement and transfers only when the replacement confirms. Completed post-cutover jobs reopen retained confirmed steps read-only, while pre-cutover jobs remain output-only. New/resume entry states remain mutually exclusive, with four recent lineages initially and progressive older loading.                                                                                                                                                                                                                                      |
| Lesson sources                         | Live; rollout gates remain    | Supported direct audio and allowlisted cheap-demux video converge with tutor-pasted transcripts on the same workspace-owned workflow. Browser/backend size checks, deterministic media rejection, automatic bounded STT recovery, canonical poll/SSE/resume state, cache-hit `not_retained` lineage, and immediate post-confirmation audio unavailability are implemented. Manual transcripts bypass STT. Representative conferencing-export compatibility and the real presigned-S3 provider smoke remain rollout evidence, not current broad compatibility claims.                                                                                                                                                                                                                                                                                                                                                         |
| Draft, publish, and post-share actions | Live                          | Sessions own revision-CAS recovery plus immutable confirmed URI/hash/version snapshots; jobs own materialized runs. Share reserves one stable job identity and `confirmedStep = 'share'` is terminal without session archival. Failed/queued unpublished roots retry that identity and frozen snapshot; correction requires a succeeded HTML publication parent with a non-empty URL. Correction mode publishes the exact saved mutable draft through a stable child request; `Republish published version` remains the historical frozen-output action. Historical handouts remain readable; intentional reruns remain child jobs.                                                                                                                                                                                                                                                                                          |
| Student workspace and schedule         | Live                          | Directory, overview, learning, history, scheduling/billing, lesson completion, and lesson-linked homework entrypoints are available. Product evolution remains roadmap-driven.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Business schedule, stats, and settings | Live                          | Day-grouped lessons and bounded unfinished follow-up lead the Business view; booking/credit suggestions and recent payments are disclosed separately. Stats shows recorded payments and lesson/workload facts, with upcoming credit watch separate from the selected month. Default-rate monetary lesson estimates are not displayed, and their setting is not edited here; existing backend fields remain compatible. Monthly recorded payments include archived students, exclude voided records, and total only the configured currency; other currencies are listed separately. Lesson/workload and recent-payment projections remain scoped to non-archived students. Low-credit message drafts state the balance and offer an optional top-up discussion without inferring debt or renewal. No predictive or risk-adjusted forecasting, per-student pricing, currency conversion, invoicing, or accounting is claimed. |
| Student memory and profile review      | Live with operator safeguards | Incremental refresh uses the latest eligible ready snapshot, with lesson-source ownership/readiness/provenance revalidated at canonical reads. The backend student-memory worker owns lesson-memory, homework-memory, and snapshot work; the frontend exposes health, candidate, and profile review while full rebuild remains CLI-only. Health inspection, candidate-delivery state and snapshot-ID retry, unavailable-vs-absent provenance, and deterministic profile diffs are supported.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Generation and safety policy           | Live                          | Assignment drafts default to GPT-6.1 Sol; memory/profile defaults remain GPT-5.6 Luna. One target per workload; provider failure never switches models/providers. Explicit choices, provenance, provider budgets, and default-off Batch replay remain; candidate ranks/tiers are removed. Durable worker retries retain frozen targets. ESL-27 adds explicit support-language metadata and complete teaching-sequence policy under the v5 generation pin; repository source is prepared, while template activation and live quality evaluation remain pending.                                                                                                                                                                                                                                                                                                                                                               |
| Audio regeneration                     | Live                          | Family selection and clip reuse follow orchestrator and speech-performance contracts; the frontend exposes capability-gated actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Telegram operations                    | Live internal surface         | The separate bot package provides allowlisted status, browsing, share, backup, drill, and approval operations over backend APIs. It is not a batch-frontend feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Ordinary memory replay

ESL-40 retains the existing diagnostic field shapes while making snapshot byte/token metrics and
budget decisions describe the effective envelope instructions/input sent to the provider. Optional
context removal is reflected in both that envelope and its source manifest; accurate estimates may
change drop/reject decisions without changing caps. The frontend continues to display the persisted
backend decision. See [effective request policy](../reference/GENERATION_PROVIDER_POLICY.md#effective-learner-memory-inputs-esl-40)
and [queued-work transition](../operations/student-memory-replay-backfill.md#effective-request-transition-esl-40).

ESL-38 shares aggregate availability across selection, health, prompt packaging, transcript progress,
teaching context and Learning. `absent`, `available`, `repair_required` and `repository_unavailable`
are separate from stored status and pending/failed work. Reference counts describe lineage only.
MCP adds result-level availability without changing the closed `mcp_teaching_context.v1` content.
Verified historical observations remain consumable; historical execution remains blocked. Established
history cannot fall back to a recent-only bootstrap after genuine invalidation. Explicit eligible-episode
rebuild and coordinated API/worker/frontend rollout remain separately authorized operations; see
[the continuity runbook](../operations/student-memory-replay-backfill.md#evidence-availability-and-continuity-esl-38).

Ordinary homework/snapshot replay stays operator-owned and CLI-only. Durable replay keys distinguish
resumption from new regeneration; cancellation and changed canonical source/current snapshot state
fence late results. Snapshot completion links one canonical result atomically, and the existing
worker repairs DB-to-BullMQ delivery gaps with frozen targets. Candidate refresh remains opt-in for
manual replay. See [the replay runbook](../operations/student-memory-replay-backfill.md).

### Admin prompts

Administration > Prompts (`/admin/prompts`, with `/prompts` compatibility redirect) is admin-only.
Initial selection follows the API's effective default, falling back to the first visible entry;
refreshes preserve an explicit selection when available. Only the retired, inactive, DB-only
`hw prompt markdown block.md` entry is hidden from this page (unless it is the effective default).
Its revisions/API access and all other historical templates are preserved.
Backend role checks independently protect management reads and mutations. The read-only
`/templates/control-plane` projection compares the running release's template asset hash/content
with active DB content and matching revisions. It shows shipped drafts awaiting activation,
unimported assets, and DB-only templates without treating the newest DB revision as shipped.
The UI offers an ordered content diff, revision inspection/history, explicit activation, restore,
archive, and default selection. Manual editor saves still activate immediately; bootstrap changes
remain drafts when an active revision exists. Tutor prompt options and generation resolution are
unchanged. No production role correction or activation is performed by this implementation.
For an unimported shipped hash, **Import & activate** calls the admin-only
`POST /templates/:id/import-and-activate`. The backend imports the running asset through shared
bootstrap draft/hash semantics, then uses normal activation. The UI refreshes persisted state after
success or failure; a partial import is never presented as successful activation. Assets and prior
revision content/history are preserved.

## Current Focus

- ESL-62 replaces independent scheduling with a selected Google Calendar, per-series durable
  creation/recovery and optional student invitations. Student/Business keep ledger and billing
  workflows during Calendar outages; timing edits open Google. Read paths no longer generate local
  recurrence. OAuth callback/session/logging, retired schedule inventory and provider UI identity
  gates are owned by the [Calendar runbook](../operations/google-calendar-cutover.md). Local/hosted
  evidence does not imply live Google or production delivery.
- The read-only ChatGPT MCP resource is implemented behind disabled-by-default `MCP_OAUTH_ENABLED`.
  It exposes learner name lookup, canonical teaching context, and the authenticated connection's
  read-only profile. Production OAuth diagnostics are active. New credentials follow their explicit
  Pipeline grant rather than the provider browser session. Migration `0067` backfills stable
  user/workspace profile identities with old grant writers stopped; deployment and live verification
  of these changes remain pending.
- Use production observations and tutor reports to select work from
  [`docs/plans/2026-06-23-alpha-readiness.md`](../plans/2026-06-23-alpha-readiness.md).
- Treat reproduced reliability or workflow failures as priority evidence.
- Known provider-account unavailability is a durable provider-neutral recording terminal state with
  operator guidance across polling, SSE, and resume; it does not invite replacement audio or another
  BullMQ delivery after the run commits.
- Keep speculative roadmap items in their plan; do not add them to this status matrix until a shared
  capability boundary changes.

## Assignment Workflow Boundary

- ESL-83 replaces the temporary JSON editor for current fresh-format assignments with workbook
  editing, one contextual panel, separate assignment teaching notes, session-local Undo/Redo and
  shared Learner view in step 4. Existing correction uses the same editor; completed references
  remain read-only until that explicit entry. Bounded list operations keep required structures,
  speaker identities, source URLs and generated content families intact. No legacy forms or manual
  builder are introduced. Valid-only saves share one flight and preserve newer typing/Undo;
  conflicts require an explicit choice against a fresh server version. Learner view does not
  confirm Create or satisfy step-5 preview/share, and text edits do not claim regenerated audio.
  Checked-in practice grouping guidance and shared headings change without live template activation.
  Create defers editor validation feedback before a draft exists and while generation is pending
  (ESL-19); an absent draft is not valid, and incomplete fields stay local with errors.
  Only parsed, schema/domain-valid AssignmentV1 can cross the durable autosave boundary. Invalid
  buffers stay local, suppress preview/confirmation/publication/correction, and disappear on reload.
  The API returns the same validated object and pinned context used by preview. Canonical sorted-key
  JSON defines the saved hash independently of textarea formatting. Frozen Create/job references
  carry format, schema/serialization version, working version, URI and hash; native renderer version and
  publication/media identities remain separate. Homework-memory extraction reads frozen typed input
  directly, preserving lineage, dedup and publication ordering. Historical Markdown and pending
  memory work dispatch explicitly by stored format. Migration 0062 is classified incompatible for
  previous-image recovery; use typed-capable forward repair or a paired pre-write DB/object restore,
  with no automatic conversion or loss of typed history.

- The API `4.0.0` / DB `0.23.0` cutover is the historical assignment-contract boundary that removes
  revisionless assignment, transcript, and draft mutations. Pre-cutover sessions, drafts, and prompt
  packages are deleted without compatibility or fabricated confirmation; completed jobs, handouts,
  URLs, rerun lineage, and required markdown storage remain read-only history. Current API, DB, and
  migration pins are machine-owned by [`packages/contracts/src/contract-versions.ts`](../../packages/contracts/src/contract-versions.ts),
  so the historical values in this paragraph are not the latest contract versions.
- Session recovery and confirmation use session revision CAS. Transcript/draft recovery use working
  version CAS and content-addressed objects. Confirmed Source/Create snapshots hold the server-owned
  immutable URI, hash, and working version directly; no content-revision tables exist.
- Canonical lesson-source ownership is keyed by tutor, student, source kind, fingerprint scheme, and
  fingerprint rather than recording, transcript, job, or output IDs. Attachment and recovery
  pointers commit together, while generic session recovery cannot mutate source ownership. Source
  confirmation uses the attached recording/transcript IDs, and lesson linking remains an ordinary
  recovery field. Successful replacement confirmation releases the old fingerprint;
  released-source reuse receives fresh recording/transcript lineage. Historical nonowners and
  unclassified historical sources remain readable but cannot perform new canonical mutations.
- An eligible uploaded recording remains replaceable after an unfinished assignment resumes.
  Passive rehydration suppresses session writes until an explicit edit, including opening Replace
  audio; completed or Share-reserved sessions remain ineligible.
- Confirmed Source exclusively drives transcript-hash-keyed lesson memory from its immutable URI.
  Prompt generation consumes confirmed Source/Context; Preview and Share consume confirmed Create.
- For a `tutor_only` profile, Source confirmation durably starts one automatic initial enrichment
  from its exact canonical ready lesson evidence. The student-memory worker reconciles the
  operation; ambiguous provider submissions remain `uncertain` without resubmission. The backend
  serves assignment-scoped learner context and checks the visible active revision on Context
  confirmation. Student Learning saves ordinary tutor edits as active revisions; candidate-derived
  draft review remains separate.
- Confirmed Source also makes retained recording audio unavailable in the same transaction and queues
  recording-owned deletion; historical confirmed rows are backfilled to that lifecycle without
  changing transcript, Source snapshot, or downstream text lineage.
- Saved no-homework intent routes Lesson source to Review & finish. Only explicit exact-source
  finish confirms Source and records current transcript completion plus immutable source-bound
  history; ordinary confirmation and session-bound downstream work reject none intent under locks.
  Current completion excludes active lists and missing-homework follow-ups, while history alone
  does not. Completed results keep processing progress behind collapsed Processing details without
  a Share job. Student History lists completed lesson transcripts, including unlinked sources,
  using existing history pages and session-result links; Step 1 remains the unfinished-work chooser.
  Explicit Create homework keeps the source owner, clears current completion and enters
  Context; reselecting none before downstream work requires a new reviewed finish. Existing homework
  progress takes precedence over `not_planned`; Schedule/business View transcript uses its typed
  result-session reference. Lesson linking retains the existing elapsed-scheduled-lesson credit
  boundary; finish/promotion have no billing effect. Pending extraction and missing ready-source
  snapshot handoffs recover through the existing worker with canonical and terminal-state checks.
- API 10 / DB 4 expose intent/current completion separately from exact-source history and mark
  migration 0066's incompatible writer boundary. Ordinary public Source replay requires current
  revision before effects. Default session lists are active; `scope=history` exposes transcript
  results without requiring a Share job. Manifest/prompt/validator and frozen AssignmentV1 bytes
  remain unchanged. Earlier API/DB version references above describe historical cutovers.
- The frontend owns automatic debounce/retry/refresh mechanics and preserves local buffers on
  conflict. The frontend enables Share only when confirmed recovery and current artifacts are clean;
  before reservation it drains pending recovery and returns a dirty session to its earliest
  reconfirmation boundary. The backend owns confirmation prerequisites, lineage validation,
  invalidation, stable Share reservation/retry, and the canonical active/completed predicate.
- Routine tutor Save/Refresh responsibility is absent. Stable data refreshes only on load, focus, or
  mutation completion; async recording/job and pending initial profile enrichment work poll. Navigation guards only unrecovered or
  ambiguous work and drains pending recovery before leaving.

## Update Rules

### ESL-39 Candidate Source and Application Proof

Repository source pins candidate delivery to an explicit eligible snapshot and its recorded lesson
trigger or selected lesson inputs. A delayed A job examines A or skips obsolete evidence; it never
drifts to B. Snapshot inclusion is not a teacher decision. Source ownership/authority, candidate
history and insertion are coordinated under the existing student lock, preserving reviewed text and
decisions without automatic rejected-backlog reopening or a new queue/ledger. Successful snapshots
superseded only by newer aggregate publication remain valid candidate sources while full source
lineage stays verified. Source invalidation, explicit obsolete markers and unfinished superseded
intents remain excluded in both read and transaction checks; latest-ready selection is unchanged.

Both existing draft endpoints report/link only selections represented in the resulting structured
profile. Patch decisions may select a subset and are validated as closed decision JSON independently
of base-profile size. Full draft refresh now applies selected approved wording deterministically to
the generated profile before saving and linking the draft. Activation checks the actual
active revision/hash and current approved wording in the relevant field using conservative Unicode,
case and whitespace equality. Removed or changed facts remain approved; inherited links are lineage.
Concurrent review cannot overwrite terminal promotion/supersession.

Completed same-student source-linked lesson dates provide chronology, with explicit extraction
fallback and unknown occurrence dates otherwise. Learning candidate details label that fallback;
draft feedback reports applied/omitted selections and activation reports actual promotions/omissions.
API 11.2 adds optional omission and promotion metadata; old-server responses remain readable.
Normalized exact duplicates are retained once, while paraphrases, merged items and moved wording
remain visible alongside the approved item for teacher review. The UI asks the tutor to review
repeated wording before activation. Semantic similarity never deletes content or supplies promotion
proof. Endpoint paths, profile schema, frozen prompts and historical records are preserved; no
data/schema migration is required. Publication and deployment remain separate operational gates.

Student-area surfaces, profile revisions, memory, timeline and candidate/draft routes authorize the
student in the authenticated workspace before secondary reads or writes. Foundational Profile is
student-owned revision history with status as its sole active authority. The direct profile catalog,
binding and rebinding APIs are removed. Historical prompt IDs remain provenance only. Migration 0059
freezes unattributable legacy rows for [bounded reconciliation](../operations/student-profile-revision-cutover.md);
that storage is inaccessible through runtime profile APIs. Issue #280 may close after the cutover
lands with its authorization evidence; destructive archive removal is a separate data reconciliation.

- Update this file when a capability moves between planned, partial, and live or its ownership
  boundary changes.
- Put route/env/payload detail in generated indexes, package READMEs, references, or runbooks.
- Keep historical implementation narrative in plans or archive docs.

## Related

- [`packages/batch-frontend/README.md`](../../packages/batch-frontend/README.md)
- [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)
- [`packages/telegram-ops-bot/README.md`](../../packages/telegram-ops-bot/README.md)
- [`docs/PIPELINE_INTEGRATION_VISION.md`](../PIPELINE_INTEGRATION_VISION.md)

### AssignmentV1 native execution (ESL-6)

Structured jobs execute frozen, validated AssignmentV1 directly through orchestrator, TTS and native
HTML; typed preview uses the same renderer. No active PMD projection or temporary Markdown source
is created. Native React renderer 3 / manifest schema 6 carry canonical assignment and publication
metadata; API 9 / validator 3 retire Markdown processing while manifest contract 4 keeps historical
read semantics. Historical Markdown and renderer-1 manifests are read-only evidence under ABO-30.
No historical correction, retry, rerun, resume, rendering, TTS, publication, fresh memory extraction or conversion is supported. Previously materialized, verified lesson/homework observations may be read and used in student-memory snapshot derivation under the existing exact ownership, confirmed-binding, identity/URI/hash and replacement checks (ESL-38). This evidence exception never admits historical extraction, regeneration, enrichment recovery or Batch legacy import. Editable JSON authority, source authorization, CAS,
lineage, cast/speech provenance and selected audio-family reuse remain unchanged. See
[AssignmentV1](../reference/ASSIGNMENT_V1.md) for the canonical execution contract.

### Shared OpenAI quota projection (ESL-45)

API 11.1 adds optional model-group and separate model/group reserved/actual token counters to
`GenerationQuotaView`. Daily-token used/remaining values describe the selected model's shared
reservation group; they are not paid spend. Defaults are 2.25M efficient / 225k larger per UTC day.
Profile refresh and candidate promotion preserve typed quota refusals as HTTP 429, with actionable
nonsecret messages displayed by the existing frontend API error path. Refusal saves no draft.
See [generation policy and compatible rollout](../reference/GENERATION_PROVIDER_POLICY.md#openai-model-group-daily-budgets-esl-45).
