# @esl-pipeline/batch-backend

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and operational usage guide.
- Last Verified Against: 2026-10-05 ESL-7 historical Markdown retirement.
- Owner: batch-backend maintainers + automation agents.
- Review Cadence: monthly or after major API/worker changes.
- Status: `active`.

Async workflow API and worker runtime for ESL Pipeline.

## Role

`@esl-pipeline/batch-backend` is the operational execution surface for the monorepo:

- authenticated HTTP API
- queue-backed workers
- durable Postgres-backed workflow state
- bridge to `@esl-pipeline/orchestrator` for final pipeline semantics
- Worker entries translate new-assignment and rerun job payloads into orchestrator v2 flags,
  preserving persisted voice and learning-preset settings and the selected rerun theme.

It does not redefine orchestrator behavior. Contract and architecture detail stay in:

- [`docs/backend-frontend/batch-backend-ssot.md`](../../docs/backend-frontend/batch-backend-ssot.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](../../docs/backend-frontend/backend-frontend-alignment.md)

## Historical Markdown

AssignmentV1 is the only executable homework input. Historical Markdown jobs, drafts and assignment
sessions remain inspectable with their original source, prompt provenance, manifests, static outputs
and produced media. Legacy mutations and processing return `legacy_assignment_read_only`; the old
Markdown submission and validation endpoints return HTTP 410. Reads do not regenerate memory,
render, scrape outputs or convert Markdown to AssignmentV1.

