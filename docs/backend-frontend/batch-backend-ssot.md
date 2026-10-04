# Batch Backend SSOT (Current Architecture)

## Meta

- Audience: maintainers and implementing agents.
- Read Time: 8 minutes.
- Authority Level: Backend architecture and service-boundary reference.
- Last Verified Against: 2026-09-12 repo state.
- Owner: backend/frontend maintainers + automation agents.
- Review Cadence: monthly or after major backend workflow changes.
- Status: `reference`.

## Purpose

- Define the current service boundary and core invariants for `@esl-pipeline/batch-backend`.
- Provide implementation-safe navigation without re-reading the full codebase.

## Canonical Sources

1. [`docs/reference/agents-ssot.md`](../reference/agents-ssot.md)
2. [`docs/backend-frontend/backend-frontend-alignment.md`](backend-frontend-alignment.md)
3. [`packages/batch-backend/src`](../../packages/batch-backend/src)
4. [`packages/batch-backend/README.md`](../../packages/batch-backend/README.md)

## Service Role

`@esl-pipeline/batch-backend` is the asynchronous execution and workflow API for batch mode.
It owns:

- Authenticated HTTP surface for recording/transcript/prompt/draft/job workflows.
- Authenticated student-memory inspection and operator health surfaces plus prompt-package
  provenance inspection.
- Queue-backed job orchestration and worker lifecycle.
- Persistence of workflow artifacts in Postgres.
- Integration bridge to orchestrator for final publish execution.

It does not redefine orchestrator pipeline semantics.

## Layered Architecture

- `src/config`: env parsing and runtime config.
- `src/domain`: repositories/models for persistent entities.
- `src/application`: workflow orchestration logic.
- `src/infrastructure`: DB, Redis/BullMQ, storage, external provider adapters.
- `src/transport`: HTTP server routes and worker entrypoints.

Main entrypoints:

- API server: [`src/transport/http-server.ts`](../../packages/batch-backend/src/transport/http-server.ts)
- Worker runner: [`src/transport/worker-runner.ts`](../../packages/batch-backend/src/transport/worker-runner.ts)

## Core Runtime Dependencies

- Postgres (`PG_*`): primary durable store.
- Redis (`REDIS_*`): queue backing via BullMQ.
- Optional object storage / manifest store via orchestrator env/config.
- External provider credentials (ElevenLabs, generation providers) as required by active workflows.

Env reference: [`docs/reference/env.md`](../reference/env.md)

## Canonical API Surface (Active)

- Auth: `/auth/*`
- Recordings/transcripts:
  - `POST /recordings/upload`
  - `GET /recordings/:id`
  - `GET|PUT /recordings/:id/transcript`
  - `POST /recordings/:id/transcribe`
- Prompt and drafts:
  - `GET /config/prompts`
  - `POST /recordings/:id/prompt-package`
  - `GET /prompt-packages/:id` - canonical prompt-package lineage and assignment-level memory provenance inspection surface
  - `POST /prompt-packages/:id/draft`
  - `GET /drafts/:id`
  - `POST /drafts/:id/materialize`
- Students and student memory:
  - `GET /students/:id/memory`
  - `GET /students/:id/memory/health`
  - `GET /students/:id/lesson-memory`
  - `GET /students/:id/homework-memory`
  - `GET /students/:id/memory-snapshots`
- Tutor business data:
  - `GET|PUT /business/settings`
  - `GET /business/schedule`
  - `GET /business/stats`
  - `GET /students/:id/surfaces/schedule-billing`
- Jobs and events:
  - `GET /jobs/:id`
  - `POST /jobs/:id/approve`
  - `POST /jobs/:id/actions`
  - `GET /jobs/events`
- Validation:
  - `POST /validation/markdown`

For live readiness/status and UI parity, use the alignment tracker:
[`docs/backend-frontend/backend-frontend-alignment.md`](backend-frontend-alignment.md)

## Prompt Catalog Model (DB-Canonical)

Prompt templates are runtime-managed from Postgres revisions. Foundational profiles are student-owned
revision histories; see [ABO-12 cutover](../operations/student-profile-revision-cutover.md).

Invariants:

- Catalog options/defaults come from active DB prompt assets.
- Assignment Templates are service-owned global configuration in V1: only admins/operators may
  manage templates and revisions, while ordinary tutors consume the active/default catalog through
  assignment generation. Tutor-owned or workspace-scoped template customization is not currently
  shipped.
- Startup validation fails when configured defaults are not active.
- Bootstrap is required for fresh environments:
  - `pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap:dry`
  - `pnpm --filter @esl-pipeline/batch-backend run prompt-assets:bootstrap`

Runbook: [`docs/operations/prompt-gallery-bootstrap.md`](../operations/prompt-gallery-bootstrap.md)

