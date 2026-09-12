# @esl-pipeline/batch-backend

## Meta

- Audience: maintainers and implementing agents.
- Authority Level: package entrypoint and operational usage guide.
- Last Verified Against: 2026-09-09 recording-ingest closeout state.
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

It does not redefine orchestrator behavior. Contract and architecture detail stay in:

- [`docs/backend-frontend/batch-backend-ssot.md`](../../docs/backend-frontend/batch-backend-ssot.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](../../docs/backend-frontend/backend-frontend-alignment.md)

## Runtime Surface

Core surfaces:

- jobs, drafts, prompt packages, recordings, students, auth
- tutor-pasted transcript sources under `POST /recordings/transcript-source`; these create a
  student-owned recording/transcript pair with `manual_transcript` source and `manual` provider
  provenance without enqueueing speech-to-text work
- student archive/restore under `/students/:id/archive` and `/students/:id/restore`; archived students are hidden from default student reads without deleting history
- student-area route payloads under `/students/:id/surfaces/overview`, `/students/:id/surfaces/learning`, and `/students/:id/surfaces/history`
- student schedule/billing route payloads under `/students/:id/surfaces/schedule-billing`, including lesson-credit state and elapsed lesson homework follow-ups
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
- Canonical lesson/homework/snapshot extraction reserves the shared generation budget before its
  provider call and records actual token use after success. If that post-success accounting write
  is unavailable, the completed result is preserved and a privacy-safe metric records the gap;
  the original reservation remains enforced. Minute RPM/TPM limits and provider 429 responses
  defer the same BullMQ job/provider/model until its safe timestamp; they do not consume a generic
  failure retry or silently fall back to another provider.
- Prompt catalog runtime is DB-canonical.
- Checked-in prompt assets seed/reference that catalog. Bootstrap imports changed content as a draft
  when an active revision already exists; service/admin activation is required before the changed
  revision becomes generation input in an existing environment.
- Prompt-package lineage is the canonical assignment-level student-memory provenance surface. When
  canonical memory lookup is unavailable, prompt packages carry explicit unavailable memory text
  instead of treating the layer as empty.
- Lesson-linked homework lineage is nullable and explicit across assignment sessions, prompt packages, drafts, jobs, and homework-memory entries; schedule surfaces summarize that state for teacher follow-ups.
- Student-memory snapshot refresh is incremental and budget-guarded for normal lesson/homework
  triggers; replay/backfill is source-truth driven and version 1 repair uses regenerate workflows
  rather than manual memory-row editing.
- A snapshot is current ready state only when every referenced lesson-memory row exists, belongs to
  the same student, remains ready, and carries confirmed-source provenance. Snapshot source-ID
  columns own coverage lineage; matching `generation_notes` arrays are diagnostics only.
- Schema changes belong in versioned migrations; runtime legacy patching is emergency-only.
- Fresh database bootstrap uses the generated `schema.sql` baseline; existing databases upgrade through versioned migrations.
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
- Active lesson-source ownership conflicts return the owning canonical assignment instead of a
  generic server error. A narrowly identifiable partial session shell (Student confirmed,
  transcript known, recording missing, no downstream work) resolves to that canonical assignment
  on read. Recovery also rejects any prompt/draft pair whose draft does not belong to the selected
  prompt and student.
- Source confirmation is the only assignment-flow lesson-memory trigger. Its durable intent and
  BullMQ identity are keyed by transcript plus confirmed hash, and the worker reads the confirmed
  URI from its payload rather than the transcript's mutable working pointer. Changed confirmed
  content temporarily makes memory unavailable until its automatic replacement succeeds.
- Prompt generation reads confirmed Source and Context inputs. Preview and Share read confirmed
  Create content, so newer autosaved recovery cannot silently enter downstream output.
- Share reserves one existing job row with a stable database/BullMQ ID. Retry and ambiguous-response
  reconciliation reuse that identity. An unpublished failed/queued root is lineage-validated and
  made runnable in PostgreSQL before its matching retained BullMQ job is reactivated in place;
  generic queue reconciliation remains strict. An intentional rerun remains a new `source_job_id`
  child.
- `confirmedStep = 'share'` is the sole completed predicate. Completed sessions remain immutable
  provenance for their historical jobs/handouts, are not resumable or in progress, and do not block
  a new assignment for the same recording. Job status DTOs expose the optional retained
  `assignmentSessionId` through rerun ancestry so post-cutover history can reopen confirmed inputs;
  pre-cutover jobs return no link. There is no assignment archival or archive-retry state.
- `POST /jobs/:publishedJobId/publish-correction` is the distinct post-Share correction command. It
  serializes on the stable request/job ID, locks and compares the authoritative mutable draft
  version/hash, and transactionally reserves one `source_job_id` child against the server-owned
  content-addressed Markdown URI. Replay must match the recorded parent, draft, version, and hash.
  The correction worker hash-validates that immutable input and runs normal new-assignment pipeline
  semantics with child-owned manifest/output identity. It does not read or merge the parent's
  generated audio or manifest.