Migration 0064 requires old API and workers to be quiesced and unfinished remote legacy homework
Batch work resolved. Refresh existing remote runs, including old cancelled rows, with the updated
Batch status tool to record terminal provider confirmation; cancellation-in-progress remains blocking.
Historical profile-enrichment reservations must also be quiesced. Its pending/result-ready intent is
retired and admission, recovery, dispatch and publication reject historical sessions. Migration 0064
terminalizes queued legacy work and freezes historical rows without dropping
SQL evidence. See [the retirement contract and cutover boundary](../../docs/reference/ASSIGNMENT_V1.md#legacy-retirement-esl-7--slice-4).

## Runtime Surface

ESL-38 separates existing verified memory evidence from historical execution admission. Snapshot
selection/publication retain exact ownership and source proof, while historical extraction, delivery,
enrichment and legacy import stay blocked. Established aggregates without an eligible parent require
explicit repair; automatic refresh cannot silently replace them with bounded bootstrap history.
Overview, health, transcript progress, prompt packaging and teaching context share bounded availability
independent of stored status. MCP exposes it beside the unchanged closed v1 context. See
[continuity and coordinated rollout](../../docs/operations/student-memory-replay-backfill.md#evidence-availability-and-continuity-esl-38).

Core surfaces:

- ESL-40 memory/profile builders produce one envelope (`learner_memory_generation_v2`); provider
  requests, pacing reservations and snapshot byte/token diagnostics use its effective instruction/input
  content. Initial enrichment retains its prompt-only reservation/result/recovery path. See
  [provider policy](../../docs/reference/GENERATION_PROVIDER_POLICY.md#effective-learner-memory-inputs-esl-40)
  and [queued-work transition](../../docs/operations/student-memory-replay-backfill.md#effective-request-transition-esl-40).
  Unused heuristic/history packaging is removed; canonical `student-memory-package` remains the
  prompt-package input and student-only transcript extraction remains supported.

- jobs, drafts, prompt packages, recordings, students, auth
- tutor-pasted transcript sources under `POST /recordings/transcript-source`; these create a
  student-owned recording/transcript pair with `manual_transcript` source and `manual` provider
  provenance without enqueueing speech-to-text work
- student archive/restore under `/students/:id/archive` and `/students/:id/restore`; archived students are hidden from default student reads without deleting history
- Business monthly recorded payments retain archived students' history, exclude voided records,
  and separate currencies. Lesson/workload, credit suggestions and recent-payment lists still
  cover non-archived students. Low-credit message drafts state the balance and offer an optional
  top-up discussion; they do not establish debt or renewal. Business uses workspace thresholds;
  per-student reminder preferences currently apply only to Student Schedule & Billing.
- student-area route payloads under `/students/:id/surfaces/overview`, `/students/:id/surfaces/learning`, and `/students/:id/surfaces/history`
- Student-area surfaces, profile revisions, memory, timeline, candidate review/promotion and
  draft initialization/refresh use `authorizeStudent` after authentication. The guard resolves
  membership workspace and performs the workspace-scoped student lookup before any child read
  or mutation. Missing, archived and foreign students receive identical `404 { error: 'not_found' }`.
  Revision and candidate queries additionally constrain every child to that authorized student.
  `getStudentTeachingContext({ workspaceId, studentId })` retains its own authorization-first lookup.
- Foundational Profile is student-owned revision history: `student_profile_revisions.student_id`,
  with one active row selected by status and a partial unique index. No separate profile catalog,
  active pointer, student binding or arbitrary rebinding exists. Live routes are
  `GET/PUT /students/:id/profile`, `GET/POST /students/:id/profile/revisions`, revision detail,
  and revision `activate`/`restore`. Old `/profiles` routes and query aliases are removed.
  Profile revision inputs and confirmed assignment snapshots use `postgresUuidSchema` for
  canonical hexadecimal PostgreSQL UUID strings, without RFC version/variant restrictions:
  migration 0059's deterministic revision IDs must round-trip unchanged. Other RFC UUID
  inputs retain their stricter validation.
  [ABO-12 reconciliation](../../docs/operations/student-profile-revision-cutover.md) explains
  the frozen legacy archive and exact historical IDs retained for assignments and prompt packages.
- student schedule/billing route payloads under `/students/:id/surfaces/schedule-billing`, including lesson-credit state and elapsed lesson homework follow-ups
- ESL-62 replaces local lesson creation/time editing with the selected Google Calendar workflow.
  Google owns recurrence and later timing edits; the backend retains lesson identity, completion,
  credits and source links. Optional student email is operational contact, never an identity key.
  Several weekly slots create independent series with separate durable recovery outcomes. See the
  [Calendar runbook](../../docs/operations/google-calendar-cutover.md) for configuration, retirement,
  callback security and provider/production acceptance gates.
- tutor business dashboard and student schedule/billing routes resolve the active workspace from the
  authenticated tutor's membership before application reads or writes. Foreign students, lessons,
  and mismatched child rows use non-enumerating not-found responses and are never mutated; legacy
  rows with a null workspace remain visible only to the default workspace.
- student-memory inspection under `/students/:id/memory`, `/students/:id/memory/health`,
  `/students/:id/lesson-memory`, `/students/:id/homework-memory`, and
  `/students/:id/memory-snapshots`
- targeted job/recording SSE under `/jobs/events?jobId=<id>&recordingId=<id>`; wildcard streams use `jobId=*`
- optional ops control under `/ops/*`
- API server + worker processes sharing the same config

Useful indexes:

- [`docs/generated/backend-route-index.md`](../../docs/generated/backend-route-index.md)
- [`docs/generated/env-surface-index.md`](../../docs/generated/env-surface-index.md)

## Current Operational Notes

- Postgres is the durable store.
- Redis/BullMQ backs queue execution.
- Recording upload cache hits reuse compatible immutable STT artifacts. When identical audio is
  submitted for another student, the backend clones recording/transcript metadata for that student
  instead of reassigning the original learner-owned artifacts.
- Audio uploads persist an explicit topology. Ordinary uploads default to `mixed_recording` and use
  the configured ElevenLabs Scribe v2 mixed profile; only an explicit trusted OBS declaration uses
  Deepgram's two-channel tutor/student path. Mixed diarization labels remain anonymous until the
  tutor confirms the speaker-role mapping in the Source review flow.
- Recording uploads spool incrementally to bounded temporary files. The browser and backend share a
  2 GiB default source guard, the backend preserves a configured 10 GiB free-space reserve at
  admission, and probed duration is capped at 6000 seconds. Direct MP3, PCM16 WAV, AAC/M4A,
  Ogg/Opus, and WebM/Opus audio remains byte-identical. MP4/AAC, MOV/AAC, and WebM/Opus video is
  accepted only as a single-audio-stream convenience input and is demuxed with `-c:a copy`; no
  transcoding or video decoding is part of ingest.
- A cache miss adopts exactly one workspace-prefixed immutable audio candidate and creates one
  durable transcription run. A same-workspace cache hit copies independent transcript lineage with
  `audio_lifecycle=not_retained`, uploads no audio, creates no run, and enqueues no BullMQ job.
- Transcription runs use a short durable claim lease and at most three committed provider-submission
  reservations. BullMQ delivery/reconciliation count is separate and can exceed three. Permanent
  failures stop; transient, ambiguous, and provider-detected malformed outcomes recover automatically
  within the reservation ceiling. A successfully normalized result rejected by deterministic structural
  validation is terminal and does not consume another provider submission. When raw-response storage
  is enabled, a received provider response is persisted before this validation; structural-failure logs
  expose only its resulting `rawResponseUri`. Provider SDK retries remain disabled.
- A narrowly allowlisted ElevenLabs account-credit response terminalizes the durable run as
  `transcription_provider_account_unavailable`. The public state is provider-neutral; logs retain only
  the controlled failure class and valid HTTP status when supplied, never provider response text or body.
  After that terminal projection commits, the BullMQ delivery completes without a redundant redelivery.
- Structural timing failure logs include a controlled `timingIssue`: `missing_start`, `missing_end`,
  `non_finite_start`, `non_finite_end`, `negative_start`, or `reversed_timing` (first failed check
  in that order). Finite non-negative point timing (`start === end`) is valid. Null/undefined timing
  is missing. `segmentIndexBasis: normalized` identifies
  the zero-based index after adapter coalescing/sorting, not the original provider word index.
  No transcript text, timing values, or raw provider fields are included. BullMQ worker completion
  reports delivery completion, including terminal-run skips; it does not assert transcription success.
- For ElevenLabs timing rejection, the worker explicitly allowlists `elevenLabsPreMergeTiming` from
  the adapter summary. `timingOrigin: provider_invalid_present` means at least one lexical provider
  token was already invalid before mapping/coalescing; its first invalid index and classification are
  included. `timingOrigin: normalization` requires a positive inspected lexical count and zero invalid
  inputs: the rejected interval was produced during normalization. The former does not rule out an
  additional merge defect. Missing or malformed provenance yields no origin inference. The whole
  summary and arbitrary provider fields are never forwarded to structural failure logs.
- ElevenLabs `audio_event` annotations are retained in the human-readable transcript as non-speech
  segments with only the provider-supplied text, timestamp, and speaker metadata. They are excluded
  from lexical validation, exact-speaker counting, speech-turn coalescing, and speaker-track metrics.
- Successful Source confirmation makes retained recording audio unavailable immediately and requests
  asynchronous recording-owned deletion. The transcribe worker sweeps bounded PostgreSQL claims for
  confirmed audio plus eligible failed or unconfirmed audio after
  `RECORDING_AUDIO_RECOVERY_TTL_DAYS` (default 7). Physical cleanup is disabled unless
  `RECORDING_AUDIO_CLEANUP_ENABLED=true`; transcript and downstream text lineage is never deleted.
  Slice 4 upload-attempt candidate cleanup remains a separate authority.
- Production migration, run/reservation, storage-candidate, runtime-media, and cleanup readiness
  procedures live in the
  [ordinary recording ingest rollout runbook](../../docs/operations/ordinary-recording-ingest-rollout.md).
- `STT_PROVIDER` is an all-topology emergency rollback override; with the current topology set, only
  `deepgram` is valid. Per-request support overrides remain topology-scoped.
- Manual transcript sources require a student, retain the pasted text as durable source material,
  and participate in prompt-package, assignment-history, and resume flows like uploaded lessons.
- Local/dev startup runs the API server, batch worker, transcribe worker, and dedicated student-memory worker as separate processes.
- Each worker awaits BullMQ initialization under a 30-second deadline, checks running/unpaused state,
  and emits structured `worker_ready` evidence with service, queue, current instance identity, and
  timestamp. Deployment verification requires all three current instances. This is initialization
  evidence, not a heartbeat or business-success signal. Host-owned read-only queue observation and
  persistent grace policy are documented in [Host and Runtime Health](../../docs/operations/host-runtime-health.md).
- Canonical lesson/homework/snapshot extraction reserves the shared generation budget before its
  provider call and records actual token use after success. If that post-success accounting write
  is unavailable, the completed result is preserved and a privacy-safe metric records the gap;
  the original reservation remains enforced. Minute RPM/TPM limits and provider 429 responses
  defer the same BullMQ job/provider/model until its safe timestamp; they do not consume a generic
  failure retry or silently fall back to another provider.
- Prompt runtime activation and revision history are DB-owned; deployed Git assets own shipped content.
- Checked-in prompt assets seed/reference that catalog. Bootstrap imports changed content as a draft
  when an active revision already exists; service/admin activation is required before the changed
  revision becomes generation input in an existing environment.
- Admin-only `GET /templates/control-plane` derives shipped content from the same deployed asset
  scanner and exact UTF-8 hashes used by bootstrap. It relates those assets to active DB revisions and
  matching imported revisions, including drafts. It exposes `in_sync`, `update_available`,
  `shipped_not_imported`, and `not_shipped`; no shipped-state persistence or auto-activation is added.
  Missing/unreadable asset roots fail the projection instead of claiming the deployment is healthy.
  Ordinary `/config/prompts` consumption and generation continue resolving active DB revisions.
- Manual template saves and restores retain immediate activation; shipped drafts require an explicit
  admin activation. The UI lives at `/admin/prompts` inside the existing frontend.
- Admin-only `POST /templates/:id/import-and-activate` reads the current deployed asset, imports a
  hash-deduplicated draft using bootstrap semantics with operator provenance, and invokes normal
  revision activation. It preserves assets and revision content/history. Import can persist before
  activation fails; errors require refreshing persisted state and retrying the shipped action.
- Prompt-package lineage is the canonical assignment-level student-memory provenance surface. When
  canonical memory lookup is unavailable, prompt packages carry explicit unavailable memory text
  instead of treating the layer as empty.
- `getStudentTeachingContext({ workspaceId, studentId })` is an internal, read-only application query
  for future interactive clients. It resolves the student in the supplied authenticated workspace
  before reading profile or memory state, then returns `teaching_context.v1` from the active profile,
  latest eligible ready snapshot, and up to three ready lessons and two ready homework entries. Active
  legacy Markdown uses the same structured derivation as existing profile reads; unparseable content
  stays unavailable. A separate provenance section names the active profile/revision, selected memory
  entries, and content origin without exposing storage or provider metadata. Missing layers stay null
  or empty; personal facts and transcript evidence are omitted. No HTTP or shared-contract surface
  exists for this query yet.
- Lesson-linked homework lineage is nullable and explicit across assignment sessions, prompt packages, drafts, jobs, and homework-memory entries; schedule surfaces summarize that state for teacher follow-ups.
- Student-memory snapshot refresh is incremental and budget-guarded for normal lesson/homework
  triggers; replay/backfill is source-truth driven and version 1 repair uses regenerate workflows
  rather than manual memory-row editing.
- A snapshot is current ready state only when every referenced lesson-memory row exists, belongs to
  the same student, remains ready, and carries confirmed-source provenance. Snapshot source-ID
  columns own coverage lineage; matching `generation_notes` arrays are diagnostics only.
- Schema changes belong in versioned migrations. Runtime legacy schema patching is retired;
  `ensureJobsSchema` rejects every invocation, including its former environment override.
  every migration must also appear in the packaged `migrations/runtime-compatibility.json`.
  New migrations declare `compatible` or `incompatible` with prior application writers and
  previous-image recovery. The release contract check enforces complete metadata; production deploy
  quiesces writers before incompatible boundaries and gates rollback guidance. See
  [deployment compatibility and recovery](../../docs/backend-frontend/DEPLOYMENT.md#schema-compatibility-and-recovery).
- Migration 0059 copies useful, explicitly student-attributable history and freezes residual legacy
  storage. Historical `unknown` provenance stays unknown. The old profile-wide provenance backfill
  and student binding tools are retired; see the cutover runbook before any residual cleanup.
- Fresh database bootstrap uses the generated `schema.sql` baseline; existing databases upgrade through versioned migrations.
- User settings remain private child storage keyed by `user_id`, with unchanged sanitized API
  output. Migration 0060 removes the unused surrogate ID and Notion token column, preserving
  ElevenLabs ciphertext, preferences, timestamps, owner FK/cascade and user-scoped policy.
  It refuses removal if any Notion value is non-NULL (including an empty string). Before a future
  rollout, inventory only row counts; privately export any legacy values and obtain approved
  disposition before clearing them. Never log secrets. The migration must run with compatible
  settings writers; pre-0060 binaries still reference the removed ID. This local cleanup does
  not authorize changes to the ongoing GitHub #298 v12.0.1 cutover.
  Planning evidence: [ABO-13 canonical data-model audit, candidate 1](https://linear.app/abocha/document/abo-13-canonical-data-model-audit-repository-e2a6435-24ab79a60688).
- `/meta/version` reports the release's expected migration head, derived from the backend's packaged
  `migrations/*.sql` files. The shared DB contract version is a separate semantic compatibility signal.
- Extended API and ops-control surfaces are additive and must be explicitly enabled.

## Assignment Confirmation Contract

The assignment builder separates automatic recovery from tutor-owned confirmation:

- Student confirmation is the only session-creation path. Every session has a monotonic revision,
  a validated confirmed snapshot, and a `confirmedStep`; recovery writes cannot alter confirmed
  truth.
- Session recovery and Source/Context/Create confirmation use session-revision compare-and-swap.
  Transcript and draft autosaves use independent working-version compare-and-swap, server hashes,
  and content-addressed storage. Source/Create confirmation copy the exact immutable URI, hash, and
  working version into the session snapshot; there are no transcript/draft revision tables.
- AssignmentV1 Slice 2 makes validated JSON the only editable authority for new structured
  prompts. Draft responses identify `format: assignment_v1`, the parsed `assignment`, pinned
  `validationContext`, and a frozen `artifact` reference (schema/serialization version 1, working
  version, content-addressed JSON URI, canonical SHA-256). Draft create/autosave always parse and
  validate schema plus domain constraints before storage or CAS. The text field is pretty-printed
  JSON for the temporary textarea bridge; it is never a separately saved editor buffer.
- Create confirmation, Share, correction and rerun jobs preserve that reference. Jobs separately
  pin native renderer version 3 (historical jobs retain their frozen renderer version). The worker rereads and
  verifies frozen JSON and passes AssignmentV1 directly to orchestrator/TTS/HTML without temporary
  Markdown. Typed preview authorizes the pinned prompt and validates the same object before native
  HTML publication. Job DTOs carry title/icon/main-audio publication metadata for direct bot
  sharing. Homework memory consumes typed content directly and namespaces its dedup hash by
  format/schema; historical Markdown is read-only and is not dispatched for current execution.
- Materialization rejects typed/legacy job-format mismatches before execution or relinking.
  Typed reruns do not require a local Markdown source: frozen JSON supplies content, while a
  stable manifest identity under `assignments/` (or `corrections/`) retains publication artifacts
  without a Markdown source file. Native manifests use schema 6 and canonical AssignmentV1 hashes;
  historical manifests retain their read semantics. See [AssignmentV1](../../docs/reference/ASSIGNMENT_V1.md).
- Migration 0065 admits native renderer 3. Migration 0063 and renderer 2 describe the historical
  ESL-6 checkpoint recorded in [AssignmentV1](../../docs/reference/ASSIGNMENT_V1.md), not current
  deployment guidance. Current image and migration compatibility is governed by
  [`runtime-compatibility.json`](migrations/runtime-compatibility.json); inspect it before proposing
  rollback. Do not infer compatibility from renderer history.
- Migration 0062 retains existing rows as `markdown`, freezes draft formats and job artifact
  references, and leaves historical readers executable. API 7 / DB 2 mark the authority cutover;
  prompt, validator and manifest contracts are unchanged. Previous-image rollback is deliberately
  blocked by `runtime-compatibility.json`: retain the additive schema and use typed-capable readers
  for forward repair. Returning to pre-Slice-2 code requires quiescence and restoring the paired
  database/object backup from before typed writes; never relabel typed JSON as Markdown or drop
  references to make old code run. No production rollout is implied by local migration evidence.
- `POST /assignment-sessions/:id/source-attachment` is the explicit ownership boundary. In one
  PostgreSQL transaction it claims the classified source fingerprint and updates session recovery
  pointers, or returns `existing_assignment_resumed` with the current owner. Confirmed ownership
  remains until a different attached source confirms successfully; cancellation preserves the old
  owner, while confirmation releases it. Direct reuse of artifact lineage previously confirmed by
  another assignment is cloned to fresh recording/transcript IDs with the same fingerprint.
- Source confirmation checks binding authority before replay. Historical nonowners and unclassified
  historical sources remain readable but cannot reconfirm, regenerate downstream assignment state,
  enqueue canonical lesson memory, or begin a new Share transition from that source. Recovery also
  rejects any prompt/draft pair whose draft does not belong to the selected prompt and student.
- Source confirmation is the only assignment-flow lesson-memory trigger. New intents record the
  authorizing assignment session as well as transcript/hash lineage. Worker publication and
  canonical lesson/student-memory reads revalidate the current confirmed source binding, so a late
  worker or historical nonowner cannot restore superseded memory. Changed confirmed content
  temporarily makes memory unavailable until its automatic replacement succeeds.
- Source confirmation also records a one-time initial profile enrichment operation for a
  student with `tutor_only` profile provenance. The student-memory worker reconciles that durable operation into its
  existing BullMQ queue when exact canonical lesson evidence becomes ready. Definitively failed
  evidence or evidence still unavailable after 24 hours ends onboarding with a controlled failure.
  Generation uses student-memory pacing and preserves the exact tutor-authored seed. A reserved
  provider submission is never repeated after an ambiguous outcome; successful activation
  atomically updates the revision, active pointer, provenance, and operation. Assignment learner
  context is read through `GET /assignment-sessions/:id/learner-context`. Context confirmation
  remains unavailable until the operation succeeds or reaches a controlled terminal outcome.
- Ordinary structured tutor edits use `PUT /students/:id/profile` and activate an active revision
  atomically; candidate-derived drafts retain their explicit review flow.
- Assignment prompt creation reads confirmed Source and Context and requires the current confirmed
  source binding. Prompt packages retain their assignment session ID so later draft creation and
  provider generation, and draft materialization recheck that same binding after replacement or
  operator remap. Standalone prompt packages have no assignment session and retain their existing
  generation and materialization paths. Preview and Share read confirmed Create content, so newer
  autosaved recovery cannot silently enter downstream output.
  Migration backfills only unique direct session references; ambiguous historical references stay
  unclassified and cannot pass the fresh-generation check. A draft-only session reference is not
  valid historical assignment provenance: migration 0044 discarded earlier editor state, and the
  current recovery/confirmation contracts require a prompt package whenever a draft is linked.
- Share reserves one existing job row with a stable database/BullMQ ID. Retry and ambiguous-response
  reconciliation reuse that identity. An unpublished failed/queued root is lineage-validated and
  made runnable in PostgreSQL before its matching retained BullMQ job is reactivated in place;
  generic queue reconciliation remains strict. An intentional rerun remains a new `source_job_id`
  child.
- `confirmedStep = 'share'` is the homework completed predicate. Completed homework sessions remain immutable
  provenance for their historical jobs/handouts, are not resumable or in progress, and retain their
  canonical source binding. Job status DTOs expose the optional retained
  `assignmentSessionId` through rerun ancestry so post-cutover history can reopen confirmed inputs;
  pre-cutover jobs return no link. There is no assignment archival or archive-retry state.
- Saved `homeworkIntent` defaults to `create`. The `none` branch remains unfinished until
  `POST /assignment-sessions/:id/finish-transcript` confirms the exact reviewed version/hash and
  atomically records Source, memory/enrichment intents, audio cleanup, a current completion marker
  and immutable exact-source finish history. Public Source/Context/Create and session-bound
  generation reject none intent before effects; transcript writers serialize with finish.
  Duplicate finish accepts only the current operation's revision and exact source. Historical
  finish events cannot complete a later review.
- API 10 / DB 4 mark the new outcome and incompatible writer boundary. Ordinary public Source
  confirmation now checks revision before its identical-source replay shortcut; Context/Create
  retain their existing replay semantics. Intent, current completion/kind and exact-source finish
  history are distinct DTO fields. `GET /user/assignment-sessions?scope=history` discovers completed
  transcript results and retained finish history; default scope remains active workflows.
- Completed transcript-only sessions are read-only results and leave active lists/counts. Explicit
  `POST /assignment-sessions/:id/start-homework` promotes the same owner to Context, clears current
  completion and retains history. It performs no reupload, reconfirmation, memory extraction or
  billing. Reselecting none before downstream work is allowed and requires a new explicit finish.
  Downstream Context/prompt/draft/Share work prevents opt-out; historical Markdown stays read-only.
- Both missing pending lesson-memory delivery and ready extraction without a source-linked snapshot
  obligation recover through the existing periodic memory dispatcher. Ready retry only delivers
  the post-publication obligation. Student locking deduplicates scanner/direct-worker requests,
  reuses pending/fulfilled snapshot evidence and respects failed/cancelled/obsolete/superseded
  obligations. Result reads distinguish extraction, refresh and initial enrichment; read does not
  retry terminal failures. None-session ready-source discovery is bounded to canonical authority,
  including eligible pre-existing ready extraction and promoted current finish evidence.
- Schedule and business projections expose `not_planned` and a nullable `transcriptResultSessionId`
  only for current completed none work without actual homework progress. Saved none and historical
  finish evidence alone do not suppress follow-up. Linking an eligible elapsed scheduled lesson
  at Student confirmation/recovery retains existing completion and credit behavior. Finish does not
  charge or refund; concurrent completion shares the lesson lock and retains one active debit.
- Migration 0066 is runtime-incompatible despite additive columns: previous images cannot safely
  read/write transcript-only sessions. Recovery after these writes requires capable readers and
  writers, or restoring the paired pre-migration backup; no image-only downgrade is implied.
- `POST /jobs/:publishedJobId/publish-correction` is the distinct post-Share correction command. It
  serializes on the stable request/job ID, locks and compares the authoritative mutable draft
  version/hash, and transactionally reserves one `source_job_id` child with the frozen AssignmentV1
  artifact. Replay must match the recorded parent, draft, version, artifact and hash. The correction
  worker verifies that artifact and runs normal native new-assignment semantics with child-owned
  manifest/output identity. It does not read or merge the parent's generated audio or manifest.
- Initial publication and a successful published correction both request homework-memory extraction.
  The lineage root remains the conceptual assignment identity while the memory row records the job
  that produced its typed assignment. A correction with changed content supersedes the lineage's
  prior ready memory and triggers the normal snapshot refresh; ordinary reruns remain memory-neutral. The
  canonical commit locks the lineage and accepts only current pending work and no older publication
  than the current ready entry, so later publication wins even when extraction completes out of
  order.
- `republishOnly` is a typed rerun mode. It requires an executable schema-6 manifest, reuses its
  selected audio artifacts, and rebuilds publication. It is distinct from the post-Share correction
  path. Historical Markdown manifests are read-only and cannot be republished.

Migration `0044_assignment_step_confirmation_contract` is an intentional closed-alpha cutover. With
the API and workers stopped, it deletes pre-cutover assignment sessions, drafts, and prompt packages
in that order. It fabricates no confirmed snapshots and adds no legacy resume/edit path. Completed
jobs, published handouts and URLs, rerun lineage, homework-memory reads through completed-job
`md_storage_uri`, and referenced storage objects remain historical outputs. API `4.0.0` and DB
`0.23.0` intentionally reject the removed revisionless assignment and artifact mutation contracts.

## Environment and Docs

Read these instead of relying on this README for exhaustive env details:

- [`docs/reference/env.md`](../../docs/reference/env.md)
- [`docs/operations/prompt-gallery-bootstrap.md`](../../docs/operations/prompt-gallery-bootstrap.md)
- [`docs/operations/speech-planner-evaluation.md`](../../docs/operations/speech-planner-evaluation.md)
- [`docs/operations/postgres-backup-restore.md`](../../docs/operations/postgres-backup-restore.md)
- [`docs/operations/telegram-ops-control-panel.md`](../../docs/operations/telegram-ops-control-panel.md)

High-signal env groups for this package:

- service runtime: `BATCH_BACKEND_*`
- infra: `PG_*`, `REDIS_*`
- auth/security/upload controls: `JWT_*`, `REFRESH_*`, `ENABLE_*`
- optional ChatGPT OAuth foundation: `MCP_OAUTH_*` (see below)
- optional ops control: `BATCH_BACKEND_OPS_CONTROL_*`
- generation: assignments use `gpt-6.1-sol` at medium reasoning
  (`GEN_ASSIGNMENT_MODEL`); memory/profile workloads use
  `gpt-5.6-luna` at medium or high reasoning according to the versioned request envelope

Each generation workload resolves one provider/model target via `resolveGenerationTarget()`.
Assignment/profile calls fail explicitly without local retries or automatic model/provider switching.
Memory queue intents and initial profile enrichment freeze the target before execution and retain
existing durable retry/recovery semantics. Fresh calls support OpenAI only; retired-provider jobs reject explicitly without retargeting;
model rosters serve UI selection and Batch/planner guards. Job options no longer expose fallback
rank/tier metadata. See the [target policy and env rollout](../../docs/reference/GENERATION_PROVIDER_POLICY.md)
for workload env pairs, retained capacity controls, and deleted settings.

The historical Gemini speech-planner evaluation CLI is database-free and offline-only. Checked-in
raw outputs, model/price evidence and reports remain intact; `--live` fails before construction.
Inworld semantic voice ranking uses one strict OpenAI Responses Luna request, low reasoning/verbosity
and existing deterministic failure recovery. See the [ESL-41 inventory and combined rollout](../../docs/operations/openai-llm-migration.md).

Production study-text planning remains disabled until explicitly enabled, with `openai` plus
`gpt-5.6-luna` selected by default. Planner and ranker share OpenAI credentials and provider/model token budgets; OpenAI planner calls use high reasoning, low verbosity, `store: false`, and
each typed-timeout retry reserves a physical request. `contextual-bracket-annotation-v1` gives Luna
the complete dialogue or monologue assignment as read-only context and accepts only ordered
TTS-only annotation insertions that restore authored text exactly. Pronunciation never invokes the
planner.

All local, Compose, and production application settings come from the repository-root `.env`.
Validate it with `pnpm env:validate -- --profile=development`; use the production profile before a
VPS deployment. Mounted `.secrets/` files and generated deploy image-state files are separate.

### ChatGPT MCP OAuth foundation

This optional, disabled-by-default boundary uses `oidc-provider` 9.12.2 for the OAuth protocol,
with the existing Pipeline user and refresh-cookie login as the resource-owner identity. The
provider supplies authorization-code + PKCE S256, discovery, Client ID Metadata Documents (CIMD),
refresh rotation, token revocation, and exact redirect validation. We selected it because it
supports a custom PostgreSQL adapter, existing-user lookup, Pipeline-owned interaction pages, and
resource indicators without introducing another user directory or hosted identity provider.

Set the `MCP_OAUTH_*` variables described in [`docs/reference/env.md`](../../docs/reference/env.md)
to activate it. Public URLs use the existing `/api` proxy.

Production canonical URLs are `https://app.eslpipeline.com/api/oauth` and
`https://app.eslpipeline.com/api/mcp`. The production validator requires them to match
`CADDY_PUBLIC_HOSTNAME`, with secure host-only refresh cookies and same-origin API access.
Changing origin requires fresh browser login and explicit MCP reconnection; use the
[domain cutover/rollback runbook](../../docs/operations/canonical-domain-migration.md).

Available surfaces are:

- `/api/.well-known/oauth-protected-resource`: metadata for the `/api/mcp` resource.
- `/api/mcp`: stateless Streamable HTTP MCP endpoint. Discovery exposes two read-only tools without
  learner data; execution requires the workspace-bound MCP OAuth credential.
- `/api/oauth/.well-known/oauth-authorization-server` (and the provider's OIDC discovery alias):
  authorization-server discovery, including authorization, token, revocation, and JWKS URLs under
  `/api/oauth`. Discovery advertises only `teaching_context.read`; OIDC identity and DPoP are not
  offered by this integration.
- `/api/oauth/interaction/:uid`: existing Pipeline login continuation and explicit authorization;
  multiple memberships require choosing one workspace. The consent page states the read scope.
- `POST /api/oauth/token/revocation`: OAuth client token revocation. A revoked provider token
  invalidates its entire Pipeline grant and token family.
- `POST /api/oauth/grants/:grantId/revoke`: Pipeline REST-authenticated grant revocation.

Only ChatGPT's published CIMD client IDs and their matching redirect URI are accepted. This
includes the exact Codex desktop client ID, whose callback is restricted to HTTP on
`127.0.0.1`, a valid client-selected port, and `/callback`. The sole initial scope is
`teaching_context.read`. The authorization and token requests must name the exact
`/api/mcp` resource. PostgreSQL stores provider artifacts by hashed identifier and stores a separate
grant bound to one immutable Pipeline user and workspace. Authorization denies zero memberships,
automatically binds one, and requires a selection for multiple. Credential verification checks the
opaque access token, fixed resource and scope, current active user, current workspace membership,
grant expiry, and revocation. REST JWTs and OAuth credentials cannot cross the two verifier paths.
Codes live 60 seconds, access tokens 15 minutes, and grants/refresh tokens 14 days.
New credentials follow the explicit Pipeline grant rather than the one-hour provider browser
session: session expiry, logout, or later authorization does not revoke another active connection.
Explicit grant/token revocation, replay detection, token/grant expiry, and current user/workspace
authorization still apply. Previously issued session-bound credentials retain their stored binding;
affected connections need one reauthorization after this correction is deployed.
Consent submits the exact displayed workspace and rechecks its membership on confirmation. Provider
artifact writes and family revocation serialize on the Pipeline grant row, so replay or revocation
cannot leave an overlapping token valid. OAuth cookies use the external `/api/oauth` path and stay
Secure on HTTPS through the Caddy to nginx proxy chain.

OAuth diagnostics use the existing Pino stdout JSON stream. At `info` level,
`mcp_oauth_diagnostic` emits one summary per token exchange, initial authorization request,
or provider revocation request; rejections use `warn`. `status` is the HTTP status (authorization
errors can redirect), `oauthError` is the bounded provider error code, and `reason` adds safe
classifications such as `refresh_replayed`, `refresh_not_found`, `client_mismatch`,
`pkce_verification_failed`, `duplicate_grant_type`, or `consume_conflict`. Unknown exceptions
emit `server_error` / `server_failure` without their payloads. These hooks use the supported
[provider middleware and events](https://github.com/panva/node-oidc-provider/blob/v9.12.2/docs/events.md),
not HTTP body interception.

Provider-supported case/trailing-slash endpoint aliases receive the same diagnostics. An escaping
provider exception also emits a bounded `mcp_oauth_provider_error` fallback; the provider's supported
`error` listener prevents Koa's default stderr exception dump. Repeated session-cleanup failures
preserve the captured server-failure classification and report the escaping failure's HTTP status.

Each summary includes a generated `requestId`, completion `timestamp` in UTC, `durationMs`,
`grantType`, `clientClass` (`chatgpt_web`, `codex`, `other`), and `resourceState`
(`absent`, `expected`, `unexpected`, or `unavailable` before parsing). Client classification
describes the requested client ID shape, not verified client identity. `grantRef`, when available,
is a domain-separated HMAC reference using the first existing OAuth cookie key; it links token
family events and `mcp_oauth_authorized` without logging raw grant/user/workspace IDs. Cookie-key
rotation changes these references. No credential fingerprints or raw request/error contents are logged.

`refreshConsumed`, `refreshSaved`, and `familyRevoked` report committed adapter actions in that
request. `refreshRotated` means the provider rotated and saved the replacement; it does **not**
prove the client received it. A rejected request can have these flags set because rotation occurs
before some later validations. False flags mean no action observed in that request, not that a
grant is globally valid. `refresh_not_found` cannot distinguish unknown, expired, or previously
deleted credentials because the adapter filters expired rows and revocation deletes artifacts.
It also covers provider rejection of a matching stored token's browser-session binding. The adapter
records `grantRef` when it finds a grant-bearing row, before provider validation; a refresh failure
with a reference can therefore mean that lookup succeeded and subsequent validation rejected it.
Other unmapped rejections retain their OAuth code with a generic bounded reason. A new initial
authorization event shows a client starting authorization; it cannot reveal the client's reason,
prove a human clicked reconnect, or identify the same client session across unrelated grants.

After an authorized deployment, inspect the existing Docker logs on the production host (adjust
the container name for a nondefault Compose project):

```bash
docker logs --since 30m esl-pipeline-prod-batch-backend-1 2>&1 |
  jq -Rc 'fromjson? | select(.event == "mcp_oauth_diagnostic" or .event == "mcp_oauth_authorized")'
```

For the next naturally occurring reconnect, retain the UTC window before Docker log rotation.
Sort by `timestamp` (Pino `time` for the authorization marker), locate the first rejected token
exchange, and inspect its `oauthError`, `reason`, grant/resource/client classifications and lifecycle
flags. Match `grantRef` to preceding successes/revocations and `requestId` to the individual summary;
then compare the timing of new authorization requests. This determines whether rejection preceded
reauthorization or a client initiated it without an observed rejection. Missing references and
client-only decisions remain unproven; do not enable request-body or provider DEBUG dumps to fill
those gaps. Deployment and any deliberate live OAuth reproduction require separate authorization.

The current [OpenAI MCP authentication guidance](https://developers.openai.com/plugins/build/auth)
requires OAuth 2.1 authorization code with PKCE S256, protected-resource and authorization-server
discovery, and resource-bound tokens; it prefers CIMD when supported. The
[MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
shaped the path-aware discovery and audience handling. The endpoint uses the official TypeScript
MCP SDK 2.1.0 with stateless request/response handling for the current 2026-07-28 protocol and
stateless legacy initialize compatibility. It publishes `find_student` and
`get_student_teaching_context`, plus the connection tool `get_profile`, each with
`teaching_context.read` OAuth metadata and read-only
annotations. Missing credentials receive a tool-level linking challenge; invalid credentials
receive HTTP 401 with protected-resource discovery. The teaching-context tool calls the canonical internal
teaching-context query and returns the independently versioned `mcp_teaching_context.v1` allowlist
without internal provenance or personal facts. The MCP layer does not cache learner context.
`get_profile` uses the [documented OpenAI profile schema](https://developers.openai.com/plugins/build/auth#support-multiple-accounts)
and `openai/profile` marker. Its opaque UUID identifies the authenticated user/workspace pair;
email and a workspace label are display metadata only. Migration `0067_mcp_profile_identities`
backfills distinct pairs from all retained OAuth grants. Successful grant binding provisions
missing identities atomically and idempotently; the read tool never provisions or repairs them.
The migration is classified `incompatible` so the existing deployment procedure quiesces old
grant writers before backfill; otherwise they could create grants without identities during rollout.
Identities survive grant expiry/revocation and membership removal/recreation. Current active-user,
workspace membership and credential checks still apply; missing identities fail closed. Existing
user/workspace deletion retires the UUID, and identity updates/reassignment are rejected by SQL.
The MCP routes accept browser `Origin` only when it exactly matches the configured
`MCP_OAUTH_RESOURCE` origin; non-browser clients may omit it. MCP request database failures log
only a safe event and SQLSTATE code, without exception text or stack.
`MCP_OAUTH_ENABLED` remains false by default. Production rollout of the profile/refresh correction
and live ChatGPT verification remain separate operator actions; follow the
[`0067` deployment and recovery procedure](../../docs/backend-frontend/DEPLOYMENT.md#schema-compatibility-and-recovery).

Student-memory operator workflows:

- Candidate refresh pins an exact eligible snapshot and its recorded selected lesson source before
  delivery; delayed jobs never resolve latest. Exact ownership/source authority and candidate
  history are rechecked under the existing student lock. Snapshot inclusion alone does not suppress
  teacher review, and reviewed decisions/approved text are preserved across duplicate delivery.
  Successful snapshots superseded by canonical newer aggregates remain candidate sources while
  their full source lineage is verified; invalidated snapshots and unfinished superseded intents
  remain excluded. Read and transaction checks share this candidate-specific rule. Ordinary
  latest-ready selection and operator retry admission retain their existing restrictions.
- Full draft refresh deterministically preserves selected approved wording in its mapped structured
  fields after generation, reusing the candidate patch application. The reviewed diff shows those
  insertions; normalized exact duplicates are retained once. Paraphrases, merged facts and moved
  wording remain visible for teacher review rather than being deleted by semantic inference.
  Both draft paths report only represented
  IDs and additive `omittedCandidates` reasons. Activation returns additive `candidatePromotion`
  counts/IDs/reasons and still proves current approved wording in the actual active revision.
  Removed/changed facts stay approved; inherited links alone do not prove application. Repeated
  activation reports already promoted facts in that revision without changing promotion timestamps.
  Review writes reject a promotion/supersession that won concurrently. Endpoint paths are unchanged.
- Lesson recency uses same-student confirmed-source session links to completed lesson `starts_at`,
  with explicit extraction fallback for unknown dates and deterministic tie breakers. `generatedAt`
  retains extraction semantics; no existing artifacts/hashes or historical dates are rewritten.
  See [chronology semantics](../../docs/reference/STUDENT_MEMORY_EXTRACTION_SCHEMA_SPEC.md#chronology-and-read-semantics).
- Pre-upgrade candidate jobs without a snapshot or recorded lesson source skip with
  `student_profile_candidate_refresh_skipped` diagnostics. A separately authorized retry must target
  an eligible snapshot with recorded source context and requested candidate intent. Do not replay
  source-less jobs against latest or reopen a rejected backlog. ESL-39 adds no schema/data migration;
  publication, hosted checks and production recovery remain separate operator steps.

- Use the focused replay/backfill runbook. It distinguishes source-checkout `pnpm`/`tsx` commands
  from compiled production-container `node dist/tools/...` commands.
- Manual full snapshot rebuild is CLI-only during Gate B through the focused replay/backfill tool;
  no normal tutor-facing rebuild control is part of v1.1.
- Ordinary homework/snapshot replay requires a durable `--replay-key`: reuse it to resume the same
  intent with its frozen provider/model; a new key requests new regeneration. `--cancel-intent`
  durably fences pending/failed work. Snapshot finalization atomically links one result and rejects
  changed canonical source sets, confirmed Source authority, newer snapshots, and terminal intent.
  The existing worker reconciliation tick repairs DB-to-queue gaps and post-commit downstream
  delivery without depending on Redis job retention for business identity. See the runbook for the
  locking, currentness, cancellation, and recovery contract.
- Candidate-refresh notes distinguish `not_requested`, `pending`, `enqueued`, and `failed`
  delivery. The focused snapshot-ID retry tool recovers requested delivery without regenerating a
  snapshot or inferring candidate intent.
- OpenAI Batch replay is operator-only and disabled by default through
  `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false`; it must not be used as a substitute for fresh
  paced worker generation.
- student lesson artifact export: `pnpm --filter @esl-pipeline/batch-backend student-artifacts:export -- --student-id <student-id> [--out tmp/student-artifacts/<student-id>.zip]`
- reviewed historical source-owner remap: `pnpm --filter @esl-pipeline/batch-backend assignment-source:remap -- --apply --user-id <user-id> --target-session-id <session-id> --reason <reviewed-reason>`; the target's stored confirmed provenance must match the classified source and every change is audited
- focused runbook: [`docs/operations/student-memory-replay-backfill.md`](../../docs/operations/student-memory-replay-backfill.md)

## Validation

### Gemini Cloud TTS admission (ESL-67)

`gemini` is the default TTS provider when `ESL_TTS_DEFAULT_PROVIDER` is unset, distinct from `google` Cloud Text-to-Speech/Chirp
identity. Operator publish and rerun selections persist `gemini-3.8-flash-lite-tts` or
`gemini-3.8-flash-tts`; the Gemini lane defaults to Flash-Lite. Fresh authoring honors the backend's
configured default; saved choices remain unchanged. Full pronunciation sentences follow the study
provider/model; short item clips default to Google Chirp 3 HD. New user settings inherit the runtime
default without rewriting existing settings. The [Gemini provider README](../tts-provider-gemini/README.md) owns Cloud
authentication and synthesis configuration.

Migration `0073_gemini_tts_provider` expands provider/model checks without rewriting existing rows.
It is runtime-incompatible because older binaries cannot interpret newly persisted Gemini choices:
quiesce old API/worker writers using the normal migration deployment protocol. After the first Gemini
job or setting is saved, restoring an old image alone is not a valid rollback. Preserve the paired
pre-migration backup or use a forward-compatible correction; do not silently relabel persisted jobs
as a different provider. No production migration is implied by local migration tests.

Choose evidence using the [repo decision route](../../docs/reference/TESTING_GUIDELINES.md#choose-the-evidence-route).
The commands below run from repo root. The [package scripts](package.json) own command spelling;
[`vitest.projects.mjs`](vitest.projects.mjs) owns test membership and project options.

### Run one test

Find the test's path relative to `tests/` in `BACKEND_TEST_PROJECT_FILES`. Explicit project entries
take precedence; `pure` is the discovered remainder. Do not infer prerequisites from the filename.
For a quick read-only lookup from repo root, replace the example test below:

```bash
node --input-type=module -e 'import { BACKEND_TEST_PROJECT_FILES as projects } from "./packages/batch-backend/vitest.projects.mjs"; const file = "config.pure-environment.test.ts"; console.log(Object.entries(projects).filter(([, files]) => files.includes(file)).map(([name]) => name));'
```

An empty result means the path is not assigned; do not treat it as a pure test or successful evidence.
Build the backend and its workspace dependencies when their compiled outputs are missing or affected,
then invoke only the selected project and file:

```bash
pnpm --filter @esl-pipeline/batch-backend test:unit:setup
pnpm --filter @esl-pipeline/batch-backend exec vitest run --config vitest.config.ts --project <project> tests/<test-file>
```

Replace `<project>` and `<test-file>` with the resolved project and full path relative to `tests/`.
The direct Vitest command assumes
current compiled outputs; it does not run the setup/build script. `test:unit` performs setup itself;
`test:unit:prebuilt` and the HTTP, database, worker and media scripts assume setup has already run.

### Prerequisites and interpretation

Project setup owns the environment before test modules load:

- `pure` and deterministic `http` need no running PostgreSQL/Redis or provider credentials. Setup
  isolates ambient service/provider inputs; the HTTP project does not exercise Redis delivery.
- `migrations` and `postgres` need a disposable PostgreSQL test database. Use explicit
  `BATCH_BACKEND_TEST_PG` targeting a database ending in `_test`; [PG setup](src/bootstrap/pg-test-env.ts)
  owns URL validation and safe environment construction. The suites may create, migrate or reset
  test state; do not point them at a development or production database.
- `worker` additionally needs disposable Redis via `BATCH_BACKEND_TEST_REDIS`; the
  [service environment helper](tests/support/test-env.ts) owns its validation.
- `media` needs FFmpeg; the pure environment setup keeps provider/service inputs isolated.

The [project setup](tests/setup/project-env.mjs) is authoritative for these requirements. A focused
pass covers the selected test's assertions; deterministic HTTP evidence does not prove real DB/Redis
delivery. A service suite cannot be replaced with a pure-project invocation to obtain a pass.

For a concrete multi-suite PostgreSQL/Redis diagnostic, the existing root `test:backend:db:worker`
helper checks reachability and constructs environment before invoking the database/worker scripts.
It assumes current builds and available test services; inspect the
[helper](../../scripts/test/run-backend-db-worker-check.mjs) for current behavior. It does not start
services or perform a general CI rehearsal.

`db:generate-baseline` and `db:verify-baseline` require a Postgres connection that can create and drop temporary databases on the target server.

For repository-wide merge evidence, use hosted PR CI. If a hosted job fails, reproduce that job's
actual command and prerequisites from its retained logs; do not run a local aggregate approximation.

Docs-only changes use the [repo docs recipe](../../docs/reference/TESTING_GUIDELINES.md#docs-only-changes).

## Related

- [`packages/orchestrator/README.md`](../orchestrator/README.md)
- [`docs/design/CANONICAL_ASSIGNMENT_STATE.md`](../../docs/design/CANONICAL_ASSIGNMENT_STATE.md)
- [`docs/backend-frontend/batch-backend-ssot.md`](../../docs/backend-frontend/batch-backend-ssot.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](../../docs/backend-frontend/backend-frontend-alignment.md)

## Structured assignment generation

Homework drafting pins the active `hw_prompt_assignment_v1.md` revision and strict
`assignment_v1_generation_v8` response schema and matching first-line template marker in the existing
prompt-package envelope. Runtime reads accept legacy root rationale without normalization or the
new learner/teacher shape; post-provider fresh admission requires `learnerRationale` and required
nullable `teacherRationale`, with no root `rationale`, plus a structured outputTask with task text,
preparation/requirements/selfCheck text lists and nullable delivery. Empty lists and null delivery
avoid filler. Runtime reads independently retain the old task/extension/sampleResponse shape without
inserting fields. Each grammar item independently admits either closed legacy scalar `form` or
structured `formBlocks` and `comparisons`. Fresh generation requires structured grammar everywhere:
at least one labeled pattern with nonempty examples, and a possibly empty list of contrasts, each
with exactly two labeled example/explanation alternatives. General examples, uses and traps retain
their distinct roles; reads never convert legacy grammar. Old pinned schemas and old active template
markers fail before generation/package creation and require recreation after an explicit template
activation. This slice changes the repository template source only; it does not activate a revision.
Only OpenAI GPT-6.1 Sol
is admitted in this slice. Completed, non-refusal direct JSON is validated locally and returned
as AssignmentV1 with a pretty-printed JSON text bridge. Native execution is downstream of validated
typed authority. Old packages require recreation; historical Markdown workflows remain usable
through explicit legacy reads. There is no model-driven
Markdown repair. See [contract and rollout](../../docs/reference/ASSIGNMENT_V1.md).

Fresh generation additionally requires `metadata.instructionLanguage` (for example `en` or `ru`).
The shipped policy chooses current tutor notes, durable learner preferences in the rendered profile
or snapshot, strong current/recent learner-level evidence, then English. Russian scaffolding can
support instructions, explanations and glosses; English targets, practice, answers and samples stay
English. Existing confirmed notes/profile provenance, transcript and memory blocks supply the
evidence; unavailable sources stay unavailable. Economy is the smallest complete teaching sequence,
with useful vocabulary/chunks, progressive practice, distinct structured grammar roles, conditional
pronunciation, concrete mission self-checks and separate rationale audiences. ESL-30's v6 identity
pins the tightened cue-leakage policy, construction-scoped grammar self-checks and short form-block
labels. Comprehension questions/explanations use the selected support language while answers stay
English. The ESL-31 bounded repair advances generation identity to v7 and requires every
`practice[].items[].prompt` to be entirely English, including situation/direction text and target
excerpts. Support-language directions belong in `practice[].instructions` and explanations in
`practice[].items[].explanation`; simple English context and bare lexical cues must still preserve
the tested grammatical decision. Old v6 (and earlier) packages/templates fail without rewriting
their pins. AssignmentV1 schema/serialization 1 and renderer publication identity 3 stay unchanged.
ESL-32 advances generation to v8 and requires an authored `metadata.icon` emoji. Old packages
and active markers fail without repinning. Read fallback is display-only; no history is rewritten.
Paired backticks highlight linguistic fragments in learner content; derived speech strips only that
syntax. Teacher follow-up remains typed teacher-only data and is omitted from whole learner HTML.
ESL-33 tightens the shipped v8 instructions to mark supplied bracketed lexical hints explicitly,
author useful formula chunks, and keep each cue closed before a newline between alternatives.
The hint must not supply an inflected answer or decisive grammatical choice. No schema/marker
change, active revision replacement or prompt-package repinning is performed by this refinement.
The reusable [assignment-quality evaluation method](../../docs/operations/assignment-quality-evaluation.md)
is separate from completed history: [ESL-28](../../docs/archive/operations/assignment-quality-evaluation-esl-28.md)
and [ESL-31](../../docs/archive/operations/assignment-quality-reevaluation-esl-31.md). Those fixed
records retain their decisions and private evidence; they are not current authorization or proof of
deployment activation.

### OpenAI shared daily admission

ESL-45 reserves OpenAI tokens against efficient/larger model groups (2.25M/225k per UTC day).
Minute and daily usage rows retain the original provider/model. Atomic PostgreSQL group admission
sums those rows under a transaction lock, including same-day pre-upgrade reservations; no migration
or refund job is required. Profile refresh/promotion quota refusals return 429 before draft writes.
See [generation policy](../../docs/reference/GENERATION_PROVIDER_POLICY.md#openai-model-group-daily-budgets-esl-45)
for explicit membership, counter semantics, the bounded caps audit, and required writer quiescence
on separately authorized deployment/rollback.

## Student activity

`GET /students/:id/activity` is a student-authorized, server-paged feed alongside
(the unchanged) legacy `/timeline` and aggregate surface APIs. It accepts `category`
(`all`, `lessons`, `profile`, `billing`), inclusive workspace-local `from`/`to` dates,
`limit` (1–100, default 30) and an opaque continuation cursor. Required sources are
one PostgreSQL query: any failure returns unavailable rather than advancing beyond
missing data. The cursor binds student, workspace, requesting user, timezone and
filters. It bounds chronological traversal with a timestamp and immutable ID;
it is not a cross-request database snapshot. Refresh discovers later commits.
The first page includes committed facts even when an application action clock is
slightly ahead of the database clock.

Migration `0068_student_activity` adds a finite append-only activity record for
otherwise-lost lesson, profile/review, lifecycle, reminder hide/undo, homework-start
and terminal-failure transitions. Table-specific triggers compare allowlisted
OLD/NEW fields in the domain writer's statement transaction; required recording
failure rolls back that mutation. They ignore no-op updates, timestamp maintenance,
credit pointer housekeeping, profile deprecation side effects and automatic title
enrichment. Historical weekly-rule activity remains readable after ESL-62 retires executable rules
and captures their snapshots. The replacement lesson trigger preserves actor attribution and ledger
history without obsolete recurrence-column references. This limited recorder avoids
an event bus, outbox, queue observer or event-sourcing rewrite. Reconsider that ceiling
only when an actual independent consumer or measured read/write pressure needs it.

Known current action IDs are carried in a transaction-local audit-only setting;
existing authenticated PostgreSQL session context is also accepted. The setting
never grants database access. Stale `updated_by`, `created_by` or reviewer fields are
never treated as the current actor. Unknown actors stay unknown. Actor references
follow user deletion through `ON DELETE SET NULL`; this is the only permitted record
update. Activity deletion follows student/workspace retention. Legacy NULL workspace
ownership remains confined to the canonical default workspace, matching existing
schedule/billing semantics.

Payments, immutable credit entries/reversals, frozen publications and exact-source
transcript finish history remain authoritative and are adapted on read. A transcript
finish remains visible after homework starts or its source changes; its historical
source ID/hash/version are distinct from current workspace intent. Transcript sessions and private failure/recovery attempts retain requesting-user
ownership. Successful public HTML outcomes preserve the previous timeline’s
student/workspace visibility, including legacy recording/prompt/draft ownership
inference; they do not expose transcript contents, storage paths or private errors. Completion/debit and restore/reversal
are related by persisted activity IDs established from the same transaction and lesson,
with student/workspace validation. Parent rows are paged before effects attach;
package payment/credit effects use their existing source-payment identity.

Recording guarantees one event per committed effective transition, not HTTP request
replay safety. A delayed retry after an intervening action retains existing command
semantics. Read-time legacy facts do not invent old transitions or actors. No historical
backfill runs; the API labels `recorded`, `retained` and `legacy` evidence and does not
claim a verified rollout start date. Record the final writer-activation boundary and
any rollback interruption in deployment evidence. `0068` is runtime-compatible:
older writers retain their domain behavior and table triggers still record applicable
transitions; old recurrence writers do not emit the new correlated rule event. Keep
that limitation explicit if a prior image is restored. API 11.4 / DB 4.1 are additive.

Focused evidence belongs to the existing PostgreSQL timeline, schedule/billing,
student-area authorization, profile candidate and no-homework owner suites. The
activity assertions exercise actual owner actions and query results; legacy timeline
coverage is retained for its remaining callers. Regenerate and verify `schema.sql`
with the existing `db:generate-baseline` / `db:verify-baseline` tools when migration SQL
changes. This feature introduces no new test-project classification.

A disposable PostgreSQL 18.6 probe with 10,001 parent facts and 1,000 linked credits
measured approximately 24 ms for All and 22 ms for Payments & credits after resolving
billing-bearing parent IDs once in SQL. A correlated lookup per parent measured about
1.5 seconds and was removed. These are local query-plan observations, not a production
latency promise; measure again before adding indexes, caches or another pagination layer.