## Data and Workflow Invariants

- Artifacts are ID-based (`recording`, `transcript`, `prompt package`, `draft`, `job`), not user-managed filesystem paths.
- New structured assignments persist only validated AssignmentV1 JSON. API/durable references name
  format, schema/serialization version, working version, canonical hash and immutable JSON URI.
  Invalid textarea state remains local; frozen AssignmentV1 is the native execution input. Historical
  Markdown is read through explicit legacy dispatch. See [AssignmentV1 authority](../reference/ASSIGNMENT_V1.md)
  for confirmation, correction, memory and migration rollback boundaries.
- Approval boundary is explicit: draft materialization precedes publish execution.
- Worker processing is queue-driven and stateful; transitions are persisted.
- Cancellation is cooperative for in-flight jobs.
- SSE may be supplemented by polling fallback in frontend UX.
- Job status endpoint is canonicalized to `GET /jobs/:id`; legacy `/jobs/:id/status` alias is retired.
- Auth middleware and `/auth/*` routes are wired from one `AuthService` instance created from loaded runtime config (no constructor env fallback path).
- Tutor business and student schedule/billing handlers resolve a workspace from the authenticated
  user's membership and pass that identity explicitly through application reads and writes. Foreign
  students, lessons, and mismatched child records are non-enumerating not-found results and cannot be
  mutated. Legacy null-workspace records are compatible only with the default workspace.
- Student timeline type filters accept canonical event types only (for example `job_awaiting_approval`), without legacy aliases.
- Worker manifest execution does not retry with filesystem store when S3 manifest configuration is invalid or missing.

## Migrations and Schema Safety

- Schema changes are managed under:
  - [`packages/batch-backend/migrations`](../../packages/batch-backend/migrations)
- Fresh-install baseline is generated at:
  - [`packages/batch-backend/schema.sql`](../../packages/batch-backend/schema.sql)
- Expected operational commands:
  - `pnpm --filter @esl-pipeline/batch-backend db:status`
  - `pnpm --filter @esl-pipeline/batch-backend db:migrate`
  - `pnpm --filter @esl-pipeline/batch-backend db:verify`
  - `pnpm --filter @esl-pipeline/batch-backend db:generate-baseline`
  - `pnpm --filter @esl-pipeline/batch-backend db:verify-baseline`
- Existing databases upgrade through migrations; brand-new databases may initialize from the generated fresh baseline.
- Baseline generation/verification commands require a Postgres connection that can create and drop temporary databases.
- Runtime legacy schema patching (`ensureJobsSchema`) is retired and rejects all invocations.
- Schema changes must land in versioned migrations; generated baseline verification protects parity.
- CI also verifies that the generated baseline matches the full migrated schema.
- Manual migration mode can be made fail-fast on pending migrations (`PG_FAIL_ON_PENDING_MIGRATIONS`; default enabled in production).
- Inventory mapping of legacy patch groups to migration parity:
  - [`docs/backend-frontend/batch-backend-legacy-schema-inventory.md`](./batch-backend-legacy-schema-inventory.md)

## Local/CI Validation

Recommended checks when changing backend behavior:

1. `pnpm --filter @esl-pipeline/batch-backend typecheck`
2. `pnpm --filter @esl-pipeline/batch-backend test`
3. Postgres-backed tests in CI must remain green (`postgres tests`, `worker integration`).

Student-memory repair is described once in
[`docs/operations/student-memory-replay-backfill.md`](../operations/student-memory-replay-backfill.md).
Use its source-checkout or compiled production-container commands; all resulting work is consumed
by `student-memory-worker`. Normal lesson/homework-triggered snapshot refresh is incremental and
budget-guarded; manual full rebuild remains an explicit CLI replay/backfill action.

## Change Policy

When modifying backend behavior:

- Update this file when service boundaries or invariants change.
- Update alignment status when capability readiness changes.
- Update `docs/reference/env.md` when env contracts change.

If this doc and code conflict, code plus tests are the immediate truth; then update docs in the same change.

### AssignmentV1 native execution (ESL-6)

Structured jobs execute frozen, validated AssignmentV1 directly through orchestrator, TTS and native
HTML; typed preview uses the same renderer. No active PMD projection or temporary Markdown source
is created. Native renderer 2 / manifest schema 6 carry canonical assignment and publication
metadata; API 9 / validator 3 retire Markdown processing while manifest contract 4 keeps historical
read semantics. Historical Markdown and renderer-1 manifests are read-only evidence under ABO-30.
No correction, retry, rerun, resume, rendering, TTS, publication, memory processing or conversion is supported. Editable JSON authority, source authorization, CAS,
lineage, cast/speech provenance and selected audio-family reuse remain unchanged. See
[AssignmentV1](../reference/ASSIGNMENT_V1.md) for the canonical execution contract.