- Initial publication and a successful published correction both request homework-memory extraction.
  The lineage root remains the conceptual assignment identity while the memory row records the job
  that produced its Markdown. A correction with changed content supersedes the lineage's prior ready
  memory and triggers the normal snapshot refresh; ordinary reruns remain memory-neutral. The
  canonical commit locks the lineage and accepts only current pending work and no older publication
  than the current ready entry, so later publication wins even when extraction completes out of
  order.
- Historical `republishOnly` remains a rerun of the parent's frozen Markdown with its existing
  artifact-reuse contract. It is not a draft-correction path.

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
- optional ops control: `BATCH_BACKEND_OPS_CONTROL_*`
- generation: assignments use `gpt-5.6-sol` at medium reasoning; memory/profile workloads use
  `gpt-5.6-luna` at medium or high reasoning according to the versioned request envelope

The speech-planner evaluation CLI is database-free and fail-closed. Its fixed live baseline counts
physical provider requests with no automatic retry, while checked-in TTS 1.5 identity controls run
through the production capability, renderer, and analysis boundaries with zero provider calls. See
the evaluation runbook for immutable artifact, resume, privacy, and current-day budget requirements.

Production study-text planning remains disabled until explicitly enabled, with `openai` plus
`gpt-5.6-luna` selected by default. Providers use separate credentials, allowlists, and
provider/model budgets; OpenAI planner calls use high reasoning, low verbosity, `store: false`, and
each typed-timeout retry reserves a physical request. `contextual-bracket-annotation-v1` gives Luna
the complete dialogue or monologue assignment as read-only context and accepts only ordered
TTS-only annotation insertions that restore authored text exactly. Pronunciation never invokes the
planner.

All local, Compose, and production application settings come from the repository-root `.env`.
Validate it with `pnpm env:validate -- --profile=development`; use the production profile before a
VPS deployment. Mounted `.secrets/` files and generated deploy image-state files are separate.

Student-memory operator workflows:

- Use the focused replay/backfill runbook. It distinguishes source-checkout `pnpm`/`tsx` commands
  from compiled production-container `node dist/tools/...` commands.
- Manual full snapshot rebuild is CLI-only during Gate B through the focused replay/backfill tool;
  no normal tutor-facing rebuild control is part of v1.1.
- Candidate-refresh notes distinguish `not_requested`, `pending`, `enqueued`, and `failed`
  delivery. The focused snapshot-ID retry tool recovers requested delivery without regenerating a
  snapshot or inferring candidate intent.
- OpenAI Batch replay is operator-only and disabled by default through
  `STUDENT_MEMORY_OPENAI_BATCH_ENABLED=false`; it must not be used as a substitute for fresh
  paced worker generation.
- student lesson artifact export: `pnpm --filter @esl-pipeline/batch-backend student-artifacts:export -- --student-id <student-id> [--out tmp/student-artifacts/<student-id>.zip]`
- focused runbook: [`docs/operations/student-memory-replay-backfill.md`](../../docs/operations/student-memory-replay-backfill.md)

## Validation

From repo root:

```bash
pnpm --filter @esl-pipeline/batch-backend build
pnpm --filter @esl-pipeline/batch-backend test
pnpm --filter @esl-pipeline/batch-backend test:integration:http
pnpm --filter @esl-pipeline/batch-backend test:media
pnpm --filter @esl-pipeline/batch-backend db:verify-baseline
```

Backend tests are classified by prerequisite in [`vitest.projects.mjs`](vitest.projects.mjs): pure unit,
deterministic in-process HTTP, PostgreSQL migrations, PostgreSQL queries, PostgreSQL + Redis worker
integration, or the real FFmpeg-backed media boundary. The configuration retains the established HTTP
integration prefix and positively lists the other non-pure prerequisites; pure unit is the guarded
discovered remainder. Package scripts select named Vitest projects, so update the configuration once
when a test's prerequisites change. Project setup owns the safe test environment before modules load,
including scrubbing ambient service and provider credentials from direct pure-test entrypoints.

`db:generate-baseline` and `db:verify-baseline` require a Postgres connection that can create and drop temporary databases on the target server.

For repository-wide merge evidence, use hosted PR CI. If a hosted job fails, reproduce that job's
actual command and prerequisites from its retained logs; do not run a local aggregate approximation.

Docs-only changes use:

```bash
pnpm docs:check
```

## Related

- [`packages/orchestrator/README.md`](../orchestrator/README.md)
- [`docs/design/CANONICAL_ASSIGNMENT_STATE.md`](../../docs/design/CANONICAL_ASSIGNMENT_STATE.md)
- [`docs/backend-frontend/batch-backend-ssot.md`](../../docs/backend-frontend/batch-backend-ssot.md)
- [`docs/backend-frontend/backend-frontend-alignment.md`](../../docs/backend-frontend/backend-frontend-alignment.md)
